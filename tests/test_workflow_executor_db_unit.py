import pytest
import os

# Target functions to test (no edits to the source file)
from modal_apps.workflow_executor import (
    resolve_workflow_id_for_version,
    check_failure_patterns_for_workflow,
    cancel_queued_jobs,
    CONSECUTIVE_FAILURE_THRESHOLD,
)


class MockCursor:
    """Minimal psycopg2-like cursor with programmable fetch results."""

    def __init__(self, fetchone_sequence=None, fetchall_sequence=None):
        self.fetchone_sequence = list(fetchone_sequence or [])
        self.fetchall_sequence = list(fetchall_sequence or [])
        self.executed = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    def execute(self, query, params=None):
        self.executed.append((str(query), params))

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


class MockConnection:
    """psycopg2-like connection that can yield a sequence of cursors."""

    def __init__(self, cursors=None):
        self._cursors = list(cursors or [])
        self.cursor_calls = 0
        self.commit_calls = 0
        self.autocommit = False
        self.closed = False

    def cursor(self, cursor_factory=None):
        self.cursor_calls += 1
        if self._cursors:
            return self._cursors.pop(0)
        # Fallback empty cursor
        return MockCursor()

    def commit(self):
        self.commit_calls += 1

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def stub_db_env(monkeypatch):
    """Ensure DB env vars exist so get_db_config() doesn't KeyError during tests."""
    monkeypatch.setenv("SUPABASE_DB_URL", "postgres://user:pass@localhost:5432/postgres")


def test_resolve_workflow_id_single_match(monkeypatch, stub_db_env):
    """Returns the workflow id when a single row matches."""
    # First cursor for get_database_connection() SET statements
    cur_settings = MockCursor()
    # Second cursor for the SELECT in resolve_workflow_id_for_version
    cur_select = MockCursor(
        fetchall_sequence=[
            [
                {
                    "id": 42,
                    "name": "WF",
                    "status": "deployed",
                    "category": "cat",
                    "current_version": "1.0.70",
                }
            ]
        ]
    )
    conn = MockConnection([cur_settings, cur_select])

    # Patch psycopg2.connect used by get_database_connection()
    monkeypatch.setattr("psycopg2.connect", lambda **kwargs: conn)

    workflow_id = resolve_workflow_id_for_version("1.0.70")
    assert workflow_id == 42
    # Should have committed after SET statements
    assert conn.commit_calls >= 1
    # Confirm a SELECT was executed
    assert any("SELECT" in q for (q, _p) in cur_select.executed)


def test_resolve_workflow_query_contains_expected_filters(monkeypatch, stub_db_env):
    """Query text should include optional filters when provided."""
    cur_settings = MockCursor()
    cur_select = MockCursor(
        fetchall_sequence=[
            [
                {
                    "id": 7,
                    "name": "WF",
                    "status": "deployed",
                    "category": "life",
                    "current_version": "2.0.0",
                }
            ]
        ]
    )
    conn = MockConnection([cur_settings, cur_select])
    monkeypatch.setattr("psycopg2.connect", lambda **kwargs: conn)

    _ = resolve_workflow_id_for_version(
        "2.0.0", status="deployed", workflow_name_contains="quote", category="life"
    )

    # The query should have dynamic WHERE fragments
    executed_sql = "\n".join(q for (q, _p) in cur_select.executed)
    assert "w.status = %s" in executed_sql
    assert "w.category = %s" in executed_sql
    assert "w.name ILIKE %s" in executed_sql


def test_resolve_workflow_id_no_match(monkeypatch, stub_db_env):
    """Raises ValueError when no rows match the criteria."""
    cur_settings = MockCursor()
    cur_select = MockCursor(fetchall_sequence=[[]])
    conn = MockConnection([cur_settings, cur_select])
    monkeypatch.setattr("psycopg2.connect", lambda **kwargs: conn)

    with pytest.raises(ValueError) as exc:
        resolve_workflow_id_for_version("9.9.9", status="deployed", category="life")
    assert "No workflows found" in str(exc.value)


def test_resolve_workflow_id_multiple_matches(monkeypatch, stub_db_env):
    """Raises ValueError when multiple rows match the criteria."""
    cur_settings = MockCursor()
    cur_select = MockCursor(
        fetchall_sequence=[
            [
                {"id": 1, "name": "A", "status": "deployed", "category": "c", "current_version": "1.0"},
                {"id": 2, "name": "B", "status": "deployed", "category": "c", "current_version": "1.0"},
            ]
        ]
    )
    conn = MockConnection([cur_settings, cur_select])
    monkeypatch.setattr("psycopg2.connect", lambda **kwargs: conn)

    with pytest.raises(ValueError) as exc:
        resolve_workflow_id_for_version("1.0", status="deployed")
    assert "Multiple workflows" in str(exc.value)


