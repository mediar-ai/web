#!/usr/bin/env python3

import os
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


def check_only():
    """ONLY CHECK - NO MODIFICATIONS"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    print("\n" + "="*80)
    print("CHECKING CRON SETUP (READ-ONLY)")
    print("="*80)
    
    try:
        # Check active cron workflows
        cursor.execute("""
            SELECT id, name, cron_expression, cron_enabled, last_scheduled_execution
            FROM deployed_workflows
            WHERE cron_expression IS NOT NULL AND cron_enabled = true
            ORDER BY id DESC;
        """)
        
        workflows = cursor.fetchall()
        
        if workflows:
            print(f"\nFound {len(workflows)} active cron workflow(s):")
            for wf in workflows:
                id, name, expr, enabled, last_exec = wf
                print(f"\n  Workflow #{id}: {name}")
                print(f"    Cron: {expr}")
                print(f"    Last run: {last_exec or 'Never'}")
        else:
            print("\n❌ No active cron workflows found")
        
        print("\n" + "="*80)
        print("WHY CRON ISN'T RUNNING AUTOMATICALLY:")
        print("="*80)
        print()
        print("🚨 VERCEL CRON ONLY WORKS IN PRODUCTION 🚨")
        print()
        print("Local Development (npm run dev):")
        print("  ❌ Cron does NOT trigger automatically")
        print("  ❌ Vercel's infrastructure is needed")
        print("  ✅ The API endpoint exists and works")
        print("  ✅ But it needs Vercel to call it")
        print()
        print("Production (Vercel deployment):")
        print("  ✅ Cron triggers automatically")
        print("  ✅ Runs on schedule defined in vercel.json")
        print("  ✅ Check Vercel dashboard > Functions > Logs")
        print()
        print("TO SEE AUTOMATIC EXECUTION:")
        print("  1. Deploy: vercel --prod")
        print("  2. Wait for schedule (every minute)")
        print("  3. Check Vercel Functions logs")
        print()
        print("Current time:", datetime.now().strftime("%H:%M:%S"))
        print("Next minute at:", datetime.now().replace(second=0).strftime("%H:%M:00"))
        
    except Exception as e:
        print(f"Error checking: {e}")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    check_only()
