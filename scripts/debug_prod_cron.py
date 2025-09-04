#!/usr/bin/env python3

import os
import requests
import time
from datetime import datetime
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


def debug_production_cron():
    """Debug why production cron isn't creating executions"""
    
    print("\n" + "="*80)
    print("DEBUGGING PRODUCTION CRON at app.mediar.ai")
    print("="*80)
    
    # 1. Check cron endpoint health
    print("\n1. CHECKING CRON ENDPOINT:")
    print("-"*40)
    
    try:
        response = requests.get("https://app.mediar.ai/api/cron/scheduler")
        health = response.json()
        print(f"   Status: {health.get('status')}")
        print(f"   Active cron jobs: {health.get('activeCronJobs')}")
    except Exception as e:
        print(f"   Error: {e}")
    
    # 2. Check database for cron workflows
    print("\n2. CRON WORKFLOWS IN DATABASE:")
    print("-"*40)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT 
                id, name, status,
                cron_expression, cron_enabled,
                last_scheduled_execution
            FROM deployed_workflows
            WHERE cron_expression IS NOT NULL
            ORDER BY id DESC;
        """)
        
        workflows = cursor.fetchall()
        
        now = datetime.utcnow()
        print(f"   Current UTC time: {now.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"   Current second: {now.second}")
        print()
        
        for wf in workflows:
            id, name, status, expr, enabled, last_exec = wf
            print(f"   Workflow #{id}: {name}")
            print(f"     Status: {status}")
            print(f"     Cron expression: {expr}")
            print(f"     Enabled: {enabled}")
            print(f"     Last execution: {last_exec}")
            
            # Check if it should run now
            if enabled and status in ['active', 'deployed']:
                # Parse cron expression (6 fields: second minute hour day month dayofweek)
                parts = expr.split()
                if len(parts) >= 6:
                    second_field = parts[0]
                    minute_field = parts[1]
                    
                    # Check if it matches current time
                    should_run = False
                    if second_field == '0' and now.second == 0:
                        if '*/1' in minute_field or minute_field == '*':
                            should_run = True
                            print(f"     ⚠️ SHOULD RUN NOW (every minute at 0 seconds)")
                        elif '*/5' in minute_field and now.minute % 5 == 0:
                            should_run = True
                            print(f"     ⚠️ SHOULD RUN NOW (every 5 minutes)")
                    
                    if not should_run:
                        if '*/1' in minute_field:
                            print(f"     Next run: in {60 - now.second} seconds")
                        elif '*/5' in minute_field:
                            next_min = (now.minute // 5 + 1) * 5
                            if next_min >= 60:
                                next_min = 0
                            print(f"     Next run: at minute {next_min:02d}:00")
            print()
        
        # 3. Check recent executions
        print("\n3. RECENT EXECUTIONS:")
        print("-"*40)
        
        cursor.execute("""
            SELECT COUNT(*), MAX(created_at)
            FROM workflow_executions
            WHERE client_id = 'cron-scheduler'
            AND created_at > NOW() - INTERVAL '1 hour';
        """)
        
        count, last_exec = cursor.fetchone()
        print(f"   Cron executions in last hour: {count}")
        if last_exec:
            print(f"   Most recent: {last_exec}")
        else:
            print(f"   Most recent: Never")
        
        # 4. Test trigger NOW
        print("\n4. TESTING MANUAL TRIGGER:")
        print("-"*40)
        
        # Wait for second=0 if needed
        if now.second > 55:
            print("   Waiting for next minute...")
            time.sleep(60 - now.second + 1)
        elif now.second > 0 and now.second < 55:
            print(f"   Waiting {60 - now.second} seconds for second=0...")
            time.sleep(60 - now.second)
        
        print(f"   Triggering at {datetime.utcnow().strftime('%H:%M:%S')}")
        
        response = requests.post("https://app.mediar.ai/api/cron/scheduler")
        result = response.json()
        
        print(f"   Success: {result.get('success')}")
        print(f"   Workflows checked: {result.get('totalWorkflows')}")
        print(f"   Triggered: {result.get('executionsTriggered')}")
        
        if result.get('executionsTriggered', 0) == 0:
            print("\n   ❌ NO WORKFLOWS TRIGGERED")
            print("\n   POSSIBLE ISSUES:")
            print("   1. Workflows already executed this minute")
            print("   2. Cron expression doesn't match current time")
            print("   3. Workflow status not 'active' or 'deployed'")
            print("   4. Workflow has no automation_sequence")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cursor.close()
        conn.close()
    
    print("\n" + "="*80)
    print("VERCEL CRON CONFIGURATION:")
    print("-"*40)
    print("Check in Vercel Dashboard:")
    print("1. Go to: https://vercel.com/dashboard")
    print("2. Select your project")
    print("3. Go to Functions tab")
    print("4. Look for /api/cron/scheduler")
    print("5. Check if it shows cron schedule: * * * * *")
    print("\nIf NOT configured, redeploy with:")
    print("   vercel --prod")


if __name__ == "__main__":
    debug_production_cron()
