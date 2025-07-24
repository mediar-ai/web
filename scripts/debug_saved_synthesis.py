#!/usr/bin/env python3

import psycopg2
import json
import sys
from datetime import datetime

# Database connection
conn_string = "postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

def debug_saved_synthesis(user_id=None):
    """Debug what's actually stored in saved_workflow_syntheses table"""
    
    try:
        conn = psycopg2.connect(conn_string)
        cursor = conn.cursor()
        
        # Query saved syntheses
        if user_id:
            query = """
            SELECT id, title, workflow_context, identified_workflow_names, 
                   workflow_boundaries, conversation_history, synthesis_results,
                   created_at
            FROM saved_workflow_syntheses 
            WHERE user_id = %s AND is_active = true
            ORDER BY created_at DESC
            LIMIT 5
            """
            cursor.execute(query, (user_id,))
        else:
            query = """
            SELECT id, title, user_id, workflow_context, identified_workflow_names, 
                   workflow_boundaries, conversation_history, synthesis_results,
                   created_at
            FROM saved_workflow_syntheses 
            WHERE is_active = true
            ORDER BY created_at DESC
            LIMIT 10
            """
            cursor.execute(query)
        
        results = cursor.fetchall()
        
        print(f"Found {len(results)} saved syntheses")
        print("=" * 80)
        
        for result in results:
            if user_id:
                synthesis_id, title, workflow_context, identified_names, boundaries, conversation, results_data, created_at = result
                user_id_display = user_id
            else:
                synthesis_id, title, user_id_display, workflow_context, identified_names, boundaries, conversation, results_data, created_at = result
            
            print(f"\n📋 Synthesis ID: {synthesis_id}")
            print(f"📋 Title: {title}")
            print(f"📋 User ID: {user_id_display}")
            print(f"📋 Created: {created_at}")
            
            # Check workflow_context
            print(f"\n🔍 WORKFLOW_CONTEXT:")
            if workflow_context:
                context_data = workflow_context
                print(f"   Type: {type(context_data)}")
                if isinstance(context_data, dict):
                    for key, value in context_data.items():
                        print(f"   {key}: {repr(value)}")
                else:
                    print(f"   Raw: {repr(context_data)}")
            else:
                print("   ❌ EMPTY/NULL")
            
            # Check identified_workflow_names
            print(f"\n🔍 IDENTIFIED_WORKFLOW_NAMES:")
            if identified_names:
                try:
                    names = json.loads(identified_names) if isinstance(identified_names, str) else identified_names
                    print(f"   Count: {len(names) if isinstance(names, list) else 'Not a list'}")
                    print(f"   Names: {names}")
                except json.JSONDecodeError as e:
                    print(f"   ❌ JSON Error: {e}")
                    print(f"   Raw: {repr(identified_names)}")
            else:
                print("   ❌ EMPTY/NULL")
            
            # Check workflow_boundaries  
            print(f"\n🔍 WORKFLOW_BOUNDARIES:")
            if boundaries:
                print(f"   Type: {type(boundaries)}")
                if isinstance(boundaries, dict):
                    print(f"   Keys: {list(boundaries.keys())}")
                    for name, boundary in boundaries.items():
                        if isinstance(boundary, dict):
                            trigger = boundary.get('trigger', 'No trigger')
                            terminator = boundary.get('terminator', 'No terminator')
                            print(f"   {name}: trigger='{trigger[:50]}...', terminator='{terminator[:50]}...'")
                        else:
                            print(f"   {name}: {repr(boundary)}")
                else:
                    print(f"   Raw: {repr(boundaries)}")
            else:
                print("   ❌ EMPTY/NULL")
            
            # Check synthesis_results
            print(f"\n🔍 SYNTHESIS_RESULTS:")
            if results_data:
                print(f"   Type: {type(results_data)}")
                if isinstance(results_data, list):
                    print(f"   Count: {len(results_data)}")
                    for i, workflow in enumerate(results_data):
                        if isinstance(workflow, dict):
                            title = workflow.get('title', 'No title')
                            print(f"   Workflow {i+1}: {title}")
                        else:
                            print(f"   Workflow {i+1}: {type(workflow)}")
                else:
                    print(f"   Raw: {repr(results_data)}")
            else:
                print("   ❌ EMPTY/NULL")
            
            print("-" * 40)
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1:
        user_id = sys.argv[1]
        print(f"🔍 Debugging saved synthesis for user: {user_id}")
        debug_saved_synthesis(user_id)
    else:
        print("🔍 Debugging all recent saved syntheses...")
        debug_saved_synthesis() 