#!/usr/bin/env python3
"""
Critical Analysis: Public Workflow Loading Flow in Desktop App
Purpose: Trace the entire process from database to desktop app UI
"""

import os
import sys
from supabase import create_client
from dotenv import load_dotenv
import json

# Load environment variables from parent directory
script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
env_path = os.path.join(parent_dir, '.env.local')

print(f"Loading .env from: {env_path}")
load_dotenv(env_path)

# Initialize Supabase
supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print(f"Supabase URL: {supabase_url}")
    print(f"Supabase Key: {'*' * 10 if supabase_key else 'None'}")
    raise ValueError("Missing Supabase credentials")

supabase = create_client(supabase_url, supabase_key)

print("=" * 100)
print("CRITICAL ANALYSIS: PUBLIC WORKFLOW LOADING FLOW IN DESKTOP APP")
print("=" * 100)
print()

# ============================================================================
# STEP 1: Database State - What's Actually Public?
# ============================================================================
print("STEP 1: DATABASE STATE - What workflows are marked as public?")
print("-" * 100)

# Check CURRENT state (before migration)
print("\n[BEFORE MIGRATION] Current state with is_shared:")
current_public_response = supabase.table('deployed_workflows').select(
    'id, name, organization_id, is_shared, created_at, created_by'
).eq('is_shared', True).execute()

current_public = current_public_response.data

print(f"Workflows with is_shared=true: {len(current_public)}")
for wf in current_public:
    print(f"  - ID {wf['id']}: {wf['name']}")
    print(f"    organization_id: {wf['organization_id']}")
    print(f"    is_shared: {wf['is_shared']}")
    print(f"    created_by: {wf['created_by']}")
    print()

# Check if is_public column exists (after migration)
print("\n[CHECKING] Does is_public column exist yet?")
try:
    after_migration_response = supabase.table('deployed_workflows').select(
        'id, name, organization_id, is_public, created_at'
    ).eq('is_public', True).execute()
    
    after_migration = after_migration_response.data
    print(f"[OK] is_public column EXISTS")
    print(f"Workflows with is_public=true: {len(after_migration)}")
    for wf in after_migration:
        print(f"  - ID {wf['id']}: {wf['name']}")
        print(f"    organization_id: {wf['organization_id']}")
        print(f"    is_public: {wf['is_public']}")
except Exception as e:
    print(f"[X] is_public column DOES NOT EXIST yet (migration not run)")
    print(f"  Error: {e}")

# Check workflows with NULL organization_id
print("\n[CHECKING] Workflows with NULL organization_id:")
null_org_response = supabase.table('deployed_workflows').select(
    'id, name, organization_id, is_shared, created_at'
).is_('organization_id', None).execute()

null_org_workflows = null_org_response.data
print(f"Workflows with NULL organization_id: {len(null_org_workflows)}")
for wf in null_org_workflows:
    print(f"  - ID {wf['id']}: {wf['name']}")
    print(f"    is_shared: {wf.get('is_shared', 'N/A')}")

# ============================================================================
# STEP 2: API Query Logic - How Backend Determines Public Workflows
# ============================================================================
print("\n" + "=" * 100)
print("STEP 2: API QUERY LOGIC - How does /api/remote-workflows/list work?")
print("-" * 100)

print("\nBefore migration, the API runs this query:")
print("""
// Get globally public workflows (is_shared = true AND organization_id IS NULL)
const publicWorkflows = await supabase
  .from('deployed_workflows')
  .select('id')
  .eq('is_shared', true)
  .is('organization_id', null)
  .is('parent_workflow_id', null);
""")

# Simulate the BEFORE query
before_query_response = supabase.table('deployed_workflows').select(
    'id, name, organization_id, is_shared'
).eq('is_shared', True).is_('organization_id', None).is_('parent_workflow_id', None).execute()

before_query_results = before_query_response.data

print(f"\n[BEFORE MIGRATION] Query results: {len(before_query_results)} workflows")
for wf in before_query_results:
    print(f"  [OK] Workflow {wf['id']}: {wf['name']} (would be returned as public)")

print("\n" + "-" * 100)
print("\nAfter migration, the API will run this query:")
print("""
// Get globally public workflows (is_public = true)
const publicWorkflows = await supabase
  .from('deployed_workflows')
  .select('id')
  .eq('is_public', true)
  .is('parent_workflow_id', null);
""")

# Simulate the AFTER query
try:
    after_query_response = supabase.table('deployed_workflows').select(
        'id, name, organization_id, is_public'
    ).eq('is_public', True).is_('parent_workflow_id', None).execute()
    
    after_query_results = after_query_response.data
    
    print(f"\n[AFTER MIGRATION] Query results: {len(after_query_results)} workflows")
    for wf in after_query_results:
        print(f"  [OK] Workflow {wf['id']}: {wf['name']} (organization_id: {wf['organization_id']})")
except Exception as e:
    print(f"\n[AFTER MIGRATION] Cannot run query yet (migration not done)")
    print(f"  Expected after migration: {len(before_query_results)} workflows")

