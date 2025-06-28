#!/usr/bin/env python3
"""
Test script that mimics the sequential processor with real data
This will test if the database session_type fix actually works
"""

import os
import sys
import json
import uuid
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

# Add the modal-apps directory to the path so we can import the processor
sys.path.append('modal-apps')

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
        # Use the direct connection parameters
        conn = psycopg2.connect(
            host="aws-0-us-west-1.pooler.supabase.com",
            database="postgres", 
            user="postgres.zxfvnlziaxekbsbwxgzj",
            password=env_vars.get('SUPABASE_DB_PASSWORD', ''),
            port=6543
        )
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return None

def get_real_event_data(conn, limit=1):
    """Get real event data from the database"""
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get a real unprocessed event
            cur.execute("""
                SELECT e.id, e.user_id, e.session_id, e.created_at, e.payload
                FROM low_level_events e
                WHERE e.session_id IS NOT NULL 
                AND e.user_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM low_level_workflow_analyses a 
                    WHERE a.user_id = e.user_id AND a.client_timestamp = e.created_at
                )
                ORDER BY e.created_at DESC
                LIMIT %s
            """, (limit,))
            
            events = cur.fetchall()
            return [dict(event) for event in events]
    except Exception as e:
        print(f"❌ Error fetching real event data: {e}")
        return []

def test_llm_analysis(event_data):
    """Test LLM analysis with real event data"""
    print(f"🧪 Testing LLM analysis for event {event_data['id']}")
    
    # Mock LLM response structure (based on the real logs you showed)
    llm_response = {
        "events_that_happened": f"Test event analysis for event {event_data['id']}",
        "how_content_changed": "Content changed during test analysis",
        "results_if_any": "Test results generated",
        "step_summary": f"Test step summary for event {event_data['id']}",
        "step_title": "Test Event Analysis",
        "user_intent": "Test user intent analysis",
        "what_was_clicked": "Test click element",
        "what_was_typed": "Test typed content"
    }
    
    return llm_response

def test_database_insert(conn, event_data, llm_response):
    """Test inserting workflow analysis into database"""
    try:
        with conn.cursor() as cur:
            # Extract window title from payload if available
            window_title = "Test Window"
            if event_data.get('payload') and isinstance(event_data['payload'], dict):
                payload = event_data['payload']
                if 'payload' in payload and 'window_name' in payload['payload']:
                    window_title = payload['payload']['window_name']
            
            print(f"💾 Testing database insert for session: {event_data['session_id']}")
            
            # This is the critical test - insert workflow analysis
            # This should trigger our fixed database function
            cur.execute("""
                INSERT INTO low_level_workflow_analyses 
                (user_id, session_id, client_timestamp, llm_structured_output, window_title)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (
                event_data['user_id'],
                event_data['session_id'], 
                event_data['created_at'],
                json.dumps(llm_response),
                window_title
            ))
            
            analysis_id = cur.fetchone()[0]
            conn.commit()
            
            print(f"✅ Successfully inserted workflow analysis {analysis_id}")
            
            # Check if session_metadata was created/updated correctly
            cur.execute("""
                SELECT session_id, user_id, processed_event_count, session_type
                FROM session_metadata 
                WHERE session_id = %s
            """, (event_data['session_id'],))
            
            session_meta = cur.fetchone()
            if session_meta:
                print(f"✅ Session metadata updated: {dict(zip(['session_id', 'user_id', 'processed_event_count', 'session_type'], session_meta))}")
                
                if session_meta[3] is None:  # session_type is None
                    print("❌ ERROR: session_type is still NULL!")
                    return False
                else:
                    print(f"✅ session_type correctly set to: {session_meta[3]}")
                    return True
            else:
                print("❌ ERROR: No session metadata found!")
                return False
                
    except Exception as e:
        print(f"❌ Database insert failed: {e}")
        conn.rollback()
        return False

def cleanup_test_data(conn, event_data):
    """Clean up test data"""
    try:
        with conn.cursor() as cur:
            # Remove test workflow analysis
            cur.execute("""
                DELETE FROM low_level_workflow_analyses 
                WHERE session_id = %s AND window_title = 'Test Window'
            """, (event_data['session_id'],))
            
            # Note: We don't delete session_metadata as it might be used by other real data
            conn.commit()
            print("🧹 Test data cleaned up")
    except Exception as e:
        print(f"⚠️  Cleanup warning: {e}")

def main():
    print("🚀 Starting sequential processor database test...")
    
    # Get database connection
    conn = get_db_connection()
    if not conn:
        print("❌ Cannot connect to database")
        return False
    
    try:
        # Get real event data
        print("📊 Fetching real event data...")
        events = get_real_event_data(conn, limit=1)
        
        if not events:
            print("❌ No unprocessed events found for testing")
            return False
        
        event_data = events[0]
        print(f"📝 Testing with event {event_data['id']} from session {event_data['session_id']}")
        
        # Test LLM analysis
        llm_response = test_llm_analysis(event_data)
        
        # Test database insert (the critical part)
        success = test_database_insert(conn, event_data, llm_response)
        
        # Cleanup
        cleanup_test_data(conn, event_data)
        
        if success:
            print("\n🎉 TEST PASSED: Database session_type fix is working!")
            return True
        else:
            print("\n❌ TEST FAILED: Database session_type fix needs more work")
            return False
            
    finally:
        conn.close()

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 