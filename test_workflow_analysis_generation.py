#!/usr/bin/env python3
"""
Test script that generates a workflow analysis and posts it via API
This tests the complete flow: generate analysis -> save to DB -> update session metadata
"""

import os
import sys
import json
import uuid
import requests
import time
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor

def get_db_connection():
    """Get database connection using environment variables"""
    # Read from .env.local file
    env_vars = {}
    try:
        with open('.env.local', 'r') as f:
            for line in f:
                if '=' in line and not line.strip().startswith('#'):
                    key, value = line.strip().split('=', 1)
                    env_vars[key] = value
    except FileNotFoundError:
        print("❌ .env.local file not found")
        return None

    try:
        # Use the connection string from environment
        conn_string = env_vars.get('SUPABASE_CONN_STRING', '')
        if conn_string:
            conn = psycopg2.connect(conn_string)
            return conn
        else:
            print("❌ SUPABASE_CONN_STRING not found in .env.local")
            return None
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return None

def get_real_event_context(conn, user_id, limit=5):
    """Get real event context for generating workflow analysis"""
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get recent events for context
            cur.execute("""
                SELECT e.id, e.user_id, e.session_id, e.created_at, e.payload
                FROM low_level_events e
                WHERE e.user_id = %s 
                AND e.session_id IS NOT NULL
                ORDER BY e.created_at DESC
                LIMIT %s
            """, (user_id, limit))
            
            events = cur.fetchall()
            return [dict(event) for event in events]
    except Exception as e:
        print(f"❌ Error fetching event context: {e}")
        return []

def get_existing_analyses(conn, user_id, limit=3):
    """Get existing analyses for context"""
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, session_id, client_timestamp, llm_structured_output
                FROM low_level_workflow_analyses
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (user_id, limit))
            
            analyses = cur.fetchall()
            return [dict(analysis) for analysis in analyses]
    except Exception as e:
        print(f"❌ Error fetching existing analyses: {e}")
        return []

def build_analysis_context(events, existing_analyses):
    """Build context for workflow analysis generation"""
    context = {
        "events": [],
        "previousAnalyses": [],
        "currentUiTree": None,
        "previousUiTree": None,
        "eventsSincePreviousUiTreeByTimestamp": [],
        "eventsSincePreviousUiTreeBySameWindow": [],
        "uiTreeDiffLatestVsPreviousForTheSameWindow": None
    }
    
    # Process events
    for event in events:
        if event.get('payload'):
            context["events"].append({
                "id": event["id"],
                "timestamp": event["created_at"].isoformat() if event["created_at"] else None,
                "event_type": event["payload"].get("event_type", "unknown"),
                "payload": event["payload"]
            })
    
    # Process existing analyses
    for analysis in existing_analyses:
        if analysis.get('llm_structured_output'):
            output = analysis['llm_structured_output']
            context["previousAnalyses"].append({
                "step_title": output.get("step_title", "Unknown Step"),
                "step_summary": output.get("step_summary", "No summary"),
                "user_intent": output.get("user_intent", "Unknown intent"),
                "what_was_clicked": output.get("what_was_clicked", "Nothing"),
                "what_was_typed": output.get("what_was_typed", "Nothing"),
                "how_content_changed": output.get("how_content_changed", "No change"),
                "events_that_happened": output.get("events_that_happened", "No events"),
                "results_if_any": output.get("results_if_any", "No results"),
                "client_timestamp": analysis["client_timestamp"].isoformat() if analysis["client_timestamp"] else None
            })
    
    return context

