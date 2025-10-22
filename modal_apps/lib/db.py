import os
import logging
import time
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


def get_database_connection(max_retries=3, retry_delay=2):
    """Create a psycopg2 connection with tuned settings and SSL error retry logic.

    Args:
        max_retries: Maximum number of connection attempts (default: 3)
        retry_delay: Delay in seconds between retries (default: 2)

    Returns:
        psycopg2 connection object

    Raises:
        Exception: If all connection attempts fail
    """
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            config = get_db_config()
            # Preserve original keys/values; psycopg2 accepts DSN dicts and discrete keys
            # Add connect_timeout for faster failure detection
            if 'dsn' in config:
                config['connect_timeout'] = 10

            conn = psycopg2.connect(**config)
            conn.autocommit = False

            with conn.cursor() as cur:
                cur.execute("SET statement_timeout = '300s'")
                cur.execute("SET idle_in_transaction_session_timeout = '600s'")
            conn.commit()

            if attempt > 1:
                logger.info(f"✓ Database connection successful on attempt {attempt}/{max_retries}")

            return conn

        except psycopg2.OperationalError as e:
            last_error = e
            error_msg = str(e)

            # Check if it's an SSL connection error that we should retry
            if "SSL connection has been closed unexpectedly" in error_msg:
                if attempt < max_retries:
                    logger.warning(f"⚠️ SSL connection failed (attempt {attempt}/{max_retries}): {error_msg}")
                    logger.info(f"   Retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)
                else:
                    logger.error(f"❌ Database connection failed after {max_retries} attempts: {error_msg}")
                    raise
            else:
                # Different error, don't retry
                logger.error(f"❌ Database connection failed (non-SSL error): %s", e)
                raise

        except Exception as e:
            logger.error("❌ Database connection failed: %s", e)
            raise

    # Should not reach here, but if we do, raise the last error
    if last_error:
        raise last_error
    raise Exception("Database connection failed: Unknown error")