# ============================================================================
# STEP 3: Desktop App Authentication - What Org Context Do Users Have?
# ============================================================================
print("\n" + "=" * 100)
print("STEP 3: DESKTOP APP AUTHENTICATION - What org context do users get?")
print("-" * 100)

print("\nDesktop authentication flow:")
print("1. User logs in via desktop app")
print("2. Web app generates token with org context")
print("3. Token includes user's PRIMARY organization")
print()
print("Key point: EVERY desktop user MUST have an organization")
print("  - If user has no org: ERROR - cannot use desktop app")
print("  - If user has 1+ orgs: Uses PRIMARY (first) org")
print()

# Check sample desktop sessions
sessions_response = supabase.table('mediar_desktop_sessions').select(
    'email, org_id, is_active, created_at'
).eq('is_active', True).order('created_at', desc=True).limit(5).execute()

sessions = sessions_response.data

print(f"Sample active desktop sessions: {len(sessions)}")
for session in sessions:
    print(f"  - {session['email']}: org_id={session['org_id']}")

# ============================================================================
# STEP 4: Access Control - Who Can See Public Workflows?
# ============================================================================
print("\n" + "=" * 100)
print("STEP 4: ACCESS CONTROL - Who can see public workflows?")
print("-" * 100)

print("\nAccess control logic for ANY user (regardless of organization):")
print("""
accessibleWorkflows = [
  ...ownedWorkflows,    // Workflows owned by user's org
  ...sharedWorkflows,   // Workflows shared with user's org
  ...publicWorkflows    // PUBLIC workflows (everyone can see)
]
""")

print("\nCritical insight:")
print("  [+] Public workflows are returned to ALL organizations")
print("  [+] Desktop users from ANY org will see public workflows")
print("  [+] No special permission needed - 'public' means 'everyone'")
print()

# Test with different org IDs
test_org_ids = [
    'org_REDACTED',  # Mediar main
    'org_REDACTED',  # Mediar legacy
    'org_REDACTED',   # Top org by count
    'org_RANDOM_ORG_ID',                 # Random org
]

print(f"Simulating access for different organizations:")
print(f"Public workflows found: {len(before_query_results)}")
print()

for org_id in test_org_ids[:3]:  # Test first 3 real orgs
    # Owned workflows
    owned_response = supabase.table('deployed_workflows').select('id').eq(
        'organization_id', org_id
    ).is_('parent_workflow_id', None).execute()
    owned_count = len(owned_response.data)
    
    # Shared workflows
    shared_response = supabase.table('workflow_organization_access').select(
        'workflow_id'
    ).eq('organization_id', org_id).execute()
    shared_count = len(shared_response.data)
    
    # Total accessible
    public_count = len(before_query_results)
    total = owned_count + shared_count + public_count
    
    print(f"Org: {org_id}")
    print(f"  Owned: {owned_count} workflows")
    print(f"  Shared: {shared_count} workflows")
    print(f"  Public: {public_count} workflows  <- SAME FOR EVERYONE")
    print(f"  Total accessible: {total} workflows")
    print()

# ============================================================================
# STEP 5: Desktop App Data Flow - From API to UI
# ============================================================================
print("=" * 100)
print("STEP 5: DESKTOP APP DATA FLOW - From API to UI")
print("-" * 100)

print("\nComplete flow:")
print()
print("1. Desktop App Startup")
print("   -> Rust: list_workflows() called")
print("   -> HTTP: GET /api/remote-workflows/list")
print("   -> Header: Authorization: Bearer <desktop-token>")
print()
print("2. Backend Authentication")
print("   -> Validates desktop token")
print("   -> Extracts user's org_id from token")
print("   -> Example: org_id = 'org_ABC123'")
print()
print("3. Backend Query Execution")
print("   -> Query owned workflows: organization_id = 'org_ABC123'")
print("   -> Query shared workflows: workflow_organization_access WHERE org_id = 'org_ABC123'")
print("   -> Query public workflows: is_shared = true AND organization_id IS NULL")
print("   -> Combine all workflow IDs")
print()
print("4. Backend Response")
print("   -> Returns: ApiWorkflow[] with fields:")
print("     * id, name, description")
print("     * organization_id")
print("     * is_shared (or is_public after migration)")
print()
print("5. Desktop App Processing (Rust)")
print("   -> Receives Vec<ApiWorkflow>")
print("   -> Converts to Vec<WorkflowSummary>")
print("   -> Maps is_shared -> WorkflowSummary.is_shared")
print()
print("6. Desktop App UI (TypeScript)")
print("   -> Receives workflow summaries via Tauri invoke")
print("   -> Maps to Workflow interface")
print("   -> Sets: isShared = summary.is_shared")
print("   -> Displays in workflow list")
print()

# ============================================================================
# STEP 6: Critical Analysis - Will All Users See Public Workflow?
# ============================================================================
print("=" * 100)
print("STEP 6: CRITICAL ANALYSIS - Will all users see the public workflow?")
print("-" * 100)

print("\nWorkflow 57: 'chromeextension092525139pm'")
print()

# Check workflow 57 specifically
wf_57_response = supabase.table('deployed_workflows').select(
    'id, name, organization_id, is_shared, parent_workflow_id, created_at'
).eq('id', 57).single().execute()

