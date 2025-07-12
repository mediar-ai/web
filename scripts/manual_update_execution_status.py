#!/usr/bin/env python3
"""
Manually updates the status of one or more workflow executions.

Usage:
  python scripts/manual_update_execution_status.py <new_status> <execution_id_1> <execution_id_2> ...

Example:
  python scripts/manual_update_execution_status.py failed 492 491 490
"""

import sys
import os
import psycopg2
from dotenv import load_dotenv
from datetime import datetime, timezone

# Load environment variables from .env.local
load_dotenv('.env.local')

def get_db_connection():
    """Gets a database connection."""
    try:
        conn_string = os.getenv('SUPABASE_CONN_STRING')
        if not conn_string:
            raise ValueError("SUPABASE_CONN_STRING not found in environment variables.")
        return psycopg2.connect(conn_string)
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

def update_execution_statuses(new_status, execution_ids, reason):
    """Updates the status and error message for a list of execution IDs."""
    if not execution_ids:
        print("No execution IDs provided.")
        return

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Using tuple for WHERE IN clause
            ids_tuple = tuple(execution_ids)
            
            print(f"Attempting to update {len(ids_tuple)} executions to status '{new_status}'...")
            
            cur.execute(
                """
                UPDATE workflow_executions
                SET
                    status = %s,
                    error_message = %s,
                    completed_at = %s,
                    execution_duration_seconds = EXTRACT(EPOCH FROM (%s - started_at))
                WHERE id IN %s
                """,
                (new_status, reason, datetime.now(timezone.utc), datetime.now(timezone.utc), ids_tuple)
            )
            
            updated_rows = cur.rowcount
            conn.commit()
            
            print(f"✅ Successfully updated {updated_rows} rows.")
            
    except Exception as e:
        print(f"❌ Error updating statuses: {e}")
        conn.rollback()
    finally:
        conn.close()

def main():
    """Main function to parse args and run the update."""
    if len(sys.argv) < 3:
        print("Usage: python scripts/manual_update_execution_status.py <new_status> <id1> <id2> ...")
        print("Example: python scripts/manual_update_execution_status.py failed 492 491")
        sys.exit(1)
        
    new_status = sys.argv[1]
    valid_statuses = ['failed', 'completed', 'cancelled', 'queued']
    if new_status not in valid_statuses:
        print(f"Invalid status '{new_status}'. Must be one of: {valid_statuses}")
        sys.exit(1)

    try:
        execution_ids = [int(eid) for eid in sys.argv[2:]]
    except ValueError:
        print("Error: All execution IDs must be integers.")
        sys.exit(1)
        
    if new_status == 'cancelled':
        reason = "Manually cancelled. The job was affected by system issues or queue blocking."
    else:
        reason = "Manually updated. The job was interrupted by a new deployment."
    
    print(f"Preparing to set status to '{new_status}' for IDs: {execution_ids}")
    update_execution_statuses(new_status, execution_ids, reason)

if __name__ == "__main__":
    main()