def generate_workflow_analysis_via_api(context, model="gemini-2.5-pro"):
    """Generate workflow analysis using the API endpoint"""
    print(f"🧪 Generating workflow analysis using model: {model}")
    
    try:
        # Use the process-workflow-step API endpoint (localhost for testing)
        response = requests.post(
            "http://localhost:3001/api/process-workflow-step",
            json={
                "prompt": "WORKFLOW_STEP_ANALYSIS_V2_PROMPT",  # This is the prompt key
                "context": context,
                "model": model
            },
            headers={'Content-Type': 'application/json'},
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            structured_output = result.get('structured_output')
            if structured_output:
                print(f"✅ Successfully generated workflow analysis")
                print(f"📝 Analysis preview: {structured_output.get('step_title', 'No title')}")
                return structured_output
            else:
                print(f"❌ No structured output in response: {result}")
                return None
        else:
            print(f"❌ API call failed: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Error generating workflow analysis: {e}")
        return None

def save_analysis_via_api(user_id, session_id, client_timestamp, analysis):
    """Save workflow analysis using the API endpoint"""
    print(f"💾 Saving workflow analysis via API...")
    
    try:
        response = requests.post(
            "http://localhost:3001/api/save-llm-analysis",
            json={
                "userId": user_id,
                "sessionId": session_id,
                "clientTimestamp": client_timestamp,
                "analysis": analysis
            },
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Successfully saved workflow analysis via API")
            return True
        else:
            print(f"❌ Save API call failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error saving workflow analysis: {e}")
        return False

def verify_session_metadata_update(conn, session_id, expected_increment=1):
    """Verify that session metadata was updated correctly"""
    print(f"🔍 Verifying session metadata update for session: {session_id}")
    
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get session metadata
            cur.execute("""
                SELECT session_id, user_id, processed_event_count, 
                       total_workflow_analyses, session_type
                FROM session_metadata 
                WHERE session_id = %s
            """, (session_id,))
            
            session_meta = cur.fetchone()
            if session_meta:
                meta_dict = dict(session_meta)
                print(f"📊 Session metadata: {meta_dict}")
                
                # Check if session_type is properly set
                if meta_dict['session_type'] is None:
                    print("❌ ERROR: session_type is still NULL!")
                    return False
                else:
                    print(f"✅ session_type correctly set to: {meta_dict['session_type']}")
                
                # Check if processed_event_count was incremented
                processed_count = meta_dict['processed_event_count'] or 0
                workflow_analyses = meta_dict['total_workflow_analyses'] or 0
                
                print(f"📈 Processed events: {processed_count}, Workflow analyses: {workflow_analyses}")
                
                if workflow_analyses > 0:
                    print("✅ Session metadata updated correctly")
                    return True
                else:
                    print("❌ Session metadata not updated (no workflow analyses recorded)")
                    return False
            else:
                print("❌ ERROR: No session metadata found!")
                return False
                
    except Exception as e:
        print(f"❌ Error verifying session metadata: {e}")
        return False

def cleanup_test_analysis(conn, user_id, client_timestamp):
    """Clean up test analysis data"""
    try:
        with conn.cursor() as cur:
            # Remove test workflow analysis
            cur.execute("""
                DELETE FROM low_level_workflow_analyses 
                WHERE user_id = %s AND client_timestamp = %s
            """, (user_id, client_timestamp))
            
            conn.commit()
            print("🧹 Test analysis cleaned up")
    except Exception as e:
        print(f"⚠️  Cleanup warning: {e}")

def test_complete_workflow_analysis_flow():
    """Test the complete workflow analysis generation and saving flow"""
    print("🚀 Starting complete workflow analysis flow test...")
    
    # Get database connection
    conn = get_db_connection()
    if not conn:
        print("❌ Cannot connect to database")
        return False
    
    try:
        # Use a known user ID with existing data
        test_user_id = "942cf301-e977-707d-942c-f301e977707d"
        
        # Get real event context
        print("📊 Fetching real event context...")
        events = get_real_event_context(conn, test_user_id, limit=5)
        
        if not events:
            print("❌ No events found for test user")
            return False
        
        # Use the most recent event's session
        test_session_id = events[0]['session_id']
        test_timestamp = datetime.now(timezone.utc).isoformat()
        
        print(f"📝 Testing with session {test_session_id}")
        
        # Get existing analyses for context
        print("📋 Fetching existing analyses for context...")
        existing_analyses = get_existing_analyses(conn, test_user_id, limit=3)
        
        # Build analysis context
        print("🔧 Building analysis context...")
        context = build_analysis_context(events, existing_analyses)
        
        # Generate workflow analysis via API
        print("🧠 Generating workflow analysis...")
        analysis = generate_workflow_analysis_via_api(context, model="gemini-2.5-pro")
        
        if not analysis:
            print("❌ Failed to generate workflow analysis")
            return False
        
        # Save analysis via API
        print("💾 Saving workflow analysis...")
        save_success = save_analysis_via_api(
            test_user_id, 
            test_session_id, 
            test_timestamp, 
            analysis
        )
        
        if not save_success:
            print("❌ Failed to save workflow analysis")
            return False
        
        # Wait a moment for database triggers to process
        print("⏳ Waiting for database triggers to process...")
        time.sleep(2)
        
        # Verify session metadata was updated
        print("🔍 Verifying session metadata update...")
        metadata_updated = verify_session_metadata_update(conn, test_session_id)
        
        # Cleanup test data
        cleanup_test_analysis(conn, test_user_id, test_timestamp)
        
        if metadata_updated:
            print("\n🎉 TEST PASSED: Complete workflow analysis flow working!")
            return True
        else:
            print("\n❌ TEST FAILED: Session metadata not updated correctly")
            return False
            
    finally:
        conn.close()

def main():
    """Main test function"""
    success = test_complete_workflow_analysis_flow()
    return success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 