def test_check_failure_patterns_skip_flag_true(monkeypatch):
    """When skip flag is set, it should reset and allow execution (no block)."""
    cur = MockCursor(fetchone_sequence=[(True,)])
    conn = MockConnection([cur])

    should_block, reason, _ = check_failure_patterns_for_workflow(cur, conn, workflow_id=123)
    assert should_block is False
    assert "Skip" in reason or "Skipped" in reason
    # An UPDATE should have been executed and a commit performed
    assert any("UPDATE deployed_workflows" in q for (q, _p) in cur.executed)
    assert conn.commit_calls == 1


def test_check_failure_patterns_less_than_threshold():
    """If fewer than threshold recent executions, do not block."""
    cur = MockCursor(
        fetchone_sequence=[(False,)],
        fetchall_sequence=[
            [
                {"status": "failed", "error_message": "E1"},
                # Only 2 rows < threshold
                {"status": "failed", "error_message": "E1"},
            ]
        ],
    )
    conn = MockConnection()

    should_block, reason, _ = check_failure_patterns_for_workflow(cur, conn, workflow_id=5)
    assert should_block is False
    assert reason == ""


def test_check_failure_patterns_not_all_failed():
    """If the last N are not all failed, do not block."""
    cur = MockCursor(
        fetchone_sequence=[(False,)],
        fetchall_sequence=[
            [
                {"status": "failed", "error_message": "E"},
                {"status": "completed", "error_message": None},
                {"status": "failed", "error_message": "E"},
            ]
        ],
    )
    conn = MockConnection()

    should_block, reason, _ = check_failure_patterns_for_workflow(cur, conn, workflow_id=7)
    assert should_block is False
    assert reason == ""


def test_check_failure_patterns_all_failed_but_messages_differ():
    """All failed but non-identical messages should not trigger cancel or block."""
    cur = MockCursor(
        fetchone_sequence=[(False,)],
        fetchall_sequence=[
            [
                {"status": "failed", "error_message": "E1"},
                {"status": "failed", "error_message": "E2"},
                {"status": "failed", "error_message": "E1"},
            ]
        ],
    )
    conn = MockConnection()

    should_block, reason, _ = check_failure_patterns_for_workflow(cur, conn, workflow_id=8)
    assert should_block is False
    assert reason == ""


def test_check_failure_patterns_exception_path_returns_no_block(monkeypatch):
    """If an exception occurs during check, it should return (False, 'Check error: ...')."""
    class BoomCursor(MockCursor):
        def fetchall(self):
            raise RuntimeError("boom")

    cur = BoomCursor(fetchone_sequence=[(False,)])
    conn = MockConnection()

    should_block, reason, _ = check_failure_patterns_for_workflow(cur, conn, workflow_id=99)
    assert should_block is False
    assert reason.startswith("Check error:")


def test_check_failure_patterns_all_failed_identical_triggers_cancel(monkeypatch):
    """If last N are failed with identical error messages, block and cancel queued jobs."""
    identical_error = "Boom"
    cur = MockCursor(
        fetchone_sequence=[(False,)],
        fetchall_sequence=[
            [
                {"status": "failed", "error_message": identical_error},
                {"status": "failed", "error_message": identical_error},
                {"status": "failed", "error_message": identical_error},
            ]
        ],
    )
    conn = MockConnection()

    called = {"args": None}

    def fake_cancel_queued_jobs(cur_arg, conn_arg, workflow_id, error_message):
        called["args"] = (workflow_id, error_message)
        return 2, [101, 102]

    # Patch the cancel function inside the module
    monkeypatch.setattr(
        "modal_apps.workflow_executor.cancel_queued_jobs", fake_cancel_queued_jobs
    )

    should_block, reason, _ = check_failure_patterns_for_workflow(cur, conn, workflow_id=999)
    assert should_block is True
    assert str(CONSECUTIVE_FAILURE_THRESHOLD) in reason
    assert "Cancelled 2 queued jobs" in reason
    assert called["args"] == (999, identical_error)


def test_cancel_queued_jobs_returns_count_and_ids():
    """cancel_queued_jobs should return number of cancelled rows and their ids, and commit."""
    # fetchall returns rows from the first UPDATE's RETURNING id
    cur = MockCursor(fetchall_sequence=[[(11,), (12,)]])
    conn = MockConnection([cur])

    count, ids = cancel_queued_jobs(cur, conn, workflow_id=55, original_error_message="err")
    assert count == 2
    assert ids == [11, 12]
    # Expect both updates executed and a commit
    executed_sql = "\n".join(q for (q, _p) in cur.executed)
    assert "UPDATE workflow_executions" in executed_sql
    assert "UPDATE deployed_workflows" in executed_sql
    assert conn.commit_calls == 1


