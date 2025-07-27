import modal
import os
import psycopg2
import json
import requests
from datetime import datetime
import uuid
import time

app = modal.App("simplified-labeling-processor")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary", "requests")

# Database connection configuration
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': '***REMOVED***'
}

def get_database_connection():
    """Get a database connection using the configuration."""
    return psycopg2.connect(**DB_CONFIG)

def get_next_analysis_for_labeling(cur, user_id, processor_id):
    """Get the next analysis that needs labeling for a specific user."""
    try:
        # Simple approach: get pending analysis and create a lock immediately
        cur.execute("""
            SELECT id, user_id, client_timestamp, llm_structured_output, window_title, session_id
            FROM low_level_workflow_analyses
            WHERE user_id = %s 
            AND label_status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED;
        """, (user_id,))
        
        analysis = cur.fetchone()
        if not analysis:
            return None
            
        analysis_id = analysis[0]
        
        # Create simple lock for this analysis
        cur.execute("""
            INSERT INTO processing_locks (user_id, event_id, processor_id, status, expires_at)
            VALUES (%s, %s, %s, 'in_progress', NOW() + INTERVAL '10 minutes')
            ON CONFLICT (user_id, event_id) DO NOTHING
            RETURNING id;
        """, (user_id, analysis_id, processor_id))
        
        if cur.fetchone():
            return analysis
        else:
            return None  # Lock conflict, skip this analysis
            
    except Exception as e:
        print(f"Error getting analysis for labeling: {e}")
        return None

def release_lock(cur, conn, user_id, analysis_id, processor_id):
    """Release the processing lock."""
    try:
        cur.execute("""
            DELETE FROM processing_locks 
            WHERE user_id = %s AND event_id = %s AND processor_id = %s
        """, (user_id, analysis_id, processor_id))
        conn.commit()
    except Exception as e:
        print(f"Error releasing lock: {e}")

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=600  # 10 minutes
)
def process_user_labeling(user_id: str):
    """Process labeling for a single user - simplified version."""
    processor_id = f"simple-labeler-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    print(f"🚀 Starting simplified labeling for user: {user_id[:8]}...")
    
    conn, cur = None, None
    processed_count = 0
    
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Process up to 10 analyses per user to avoid long-running functions
        for i in range(10):
            analysis = get_next_analysis_for_labeling(cur, user_id, processor_id)
            
            if not analysis:
                break
                
            analysis_id, user_id, client_timestamp, analysis_data, window_title, session_id = analysis
            print(f"🔄 Processing analysis {analysis_id}...")
            
            try:
                # Create context for labeling
                context = {
                    'targetAnalysis': analysis_data,
                    'neighborAnalyses': []  # Simplified - no neighbor context for speed
                }
                
                # Call labeling API
                response = requests.post(
                    "https://app.mediar.ai/api/suggest-workflow-labels",
                    json={'model': 'gemini-2.5-pro', 'context': context},
                    headers={'Content-Type': 'application/json'},
                    timeout=60  # 1 minute timeout
                )
                
                if response.status_code == 200:
                    result = response.json()
                    label = result.get('label')
                    
                    if label:
                        # Update analysis status and save label
                        cur.execute("""
                            UPDATE low_level_workflow_analyses
                            SET label_status = 'completed'
                            WHERE id = %s;
                        """, (analysis_id,))
                        
                        cur.execute("""
                            INSERT INTO low_level_workflow_labeling (user_id, low_level_workflow_analysis_id, selected_labels)
                            VALUES (%s, %s, %s)
                            ON CONFLICT (low_level_workflow_analysis_id) DO UPDATE
                            SET selected_labels = EXCLUDED.selected_labels;
                        """, (user_id, analysis_id, [label]))
                        
                        conn.commit()
                        processed_count += 1
                        print(f"✅ Successfully processed analysis {analysis_id}")
                    else:
                        print(f"⚠️ No label generated for analysis {analysis_id}")
                        
                else:
                    print(f"❌ API error {response.status_code} for analysis {analysis_id}")
                    
            except Exception as e:
                print(f"❌ Error processing analysis {analysis_id}: {e}")
            finally:
                # Always release the lock
                release_lock(cur, conn, user_id, analysis_id, processor_id)
        
        print(f"✅ Completed labeling for user {user_id[:8]}... - processed {processed_count} analyses")
        return {"success": True, "user_id": user_id, "processed": processed_count}
        
    except Exception as e:
        print(f"❌ Error in user labeling processor: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=300  # 5 minutes
)
def trigger_simplified_labeling():
    """Trigger labeling for all users with pending analyses - simplified approach."""
    print("🎯 Starting simplified labeling coordinator")
    
    conn, cur = None, None
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Get all users with pending analyses
        cur.execute("""
            SELECT DISTINCT user_id
            FROM low_level_workflow_analyses
            WHERE label_status = 'pending'
            AND user_id IS NOT NULL
            ORDER BY user_id
            LIMIT 20;  -- Process max 20 users at once
        """)
        
        users = cur.fetchall()
        print(f"📋 Found {len(users)} users with pending analyses")
        
        if not users:
            print("✅ No users with pending analyses")
            return {"success": True, "message": "No pending work"}
        
        # Launch processors for each user in parallel
        remote_calls = []
        for user_row in users:
            user_id = user_row[0]
            print(f"  📋 Queueing processor for user: {user_id[:8]}...")
            try:
                remote_calls.append(process_user_labeling.spawn(user_id))
            except Exception as e:
                print(f"  ⚠️ Failed to spawn processor for user {user_id[:8]}...: {e}")
        
        print(f"🔥 Launched {len(remote_calls)} processors in parallel")
        return {"success": True, "processors_launched": len(remote_calls)}
        
    except Exception as e:
        print(f"❌ Error in simplified coordinator: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if conn:
            conn.close()

# SIMPLIFIED SCHEDULED FUNCTION - No complex coordinator locking
@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    schedule=modal.Period(minutes=5),  # Every 5 minutes instead of 1
    timeout=60  # 1 minute timeout
)
def simple_scheduled_labeling():
    """
    Simplified scheduled labeling - no coordinator locks, just direct execution.
    Runs every 5 minutes to reduce conflicts.
    """
    print("⏰ Simple scheduled labeling started")
    
    try:
        # Direct call - no complex coordination
        result = trigger_simplified_labeling.remote()
        print(f"✅ Triggered labeling coordinator: {result}")
        return {"success": True, "triggered_at": datetime.utcnow().isoformat()}
    except Exception as e:
        print(f"❌ Error in simple scheduled labeling: {e}")
        return {"success": False, "error": str(e)}

# Manual trigger function for testing
@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=300
)
def manual_trigger_labeling():
    """Manual trigger for testing the simplified labeling system."""
    print("🔧 Manual labeling trigger activated")
    result = trigger_simplified_labeling.remote()
    return result 