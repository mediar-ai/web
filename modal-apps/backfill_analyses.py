import modal
import os
import psycopg2
import json
from datetime import datetime

app = modal.App("backfill-labeling-fields")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary")

DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': '***REMOVED***'
}

def get_database_connection():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True  # Autocommit for simpler script logic
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def get_window_title_from_event(cur, user_id, client_timestamp):
    """Fetches the corresponding raw event to extract the window title."""
    try:
        cur.execute("""
            SELECT payload->'payload'->'event'->'screen'->'ui_tree'
            FROM low_level_events
            WHERE user_id = %s AND created_at = %s
            LIMIT 1;
        """, (user_id, client_timestamp))
        result = cur.fetchone()
        if not result or not result[0]:
            return None
            
        ui_tree = json.loads(result[0])
        return ui_tree.get('attributes', {}).get('name', 'Unknown')
    except Exception:
        return 'Error Parsing Title'

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=7200 # 2 hours for large backfills
)
def run_backfill():
    """
    One-time script to backfill `label_status` and `window_title` for existing records.
    """
    print("🚀 Starting backfill process...")
    conn, cur = None, None
    updated_titles = 0
    
    try:
        conn = get_database_connection()
        cur = conn.cursor()

        # 1. Backfill label_status for all NULL records
        print("🔄 Backfilling 'label_status' to 'pending' for existing records...")
        cur.execute("UPDATE low_level_workflow_analyses SET label_status = 'pending' WHERE label_status IS NULL;")
        print(f"✅ Completed label_status backfill. {cur.rowcount} rows updated.")

        # 2. Backfill window_title for all NULL records
        print("🔄 Identifying analyses that need a window_title backfill...")
        cur.execute("""
            SELECT id, user_id, client_timestamp 
            FROM low_level_workflow_analyses 
            WHERE window_title IS NULL;
        """)
        records_to_update = cur.fetchall()
        total_records = len(records_to_update)
        print(f"Found {total_records} records to backfill with a window title.")

        for i, record in enumerate(records_to_update):
            analysis_id, user_id, client_timestamp = record
            
            # Fetch the title from the corresponding event
            window_title = get_window_title_from_event(cur, user_id, client_timestamp)
            
            if window_title:
                cur.execute("""
                    UPDATE low_level_workflow_analyses
                    SET window_title = %s
                    WHERE id = %s;
                """, (window_title, analysis_id))
                updated_titles += 1
            
            if (i + 1) % 100 == 0:
                print(f"    ...progress: {i + 1} / {total_records} records processed.")

        print(f"✅ Completed window_title backfill. {updated_titles} titles updated.")
        
        return {
            "success": True,
            "status_updated": cur.rowcount,
            "titles_updated": updated_titles
        }

    except Exception as e:
        print(f"❌ An error occurred during backfill: {e}")
        return { "success": False, "error": str(e) }
    finally:
        if cur: cur.close()
        if conn: conn.close()
        print("🏁 Backfill process finished.") 