import os
import psycopg2
import json
import sys

def get_database_connection():
    """Gets a database connection using a local environment variable."""
    conn_string = os.environ.get("DATABASE_URL")
    if not conn_string:
        print("❌ Error: DATABASE_URL environment variable not set.")
        sys.exit(1)
    try:
        conn = psycopg2.connect(conn_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def get_window_title_from_event_payload(payload_str):
    """
    Extracts the window title using the robust, multi-fallback logic.
    """
    try:
        # The payload from the DB is a dict, but we dump/load to handle the nested string ui_tree
        payload = json.loads(payload_str)
        ui_tree_str = payload.get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
        app_name_fallback = payload.get('payload', {}).get('event', {}).get('app_name', 'Unknown')

        if not ui_tree_str:
            return app_name_fallback

        ui_tree = json.loads(ui_tree_str)

        def find_document_name(node):
            if isinstance(node, dict):
                attributes = node.get('attributes', {})
                if attributes.get('role') == 'Document' and 'name' in attributes:
                    return attributes['name']
                for child in node.get('children', []):
                    found = find_document_name(child)
                    if found:
                        return found
            return None

        doc_name = find_document_name(ui_tree)
        if doc_name:
            return doc_name
        
        top_level_name = ui_tree.get('attributes', {}).get('name')
        if top_level_name:
            return top_level_name

        return app_name_fallback
    except Exception:
        return 'Error Parsing Title'

def run_local_backfill():
    """
    Local script to backfill `window_title` for existing records.
    """
    print("🚀 Starting LOCAL backfill process for window titles...")
    conn, cur = None, None
    updated_titles = 0
    
    try:
        conn = get_database_connection()
        cur = conn.cursor()

        print("🔄 Identifying analyses that need a window_title backfill...")
        cur.execute("""
            SELECT la.id, le.payload
            FROM low_level_workflow_analyses la
            JOIN low_level_events le ON la.user_id = le.user_id AND la.client_timestamp = le.created_at
            WHERE la.window_title IS NULL;
        """)
        records_to_update = cur.fetchall()
        total_records = len(records_to_update)
        print(f"Found {total_records} records to backfill with a window title.")

        for i, record in enumerate(records_to_update):
            analysis_id, event_payload_json = record
            
            window_title = get_window_title_from_event_payload(json.dumps(event_payload_json))
            
            if window_title and window_title not in ['Unknown', 'Error Parsing Title']:
                print(f"  -> UPDATING analysis ID {analysis_id} with title: '{window_title}'")
                cur.execute("UPDATE low_level_workflow_analyses SET window_title = %s WHERE id = %s;", (window_title, analysis_id))
                updated_titles += 1
            else:
                print(f"  -> SKIPPING analysis ID {analysis_id}: No valid title found.")
            
        print(f"✅ Completed window_title backfill. {updated_titles} of {total_records} titles were updated.")
        
    except Exception as e:
        print(f"❌ An unexpected error occurred during backfill: {e}")
    finally:
        if cur: cur.close()
        if conn: conn.close()
        print("🏁 Backfill process finished.")

if __name__ == "__main__":
    run_local_backfill() 