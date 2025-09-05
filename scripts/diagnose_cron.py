#!/usr/bin/env python3

import os
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


def diagnose():
    """Diagnose why cron isn't triggering"""
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    print("\n" + "="*80)
    print("CRON DIAGNOSIS")
    print("="*80)
    
    # Get workflows with full details
    cursor.execute("""
        SELECT 
            id, 
            name,
            status,
            cron_expression, 
            cron_enabled,
            last_scheduled_execution,
            next_scheduled_execution,
            cron_timezone
        FROM deployed_workflows
        WHERE cron_enabled = true
        ORDER BY id;
    """)
    
    workflows = cursor.fetchall()
    
    print(f"\nFound {len(workflows)} cron-enabled workflows:\n")
    
    for wf in workflows:
        id, name, status, expr, enabled, last_exec, next_exec, tz = wf
        
        print(f"Workflow #{id}: {name}")
        print(f"  Status: {status}")
        print(f"  Cron Expression: {expr}")
        print(f"  Cron Enabled: {enabled}")
        print(f"  Timezone: {tz or 'UTC'}")
        print(f"  Last Execution: {last_exec or 'Never'}")
        print(f"  Next Execution: {next_exec or 'Not scheduled'}")
        
        # Parse the cron expression
        if expr:
            parts = expr.split()
            if len(parts) == 6:
                sec, min, hour, day, month, dow = parts
                print(f"  Parsed: sec={sec} min={min} hour={hour} day={day} month={month} dow={dow}")
                
                # Check current time
                now = datetime.now()
                print(f"  Current time: {now.strftime('%Y-%m-%d %H:%M:%S')}")
                
                # Check if it should run this minute
                if min == "*/1" or min == "*":
                    print(f"  ✓ Should run every minute")
                elif min.startswith("*/"):
                    interval = int(min[2:])
                    if now.minute % interval == 0:
                        print(f"  ✓ Should run this minute (every {interval} minutes)")
                    else:
                        next_run = interval - (now.minute % interval)
                        print(f"  ✗ Next run in {next_run} minutes")
                else:
                    print(f"  ? Complex minute pattern: {min}")
                
                # Check seconds
                if sec == "0":
                    print(f"  ⚠️  Requires second=0, but Vercel triggers at random seconds!")
                    print(f"     This is likely why it's not triggering!")
        print()
    
    print("\n" + "="*80)
    print("PROBLEM IDENTIFIED:")
    print("="*80)
    print("\nYour cron expressions require second=0 (e.g., '0 */5 * * * *')")
    print("But Vercel cron triggers at random seconds (e.g., :45 seconds).")
    print("\nSOLUTION: Update the cron expressions to use wildcards for seconds.")
    print("Or modify the cron scheduler to ignore seconds when matching.")
    
    cursor.close()
    conn.close()


if __name__ == "__main__":
    diagnose()

