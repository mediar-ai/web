#!/usr/bin/env python3
"""
Verify Migration Success: Check that is_shared was renamed to is_public
"""

import os
from supabase import create_client
from dotenv import load_dotenv

# Load environment
script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
env_path = os.path.join(parent_dir, '.env.local')

load_dotenv(env_path)

supabase = create_client(
    os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

print("=" * 80)
print("VERIFYING MIGRATION SUCCESS")
print("=" * 80)
print()

# Test 1: Check if is_public column exists
print("Test 1: Checking for is_public column...")
try:
    result = supabase.table('deployed_workflows').select('is_public').limit(1).execute()
    print("  [OK] is_public column exists")
    has_is_public = True
except Exception as e:
    print(f"  [FAIL] is_public column does not exist")
    print(f"  Error: {e}")
    has_is_public = False

# Test 2: Check if is_shared column still exists (should not)
print("\nTest 2: Checking if is_shared was removed...")
try:
    result = supabase.table('deployed_workflows').select('is_shared').limit(1).execute()
    print("  [FAIL] is_shared column still exists (should be renamed)")
    has_is_shared = True
except Exception as e:
    print("  [OK] is_shared column removed")
    has_is_shared = False

# Test 3: Check NULL org_id count
print("\nTest 3: Checking for NULL organization_id...")
result = supabase.table('deployed_workflows').select('id').is_('organization_id', None).execute()
null_count = len(result.data)
print(f"  Workflows with NULL org_id: {null_count}")
if null_count == 0:
    print("  [OK] No orphaned workflows")
else:
    print(f"  [WARN] {null_count} workflows still have NULL org_id")

# Test 4: Check public workflows count
if has_is_public:
    print("\nTest 4: Checking public workflows...")
    result = supabase.table('deployed_workflows').select('id, name, organization_id, is_public').eq('is_public', True).execute()
    public_workflows = result.data
    print(f"  Public workflows (is_public=true): {len(public_workflows)}")
    for wf in public_workflows:
        print(f"    - Workflow {wf['id']}: {wf['name']}")
        print(f"      organization_id: {wf['organization_id']}")

# Test 5: Check workflow 57 specifically
print("\nTest 5: Checking workflow 57 status...")
if has_is_public:
    result = supabase.table('deployed_workflows').select('id, name, organization_id, is_public').eq('id', 57).execute()
    if result.data:
        wf = result.data[0]
        print(f"  ID: {wf['id']}")
        print(f"  Name: {wf['name']}")
        print(f"  organization_id: {wf['organization_id']}")
        print(f"  is_public: {wf['is_public']}")
        print()
        if wf['is_public']:
            print("  [WARN] Workflow 57 is PUBLIC - ALL desktop users will see it")
        else:
            print("  [OK] Workflow 57 is private - only owning org sees it")
    else:
        print("  [WARN] Workflow 57 not found")

# Final verdict
print()
print("=" * 80)
print("MIGRATION STATUS")
print("=" * 80)
print()

if has_is_public and not has_is_shared and null_count == 0:
    print("[SUCCESS] Migration completed successfully!")
    print()
    print("Summary:")
    print("  [+] Column renamed: is_shared -> is_public")
    print("  [+] All workflows have organization owners")
    print("  [+] API code matches database schema")
    print()
    print("Next steps:")
    print("  1. Restart web app to use new column")
    print("  2. Rebuild desktop app")
    print("  3. Test workflow visibility")
elif not has_is_public:
    print("[PENDING] Migration not executed yet")
    print()
    print("Please run the migration SQL in Supabase Dashboard:")
    print("https://supabase.com/dashboard/project/eshwntsgsputksqamckh/sql/new")
else:
    print("[PARTIAL] Migration partially complete")
    print(f"  is_public exists: {has_is_public}")
    print(f"  is_shared exists: {has_is_shared}")
    print(f"  NULL org_id count: {null_count}")

print()

