import psycopg2
import psycopg2.extras
import os
import sys
import io

# --- IMPORTANT ---
# This script assumes you have set the following environment variables:
# OLD_DB_CONN_STRING: The connection string for the source (old) database.
# NEW_DB_CONN_STRING: The connection string for the destination (new) database.
#
# Example:
# export OLD_DB_CONN_STRING="postgresql://postgres:password@db.old-project.supabase.co:5432/postgres"
# export NEW_DB_CONN_STRING="postgresql://postgres.zrfvohqbvwepwulvanuc:NBKtcRVjpKjZVwMm@aws-0-us-east-2.pooler.supabase.com:5432/postgres"

TABLES_TO_MIGRATE = [
    # "users", # This table is not used and has data integrity issues. Skipping.
    "low_level_events",
    "user_activity_data",
    "low_level_workflow_analyses",
    "llm_traces",
    "low_level_datasets",
    "session_metadata"
]

def migrate_table_with_copy(old_conn, new_conn, table_name):
    """
    Uses the PostgreSQL COPY command to efficiently stream data from the
    old DB to the new one, handling schema differences.
    """
    try:
        print(f"--- Migrating table: {table_name} ---")
        
        old_cur = old_conn.cursor()
        new_cur = new_conn.cursor()

        # 1. Get column schemas and find intersection
        new_cur.execute(f"SELECT * FROM public.{table_name} LIMIT 0;")
        new_colnames = [desc[0] for desc in new_cur.description]
        
        old_cur.execute(f"SELECT * FROM public.{table_name} LIMIT 0;")
        old_colnames = [desc[0] for desc in old_cur.description]
        
        rename_map = {'clerk_id': 'clerk_user_id'}
        shared_colnames_new = []
        shared_colnames_old = []
        
        for old_col in old_colnames:
            new_col = rename_map.get(old_col, old_col)
            if new_col in new_colnames:
                shared_colnames_old.append(old_col)
                shared_colnames_new.append(new_col)
        
        if not shared_colnames_new:
            print(f"  > No shared columns found for table {table_name}. Skipping.")
            return

        print(f"  > Migrating shared columns: {', '.join(shared_colnames_new)}")

        # 2. Use COPY command for efficient data transfer
        # Create an in-memory text buffer to act as the pipe
        f = io.StringIO()
        
        # 3. COPY data from OLD database TO the buffer
        copy_from_sql = f"COPY (SELECT {', '.join(shared_colnames_old)} FROM public.{table_name}) TO STDOUT WITH CSV HEADER"
        print("  > Exporting data from old database...")
        old_cur.copy_expert(copy_from_sql, f)
        f.seek(0) # Rewind buffer to the beginning

        # 4. COPY data FROM the buffer TO the new database
        copy_to_sql = f"COPY public.{table_name} ({', '.join(shared_colnames_new)}) FROM STDIN WITH CSV HEADER"
        print("  > Importing data into new database...")
        new_cur.copy_expert(copy_to_sql, f)
        
        # Commit the transaction for the current table
        new_conn.commit()

        # The row count is not easily available with this method, but we can query it
        new_cur.execute(f"SELECT COUNT(*) FROM public.{table_name}")
        count = new_cur.fetchone()[0]
        print(f"  > Successfully migrated data. New table count: {count}")

    except psycopg2.Error as e:
        print(f"\n❌ An error occurred during migration for table {table_name}: {e}")
        new_conn.rollback() # Rollback changes for the failed table
        raise

def run_migration():
    """Connects to both databases and orchestrates the data migration."""
    old_conn_string = os.environ.get("OLD_DB_CONN_STRING")
    new_conn_string = os.environ.get("NEW_DB_CONN_STRING")

    if not old_conn_string or not new_conn_string:
        print("Error: OLD_DB_CONN_STRING and NEW_DB_CONN_STRING environment variables must be set.")
        sys.exit(1)

    old_conn = None
    new_conn = None

    try:
        print("Connecting to OLD database...")
        old_conn = psycopg2.connect(old_conn_string)
        
        print("Connecting to NEW database...")
        new_conn = psycopg2.connect(new_conn_string)
        
        print("\nStarting data migration with COPY strategy...")
        
        for table in TABLES_TO_MIGRATE:
            # We need to run each table in its own transaction
            migrate_table_with_copy(old_conn, new_conn, table)

        print("\n✅ Data migration complete.")

    except Exception as e:
        print(f"\n❌ A critical error occurred: {e}")
    finally:
        if old_conn: old_conn.close()
        if new_conn: new_conn.close()
        print("All database connections closed.")

if __name__ == "__main__":
    run_migration() 