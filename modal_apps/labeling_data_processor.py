import modal
import os
import psycopg2
import json
import requests
from datetime import datetime
import uuid
import time

app = modal.App("labeling-data-processor")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary", "requests")

# --- CANCELLATION PREVENTION NOTES ---
# Modal cancellation requests can occur when:
# 1. Scheduled functions overlap due to long-running processors vs short schedule intervals
# 2. Multiple coordinators try to run simultaneously
# 3. Resource limits are exceeded causing Modal to cancel older instances
# 
# Prevention strategies implemented:
# - Increased schedule from 30min to 90min to prevent overlaps  
# - Reduced processor timeout from 2hrs to 1hr to prevent long-running overlaps
# - Added coordinator locking to prevent multiple instances
# - Added coordinator conflict detection in scheduled_labeling_processing
# --- END CANCELLATION NOTES ---

# Database connection configuration
DB_CONFIG = {
    'host': 'aws-0-us-west-1.pooler.supabase.com',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres.eshwntsgsputksqamckh',
    'password': 'dS64xX6mU3E4Sbyc'
}

# --- Utility Functions (Adapted from sequential_processor.py) ---

def cleanup_expired_labeling_locks(cur, conn):
    """Clean up expired and stale labeling processing locks"""
    try:
        # Clean up expired/completed locks
        cur.execute("""
            DELETE FROM processing_locks 
            WHERE expires_at < NOW() OR status IN ('completed', 'failed')
        """)
        basic_cleanup = cur.rowcount
        
        # Clean up stale labeling locks older than 5 minutes
        cur.execute("""
            DELETE FROM processing_locks 
            WHERE status = 'in_progress' 
              AND processor_id LIKE 'labeler-%'
              AND created_at < NOW() - INTERVAL '5 minutes'
        """)
        stale_cleanup = cur.rowcount
        
        total_cleaned = basic_cleanup + stale_cleanup
        if total_cleaned > 0:
            print(f"🧹 Labeling cleanup: {basic_cleanup} expired + {stale_cleanup} stale = {total_cleaned} total")
        
        conn.commit()
        return total_cleaned
        
    except Exception as e:
        print(f"❌ Failed to cleanup labeling locks: {e}")
        conn.rollback()
        return 0

