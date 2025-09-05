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


def watch():
    """Watch for the first cron execution to appear"""
    
    print("\n" + "="*80)
    print("WATCHING FOR FIRST CRON EXECUTION")
    print("="*80)
    print("\nThe fix has been deployed!")
    print("Vercel will trigger the cron within 1 minute.")
    print("Waiting for the first execution to appear...\n")
    
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
            print("\n✅ FIRST CRON EXECUTION DETECTED!")
            print(f"\nExecution #{exec_id}")
            print(f"Workflow: {name}")
            print(f"Status: {status}")
            print(f"Created: {created}")
            print("\n" + "🎉"*20)
            print("\n✅ CRON IS NOW WORKING!")
            print("\nYour workflows will now run automatically:")
            print("- 'Scheduled Task Template' runs every minute")
            print("- 'Automated Cron Task' runs every 5 minutes")
            
            cursor.close()
            conn.close()
            break
        
        now = datetime.now()
        print(f"Check #{check_count} at {now.strftime('%H:%M:%S')} - No executions yet... (waiting)", end='\r')
        
        cursor.close()
        conn.close()
        
        time.sleep(5)  # Check every 5 seconds


if __name__ == "__main__":
    try:
        watch()
    except KeyboardInterrupt:
        print("\n\nStopped watching.")

