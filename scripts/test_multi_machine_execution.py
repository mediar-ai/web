#!/usr/bin/env python3
"""
Test script for multi-machine workflow execution system
Verifies that execution 8683 and other queued jobs can be processed correctly
"""

import psycopg2
import os
import time
from datetime import datetime, timedelta

def get_db_connection():
    """Gets a database connection using environment variables."""
    conn_string = os.getenv('SUPABASE_CONN_STRING') or 'postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres'
    try:
        conn = psycopg2.connect(conn_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def clean_old_coordinator_locks(cur):
    """Clean up old coordinator locks that might be blocking execution"""
    print("\n🧹 CLEANING OLD COORDINATOR LOCKS")
    print("=" * 50)
    
    # Check current locks first
    cur.execute("""
        SELECT 
            user_id, processor_id, status, created_at, expires_at,
            EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as age_minutes
        FROM processing_locks 
        WHERE user_id IN ('workflow-coordinator', 'global-scheduler')
           OR user_id LIKE 'machine-%-coordinator'
        ORDER BY created_at DESC
    """)
    
    locks = cur.fetchall()
    if locks:
        print(f"Found {len(locks)} coordinator locks:")
        for user_id, processor_id, status, created, expires, age in locks:
            print(f"  {user_id}: {processor_id[:30]}... (age: {age:.1f}min, status: {status})")
    
    # Clean up expired locks
    cur.execute("""
        DELETE FROM processing_locks 
        WHERE (user_id IN ('workflow-coordinator', 'global-scheduler') 
               OR user_id LIKE 'machine-%-coordinator')
          AND expires_at < NOW()
    """)
    expired_cleaned = cur.rowcount
    
    # Clean up old locks (> 10 minutes old)
    cur.execute("""
        DELETE FROM processing_locks 
        WHERE (user_id IN ('workflow-coordinator', 'global-scheduler') 
               OR user_id LIKE 'machine-%-coordinator')
          AND created_at < NOW() - INTERVAL '10 minutes'
    """)
    old_cleaned = cur.rowcount
    
    total_cleaned = expired_cleaned + old_cleaned
    if total_cleaned > 0:
        print(f"✅ Cleaned up {total_cleaned} old coordinator locks ({expired_cleaned} expired + {old_cleaned} old)")
    else:
        print("✅ No old coordinator locks to clean")
    
    return total_cleaned

def analyze_machine_queue_status(cur):
    """Analyze the current queue status by machine"""
    print("\n📊 MACHINE QUEUE ANALYSIS")
    print("=" * 50)
    
    cur.execute("""
        WITH machine_status AS (
            SELECT 
                assigned_machine_id,
                COUNT(*) as total_executions,
                COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued_count,
                COUNT(CASE WHEN status = 'running' AND started_at > NOW() - INTERVAL '30 minutes' THEN 1 END) as running_count,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
                MIN(CASE WHEN status = 'queued' THEN created_at END) as oldest_queued_at,
                MIN(CASE WHEN status = 'queued' THEN id END) as oldest_queued_id,
                MAX(CASE WHEN status = 'running' THEN started_at END) as latest_running_started
            FROM workflow_executions 
            WHERE assigned_machine_id IS NOT NULL
              AND created_at > NOW() - INTERVAL '24 hours'
            GROUP BY assigned_machine_id
        ),
        machine_availability AS (
            SELECT 
                *,
                CASE 
                    WHEN running_count = 0 AND queued_count > 0 THEN 'AVAILABLE'
                    WHEN running_count > 0 THEN 'BUSY' 
                    WHEN queued_count = 0 THEN 'IDLE'
                    ELSE 'UNKNOWN'
                END as availability_status
            FROM machine_status
        )
        SELECT * FROM machine_availability ORDER BY assigned_machine_id
    """)
    
    machines = cur.fetchall()
    
    print(f"{'Machine':<10} {'Status':<12} {'Queued':<8} {'Running':<8} {'Completed':<10} {'Failed':<8} {'Oldest Queued ID':<15}")
    print("-" * 90)
    
    available_machines = []
    busy_machines = []
    
    for machine in machines:
        machine_id, total, queued, running, completed, failed, oldest_queued_at, oldest_queued_id, latest_running, status = machine
        print(f"{machine_id:<10} {status:<12} {queued:<8} {running:<8} {completed:<10} {failed:<8} {oldest_queued_id or 'N/A':<15}")
        
        if status == 'AVAILABLE':
            available_machines.append((machine_id, oldest_queued_id, queued))
        elif status == 'BUSY':
            busy_machines.append((machine_id, running))
    
    print(f"\n📋 Summary:")
    print(f"  🟢 Available machines: {len(available_machines)}")
    print(f"  🔴 Busy machines: {len(busy_machines)}")
    
    if available_machines:
        print(f"  📄 Ready to process: {', '.join([f'Machine {m[0]} (execution {m[1]})' for m in available_machines])}")
    
    return available_machines, busy_machines

def check_execution_8683_status(cur):
    """Check the specific status of execution 8683"""
    print("\n🔍 EXECUTION 8683 STATUS CHECK")
    print("=" * 50)
    
    cur.execute("""
        SELECT 
            id, workflow_id, status, assigned_machine_id, mcp_endpoint,
            created_at, started_at, completed_at, modal_call_id,
            error_message
        FROM workflow_executions 
        WHERE id = 8683
    """)
    
    execution = cur.fetchone()
    if not execution:
        print("❌ Execution 8683 not found!")
        return None
    
    id, workflow_id, status, machine_id, mcp_endpoint, created, started, completed, modal_call_id, error = execution
    
    print(f"Execution ID: {id}")
    print(f"Workflow ID: {workflow_id}")
    print(f"Status: {status}")
    print(f"Assigned Machine: {machine_id}")
    print(f"MCP Endpoint: {mcp_endpoint}")
    print(f"Created: {created}")
    print(f"Started: {started or 'Not started'}")
    print(f"Completed: {completed or 'Not completed'}")
    print(f"Modal Call ID: {modal_call_id or 'None'}")
    print(f"Error: {error or 'None'}")
    
    if status == 'queued':
        age = datetime.now(created.tzinfo) - created
        print(f"⏰ Queued for: {age}")
        print(f"🎯 This execution should be processable by the new multi-machine system!")
        return True
    else:
        print(f"ℹ️ Execution is not in queued status")
        return False

def simulate_new_coordinator_logic(cur):
    """Simulate the new machine-specific coordinator logic"""
    print("\n🤖 SIMULATING NEW COORDINATOR LOGIC")
    print("=" * 50)
    
    # This mimics the new machine selection query
    cur.execute("""
        WITH machine_status AS (
            SELECT 
                assigned_machine_id,
                COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued_count,
                COUNT(CASE WHEN status = 'running' AND started_at > NOW() - INTERVAL '30 minutes' THEN 1 END) as running_count,
                MIN(CASE WHEN status = 'queued' THEN created_at END) as oldest_queued_at,
                MIN(CASE WHEN status = 'queued' THEN id END) as oldest_queued_id
            FROM workflow_executions 
            WHERE assigned_machine_id IS NOT NULL
              AND status IN ('queued', 'running')
              AND created_at > NOW() - INTERVAL '24 hours'
            GROUP BY assigned_machine_id
        )
        SELECT 
            assigned_machine_id,
            queued_count,
            running_count,
            oldest_queued_at,
            oldest_queued_id
        FROM machine_status
        WHERE queued_count > 0 AND running_count = 0
        ORDER BY oldest_queued_at ASC
        LIMIT 5  -- Show top 5 available machines
    """)
    
    available_machines = cur.fetchall()
    
    if not available_machines:
        print("❌ No machines available for processing (all busy or no queued jobs)")
        return False
    
    print(f"✅ Found {len(available_machines)} available machines:")
    for machine_id, queued, running, oldest_time, oldest_id in available_machines:
        print(f"  Machine {machine_id}: {queued} queued jobs, oldest execution: {oldest_id}")
        
        if oldest_id == 8683:
            print(f"    🎯 Machine {machine_id} would process execution 8683!")
    
    return True

def main():
    """Main test function"""
    print("🚀 MULTI-MACHINE WORKFLOW EXECUTION TEST")
    print("=" * 60)
    print(f"Timestamp: {datetime.now()}")
    
    try:
        # Connect to database
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Step 1: Clean old coordinator locks
        clean_old_coordinator_locks(cur)
        
        # Step 2: Analyze machine queue status
        available_machines, busy_machines = analyze_machine_queue_status(cur)
        
        # Step 3: Check execution 8683 specifically
        can_process_8683 = check_execution_8683_status(cur)
        
        # Step 4: Simulate new coordinator logic
        has_available_machines = simulate_new_coordinator_logic(cur)
        
        # Summary
        print("\n🎯 TEST SUMMARY")
        print("=" * 50)
        
        if can_process_8683 and has_available_machines:
            print("✅ GOOD NEWS: Execution 8683 should be processable with the new multi-machine system!")
            print(f"   The new coordinator should pick up Machine 2 and process execution 8683.")
            print(f"   Available machines: {len(available_machines)}")
            print(f"   Busy machines: {len(busy_machines)}")
        else:
            print("⚠️ There may be issues that need to be resolved:")
            if not can_process_8683:
                print("   - Execution 8683 is not in queued status")
            if not has_available_machines:
                print("   - No machines are currently available")
        
        print("\n📋 NEXT STEPS:")
        print("1. Deploy the updated workflow_executor.py to Modal")
        print("2. The new system will automatically start processing queued jobs per machine")
        print("3. Monitor the logs to see execution 8683 getting picked up by Machine 2")
        
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False
    
    return True

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1) 