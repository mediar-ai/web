#!/usr/bin/env python3

import psycopg2
import json
from datetime import datetime

def check_user_readiness():
    """Check if the specific user is ready for timeline mapping"""
    
    # Connect to database
    conn = psycopg2.connect("postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres")
    cursor = conn.cursor()
    
    # Target user from the request
    user_id = "cf10a6c5-4c16-b3c9-cf10-a6c54c16b3c9"
    
    print(f"🔍 Checking timeline mapping readiness for user: {user_id}")
    print("=" * 60)
    
    # Check detailed workflows
    print("📊 Step 1: Checking detailed workflows...")
    cursor.execute("""
        SELECT id, title, 
               CASE WHEN detailed_workflow_data IS NOT NULL THEN 'Yes' ELSE 'No' END as has_details,
               CASE WHEN detailed_workflow_data IS NOT NULL AND 
                         detailed_workflow_data->'workflow_components_with_ids' IS NOT NULL 
                    THEN 'Yes' ELSE 'No' END as has_components
        FROM low_level_workflows 
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 5
    """, (user_id,))
    
    workflows = cursor.fetchall()
    detailed_workflows = [w for w in workflows if w[2] == 'Yes']
    
    print(f"Total workflows: {len(workflows)}")
    print(f"With detailed data: {len(detailed_workflows)}")
    
    for wf_id, title, has_details, has_components in workflows:
        print(f"  Workflow {wf_id}: {title[:50]}")
        print(f"    Details: {has_details}, Components: {has_components}")
    
    # Check UI tree events
    print(f"\n🌳 Step 2: Checking UI tree events...")
    cursor.execute("""
        SELECT COUNT(*) as ui_tree_count
        FROM low_level_events_enriched
        WHERE user_id = %s AND event_type = 'ui_tree'
    """, (user_id,))
    
    ui_tree_count = cursor.fetchone()[0]
    print(f"UI tree events: {ui_tree_count}")
    
    if ui_tree_count >= 2:
        # Get recent UI tree events for batch analysis
        cursor.execute("""
            SELECT id, created_at
            FROM low_level_events_enriched
            WHERE user_id = %s AND event_type = 'ui_tree'
            ORDER BY created_at DESC 
            LIMIT 3
        """, (user_id,))
        
        recent_ui_trees = cursor.fetchall()
        print(f"Recent UI tree events:")
        for i, (event_id, created_at) in enumerate(recent_ui_trees):
            print(f"  {i+1}. Event {event_id}: {created_at}")
    
    # Check analysis records (needed for timeline mapping)
    print(f"\n🔍 Step 3: Checking analysis records...")
    cursor.execute("""
        SELECT COUNT(*) as analysis_count,
               MIN(created_at) as earliest,
               MAX(created_at) as latest
        FROM low_level_workflow_analyses
        WHERE user_id = %s
    """, (user_id,))
    
    analysis_data = cursor.fetchone()
    analysis_count, earliest, latest = analysis_data
    
    print(f"Analysis records: {analysis_count}")
    if analysis_count > 0:
        print(f"  Range: {earliest} to {latest}")
    
    # Final readiness assessment
    print(f"\n🎯 Readiness Assessment:")
    ready = len(detailed_workflows) > 0 and ui_tree_count >= 2 and analysis_count > 0
    
    print(f"✅ Detailed workflows: {'✓' if len(detailed_workflows) > 0 else '✗'} ({len(detailed_workflows)})")
    print(f"✅ UI tree events: {'✓' if ui_tree_count >= 2 else '✗'} ({ui_tree_count})")
    print(f"✅ Analysis records: {'✓' if analysis_count > 0 else '✗'} ({analysis_count})")
    
    if ready:
        print(f"\n🚀 User {user_id} is READY for timeline mapping!")
    else:
        print(f"\n❌ User {user_id} is NOT ready for timeline mapping.")
        if len(detailed_workflows) == 0:
            print("   - Missing detailed workflows with components")
        if ui_tree_count < 2:
            print("   - Need at least 2 UI tree events for batch analysis")
        if analysis_count == 0:
            print("   - Missing analysis records")
    
    cursor.close()
    conn.close()
    
    return ready

if __name__ == "__main__":
    check_user_readiness() 