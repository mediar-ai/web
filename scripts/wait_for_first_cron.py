#!/usr/bin/env python3

import os
import time
import psycopg2
from datetime import datetime
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


def wait():
    """Wait for first cron execution"""
    
    print("\n" + "="*80)
    print("WAITING FOR CRON TO START WORKING")
    print("="*80)
    print("\nThe authentication fix has been pushed!")
    print("Deployment takes ~2 minutes, then cron will trigger.")
    print("\nYour cron schedules:")
    print("  • Scheduled Task Template - Every minute")
    print("  • Automated Cron Task - Every 5 minutes")
    print("\nWaiting for first execution...\n")
    
    check_count = 0
    
    while True:
        check_count += 1
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check for cron executions
        cursor.execute("""
            SELECT e.id, w.name, e.status, e.created_at
            FROM workflow_executions e
            JOIN deployed_workflows w ON e.workflow_id = w.id
            WHERE e.client_id = 'cron-scheduler'
            ORDER BY e.created_at DESC
            LIMIT 1;
        """)
        
        result = cursor.fetchone()
        
        if result:
            exec_id, name, status, created = result
            print("\n" + "🎉"*20)
            print("\n✅ CRON IS FINALLY WORKING!")
            print(f"\nFirst Execution Detected:")
            print(f"  • Execution #{exec_id}")
            print(f"  • Workflow: {name}")
            print(f"  • Status: {status}")
            print(f"  • Created: {created}")
            print("\n" + "🎉"*20)
            
            print("\n✅ Your cron workflows are now running automatically!")
            print("\nThey will continue to run on schedule:")
            print("  • Every minute: Scheduled Task Template")
            print("  • Every 5 minutes: Automated Cron Task")
            
            cursor.close()
            conn.close()
            break
        
        now = datetime.now()
        mins_since_push = check_count * 10 / 60  # We check every 10 seconds
        print(f"Check #{check_count} at {now.strftime('%H:%M:%S')} - Waiting... ({mins_since_push:.1f} mins since push)", end='\r')
        
        cursor.close()
        conn.close()
        
        time.sleep(10)  # Check every 10 seconds


if __name__ == "__main__":
    try:
        wait()
    except KeyboardInterrupt:
        print("\n\nStopped waiting.")

