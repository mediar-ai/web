#!/usr/bin/env python3

import requests
import time
from datetime import datetime
import psycopg2
import os
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


def debug_cron():
    """Debug why cron isn't triggering"""
    
    print("\n" + "="*80)
    print("DEBUGGING WHY CRON ISN'T TRIGGERING")
    print("="*80)
    
    # Check workflows in database
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, name, cron_expression, last_scheduled_execution
        FROM deployed_workflows
        WHERE cron_enabled = true
        ORDER BY id;
    """)
    
    workflows = cursor.fetchall()
    
    print("\nActive cron workflows:")
    for wf in workflows:
        id, name, expr, last_exec = wf
        print(f"  #{id}: {name}")
        print(f"    Cron: {expr}")
        print(f"    Last execution: {last_exec}")
    
    # Wait for the right time
    now = datetime.now()
    seconds_to_wait = 60 - now.second
    
    print(f"\nCurrent time: {now.strftime('%H:%M:%S')}")
    
    if now.second > 0:
        print(f"Waiting {seconds_to_wait} seconds for next minute...")
        time.sleep(seconds_to_wait)
    
    print(f"\nTriggering at exactly: {datetime.now().strftime('%H:%M:%S')}")
    
    # Call the endpoint
    response = requests.get("https://app.mediar.ai/api/cron/scheduler")
    result = response.json()
    
    print(f"\nResponse:")
    print(f"  Success: {result.get('success')}")
    print(f"  Workflows found: {result.get('totalWorkflows')}")
    print(f"  Triggered: {result.get('executionsTriggered')}")
    
    if result.get('executionsTriggered', 0) == 0:
        print("\n❌ STILL NOT TRIGGERING!")
        
        # Check last_scheduled_execution again
        cursor.execute("""
            SELECT id, name, last_scheduled_execution
            FROM deployed_workflows
            WHERE cron_enabled = true
            ORDER BY id;
        """)
        
        workflows = cursor.fetchall()
        
        print("\nChecking last_scheduled_execution timestamps:")
        for wf in workflows:
            id, name, last_exec = wf
            print(f"  #{id}: {name}")
            if last_exec:
                # Check if it's in the current minute
                current_minute = datetime.now().replace(second=0, microsecond=0)
                last_exec_minute = last_exec.replace(second=0, microsecond=0, tzinfo=None)
                
                if last_exec_minute >= current_minute:
                    print(f"    ⚠️ Already executed this minute at {last_exec}")
                    print(f"    This prevents re-execution!")
                else:
                    print(f"    Last: {last_exec}")
            else:
                print(f"    Never executed")
        
        print("\nPOSSIBLE ISSUE:")
        print("The workflow might have been manually triggered earlier")
        print("in this minute, setting last_scheduled_execution.")
        print("This prevents Vercel from triggering it again.")
        
        # Update to clear last_scheduled_execution
        print("\nClearing last_scheduled_execution to allow triggering...")
        cursor.execute("""
            UPDATE deployed_workflows
            SET last_scheduled_execution = NULL
            WHERE cron_enabled = true;
        """)
        conn.commit()
        print("✅ Cleared!")
        
        print("\nTrying again...")
        response = requests.get("https://app.mediar.ai/api/cron/scheduler")
        result = response.json()
        
        print(f"\nSecond attempt:")
        print(f"  Triggered: {result.get('executionsTriggered')}")
        
        if result.get('executionsTriggered', 0) > 0:
            print("✅ NOW IT'S WORKING!")
    else:
        print("✅ WORKFLOWS TRIGGERED!")
    
    cursor.close()
    conn.close()


if __name__ == "__main__":
    debug_cron()

