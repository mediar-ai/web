import psycopg2
import psycopg2.extras
import os
import sys

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

def migrate_table(old_cur, new_cur, table_name, batch_size=10000):
    """
    Copies data from a table in the old DB to the new DB in batches,
    intelligently handling schema differences by only copying shared columns.
    """
    try:
        print(f"--- Migrating table: {table_name} ---")

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

        # 2. Use a server-side cursor for efficient, batched fetching
        select_query = f"SELECT {', '.join(shared_colnames_old)} FROM public.{table_name};"
        
        # Give the cursor a unique name
        cursor_name = f"migration_cursor_{table_name}"
        old_cur.execute(f"DECLARE {cursor_name} CURSOR FOR {select_query}")
        
        total_rows_migrated = 0
        while True:
            # 3. Fetch a batch of rows
            old_cur.execute(f"FETCH {batch_size} FROM {cursor_name};")
            batch_data = old_cur.fetchall()
            
            if not batch_data:
                break # No more data to fetch

            # 4. Insert the batch into the new table
            insert_query = f"INSERT INTO public.{table_name} ({', '.join(shared_colnames_new)}) VALUES %s"
            psycopg2.extras.execute_values(new_cur, insert_query, batch_data)
            
            total_rows_migrated += len(batch_data)
            print(f"  > Migrated {total_rows_migrated} rows...")

        print(f"  > Successfully migrated a total of {total_rows_migrated} rows to new.{table_name}.")

    except psycopg2.Error as e:
        print(f"\n❌ An error occurred during migration for table {table_name}: {e}")
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
        old_cur = old_conn.cursor()

        print("Connecting to NEW database...")
        new_conn = psycopg2.connect(new_conn_string)
        new_cur = new_conn.cursor()
        
        print("\nStarting data migration...")
        
        for table in TABLES_TO_MIGRATE:
            migrate_table(old_cur, new_cur, table)

        print("\n✅ Data migration complete.")
        new_conn.commit()

    except Exception as e:
        print(f"\n❌ A critical error occurred: {e}")
        if new_conn:
            new_conn.rollback()
    finally:
        if old_cur: old_cur.close()
        if old_conn: old_conn.close()
        if new_cur: new_cur.close()
        if new_conn: new_conn.close()
        print("All database connections closed.")

if __name__ == "__main__":
    run_migration() 