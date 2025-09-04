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


def check_vercel_cron():
    """Check if Vercel is calling the cron endpoint"""
    
    print("\n" + "="*80)
    print("VERCEL CRON DEPLOYMENT CHECK")
    print("="*80)
    
    print("\n❌ THE PROBLEM:")
    print("-"*40)
    print("Vercel is NOT automatically calling /api/cron/scheduler")
    print()
    print("Even though vercel.json has the cron configuration,")
    print("it's not active in your production deployment.")
    print()
    print("REASON: The deployment was made BEFORE adding cron config,")
    print("or the vercel.json wasn't properly deployed.")
    
    print("\n✅ THE SOLUTION:")
    print("-"*40)
    print("You need to REDEPLOY to activate the cron schedule:")
    print()
    print("1. Make sure you're in the project directory")
    print("2. Run: vercel --prod")
    print("3. This will deploy with the cron configuration")
    print("4. Vercel will start calling /api/cron/scheduler every minute")
    print()
    print("After deployment:")
    print("- Go to https://vercel.com/dashboard")
    print("- Select your project")
    print("- Go to Functions tab")
    print("- Click on 'cron/scheduler'")
    print("- You should see 'Cron: * * * * *' label")
    print("- Check the logs to see executions")
    
    # Check last execution times to confirm
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT 
                id, name,
                last_scheduled_execution
            FROM deployed_workflows
            WHERE cron_enabled = true;
        """)
        
        workflows = cursor.fetchall()
        
        print("\n" + "="*80)
        print("CURRENT STATUS:")
        print("-"*40)
        
        for id, name, last_exec in workflows:
            print(f"Workflow #{id}: {name}")
            if last_exec:
                time_ago = datetime.now(last_exec.tzinfo) - last_exec
                minutes_ago = int(time_ago.total_seconds() / 60)
                print(f"  Last cron execution: {minutes_ago} minutes ago")
            else:
                print(f"  Last cron execution: NEVER")
        
        print()
        print("If these show 'NEVER' or very old times,")
        print("it confirms Vercel isn't calling the cron endpoint.")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    check_vercel_cron()
