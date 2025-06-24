import modal
import os
import psycopg2
import json
from datetime import datetime

# Import all the functions from producer.py
from producer import (
    get_current_event, get_previous_ui_tree_by_timestamp, get_window_title,
    get_previous_same_window_ui_tree, get_events_between_timestamps,
    get_screenshots_near_timestamp, get_recent_analyses, build_context_for_event,
    generate_simplified_ui_tree_string, generate_event_summary_string,
    get_screenshot_for_ui_tree_event
)

app = modal.App("test-producer-10-steps")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary")

# Copy the functions directly instead of importing
def generate_simplified_ui_tree_string(ui_tree_str):
    """Generate simplified UI tree string from raw UI tree JSON"""
    if not ui_tree_str:
        return None
    try:
        import json
        tree = json.loads(ui_tree_str)
        # Simplified version - just return a summary
        return f"UI Tree with {len(str(tree))} characters"
    except:
        return "Invalid UI tree"

def generate_event_summary_string(event):
    """Generate event summary string"""
    try:
        payload = event[3] if len(event) >= 4 else {}
        event_type = payload.get('payload', {}).get('type', 'unknown')
        return f"{event_type} at {event[2]}"
    except:
        return "Unknown event"

def get_screenshot_for_ui_tree_event(cursor, user_id, session_id, ui_tree_timestamp, time_window_seconds=3):
    """Find screenshot_diff event closest to the UI tree timestamp within time window"""
    try:
        from datetime import datetime, timedelta
        
        if isinstance(ui_tree_timestamp, str):
            ui_tree_time = datetime.fromisoformat(ui_tree_timestamp.replace('Z', '+00:00'))
        else:
            ui_tree_time = ui_tree_timestamp
        
        # Define time bounds
        before_bound = ui_tree_time - timedelta(seconds=time_window_seconds)
        after_bound = ui_tree_time + timedelta(seconds=time_window_seconds)
        
        # Query for screenshot_diff events within time bounds
        cursor.execute("""
            SELECT id, session_id, created_at, payload
            FROM low_level_events 
            WHERE user_id = %s 
            AND session_id = %s
            AND payload->'payload'->>'type' = 'screenshot_diff'
            AND created_at BETWEEN %s AND %s
            ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - %s)))
            LIMIT 1;
        """, (user_id, session_id, before_bound, after_bound, ui_tree_time))
        
        screenshot_event = cursor.fetchone()
        if not screenshot_event:
            return None
            
        # Extract the 'after' screenshot from the event
        screenshot_payload = screenshot_event[3]  # payload column
        screenshot_diff = screenshot_payload.get('payload', {}).get('event', {}).get('screenshot_diff', {})
        after_screenshot = screenshot_diff.get('after')
        
        if after_screenshot and len(after_screenshot) > 1000:  # Valid base64 data
            return after_screenshot
            
        return None
        
    except Exception as e:
        print(f"Error getting screenshot for UI tree event: {e}")
        return None

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=1800
)
def test_10_steps():
    print("Testing producer for exactly 10 steps...")
    conn = None
    try:
        conn = psycopg2.connect(os.environ["SUPABASE_CONN_STRING"])
        cur = conn.cursor()

        # Test with our known user
        test_user_id = "29303245-5cbb-671e-2930-32455cbb671e"
        
        print(f"Getting unprocessed events for test user: {test_user_id}")
        
        # Get unprocessed events for test user
        cur.execute("""
            SELECT id, user_id, session_id, created_at, payload
            FROM public.get_unprocessed_ui_tree_events(p_user_id := %s)
            LIMIT 10;
        """, (test_user_id,))
        unprocessed_events = cur.fetchall()

        if not unprocessed_events:
            print("No unprocessed events found for test user")
            return

        print(f"Found {len(unprocessed_events)} unprocessed events to process")
        
        # Get existing analyses for context
        cur.execute("""
            SELECT id, user_id, session_id, workflow, step, description, facts, logic, tech, apps, context, created_at, client_timestamp 
            FROM low_level_workflow_analyses 
            WHERE user_id = %s 
            ORDER BY created_at DESC
            LIMIT 10
        """, (test_user_id,))
        existing_analyses = cur.fetchall()
        print(f"Found {len(existing_analyses)} existing analyses for context")
        
        jobs_created = 0
        context_summary = []
        
        for i, event_to_process in enumerate(unprocessed_events):
            try:
                event_id = event_to_process[0]
                session_id = event_to_process[2]
                created_at = event_to_process[3]

                print(f"\n=== STEP {i+1}/10: Processing event {event_id} ===")
                
                # Get current event details
                current_event = get_current_event(cur, event_id)
                if not current_event:
                    print(f"Could not find current event {event_id}")
                    continue
                
                # Build context using precise queries
                context = build_context_for_event(cur, test_user_id, current_event)
                
                # Analyze context
                context_fields = list(context.keys())
                context_size = sum(len(str(v)) for v in context.values() if v is not None)
                
                print(f"Built context with {len(context_fields)} fields ({context_size} chars)")
                print(f"Context fields: {context_fields}")
                
                context_summary.append({
                    'step': i+1,
                    'event_id': event_id,
                    'context_fields': context_fields,
                    'context_size': context_size,
                    'has_previous_ui_tree': 'previousUiTree' in context,
                    'has_same_window': 'eventsSincePreviousUiTreeBySameWindow' in context,
                    'has_screenshots': any('screenshot' in field.lower() for field in context_fields),
                    'window_title': context.get('previousWindowTitle', 'N/A')[:50] + '...' if context.get('previousWindowTitle') else 'N/A'
                })
                
                job_payload = {
                    "context": context,
                    "event": { "session_id": session_id, "created_at": created_at.isoformat() }
                }
                
                # Insert job
                cur.execute("""
                    INSERT INTO workflow_analysis_jobs (user_id, event_id, payload) 
                    VALUES (%s, %s, %s)
                """, (test_user_id, event_id, json.dumps(job_payload)))
                
                jobs_created += 1
                print(f"✅ Created job {jobs_created}")
                
            except Exception as e:
                print(f"❌ Error processing event {event_to_process}: {e}")
                import traceback
                traceback.print_exc()
                continue
        
        # Commit all jobs
        conn.commit()
        print(f"\n🎉 Successfully created {jobs_created} jobs!")
        
        # Print summary
        print(f"\n📊 CONTEXT ANALYSIS SUMMARY:")
        print(f"{'Step':<4} {'Event ID':<8} {'Fields':<6} {'Size':<8} {'Prev UI':<8} {'Same Win':<8} {'Screenshots':<11} {'Window'}")
        print("-" * 100)
        
        for summary in context_summary:
            print(f"{summary['step']:<4} {summary['event_id']:<8} {len(summary['context_fields']):<6} {summary['context_size']:<8} "
                  f"{'✅' if summary['has_previous_ui_tree'] else '❌':<8} {'✅' if summary['has_same_window'] else '❌':<8} "
                  f"{'✅' if summary['has_screenshots'] else '❌':<11} {summary['window_title']}")
        
        # Check data volume
        total_size = sum(s['context_size'] for s in context_summary)
        avg_size = total_size / len(context_summary) if context_summary else 0
        
        print(f"\n📈 PERFORMANCE METRICS:")
        print(f"Total context data: {total_size:,} characters")
        print(f"Average per step: {avg_size:,.0f} characters")
        print(f"Estimated total size: {total_size/1024/1024:.2f} MB")
        
        return {
            'jobs_created': jobs_created,
            'context_summary': context_summary,
            'total_size_mb': total_size/1024/1024
        }

    except Exception as e:
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        if conn:
            cur.close()
            conn.close() 