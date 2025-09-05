#!/usr/bin/env python3
"""
Monitor Vercel deployment and wait for first successful cron execution
"""

import os
import sys
import time
import subprocess
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def check_deployment_status():
    """Check if deployment is complete"""
    try:
        result = subprocess.run(
            ["vercel", "ls", "--limit", "1"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0 and result.stdout:
            # Parse deployment status from output
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                # Look for 'Ready' status
                if 'Ready' in lines[1]:
                    return 'ready'
                elif 'Building' in lines[1] or 'Queued' in lines[1]:
                    return 'building'
        return 'unknown'
    except:
        return 'unknown'

def main():
    # Setup Supabase client
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url or not supabase_key:
        print("❌ Missing Supabase credentials")
        return
        
    supabase: Client = create_client(supabase_url, supabase_key)
    
    print("🚀 Monitoring deployment and cron executions...")
    print("=" * 60)
    
    # Track initial state
    initial_response = supabase.table("workflow_executions")\
        .select("id, created_at, status, workflow_id")\
        .eq("client_id", "cron-scheduler")\
        .order("created_at", desc=True)\
        .limit(1)\
        .execute()
    
    last_execution_id = initial_response.data[0]["id"] if initial_response.data else None
    last_check = datetime.now()
    deployment_ready = False
    
    print(f"📊 Initial state: Last execution ID: {last_execution_id}")
    print("⏳ Waiting for deployment to complete and cron to trigger...\n")
    
    while True:
        try:
            # Check deployment status
            if not deployment_ready:
                status = check_deployment_status()
                if status == 'ready':
                    print(f"✅ Deployment is ready!")
                    deployment_ready = True
                elif status == 'building':
                    print(f"🔨 Deployment still building...", end='\r')
            
            # Check for new executions
            response = supabase.table("workflow_executions")\
                .select("id, created_at, status, workflow_id")\
                .eq("client_id", "cron-scheduler")\
                .order("created_at", desc=True)\
                .limit(5)\
                .execute()
            
            if response.data:
                new_executions = []
                for execution in response.data:
                    if last_execution_id is None or execution["id"] > last_execution_id:
                        new_executions.append(execution)
                
                if new_executions:
                    print(f"\n🎉 NEW CRON EXECUTION{'S' if len(new_executions) > 1 else ''} DETECTED!")
                    print("=" * 60)
                    for execution in reversed(new_executions):  # Show oldest first
                        workflow_response = supabase.table("deployed_workflows")\
                            .select("name")\
                            .eq("id", execution["workflow_id"])\
                            .single()\
                            .execute()
                        
                        workflow_name = workflow_response.data["name"] if workflow_response.data else f"Workflow #{execution['workflow_id']}"
                        
                        print(f"""
📌 Execution #{execution['id']}:
   Workflow: {workflow_name}
   Time: {execution['created_at']}
   Status: {execution['status']}
""")
                    
                    last_execution_id = new_executions[0]["id"]
                    print("✅ CRON IS WORKING! Your scheduled workflows are now running automatically.")
                    print("\nNext steps:")
                    print("1. Check https://app.mediar.ai for execution results")
                    print("2. Monitor Modal dashboard for actual workflow runs")
                    print("3. Cron will continue running every minute automatically")
                    return
            
            # Show waiting indicator
            elapsed = (datetime.now() - last_check).seconds
            if elapsed > 0 and elapsed % 10 == 0:
                print(f"⏰ Checking... (been waiting {elapsed}s)", end='\r')
            
            time.sleep(2)
            
        except KeyboardInterrupt:
            print("\n\n🛑 Monitoring stopped by user")
            break
        except Exception as e:
            print(f"\n⚠️ Error checking executions: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
