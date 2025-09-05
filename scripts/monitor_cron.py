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


def monitor():
    """Monitor for new cron executions"""
    
    print("\n" + "="*80)
    print("🎉 FIX DEPLOYED!")
    print("="*80)
    print("\nThe fix has been pushed to GitHub.")
    print("Vercel will auto-deploy in 1-2 minutes.")
    print("\nOnce deployed, workflows will trigger every minute!")
    print("\nMonitoring for new executions...")
    print("Press Ctrl+C to stop\n")
    
    last_count = 0
    
    while True:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE client_id = 'cron-scheduler'
            """)
            
            total_count = cursor.fetchone()[0]
            
            if total_count > last_count:
                print(f"✅ NEW EXECUTIONS! Total: {total_count} (+{total_count - last_count})")
                
                # Get latest execution
                cursor.execute("""
                    SELECT id, workflow_id, status, created_at
                    FROM workflow_executions 
                    WHERE client_id = 'cron-scheduler'
                    ORDER BY created_at DESC
                    LIMIT 1
                """)
                
                latest = cursor.fetchone()
                if latest:
                    exec_id, wf_id, status, created = latest
                    print(f"   Latest: Execution #{exec_id} - Status: {status}")
                    print(f"   Created: {created}")
                
                last_count = total_count
            else:
                print(f"   Waiting... (Total cron executions: {total_count}) - {datetime.now().strftime('%H:%M:%S')}", end='\r')
            
            cursor.close()
            conn.close()
            
        except Exception as e:
            print(f"Error: {e}")
            
        time.sleep(10)  # Check every 10 seconds


if __name__ == "__main__":
    monitor()

