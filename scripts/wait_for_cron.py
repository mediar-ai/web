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


def wait_for_cron():
    """Wait for cron executions to appear"""
    
    print("\n" + "="*80)
    print("WAITING FOR CRON EXECUTIONS")
    print("="*80)
    print("\nThe logging fix has been deployed.")
    print("Vercel should trigger cron every minute.")
    print("Monitoring for new executions...")
    print("\nPress Ctrl+C to stop\n")
    
    last_count = 0
    check_count = 0
    
    while True:
        check_count += 1
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Count cron executions
            cursor.execute("""
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE client_id = 'cron-scheduler'
            """)
            
            total_count = cursor.fetchone()[0]
            
            # Get recent executions
            cursor.execute("""
                SELECT e.id, w.name, e.status, e.created_at
                FROM workflow_executions e
                JOIN deployed_workflows w ON e.workflow_id = w.id
                WHERE e.client_id = 'cron-scheduler'
                AND e.created_at > NOW() - INTERVAL '5 minutes'
                ORDER BY e.created_at DESC
                LIMIT 3;
            """)
            
            recent = cursor.fetchall()
            
            if total_count > last_count:
                print(f"\n🎉 NEW CRON EXECUTIONS DETECTED!")
                print(f"Total: {total_count} (+{total_count - last_count})")
                
                if recent:
                    print("\nRecent executions:")
                    for exec_id, name, status, created in recent:
                        print(f"  #{exec_id}: {name} - {status} - {created}")
                
                last_count = total_count
            else:
                now = datetime.now()
                next_min = 60 - now.second
                
                status_msg = f"Check #{check_count} at {now.strftime('%H:%M:%S')} - Total cron executions: {total_count}"
                
                if recent:
                    last_time = recent[0][3]
                    mins_ago = int((now - last_time.replace(tzinfo=None)).total_seconds() / 60)
                    status_msg += f" (last: {mins_ago} min ago)"
                else:
                    status_msg += " (none yet)"
                
                status_msg += f" - Next check in {next_min}s"
                
                print(status_msg, end='\r')
            
            cursor.close()
            conn.close()
            
        except Exception as e:
            print(f"\nError: {e}")
        
        # Wait 30 seconds between checks
        time.sleep(30)
    
    print("\n\nIf no executions appear after 5 minutes:")
    print("1. Check Vercel Function logs at:")
    print("   https://vercel.com/louis030195s-projects/browser-workflow-capture-app/logs")
    print("2. Look for errors in /api/cron/scheduler")
    print("3. The new logging will show what's happening")


if __name__ == "__main__":
    try:
        wait_for_cron()
    except KeyboardInterrupt:
        print("\n\nStopped monitoring.")
        print("\nTo check manually:")
        print("python scripts/check_cron_now.py")

