#!/usr/bin/env python3

import sys
import os
import psycopg2
import json
from datetime import datetime

# Add modal-apps to path so we can import functions
sys.path.append('modal-apps')

# Import the functions we want to test
from sequential_processor import (
    get_database_connection, 
    get_recent_analyses, 
    build_fresh_context,
    get_next_unprocessed_event
)

def test_context_building():
    """Test the context building with real database data"""
    
    # Set up database connection using environment variable
    conn_string = os.getenv('SUPABASE_CONN_STRING')
    if not conn_string:
        print("❌ SUPABASE_CONN_STRING environment variable not set")
        return
    
    try:
        # Connect to database
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Find a user with recent analyses
        cur.execute("""
            SELECT user_id, COUNT(*) as analysis_count
            FROM low_level_workflow_analyses 
            WHERE llm_structured_output IS NOT NULL
            GROUP BY user_id 
            ORDER BY analysis_count DESC 
            LIMIT 5
        """)
        
        users = cur.fetchall()
        print(f"📊 Found {len(users)} users with analyses:")
        for user_id, count in users:
            print(f"   • {user_id}: {count} analyses")
        
        if not users:
            print("❌ No users with analyses found")
            return
        
        # Test with the user who has the most analyses
        test_user_id = users[0][0]
        print(f"\n🧪 Testing context building for user: {test_user_id}")
        
        # Get recent analyses to see what the data looks like
        print("\n📋 Testing get_recent_analyses function:")
        recent_analyses = get_recent_analyses(cur, test_user_id, 5)
        print(f"   Found {len(recent_analyses)} recent analyses")
        
        for i, analysis in enumerate(recent_analyses[:3]):
            analysis_id, user_id, session_id, llm_output, created_at, client_timestamp = analysis
            print(f"\n   Analysis {i+1} (ID: {analysis_id}):")
            print(f"     • Created: {created_at}")
            print(f"     • Client timestamp: {client_timestamp}")
            
            if llm_output:
                print(f"     • Fields in llm_structured_output:")
                for key, value in llm_output.items():
                    value_preview = str(value)[:100] + "..." if len(str(value)) > 100 else str(value)
                    print(f"       - {key}: {value_preview}")
            else:
                print(f"     • llm_structured_output: None")
        
        # Try to get an unprocessed event for this user to test full context building
        print(f"\n🔄 Testing full context building:")
        try:
            # Get a recent event (not necessarily unprocessed) to test context building
            cur.execute("""
                SELECT id, user_id, session_id, created_at, payload
                FROM low_level_events 
                WHERE user_id = %s AND payload->'payload'->>'type' = 'ui_tree'
                ORDER BY created_at DESC 
                LIMIT 1
            """, (test_user_id,))
            
            event = cur.fetchone()
            if event:
                print(f"   Found event {event[0]} to test context building")
                
                # Build context for this event
                context, context_metadata = build_fresh_context(cur, test_user_id, event)
                
                print(f"\n📈 Context building results:")
                print(f"   • Context fields: {list(context.keys())}")
                print(f"   • Context metadata: {context_metadata}")
                
                # Check if previousAnalyses are now populated correctly
                if 'previousAnalyses' in context:
                    prev_analyses = context['previousAnalyses']
                    print(f"\n🔍 Previous analyses ({len(prev_analyses)} found):")
                    for i, prev_analysis in enumerate(prev_analyses):
                        print(f"     Analysis {i+1}:")
                        for field, value in prev_analysis.items():
                            if field != 'client_timestamp':
                                status = "✅" if value != "Not available in data" else "❌"
                                value_preview = str(value)[:80] + "..." if len(str(value)) > 80 else str(value)
                                print(f"       {status} {field}: {value_preview}")
                else:
                    print("   ❌ No previousAnalyses in context")
                    
            else:
                print("   ❌ No recent events found for this user")
                
        except Exception as e:
            print(f"   ❌ Error building context: {e}")
        
    except Exception as e:
        print(f"❌ Database error: {e}")
        
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

if __name__ == "__main__":
    print("🧪 Testing Sequential Processor Context Building")
    print("=" * 50)
    test_context_building() 