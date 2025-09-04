#!/usr/bin/env python3

import os
from datetime import datetime, timedelta
import psycopg2
from dotenv import load_dotenv

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


def check_latest_execution():
    """Check the most recent workflow executions"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    print("\nLATEST WORKFLOW EXECUTIONS")
    print("="*60)
    
    try:
        # Get the 5 most recent executions
        cursor.execute("""
            SELECT 
                e.id,
                e.workflow_id,
                w.name as workflow_name,
                e.status,
                e.client_id,
                e.created_at,
                e.started_at,
                e.completed_at,
                e.error_message
            FROM workflow_executions e
            JOIN deployed_workflows w ON e.workflow_id = w.id
            ORDER BY e.created_at DESC
            LIMIT 5;
        """)
        
        executions = cursor.fetchall()
        
        if executions:
            print(f"Found {len(executions)} recent executions:\n")
            for exec_data in executions:
                (
                    exec_id, workflow_id, workflow_name, status,
                    client_id, created_at, started_at, completed_at, error_msg
                ) = exec_data
                
                is_cron = client_id == 'cron-scheduler'
                cron_marker = " [CRON]" if is_cron else ""
                
                # Status emoji
                status_icon = {
                    'completed': '✅',
                    'running': '🏃',
                    'failed': '❌',
                    'queued': '⏳',
                    'cancelled': '🚫'
                }.get(status, '❓')
                
                print(f"{status_icon} Execution #{exec_id}{cron_marker}")
                print(f"   Workflow: {workflow_name} (#{workflow_id})")
                print(f"   Status: {status}")
                print(f"   Client: {client_id}")
                print(f"   Created: {created_at}")
                
                if started_at:
                    print(f"   Started: {started_at}")
                if completed_at:
                    print(f"   Completed: {completed_at}")
                    # Calculate duration
                    if started_at:
                        duration = (completed_at - started_at).total_seconds()
                        print(f"   Duration: {duration:.2f} seconds")
                
                if error_msg:
                    print(f"   Error: {error_msg[:100]}...")
                    
                print()
        else:
            print("No executions found")
        
        # Count cron executions in last hour
        print("\nCRON EXECUTION STATS (last hour):")
        print("-"*40)
        
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM workflow_executions
            WHERE client_id = 'cron-scheduler'
            AND created_at > NOW() - INTERVAL '1 hour';
        """)
        
        stats = cursor.fetchone()
        total, completed, failed = stats
        
        if total > 0:
            print(f"Total cron executions: {total}")
            print(f"  Successful: {completed}")
            print(f"  Failed: {failed}")
            success_rate = (completed / total * 100) if total > 0 else 0
            print(f"  Success rate: {success_rate:.1f}%")
        else:
            print("No cron executions in the last hour")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    check_latest_execution()
