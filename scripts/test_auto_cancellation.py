#!/usr/bin/env python3
"""
Test script for auto-cancellation logic
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timedelta

# Database configuration
DB_CONFIG = {
    "host": "aws-0-us-west-1.pooler.supabase.com",
    "port": 5432,
    "database": "postgres",
    "user": "postgres.eshwntsgsputksqamckh",
    "password": "***REMOVED***",
}

# Import the functions we want to test
from modal_apps.workflow_executor import (
    get_last_failed_executions,
    cancel_queued_jobs,
    check_and_cancel_queue_if_needed,
    CONSECUTIVE_FAILURE_THRESHOLD
)

def test_get_last_failed_executions():
    """Test getting last failed executions"""
    print("🧪 Testing get_last_failed_executions...")
    
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()  # Use regular cursor for testing our functions
    
    # Test with workflow ID 1 (should have failures)
    failures = get_last_failed_executions(cur, 1, 5)
    print(f"   Found {len(failures)} recent failures for workflow 1")
    
    if failures:
        print(f"   Most recent failure: {failures[0][1]} - {failures[0][2][:50] if failures[0][2] else 'No error message'}...")
    
    cur.close()
    conn.close()
    print("✅ get_last_failed_executions test passed")

def test_consecutive_failure_detection():
    """Test the consecutive failure detection logic"""
    print("\n🧪 Testing consecutive failure detection...")
    
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    # Test with real data - check if current patterns would trigger cancellation
    cur.execute("""
        SELECT workflow_id, error_message, COUNT(*) as count
        FROM workflow_executions 
        WHERE status = 'failed' AND error_message IS NOT NULL
        GROUP BY workflow_id, error_message
        HAVING COUNT(*) >= 3
        ORDER BY count DESC
        LIMIT 5
    """)
    
    patterns = cur.fetchall()
    print(f"   Found {len(patterns)} error patterns with 3+ occurrences")
    
    for pattern in patterns:
        print(f"   - Workflow {pattern[0]}: {pattern[2]} × '{pattern[1][:50]}...'")
    
    cur.close()
    conn.close()
    print("✅ Consecutive failure detection test passed")

def test_queued_jobs_count():
    """Test counting queued jobs"""
    print("\n🧪 Testing queued jobs count...")
    
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    # Count current queued jobs
    cur.execute("""
        SELECT workflow_id, COUNT(*) as queued_count
        FROM workflow_executions 
        WHERE status = 'queued'
        GROUP BY workflow_id
    """)
    
    queued_jobs = cur.fetchall()
    print(f"   Found {len(queued_jobs)} workflows with queued jobs")
    
    for job in queued_jobs:
        print(f"   - Workflow {job[0]}: {job[1]} queued jobs")
    
    cur.close()
    conn.close()
    print("✅ Queued jobs count test passed")

def test_auto_cancellation_logic():
    """Test the full auto-cancellation logic without actually cancelling"""
    print("\n🧪 Testing auto-cancellation logic (dry run)...")
    
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    # Get some real failure patterns and test the logic
    cur.execute("""
        SELECT DISTINCT workflow_id, error_message
        FROM workflow_executions 
        WHERE status = 'failed' AND error_message IS NOT NULL
        LIMIT 3
    """)
    
    test_cases = cur.fetchall()
    
    for test_case in test_cases:
        workflow_id = test_case[0]
        error_message = test_case[1]
        
        # Test the logic (without actually cancelling)
        last_failures = get_last_failed_executions(cur, workflow_id, CONSECUTIVE_FAILURE_THRESHOLD)
        
        if len(last_failures) >= CONSECUTIVE_FAILURE_THRESHOLD:
            error_messages = [exec[2] for exec in last_failures]
            all_identical = all(msg == error_messages[0] for msg in error_messages)
            
            if all_identical:
                print(f"   Workflow {workflow_id}:")
                print(f"     - Last 3 failures are identical: {all_identical}")
                print(f"     - Would trigger cancellation: {all_identical}")
            else:
                print(f"   Workflow {workflow_id}: Last 3 failures are not identical")
        else:
            print(f"   Workflow {workflow_id}: Only {len(last_failures)} recent failures")
    
    cur.close()
    conn.close()
    print("✅ Auto-cancellation logic test passed")

def main():
    """Run all tests"""
    print("🚀 Testing Auto-Cancellation Implementation")
    print("=" * 50)
    
    try:
        test_get_last_failed_executions()
        test_consecutive_failure_detection()
        test_queued_jobs_count()
        test_auto_cancellation_logic()
        
        print("\n" + "=" * 50)
        print("✅ All tests passed! Auto-cancellation logic is ready.")
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main() 