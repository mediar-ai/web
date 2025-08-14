from modal_apps.lib import locks


class Cursor:
    def __init__(self):
        self.executed = []
        self.executemany_calls = []

    def execute(self, query):
        self.executed.append(str(query))

    def executemany(self, query, params):
        self.executemany_calls.append((str(query), list(params)))


def test_cleanup_stale_machine_locks_runs_delete():
    cur = Cursor()
    locks.cleanup_stale_machine_locks(cur)
    assert any("DELETE FROM processing_locks" in q for q in cur.executed)
    # Ensure predicate contains the coordinator pattern
    joined = "\n".join(cur.executed)
    assert "user_id LIKE 'machine-%-coordinator'" in joined


def test_record_and_release_acquired_locks():
    acquired = []
    locks.record_acquired_lock(acquired, "machine-1-coordinator", "proc-1")
    locks.record_acquired_lock(acquired, "machine-2-coordinator", "proc-2")
    assert ("machine-1-coordinator", "proc-1") in acquired
    assert ("machine-2-coordinator", "proc-2") in acquired

    cur = Cursor()
    locks.release_acquired_locks(cur, acquired)
    assert cur.executemany_calls, "executemany should be called for deletions"
    query, params = cur.executemany_calls[0]
    assert "DELETE FROM processing_locks" in query
    # Ensure values propagated
    assert params[0] == ("machine-1-coordinator", "proc-1")
    assert params[1] == ("machine-2-coordinator", "proc-2")


