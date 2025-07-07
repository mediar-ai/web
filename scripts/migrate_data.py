import psycopg2
import psycopg2.extras
import os
import sys
import json
from datetime import date, timedelta

# --- IMPORTANT ---
# This script assumes you have set the following environment variables:
# OLD_DB_CONN_STRING: The connection string for the source (old) database.
# NEW_DB_CONN_STRING: The connection string for the destination (new) database.
#
# Example:
# export OLD_DB_CONN_STRING="postgresql://postgres:password@db.old-project.supabase.co:5432/postgres"
# export NEW_DB_CONN_STRING="postgresql://postgres.zrfvohqbvwepwulvanuc:NBKtcRVjpKjZVwMm@aws-0-us-east-2.pooler.supabase.com:5432/postgres"

TABLES_TO_MIGRATE = [
    # --- Completed ---
    # "session_metadata",
    # "low_level_workflow_analyses",
    # "low_level_datasets",
    # "low_level_workflows",
    # "low_level_workflow_labeling",
    # "synthesis_sessions",

    # --- In Progress ---
    # "workflow_analysis_jobs",  # DELETED - no longer needed with sequential processor
    "llm_traces",
    "mediar_users",
    "user_activity_data",
    "low_level_events",
]

def migrate_table_row_by_row(old_conn, new_conn, table_name):
    """
    Migrates a single table's data row by row with concise logging.
    """
    print(f"Migrating {table_name}...")
    
    try:
        with old_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as old_cur, \
             new_conn.cursor() as new_cur:
            
            # Get shared columns (use regular cursor for metadata queries)
            with old_conn.cursor() as metadata_cur:
                new_cur.execute(f"SELECT * FROM public.{table_name} LIMIT 0;")
                new_colnames = {desc[0] for desc in new_cur.description}
                
                metadata_cur.execute(f"SELECT * FROM public.{table_name} LIMIT 0;")
                old_colnames = [desc[0] for desc in metadata_cur.description]
                
                rename_map = {'clerk_id': 'clerk_user_id'}
                shared_colnames_new = []
                shared_colnames_old = []

                for old_col in old_colnames:
                    new_col = rename_map.get(old_col, old_col)
                    if new_col in new_colnames:
                        shared_colnames_old.append(old_col)
                        shared_colnames_new.append(new_col)
                
                if not shared_colnames_new:
                    print(f"  No shared columns. Skipping.")
                    return

                # Get total count for progress tracking (use regular cursor)
                metadata_cur.execute(f"SELECT COUNT(*) FROM public.{table_name}")
                total_rows = metadata_cur.fetchone()[0]
                
                if total_rows == 0:
                    print(f"  No rows to migrate.")
                    return

            # Check if table has created_at column for ordering
            order_clause = ""
            if 'created_at' in old_colnames:
                order_clause = " ORDER BY created_at"

            # Process in chunks of 50 rows at a time
            chunk_size = 50
            migrated_count = 0
            error_count = 0
            processed_rows = 0
            
            while processed_rows < total_rows:
                try:
                    # Fetch chunk of 50 rows
                    chunk_query = f"SELECT {', '.join(shared_colnames_old)} FROM public.{table_name}{order_clause} LIMIT {chunk_size} OFFSET {processed_rows}"
                    old_cur.execute(chunk_query)
                    chunk_rows = old_cur.fetchall()
                    
                    if not chunk_rows:
                        break  # No more rows
                    
                    print(f"  Processing chunk at offset {processed_rows} ({len(chunk_rows)} rows)...")
                    
                    # Process each row in the chunk
                    for row in chunk_rows:
                        processed_rows += 1
                        try:
                            # Prepare values for insertion (handle column renaming and JSON serialization)
                            values = []
                            for old_col in shared_colnames_old:
                                value = row[old_col]
                                
                                # Handle JSON/dict columns - serialize them
                                if isinstance(value, (dict, list)):
                                    value = json.dumps(value)
                                
                                # Handle NULL values for clerk_id -> clerk_user_id rename
                                if old_col == 'clerk_id' and value is None:
                                    # Skip rows with NULL clerk_id since new schema requires clerk_user_id
                                    raise ValueError(f"NULL clerk_id in row {processed_rows}")
                                
                                values.append(value)
                            
                            # Insert the row
                            placeholders = ', '.join(['%s'] * len(values))
                            insert_sql = f"INSERT INTO public.{table_name} ({', '.join(shared_colnames_new)}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
                            
                            new_cur.execute(insert_sql, values)
                            
                            # Check if row was actually inserted
                            if new_cur.rowcount > 0:
                                migrated_count += 1
                            
                            new_conn.commit()
                            
                        except psycopg2.Error as e:
                            error_count += 1
                            row_id = row.get('id', 'N/A')
                            print(f"    ERROR row {processed_rows} (ID: {row_id}): {str(e)[:100]}...")
                            new_conn.rollback()
                            continue
                        except Exception as e:
                            error_count += 1
                            row_id = row.get('id', 'N/A')
                            # Skip rows with NULL clerk_id without logging as errors (expected behavior)
                            if "NULL clerk_id" not in str(e):
                                print(f"    ERROR row {processed_rows} (ID: {row_id}): {str(e)[:100]}...")
                            new_conn.rollback()
                            continue
                    
                    # Progress report after each chunk
                    progress = (processed_rows / total_rows) * 100
                    print(f"  {processed_rows}/{total_rows} ({progress:.0f}%) - Success: {migrated_count}, Errors: {error_count}")
                
                except Exception as e:
                    print(f"  CHUNK ERROR at offset {processed_rows}: {str(e)[:100]}...")
                    break

    except Exception as e:
        print(f"  FAILED: {str(e)[:100]}...")
        new_conn.rollback()
        raise

    print(f"  DONE: {migrated_count} success, {error_count} errors")


def run_migration():
    """Orchestrates the data migration process."""
    old_conn_string = os.environ.get("OLD_DB_CONN_STRING")
    new_conn_string = os.environ.get("NEW_DB_CONN_STRING")

    if not old_conn_string or not new_conn_string:
        print("Error: OLD_DB_CONN_STRING and NEW_DB_CONN_STRING environment variables must be set.")
        sys.exit(1)

    old_conn = None
    new_conn = None

    try:
        print("Connecting to databases...")
        old_conn = psycopg2.connect(old_conn_string)
        new_conn = psycopg2.connect(new_conn_string)
        
        print("Starting row-by-row migration...")
        
        for table in TABLES_TO_MIGRATE:
            migrate_table_row_by_row(old_conn, new_conn, table)

        print("Migration complete!")

    except Exception as e:
        print(f"Migration failed: {str(e)[:100]}...")
    finally:
        if old_conn: old_conn.close()
        if new_conn: new_conn.close()

if __name__ == "__main__":
    run_migration() 