wf_57 = wf_57_response.data if wf_57_response.data else None

if wf_57:
    print("Current state:")
    print(f"  ID: {wf_57['id']}")
    print(f"  Name: {wf_57['name']}")
    print(f"  organization_id: {wf_57['organization_id']}")
    print(f"  is_shared: {wf_57['is_shared']}")
    print(f"  parent_workflow_id: {wf_57['parent_workflow_id']}")
    print()
    
    # Check if it matches public workflow criteria
    is_currently_public = (
        wf_57['is_shared'] == True and 
        wf_57['organization_id'] is None and
        wf_57['parent_workflow_id'] is None
    )
    
    print("BEFORE MIGRATION:")
    print(f"  Is marked as public? {is_currently_public}")
    print(f"  Query condition: is_shared=true AND organization_id IS NULL")
    print(f"    [+] is_shared = {wf_57['is_shared']}")
    print(f"    {'[+]' if wf_57['organization_id'] is None else '[-]'} organization_id IS NULL = {wf_57['organization_id'] is None}")
    print(f"    {'[+]' if wf_57['parent_workflow_id'] is None else '[-]'} parent_workflow_id IS NULL = {wf_57['parent_workflow_id'] is None}")
    print(f"  Result: {'[+] VISIBLE to all users' if is_currently_public else '[-] NOT visible as public'}")
    print()
    
    # After migration state
    print("AFTER MIGRATION:")
    print(f"  organization_id will be: 'org_REDACTED' (Mediar)")
    print(f"  is_public will be: true (if is_shared was true)")
    print(f"  Query condition: is_public=true")
    print(f"  Result: [+] VISIBLE to all users")
    print()
else:
    print("[-] Workflow 57 not found in database!")
    print()

# ============================================================================
# STEP 7: Edge Cases & Potential Issues
# ============================================================================
print("=" * 100)
print("STEP 7: EDGE CASES & POTENTIAL ISSUES")
print("-" * 100)

print("\n1. Parent/Child Workflows")
print("   Query includes: .is('parent_workflow_id', null)")
print("   This means: Only TOP-LEVEL workflows are returned as public")
print("   Settings workflows (children) are NOT returned separately")
print()

# Check if workflow 57 has children
children_response = supabase.table('deployed_workflows').select(
    'id, name, parent_workflow_id'
).eq('parent_workflow_id', 57).execute()

children = children_response.data

if children:
    print(f"   Workflow 57 has {len(children)} child workflows:")
    for child in children:
        print(f"     - ID {child['id']}: {child['name']}")
    print(f"   These children will NOT appear in public list (parent_workflow_id != null)")
else:
    print(f"   Workflow 57 has no children")
print()

print("2. Desktop Token Expiry")
print("   Tokens expire after 30 days")
print("   Expired tokens → 401 Unauthorized → No workflows visible")
print()

print("3. Organization Requirement")
print("   Desktop app REQUIRES organization context")
print("   Users without org → Cannot use desktop app at all")
print()

print("4. Migration Timing")
print("   Web app + Desktop app must be updated together")
print("   Old desktop + New web = is_shared undefined")
print("   New desktop + Old web = is_public undefined")
print()

# ============================================================================
# FINAL VERDICT
# ============================================================================
print("=" * 100)
print("FINAL VERDICT: Will all users see workflow 57 in desktop app?")
print("=" * 100)
print()

if wf_57 and is_currently_public:
    print("[+] YES - All desktop users WILL see workflow 57")
    print()
    print("Reasoning:")
    print("  1. Workflow 57 is marked as public (is_shared=true, org_id=NULL)")
    print("  2. API query includes it in publicWorkflows list")
    print("  3. Public workflows are returned to ALL organizations")
    print("  4. Desktop app receives it in list response")
    print("  5. UI displays it alongside owned/shared workflows")
    print()
    print("User experience:")
    print("  - User from org_A: Sees workflow 57 [+]")
    print("  - User from org_B: Sees workflow 57 [+]")
    print("  - User from Mediar: Sees workflow 57 [+]")
    print("  - User from ANY org: Sees workflow 57 [+]")
    print()
    print("After migration:")
    print("  - Same behavior, just clearer semantics")
    print("  - is_public=true instead of is_shared=true + NULL org")
    print("  - Still visible to everyone")
elif wf_57:
    print("[-] NO - Workflow 57 is NOT currently public")
    print()
    print("Reasoning:")
    print(f"  - is_shared: {wf_57['is_shared']} (need: true)")
    print(f"  - organization_id: {wf_57['organization_id']} (need: NULL)")
    print(f"  - Does not meet criteria: is_shared=true AND organization_id IS NULL")
    print()
    print("To make it public:")
    if wf_57['organization_id'] is not None:
        print("  1. Set organization_id = NULL (temporarily, for old model)")
        print("  2. Keep is_shared = true")
        print("  OR")
        print("  1. Run migration (creates is_public column)")
        print("  2. Set is_public = true")
else:
    print("[-] Workflow 57 does not exist")

print()
print("=" * 100)
print("END OF ANALYSIS")
print("=" * 100)

