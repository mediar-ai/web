import pytest
from datetime import datetime, timezone

from modal_apps.sequential_processor import (
    is_event_already_processed,
    get_next_unprocessed_event_with_lock,
    acquire_processing_lock,
    release_processing_lock,
    simple_cleanup_locks,
    cleanup_expired_locks,
)


class SPCursor:
    """Cursor mock with programmable fetchone/fetchall and rowcount behavior."""

    def __init__(self, fetchone_sequence=None, fetchall_sequence=None, rowcount_sequence=None):
        self.fetchone_sequence = list(fetchone_sequence or [])
        self.fetchall_sequence = list(fetchall_sequence or [])
        self.rowcount_sequence = list(rowcount_sequence or [])
        self.executed = []
        self._rowcount = 0
        self.closed = False

    @property
    def rowcount(self):
        # Last set by execute; returns current value
        return self._rowcount

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    def execute(self, query, params=None):
        self.executed.append((str(query), params))
        # Advance rowcount for statements that care (DELETE/UPDATE)
        if self.rowcount_sequence:
            self._rowcount = self.rowcount_sequence.pop(0)
        else:
            # Default to 0 if not specified
            self._rowcount = 0

    def fetchone(self):
        if self.fetchone_sequence:
            return self.fetchone_sequence.pop(0)
        return None

    def fetchall(self):
        if self.fetchall_sequence:
            return self.fetchall_sequence.pop(0)
        return []

    def close(self):
        self.closed = True


class SPConnection:
    def __init__(self, cursor: SPCursor):
        self._cursor = cursor
        self.commit_calls = 0
        self.rollback_calls = 0
        self.closed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commit_calls += 1

    def rollback(self):
        self.rollback_calls += 1

    def close(self):
        self.closed = True


def test_is_event_already_processed_true():
    cur = SPCursor(fetchone_sequence=[(True,)])
    result = is_event_already_processed(cur, "user-1", 123, datetime.now(timezone.utc))
    assert result is True
    assert any("SELECT EXISTS" in q for (q, _p) in cur.executed)


def test_is_event_already_processed_false():
    cur = SPCursor(fetchone_sequence=[(False,)])
    result = is_event_already_processed(cur, "user-2", 456, datetime.now(timezone.utc))
    assert result is False


def test_acquire_processing_lock_insert_success():
    # INSERT ... RETURNING id -> fetchone returns non-None
    cur = SPCursor(fetchone_sequence=[(1,)])
    conn = SPConnection(cur)
    ok = acquire_processing_lock(cur, conn, "u1", 11, "p1")
    assert ok is True
    assert conn.commit_calls == 1
    assert any("INSERT INTO processing_locks" in q for (q, _p) in cur.executed)


def test_acquire_processing_lock_conflict_but_owned_and_not_expired():
    # INSERT returns None; then SELECT returns same processor with future expires_at
    from datetime import timedelta

    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    cur = SPCursor(fetchone_sequence=[None, ("p1", "in_progress", future)])
    conn = SPConnection(cur)
    ok = acquire_processing_lock(cur, conn, "u1", 11, "p1")
    assert ok is True
    # No commit expected since we reused existing lock (function returns True without commit)


def test_acquire_processing_lock_conflict_owned_but_expired():
    from datetime import timedelta

    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    cur = SPCursor(fetchone_sequence=[None, ("p1", "in_progress", past)])
    conn = SPConnection(cur)
    ok = acquire_processing_lock(cur, conn, "u1", 11, "p1")
    assert ok is False


def test_release_processing_lock_updates_and_commits():
    cur = SPCursor()
    conn = SPConnection(cur)
    release_processing_lock(cur, conn, "u1", 11, "p1", "completed")
    assert conn.commit_calls == 1
    assert any("UPDATE processing_locks" in q for (q, _p) in cur.executed)


def test_simple_cleanup_locks_counts_and_commit():
    # First DELETE rowcount 2, second DELETE rowcount 4
    cur = SPCursor(rowcount_sequence=[2, 4])
    conn = SPConnection(cur)
    total = simple_cleanup_locks(cur, conn)
    assert total == 6
    assert conn.commit_calls == 1


def test_cleanup_expired_locks_counts_and_commit():
    # First DELETE rowcount 3, second DELETE rowcount 1
    cur = SPCursor(rowcount_sequence=[3, 1])
    conn = SPConnection(cur)
    total = cleanup_expired_locks(cur, conn, "user-xyz")
    assert total == 4
    assert conn.commit_calls == 1


def test_get_next_unprocessed_event_with_lock_happy_path(monkeypatch):
    # Sequence of fetchone calls inside function:
    # 1) cleanup_expired_locks uses rowcount (no fetchone)
    # 2) SELECT COUNT(*) total_events -> (100,)
    # 3) SELECT COUNT(*) total_analyses -> (50,)
    # 4) SELECT COUNT(*) locked_events -> (0,)
    # 5) main event SELECT -> (event tuple)
    # 6) acquire_processing_lock INSERT ... RETURNING id -> (1,)
    event_payload = {"payload": {"event": {"screen": {"ui_tree": None}}}}
    now = datetime.now(timezone.utc)
    event_tuple = (777, "user-abc", "sess-1", now, event_payload)

    cur = SPCursor(
        fetchone_sequence=[(100,), (50,), (0,), event_tuple, (1,)],
        rowcount_sequence=[0, 0],
    )
    conn = SPConnection(cur)

    # Call function
    event, event_id = get_next_unprocessed_event_with_lock(cur, conn, "user-abc", "proc-1")
    assert event_id == 777
    assert event == event_tuple


def test_get_next_unprocessed_event_with_lock_no_event():
    cur = SPCursor(
        fetchone_sequence=[(10,), (5,), (0,), None],
        rowcount_sequence=[0, 0],
    )
    conn = SPConnection(cur)
    event, event_id = get_next_unprocessed_event_with_lock(cur, conn, "user-abc", "proc-1")
    assert event is None and event_id is None


