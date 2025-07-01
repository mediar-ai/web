#!/usr/bin/env python3
"""Test database query to fetch workflow automation sequence"""

import os
import json
import sys

# Check if we have Supabase credentials
supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

if not supabase_url or not supabase_key:
    print("❌ Missing Supabase credentials!")
    print("Please set environment variables:")
    print("- NEXT_PUBLIC_SUPABASE_URL")
    print("- SUPABASE_SERVICE_KEY")
    sys.exit(1)

try:
    from supabase import create_client
except ImportError:
    print("❌ Supabase module not installed!")
    print("Install with: pip install supabase")
    sys.exit(1)

# Connect to Supabase
print(f"🔌 Connecting to Supabase...")
print(f"   URL: {supabase_url}")

try:
    supabase = create_client(supabase_url, supabase_key)
    
    # Query workflow ID 1
    print("\n📊 Querying deployed_workflows table...")
    result = supabase.table('deployed_workflows').select('*').eq('id', 1).single().execute()
    
    if result.data:
        workflow = result.data
        print(f"\n✅ Found workflow!")
        print(f"   ID: {workflow['id']}")
        print(f"   Name: {workflow['name']}")
        print(f"   Status: {workflow['status']}")
        print(f"   Version: {workflow.get('version', 'N/A')}")
        
        # Check automation_sequence
        automation_sequence = workflow.get('automation_sequence', [])
        print(f"\n📋 Automation Sequence: {len(automation_sequence)} steps")
        
        # Display first few steps
        for i, step in enumerate(automation_sequence[:5]):
            print(f"\n   Step {i+1}:")
            print(f"   Action: {step.get('action_type')}")
            print(f"   Description: {step.get('description')}")
            if step.get('url'):
                print(f"   URL: {step['url']}")
            if step.get('selector'):
                print(f"   Selector: {step['selector']}")
            if step.get('parameters'):
                print(f"   Parameters: {json.dumps(step['parameters'])}")
        
        if len(automation_sequence) > 5:
            print(f"\n   ... and {len(automation_sequence) - 5} more steps")
        
        # Save full sequence to file for inspection
        with open('workflow_sequence.json', 'w') as f:
            json.dump(automation_sequence, f, indent=2)
        print(f"\n💾 Full automation sequence saved to: workflow_sequence.json")
        
        # Show validation checks and error handling if present
        if workflow.get('validation_checks'):
            print(f"\n✅ Validation Checks: {len(workflow['validation_checks'])}")
        
        if workflow.get('error_handling'):
            print(f"\n🚨 Error Handling Rules: {len(workflow['error_handling'])}")
            
    else:
        print("❌ No workflow found with ID 1")
        
except Exception as e:
    print(f"\n❌ Database query failed: {e}")
    import traceback
    traceback.print_exc() 