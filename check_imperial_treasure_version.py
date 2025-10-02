import os
from supabase import create_client, Client
from dotenv import load_dotenv
import json
from datetime import datetime

# Load environment variables
load_dotenv('.env.local')

# Initialize Supabase client
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("\n" + "="*80)
print("Checking imperial_treasure_1 workflow in production database")
print("="*80 + "\n")

# Check if workflow exists with github_folder = imperial_treasure_1
response = supabase.table('deployed_workflows').select(
    'id, name, github_folder, github_path, github_sha, version, total_versions, current_version_id, created_at, updated_at'
).eq('github_folder', 'imperial_treasure_1').execute()

if response.data and len(response.data) > 0:
    workflow = response.data[0]
    print("✅ Found imperial_treasure_1 workflow!")
    print(f"   ID: {workflow['id']}")
    print(f"   Name: {workflow['name']}")
    print(f"   GitHub Folder: {workflow['github_folder']}")
    print(f"   GitHub Path: {workflow['github_path']}")
    print(f"   GitHub SHA: {workflow['github_sha'][:7] if workflow['github_sha'] else 'None'}")
    print(f"   Version: {workflow['version']}")
    print(f"   Total Versions: {workflow['total_versions']}")
    print(f"   Current Version ID: {workflow['current_version_id']}")
    print(f"   Created: {workflow['created_at']}")
    print(f"   Updated: {workflow['updated_at']}")

    # Get version history
    print("\n📚 Version History:")
    versions = supabase.table('deployed_workflow_versions').select(
        'id, version_number, created_at, change_notes, is_active'
    ).eq('workflow_id', workflow['id']).order('created_at', desc=False).execute()

    if versions.data:
        for v in versions.data:
            active = " [CURRENT]" if v['id'] == workflow['current_version_id'] else ""
            print(f"   v{v['version_number']}{active}")
            print(f"     Created: {v['created_at']}")
            print(f"     Notes: {v['change_notes']}")
            print()
    else:
        print("   No versions found in deployed_workflow_versions table")

    # Get recent executions
    print("\n🚀 Recent Executions:")
    executions = supabase.table('workflow_executions').select(
        'id, status, version_number, created_at'
    ).eq('workflow_id', workflow['id']).order('created_at', desc=True).limit(5).execute()

    if executions.data:
        for exec in executions.data:
            print(f"   #{exec['id']}: {exec['status']} (v{exec['version_number']}) - {exec['created_at']}")
    else:
        print("   No executions found")

else:
    print("❌ No workflow found with github_folder = 'imperial_treasure_1'")

    # Check if it exists with different naming
    print("\n🔍 Searching for similar workflows...")
    similar = supabase.table('deployed_workflows').select(
        'id, name, github_folder'
    ).or_('name.ilike.%imperial%,github_folder.ilike.%imperial%').execute()

    if similar.data:
        print("Found these imperial-related workflows:")
        for w in similar.data:
            print(f"   ID {w['id']}: {w['name']} (folder: {w['github_folder']})")
    else:
        print("   No imperial-related workflows found")

print("\n" + "="*80)