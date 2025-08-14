import pytest

from modal_apps.workflow_executor import get_database_connection


class CtxCursor:
    def __init__(self):
        self.executed = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    def execute(self, query):
        self.executed.append(str(query))

    def close(self):
        self.closed = True


class Conn:
    def __init__(self):
        self.autocommit = None
        self.commits = 0
        self.closed = False
        self._cursor = CtxCursor()

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def stub_db_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", "postgres://user:pass@localhost:5432/postgres")


def test_get_database_connection_sets_timeouts_and_commits(monkeypatch):
    conn = Conn()
    monkeypatch.setattr("psycopg2.connect", lambda **kwargs: conn)

    result = get_database_connection()
    assert result is conn
    assert conn.autocommit is False
    assert conn.commits >= 1

    q = "\n".join(conn._cursor.executed)
    assert "SET statement_timeout = '300s'" in q
    assert "SET idle_in_transaction_session_timeout = '600s'" in q


