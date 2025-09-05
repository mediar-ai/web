#!/usr/bin/env python3
"""
Check latest cron executions in Supabase
"""

import requests
import os
import time
from datetime import datetime, timedelta

# Get Supabase credentials directly from environment
SUPABASE_URL = "https://lqnlxsvefdzljnugpmii.supabase.co"
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxxbmx4c3ZlZmR6bGpudWdwbWlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyODA0NDI2MCwiZXhwIjoyMDQzNjIwMjYwfQ.g4a_V1f8-mjCtd5OWMKWjdPXRBYQlGxCdMdGz6hBOy8")

def check_executions():
    """Check recent cron executions"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    
    # Check executions from the last 5 minutes
    five_minutes_ago = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    
    # Query for recent cron executions
    url = f"{SUPABASE_URL}/rest/v1/workflow_executions"
    params = {
        "select": "id,created_at,status,workflow_id,client_id",
        "client_id": "eq.cron-scheduler",
        "created_at": f"gte.{five_minutes_ago}",
        "order": "created_at.desc",
        "limit": "10"
    }
    
    try:
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        executions = response.json()
        
        if executions:
            print(f"\n🎉 CRON EXECUTIONS FOUND! (Last 5 minutes)")
            print("=" * 60)
            for execution in executions:
                print(f"""
Execution #{execution['id']}:
  Created: {execution['created_at']}
  Status: {execution['status']}
  Workflow ID: {execution['workflow_id']}
""")
            return True
        else:
            return False
            
    except Exception as e:
        print(f"Error checking executions: {e}")
        return False

def main():
    print("🔍 Checking for cron executions...")
    print("⏳ Waiting for the fixed cron scheduler to run...")
    print("   (Vercel cron runs every minute)")
    print()
    
    check_count = 0
    while True:
        check_count += 1
        print(f"Check #{check_count} at {datetime.now().strftime('%H:%M:%S')}...", end="")
        
        if check_executions():
            print("\n\n✅ SUCCESS! Cron is now working!")
            print("\nYour scheduled workflows will now run automatically every minute.")
            print("Check https://app.mediar.ai for execution details.")
            break
        else:
            print(" No executions yet.")
            
        if check_count >= 10:
            print("\n⚠️ No executions found after 10 checks.")
            print("The deployment might still be in progress. Please wait a bit longer.")
            break
            
        time.sleep(30)  # Check every 30 seconds

if __name__ == "__main__":
    main()