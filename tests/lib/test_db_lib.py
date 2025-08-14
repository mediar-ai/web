import os
import pytest

from modal_apps.lib import db


def test_get_db_config_prefers_dsn(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", "postgres://user:pass@host:5432/postgres")
    # Ensure discrete vars don't interfere
    monkeypatch.delenv("SUPABASE_HOST", raising=False)
    cfg = db.get_db_config()
    assert cfg == {"dsn": "postgres://user:pass@host:5432/postgres"}


def test_get_db_config_discrete(monkeypatch):
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.setenv("SUPABASE_HOST", "db.example.local")
    monkeypatch.setenv("SUPABASE_USER", "svc")
    monkeypatch.setenv("SUPABASE_PASSWORD", "secret")
    cfg = db.get_db_config()
    assert cfg["host"] == "db.example.local"
    assert cfg["user"] == "svc"
    assert cfg["password"] == "secret"
    assert cfg["port"] == 5432
    assert cfg["database"] == "postgres"


class MockCtxCursor:
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


class MockConn:
    def __init__(self):
        self.autocommit = None
        self.commits = 0
        self._cursor = MockCtxCursor()

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def close(self):
        pass


def test_get_database_connection_sets_timeouts_and_commits(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", "postgres://user:pass@host:5432/postgres")
    conn = MockConn()
    monkeypatch.setattr("psycopg2.connect", lambda **kwargs: conn)

    result = db.get_database_connection()
    assert result is conn
    assert conn.autocommit is False
    assert conn.commits >= 1
    sql = "\n".join(conn._cursor.executed)
    assert "SET statement_timeout = '300s'" in sql
    assert "SET idle_in_transaction_session_timeout = '600s'" in sql


