#!/usr/bin/env python3

import os
import psycopg2
from dotenv import load_dotenv
from datetime import datetime, timedelta

# Load environment variables
load_dotenv(".env.local")


def get_db_connection():
    """Get database connection using environment variables."""
    try:
        database_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
        if database_url:
            conn = psycopg2.connect(database_url)
        else:
            conn = psycopg2.connect(
                host=os.getenv("DB_HOST"),
                database=os.getenv("DB_NAME"),
                user=os.getenv("DB_USER"),
                password=os.getenv("DB_PASSWORD"),
                port=os.getenv("DB_PORT", 5432),
            )
        return conn
    except Exception as e:
        print(f"Database connection failed: {e}")
        raise


def check():
    """Check for recent cron executions"""
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    print("\nCRON EXECUTIONS IN LAST 10 MINUTES:")
    print("="*60)
    
    # Get executions from last 10 minutes
    cursor.execute("""
        SELECT 
            e.id,
            w.name,
            e.status,
            e.created_at
        FROM workflow_executions e
        JOIN deployed_workflows w ON e.workflow_id = w.id
        WHERE e.client_id = 'cron-scheduler'
        AND e.created_at > NOW() - INTERVAL '10 minutes'
        ORDER BY e.created_at DESC;
    """)
    
    executions = cursor.fetchall()
    
    if executions:
        print(f"Found {len(executions)} cron executions!")
        for exec in executions:
            id, name, status, created = exec
            print(f"\n  Execution #{id}")
            print(f"    Workflow: {name}")
            print(f"    Status: {status}")
            print(f"    Created: {created}")
    else:
        print("No cron executions found in last 10 minutes")
    
    # Check workflow last_scheduled_execution
    print("\n\nWORKFLOW STATUS:")
    print("-"*60)
    
    cursor.execute("""
        SELECT 
            id, 
            name,
            last_scheduled_execution,
            (SELECT COUNT(*) FROM workflow_executions 
             WHERE workflow_id = dw.id AND client_id = 'cron-scheduler') as cron_count
        FROM deployed_workflows dw
        WHERE cron_enabled = true
        ORDER BY id;
    """)
    
    workflows = cursor.fetchall()
    
    for wf in workflows:
        id, name, last_exec, count = wf
        print(f"\nWorkflow #{id}: {name}")
        print(f"  Total cron executions: {count}")
        print(f"  Last scheduled: {last_exec or 'Never'}")
    
    cursor.close()
    conn.close()


if __name__ == "__main__":
    check()