def get_database_connection():
    """Gets a new database connection."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        return conn
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        raise

def acquire_labeling_lock(cur, conn, user_id, analysis_id, processor_id):
    """Acquires a lock for a specific analysis to prevent duplicate processing."""
    try:
        # We repurpose the event_id column for analysis_id for this processor
        cur.execute("""
            INSERT INTO processing_locks (user_id, event_id, processor_id, status, expires_at)
            VALUES (%s, %s, %s, 'in_progress', NOW() + INTERVAL '10 minutes')
            ON CONFLICT (user_id, event_id) DO NOTHING
            RETURNING id
        """, (user_id, analysis_id, processor_id))  # 10 min expiration for lighter labeling workload
        
        if cur.fetchone():
            conn.commit()
            print(f"🔒 Acquired labeling lock for user {user_id}, analysis {analysis_id}")
            return True
        else:
            print(f"⏭️  Analysis {analysis_id} already being processed.")
            return False
    except Exception as e:
        print(f"❌ Failed to acquire labeling lock: {e}")
        conn.rollback()
        return False

def release_labeling_lock(cur, conn, user_id, analysis_id, processor_id):
    """Deletes the lock for a specific analysis, allowing for future retries."""
    try:
        cur.execute("""
            DELETE FROM processing_locks
            WHERE user_id = %s AND event_id = %s AND processor_id = %s
        """, (user_id, analysis_id, processor_id))
        conn.commit()
    except Exception as e:
        print(f"❌ Failed to release labeling lock: {e}")
        conn.rollback()

def get_ready_to_label_analysis(cur, conn, user_id, processor_id):
    """
    Gets the next analysis for a user that is ready for labeling (has enough future context),
    and acquires a lock for it.
    """
    cur.execute("""
        SELECT * FROM (
            SELECT
                id,
                user_id,
                client_timestamp,
                llm_structured_output,
                window_title,
                -- This window function counts how many analyses exist AFTER the current one for this user
                COUNT(*) OVER (PARTITION BY user_id ORDER BY client_timestamp ROWS BETWEEN 1 FOLLOWING AND 10 FOLLOWING) as future_event_count
            FROM
                low_level_workflow_analyses
            WHERE
                label_status = 'pending' AND user_id = %s AND llm_structured_output IS NOT NULL
        ) AS subquery
        -- Only select rows that have at least 10 future events
        WHERE future_event_count >= 10
        AND NOT EXISTS ( -- And that are not currently locked by another process
            SELECT 1 FROM processing_locks
            WHERE event_id = subquery.id AND user_id::uuid = subquery.user_id AND status = 'in_progress' AND expires_at > NOW()
        )
        ORDER BY client_timestamp ASC
        LIMIT 1;
    """, (user_id,))
    
    analysis = cur.fetchone()
    if not analysis:
        return None

    # We get a 6-column result from the query now
    analysis_id, user_id, client_timestamp, llm_structured_output, window_title, _ = analysis
    
    if acquire_labeling_lock(cur, conn, user_id, analysis_id, processor_id):
        return (analysis_id, user_id, client_timestamp, llm_structured_output, window_title)
    else:
        # Could not get lock, so it's being processed by another instance.
        return None

def get_neighbor_analyses(cur, user_id, target_timestamp, limit=10):
    """
    Fetches the full, unmodified llm_structured_output and timestamp of neighboring analyses.
    """
    
    def fetch_and_format(query, params):
        cur.execute(query, params)
        results = []
        for row in cur.fetchall():
            timestamp, analysis_json, window_title = row
            if not analysis_json:
                continue

            # Construct a complete analysis object for the neighbor
            formatted_analysis = {
                "client_timestamp": timestamp.isoformat(),
                "window_title": window_title,
                **(analysis_json or {})
            }
            results.append({
                "timestamp": timestamp.isoformat(),
                "analysis": formatted_analysis
            })
        return results

    # Analyses before the target
    before_query = """
        SELECT client_timestamp, llm_structured_output, window_title FROM low_level_workflow_analyses
        WHERE user_id = %s AND client_timestamp < %s
        ORDER BY client_timestamp DESC LIMIT %s
    """
    before_analyses = fetch_and_format(before_query, (user_id, target_timestamp, limit))

    # Analyses after the target
    after_query = """
        SELECT client_timestamp, llm_structured_output, window_title FROM low_level_workflow_analyses
        WHERE user_id = %s AND client_timestamp > %s
        ORDER BY client_timestamp ASC LIMIT %s
    """
    after_analyses = fetch_and_format(after_query, (user_id, target_timestamp, limit))

    return before_analyses + after_analyses

# --- Main Processing Logic ---

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=3600, # 1 hour (reduced from 2 hours to prevent overlaps)
    retries=0
)
def process_all_labels_for_user(user_id: str):
    """
    Processes all analyses for a single user sequentially to generate labeling data.
    """
    processor_id = f"labeler-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    print(f"🚀 Starting labeling processor {processor_id} for user: {user_id}")
    
    conn, cur = None, None
    total_processed = 0
    
    try:
        conn = get_database_connection()
        cur = conn.cursor()

        while True:
            analysis = get_ready_to_label_analysis(cur, conn, user_id, processor_id)
            
            if not analysis:
                print(f"✅ No more analyses to label for user: {user_id}")
                break
                
            analysis_id, user_id, client_timestamp, target_analysis_data, window_title = analysis
            print(f"🔄 Processing label for analysis {analysis_id}...")
            
            # Inner loop for retries, mirroring the sequential_processor
            retries = 0
            max_retries = 5
            base_retry_delay_seconds = 15 # Shorter delay for this lighter task
            processed_or_failed = False

            while not processed_or_failed and retries < max_retries:
                try:
                    # The query now returns 5 columns, including the window title
                    analysis_id, user_id, client_timestamp, target_analysis_data, window_title = analysis

                    neighbor_analyses = get_neighbor_analyses(cur, user_id, client_timestamp)
                    
                    # Construct the context object correctly, including all necessary fields
                    context = {
                        "targetAnalysis": {
                            "client_timestamp": client_timestamp.isoformat(),
                            "window_title": window_title,
                            **(target_analysis_data or {}) # Unpack the JSON blob
                        },
                        "neighborAnalyses": neighbor_analyses
                    }

                    # Generate context statistics for logging
                    neighbor_count = len(neighbor_analyses)
                    if neighbor_count > 0:
                        # Calculate average character counts per field
                        field_stats = {}
                        common_fields = ['step_title', 'step_summary', 'user_intent', 'what_was_clicked', 'what_was_typed', 'how_content_changed', 'events_that_happened', 'results_if_any']
                        
                        for field in common_fields:
                            values = []
                            for neighbor in neighbor_analyses:
                                if 'analysis' in neighbor and field in neighbor['analysis'] and neighbor['analysis'][field]:
                                    if neighbor['analysis'][field] != "Not available in data":
                                        values.append(len(str(neighbor['analysis'][field])))
                            
                            if values:
                                field_stats[field] = {
                                    'count': len(values),
                                    'avg_chars': round(sum(values) / len(values), 1),
                                    'min_chars': min(values),
                                    'max_chars': max(values)
                                }
                        
                        print(f"🧠 Context stats for LLM (analysis ID: {analysis_id}):")
                        print(f"   📊 Neighbors: {neighbor_count} analyses")
                        print(f"   📈 Field statistics (avg/min/max chars, count):")
                        for field, stats in field_stats.items():
                            print(f"      • {field}: {stats['avg_chars']}/{stats['min_chars']}/{stats['max_chars']} chars ({stats['count']} samples)")
                        
                        # Show target analysis summary
                        target_title = target_analysis_data.get('step_title', 'N/A') if target_analysis_data else 'N/A'
                        target_summary_len = len(target_analysis_data.get('step_summary', '')) if target_analysis_data and target_analysis_data.get('step_summary') else 0
                        print(f"   🎯 Target analysis: '{target_title}' ({target_summary_len} chars summary)")
                    else:
                        print(f"🧠 Context for LLM (analysis ID: {analysis_id}): No neighbor analyses available")

                    # Call the updated API to get the single best label
                    response = requests.post(
                        "https://app.mediar.ai/api/suggest-workflow-labels",
                        json={ 'model': 'gemini-2.5-pro', 'context': context },  # Default model (was: gemini-2.5-pro-preview-06-05)
                        headers={'Content-Type': 'application/json'},
                        timeout=300
                    )

                    # Handle 429 rate limit with backoff
                    if response.status_code == 429:
                        retries += 1
                        import random
                        delay = (base_retry_delay_seconds * (2 ** retries)) + random.uniform(0, 5)
                        print(f"🚨 Rate limit (429) detected for analysis {analysis_id}. Retrying in {delay:.1f}s... (Attempt {retries}/{max_retries})")
                        time.sleep(delay)
                        continue # Retry the same analysis
                    else:
                        response.raise_for_status()

                    label = response.json().get('label')
                    print(f"📝 LLM Response (label): '{label}'")
                    
                    # Save the generated label
                    if label:
                        # We also need to update the label_status in the original analysis table
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

                        total_processed += 1
                        print(f"✅ Successfully generated and saved label for analysis {analysis_id}")
                    else:
                        print(f"⚠️ No label generated for analysis {analysis_id}, marking as failed.")
                    
                    processed_or_failed = True

                except Exception as e:
                    print(f"❌ Error processing label for analysis {analysis_id}: {e}")
                    processed_or_failed = True # Mark as failed to stop retrying
                finally:
                    # Only release lock if the event was processed or retries were exhausted
                    if processed_or_failed or retries >= max_retries:
                         release_labeling_lock(cur, conn, user_id, analysis_id, processor_id)
                
        return { "success": True, "user_id": user_id, "labels_generated": total_processed }

    except Exception as e:
        print(f"❌ Major error in labeling processor for user {user_id}: {e}")
        return { "success": False, "error": str(e) }
    finally:
        if cur: cur.close()
        if conn: conn.close()

# --- Dispatcher and Scheduler ---

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=1800 # 30 minutes
)
def trigger_labeling_for_all_users():
    """
    Finds all users with analyses ready for labeling and triggers a parallel
    processor for each one.
    """
    coordinator_id = f"label-coordinator-{uuid.uuid4().hex[:8]}-{int(time.time())}"
    print(f"🎯 Starting Labeling Coordinator {coordinator_id}")
    
    conn, cur = None, None
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        
        # Acquire coordinator lock to prevent multiple instances
        try:
            cur.execute("""
                INSERT INTO processing_locks (user_id, event_id, processor_id, status, expires_at)
                VALUES ('label-coordinator', 0, %s, 'in_progress', NOW() + INTERVAL '30 minutes')
                ON CONFLICT (user_id, event_id) DO NOTHING
                RETURNING id
            """, (coordinator_id,))
            
            if not cur.fetchone():
                print(f"⏸️  Another labeling coordinator is already running, skipping")
                return {"success": True, "message": "Skipped due to active coordinator", "coordinator_id": coordinator_id}
            
            conn.commit()
            print(f"🔒 Acquired labeling coordinator lock: {coordinator_id}")
        except Exception as lock_error:
            print(f"❌ Failed to acquire coordinator lock: {lock_error}")
            return {"success": False, "error": f"Failed to acquire coordinator lock: {lock_error}"}

        # Clean up expired locks first
        cleanup_expired_labeling_locks(cur, conn)

        # Find users who have analyses that are ready for labeling
        cur.execute("""
            SELECT DISTINCT analysis.user_id::text
            FROM
                low_level_workflow_analyses AS analysis
            WHERE
                analysis.label_status = 'pending'
                AND NOT EXISTS ( -- Not currently being processed by another labeler
                    SELECT 1 FROM processing_locks
                    WHERE event_id = analysis.id 
                    AND user_id NOT LIKE '%coordinator%'  -- Fix: Filter out coordinator locks before UUID casting
                    AND user_id::uuid = analysis.user_id 
                    AND status = 'in_progress' 
                    AND expires_at > NOW()
                );
        """)
        
        users_to_process = [row[0] for row in cur.fetchall()]
        print(f"📋 Found {len(users_to_process)} users with analyses to label.")
        
        # Limit concurrent processing to avoid overwhelming the system
        MAX_CONCURRENT_USERS = 10  # Process up to 10 users simultaneously
        if len(users_to_process) > MAX_CONCURRENT_USERS:
            print(f"⚠️ Limiting to {MAX_CONCURRENT_USERS} concurrent users (found {len(users_to_process)})")
            users_to_process = users_to_process[:MAX_CONCURRENT_USERS]
        
        # Create all remote calls WITHOUT waiting for them to start
        print(f"🚀 Preparing {len(users_to_process)} processors for parallel launch...")
        
        # Collect all remote calls first (this is fast and non-blocking)
        remote_calls = []
        for user_id in users_to_process:
            print(f"  📋 Queueing processor for user: {user_id[:8]}...")
            try:
                # Try spawn first for non-blocking parallel execution
                remote_calls.append(process_all_labels_for_user.spawn(user_id))
            except Exception as e:
                print(f"  ⚠️ Spawn failed, using remote for user {user_id[:8]}...: {e}")
                # Fall back to remote() if spawn fails
                remote_calls.append(process_all_labels_for_user.remote(user_id))
        
        print(f"🔥 ALL {len(remote_calls)} PROCESSORS QUEUED - Launching in parallel NOW!")
        
        # Now all processors will launch simultaneously
        # The spawn() method returns immediately without waiting
        
        # Give a moment for all processors to initialize
        time.sleep(2)
        
        # Verify processors are starting (optional status check)
        active_count = 0
        try:
            cur.execute("""
                SELECT COUNT(*) FROM processing_locks 
                WHERE processor_id LIKE 'labeler-%' 
                AND status = 'in_progress' 
                AND expires_at > NOW()
                AND created_at > NOW() - INTERVAL '2 minutes'
            """)
            active_count = cur.fetchone()[0]
            print(f"📊 Verification: {active_count} processors now active (launched in last 2 minutes)")
        except Exception as e:
            print(f"⚠️ Could not verify processor status: {e}")
        
        # Release coordinator lock
        try:
            cur.execute("""
                DELETE FROM processing_locks 
                WHERE user_id = 'label-coordinator' AND event_id = 0 AND processor_id = %s
            """, (coordinator_id,))
            conn.commit()
            print(f"🔓 Released labeling coordinator lock: {coordinator_id}")
        except Exception as unlock_error:
            print(f"❌ Failed to release coordinator lock: {unlock_error}")
            
        return { 
            "success": True, 
            "users_found": len(users_to_process),
            "processors_dispatched": len(remote_calls),
            "processors_active": active_count,
            "launch_method": "spawn_parallel"
        }

    except Exception as e:
        print(f"❌ Error in Labeling Coordinator: {e}")
        
        # Release coordinator lock on error
        try:
            if cur and conn:
                cur.execute("""
                    DELETE FROM processing_locks 
                    WHERE user_id = 'label-coordinator' AND event_id = 0 AND processor_id = %s
                """, (coordinator_id,))
                conn.commit()
                print(f"🔓 Released coordinator lock on error: {coordinator_id}")
        except Exception as unlock_error:
            print(f"❌ Failed to release coordinator lock on error: {unlock_error}")
        
        return { "success": False, "error": str(e) }
    finally:
        if cur: cur.close()
        if conn: conn.close()
        
@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    schedule=modal.Period(minutes=90),  # Increased from 30 to 90 minutes to prevent overlaps
    timeout=600
)
def scheduled_labeling_processing():
    """Periodically triggers the labeling process for all users every 90 minutes."""
    print("⏰ Starting scheduled labeling processing...")
    
    try:
        # Check if any labeling coordinators are already running to prevent conflicts
        conn = get_database_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT COUNT(*) FROM processing_locks 
            WHERE processor_id LIKE 'label-coordinator-%' 
            AND status = 'in_progress' 
            AND expires_at > NOW()
        """)
        coordinator_count = cur.fetchone()[0]
        
        if coordinator_count > 0:
            print(f"⏸️  Labeling coordinator already running ({coordinator_count} active), skipping to prevent conflicts")
            cur.close()
            conn.close()
            return {"success": True, "message": "Skipped due to active coordinator", "active_coordinators": coordinator_count}
        
        cur.close()
        conn.close()
        
        result = trigger_labeling_for_all_users.remote()
        return result
    except Exception as e:
        print(f"❌ Error in scheduled labeling processing: {e}")
        return {"success": False, "error": str(e)} 