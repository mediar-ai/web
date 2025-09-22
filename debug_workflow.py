#!/usr/bin/env python3
import os
import sys
import json
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

# Get Supabase credentials
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not url or not key:
    print("Missing Supabase credentials")
    sys.exit(1)

# Create Supabase client
supabase: Client = create_client(url, key)

# Query test workflow
print("Searching for test-dev-cluster workflow...")
response = supabase.table("deployed_workflows").select("*").or_("name.like.%test-dev%,description.like.%tets%").execute()

if response.data:
    for workflow in response.data:
        print(f"\n{'='*60}")
        print(f"Workflow: {workflow['name']} (ID: {workflow['id']})")
        print(f"Description: {workflow['description']}")
        print(f"Status: {workflow['status']}")

        # Check YAML sequence
        if workflow.get('automation_sequence_yaml'):
            print(f"\nYAML Sequence Found:")
            print(workflow['automation_sequence_yaml'][:1000])

        # Check JSON sequence
        if workflow.get('automation_sequence'):
            print(f"\nJSON Sequence Found:")
            seq = workflow['automation_sequence']
            if isinstance(seq, str):
                seq = json.loads(seq)
            print(json.dumps(seq, indent=2)[:1500])
else:
    print("No workflow found matching criteria")

# Also query other workflows for comparison
print("\n\nFetching a working workflow for comparison...")
comparison = supabase.table("deployed_workflows").select("*").eq("status", "active").limit(1).execute()

if comparison.data:
    workflow = comparison.data[0]
    print(f"\n{'='*60}")
    print(f"Working Workflow Example: {workflow['name']}")

    if workflow.get('automation_sequence_yaml'):
        print(f"\nYAML Structure:")
        print(workflow['automation_sequence_yaml'][:800])
    elif workflow.get('automation_sequence'):
        print(f"\nJSON Structure:")
        seq = workflow['automation_sequence']
        if isinstance(seq, str):
            seq = json.loads(seq)
        print(json.dumps(seq, indent=2)[:800])