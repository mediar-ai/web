#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime

def check_synthesized_workflows():
    """Check which users have synthesized workflows with detailed_workflow_data"""
    
    # Connect to database (same pattern as existing scripts)
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    print("🔍 Checking synthesized workflows with detailed_workflow_data...")
    print("=" * 60)
    
    # Check all users with synthesized workflows
    cursor.execute("""
        SELECT user_id, COUNT(*) as workflow_count,
               COUNT(CASE WHEN detailed_workflow_data IS NOT NULL THEN 1 END) as detailed_count
        FROM low_level_workflows 
        GROUP BY user_id
        ORDER BY detailed_count DESC, workflow_count DESC
    """)
    
    user_workflows = cursor.fetchall()
    
    print("📊 User Workflow Summary:")
    print("User ID                                  | Total | With Details")
    print("-" * 60)
    
    users_with_detailed = []
    for user_id, total_count, detailed_count in user_workflows:
        print(f"{user_id[:40]:<40} | {total_count:5} | {detailed_count:5}")
        if detailed_count > 0:
            users_with_detailed.append(user_id)
    
    print(f"\n✅ Found {len(users_with_detailed)} users with detailed workflow data")
    
    # Show detailed info for first user with detailed workflows
    if users_with_detailed:
        test_user = users_with_detailed[0]
        print(f"\n🔬 Examining detailed workflows for user: {test_user}")
        
        cursor.execute("""
            SELECT id, title, detailed_workflow_data, synthesis_session_id, created_at
            FROM low_level_workflows 
            WHERE user_id = %s AND detailed_workflow_data IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 3
        """, (test_user,))
        
        detailed_workflows = cursor.fetchall()
        
        for wf_id, title, detailed_data, session_id, created_at in detailed_workflows:
            print(f"\n  📝 Workflow {wf_id}: {title}")
            print(f"     Session: {session_id}")
            print(f"     Created: {created_at}")
            
            # Check if it has workflow_components_with_ids
            if detailed_data and 'workflow_components_with_ids' in detailed_data:
                components = detailed_data['workflow_components_with_ids']
                types_count = len(components.get('workflow_types', []))
                instances_count = len(components.get('workflow_instances', []))
                steps_count = len(components.get('steps', []))
                
                print(f"     ✅ Components: {types_count} types, {instances_count} instances, {steps_count} steps")
            else:
                print(f"     ❌ No workflow_components_with_ids found")
    
    # Check UI tree events for users with detailed workflows
    if users_with_detailed:
        test_user = users_with_detailed[0]
        print(f"\n🌳 Checking UI tree events for user: {test_user}")
        
        cursor.execute("""
            SELECT COUNT(*) as ui_tree_count
            FROM low_level_events_enriched
            WHERE user_id = %s AND event_type = 'ui_tree'
        """, (test_user,))
        
        ui_tree_count = cursor.fetchone()[0]
        print(f"     📊 UI tree events: {ui_tree_count}")
        
        if ui_tree_count > 0:
            print(f"\n🎯 User {test_user} is ready for timeline mapping!")
            print(f"     - Has {len([u for u in user_workflows if u[0] == test_user][0][2])} detailed workflows")
            print(f"     - Has {ui_tree_count} UI tree events")
        else:
            print(f"     ⚠️  No UI tree events found")
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    check_synthesized_workflows() 