#!/usr/bin/env python3
"""
Monitor cron executions and their status
"""

import requests
import time
from datetime import datetime, timedelta
import json

# Supabase credentials
SUPABASE_URL = "https://lqnlxsvefdzljnugpmii.supabase.co"
SUPABASE_KEY = "***REMOVED***"

def get_recent_executions():
    """Get recent workflow executions from cron"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    
    # Get executions from the last 10 minutes
    ten_minutes_ago = (datetime.utcnow() - timedelta(minutes=10)).isoformat()
    
    url = f"{SUPABASE_URL}/rest/v1/workflow_executions"
    params = {
        "select": "id,created_at,status,workflow_id,client_id,error_message,formatted_output",
        "client_id": "eq.cron-scheduler",
        "created_at": f"gte.{ten_minutes_ago}",
        "order": "created_at.desc",
        "limit": "20"
    }
    
    response = requests.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response.json()

def get_workflow_name(workflow_id):
    """Get workflow name by ID"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    
    url = f"{SUPABASE_URL}/rest/v1/deployed_workflows"
    params = {
        "select": "name",
        "id": f"eq.{workflow_id}"
    }
    
    response = requests.get(url, headers=headers, params=params)
    workflows = response.json()
    return workflows[0]["name"] if workflows else f"Workflow #{workflow_id}"

def main():
    print("🔍 Monitoring cron executions...")
    print("=" * 60)
    
    while True:
        try:
            executions = get_recent_executions()
            
            if executions:
                print(f"\n📊 Found {len(executions)} recent cron execution(s):")
                print("-" * 60)
                
                for execution in executions:
                    workflow_name = get_workflow_name(execution['workflow_id'])
                    status_emoji = "✅" if execution['status'] == 'completed' else "❌"
                    
                    print(f"\n{status_emoji} Execution #{execution['id']}")
                    print(f"   Workflow: {workflow_name}")
                    print(f"   Status: {execution['status']}")
                    print(f"   Created: {execution['created_at']}")
                    
                    if execution['error_message']:
                        print(f"   Error: {execution['error_message']}")
                    
                    # Check formatted_output for partial_success
                    if execution['formatted_output']:
                        try:
                            output = json.loads(execution['formatted_output'])
                            if isinstance(output, dict) and output.get('status') == 'partial_success':
                                print(f"   ⚠️ WARNING: Still showing partial_success!")
                        except:
                            pass
                
                print("\n" + "=" * 60)
            else:
                print("No recent cron executions found.")
            
            print(f"\n⏰ Next check in 30 seconds... (Press Ctrl+C to stop)")
            time.sleep(30)
            
        except KeyboardInterrupt:
            print("\n\n✋ Monitoring stopped.")
            break
        except Exception as e:
            print(f"\n❌ Error: {e}")
            time.sleep(30)

if __name__ == "__main__":
    main()