import os
import pytest
import psycopg2


PROD_RO_DSN_ENV = "PROD_RO_DSN"


def require_prod_dsn():
    dsn = os.getenv(PROD_RO_DSN_ENV) or os.getenv("SUPABASE_DB_RO_URL")
    if not dsn:
        pytest.skip(f"Set {PROD_RO_DSN_ENV} or SUPABASE_DB_RO_URL to run production read-only smoke tests")
    return dsn


def connect_ro(dsn: str):
    # Use libpq PGOPTIONS to force read-only/timeout without modifying app code
    pgoptions = os.getenv("PGOPTIONS", "")
    flags = "-c default_transaction_read_only=on -c statement_timeout=5000"
    os.environ["PGOPTIONS"] = f"{pgoptions} {flags}".strip()
    return psycopg2.connect(dsn)


def test_prod_ro_connect_and_select_one():
    dsn = require_prod_dsn()
    conn = connect_ro(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            assert cur.fetchone()[0] == 1
    finally:
        conn.close()


def test_prod_ro_simple_core_counts():
    dsn = require_prod_dsn()
    conn = connect_ro(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM deployed_workflows")
            count_wf = cur.fetchone()[0]
            assert isinstance(count_wf, (int,))

            cur.execute("SELECT COUNT(*) FROM workflow_executions")
            count_exec = cur.fetchone()[0]
            assert isinstance(count_exec, (int,))
    finally:
        conn.close()


def test_prod_ro_views_present_if_exists():
    dsn = require_prod_dsn()
    conn = connect_ro(dsn)
    try:
        with conn.cursor() as cur:
            try:
                cur.execute("SELECT 1 FROM deployed_workflows_with_sequence LIMIT 1")
                _ = cur.fetchone()
            except Exception as e:
                pytest.skip(f"View deployed_workflows_with_sequence not available: {e}")
    finally:
        conn.close()


def test_prod_ro_enforced_by_transaction():
    dsn = require_prod_dsn()
    conn = connect_ro(dsn)
    try:
        with conn.cursor() as cur:
            # Ensure we're in a read-only transaction and DDL is blocked
            cur.execute("SET TRANSACTION READ ONLY")
            with pytest.raises(Exception):
                cur.execute("CREATE TEMP TABLE tmp_x(id int)")
    finally:
        conn.close()


