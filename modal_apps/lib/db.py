import os
import logging
import psycopg2


logger = logging.getLogger(__name__)


def get_db_config():
    """Resolve Postgres connection configuration from environment variables.

    Supports a full DSN or discrete SUPABASE_* variables. Keeps the exact
    semantics used in the original executor to avoid behavioral drift.
    """
    dsn = (
        os.environ.get("SUPABASE_DB_URL")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
    )
    if dsn:
        return {"dsn": dsn}

    return {
        "host": os.environ["SUPABASE_HOST"],
        "port": 5432,
        "database": "postgres",
        "user": os.environ["SUPABASE_USER"],
        "password": os.environ["SUPABASE_PASSWORD"],
    }


def get_database_connection():
    """Create a psycopg2 connection with tuned settings, matching original behavior."""
    try:
        config = get_db_config()
        # Preserve original keys/values; psycopg2 accepts DSN dicts and discrete keys
        conn = psycopg2.connect(**config)
        conn.autocommit = False

        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '300s'")
            cur.execute("SET idle_in_transaction_session_timeout = '600s'")
        conn.commit()

        return conn
    except Exception as e:
        logger.error("❌ Database connection failed: %s", e)
        raise



