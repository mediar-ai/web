import modal
import os
import psycopg2
import json
from datetime import datetime

app = modal.App("workflow-analysis-producer")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary")

# This script is responsible for finding unprocessed events and creating jobs for them.

GET_UNPROCESSED_EVENTS_SQL = """
    SELECT id, user_id, session_id, created_at, payload
    FROM public.get_unprocessed_ui_tree_events(p_user_id := %s);
"""

# We need the full event history to build context for each job.
# GET_ALL_EVENTS_SQL = "SELECT id, session_id, created_at, payload FROM low_level_events WHERE user_id = %s ORDER BY created_at ASC;"
# GET_RECENT_EVENTS_SQL = ...
# GET_RECENT_ANALYSES_SQL = ...

# Get existing analyses for previous context
GET_ANALYSES_SQL = "SELECT id, user_id, session_id, llm_structured_output, created_at, client_timestamp FROM low_level_workflow_analyses WHERE user_id = %s ORDER BY created_at DESC;"

# Simplified versions of the frontend utils
def get_event_timestamp(event):
    """Get timestamp from event"""
    try:
        return str(event[2]) if len(event) >= 3 else None
    except:
        return None

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
    """
    Find screenshot_diff event closest to the UI tree timestamp within time window
    Returns the base64 data for the 'after' screenshot
    """
    try:
        # Convert timestamp to ensure we have the right format
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

# New precise queries for context building
def get_current_event(cur, event_id):
    """Get the current UI tree event being processed"""
    cur.execute("""
        SELECT id, session_id, created_at, payload 
        FROM low_level_events 
        WHERE id = %s
    """, (event_id,))
    return cur.fetchone()

def get_previous_ui_tree_by_timestamp(cur, user_id, current_timestamp):
    """Get exactly the previous UI tree event by timestamp"""
    cur.execute("""
        SELECT id, session_id, created_at, payload 
        FROM low_level_events 
        WHERE user_id = %s 
          AND payload->'payload'->>'type' = 'ui_tree'
          AND created_at < %s
        ORDER BY created_at DESC 
        LIMIT 1
    """, (user_id, current_timestamp))
    return cur.fetchone()

def get_window_title(event):
    """Extract window title from UI tree event"""
    try:
        payload = event[3] if len(event) >= 4 else {}
        ui_tree_str = payload.get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
        if ui_tree_str:
            import json
            ui_tree = json.loads(ui_tree_str)
            return ui_tree.get('attributes', {}).get('name') or payload.get('payload', {}).get('event', {}).get('app_name', 'Unknown')
        return payload.get('payload', {}).get('event', {}).get('app_name', 'Unknown')
    except:
        return 'Unknown'

def get_previous_same_window_ui_tree(cur, user_id, current_timestamp, window_title):
    """Get exactly the previous UI tree event from the same window"""
    cur.execute("""
        SELECT id, session_id, created_at, payload 
        FROM low_level_events 
        WHERE user_id = %s 
          AND payload->'payload'->>'type' = 'ui_tree'
          AND created_at < %s
          AND COALESCE(
            (payload->'payload'->'event'->'screen'->>'ui_tree')::jsonb->'attributes'->>'name',
            payload->'payload'->'event'->>'app_name'
          ) = %s
        ORDER BY created_at DESC 
        LIMIT 1
    """, (user_id, current_timestamp, window_title))
    return cur.fetchone()

def get_events_between_timestamps(cur, user_id, start_timestamp, end_timestamp):
    """Get all events between two timestamps"""
    cur.execute("""
        SELECT id, session_id, created_at, payload 
        FROM low_level_events
        WHERE user_id = %s
          AND created_at > %s
          AND created_at < %s
        ORDER BY created_at ASC
    """, (user_id, start_timestamp, end_timestamp))
    return cur.fetchall()

def get_screenshots_near_timestamp(cur, user_id, target_timestamp):
    """Get the closest screenshot to a UI tree timestamp"""
    cur.execute("""
        SELECT id, session_id, created_at, payload,
               ABS(EXTRACT(EPOCH FROM (
                 (payload->'payload'->'event'->'screenshot_diff'->>'after_timestamp')::timestamp 
                 - %s::timestamp
               ))) as time_diff
        FROM low_level_events
        WHERE user_id = %s
          AND payload->'payload'->>'type' = 'screenshot_diff'
          AND (payload->'payload'->'event'->'screenshot_diff'->>'after_timestamp')::timestamp 
              BETWEEN %s::timestamp - INTERVAL '2 seconds'
                  AND %s::timestamp + INTERVAL '1 second'
        ORDER BY time_diff ASC
        LIMIT 1
    """, (target_timestamp, user_id, target_timestamp, target_timestamp))
    return cur.fetchone()

def get_recent_analyses(cur, user_id, limit=10):
    """Get recent analyses for previous context"""
    cur.execute("""
        SELECT id, user_id, session_id, llm_structured_output, created_at, client_timestamp 
        FROM low_level_workflow_analyses 
        WHERE user_id = %s 
        ORDER BY created_at DESC
        LIMIT %s
    """, (user_id, limit))
    return cur.fetchall()

def build_context_for_event(cur, user_id, current_event):
    """Build complete context for one UI tree event using precise queries"""
    current_timestamp = current_event[2]  # created_at
    window_title = get_window_title(current_event)
    
    context = {
        'currentUiTree': generate_simplified_ui_tree_string(
            current_event[3].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
        ) if current_event[3].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree') else None
    }
    
    # Get previous UI tree by timestamp
    previous_event = get_previous_ui_tree_by_timestamp(cur, user_id, current_timestamp)
    if previous_event:
        context['previousUiTree'] = generate_simplified_ui_tree_string(
            previous_event[3].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
        ) if previous_event[3].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree') else None
        
        context['previousWindowTitle'] = get_window_title(previous_event)
        context['previousWindowTimestamp'] = previous_event[2].isoformat()
        
        # Get events between previous and current
        events_between = get_events_between_timestamps(cur, user_id, previous_event[2], current_timestamp)
        if events_between:
            context['eventsSincePreviousUiTreeByTimestamp'] = [
                generate_event_summary_string(event) for event in events_between
            ]
        
        # Get screenshot for previous event
        prev_screenshot = get_screenshots_near_timestamp(cur, user_id, previous_event[2])
        if prev_screenshot:
            context['screenshotBefore'] = get_screenshot_for_ui_tree_event(cur, user_id, previous_event[1], previous_event[2])
    
    # Get previous same window UI tree
    previous_same_window = get_previous_same_window_ui_tree(cur, user_id, current_timestamp, window_title)
    if previous_same_window and (not previous_event or previous_same_window[0] != previous_event[0]):
        # Different from timestamp previous, get events between same window
        events_same_window = get_events_between_timestamps(cur, user_id, previous_same_window[2], current_timestamp)
        if events_same_window:
            context['eventsSincePreviousUiTreeBySameWindow'] = [
                generate_event_summary_string(event) for event in events_same_window
            ]
        
        # Get screenshot for same window event
        same_window_screenshot = get_screenshots_near_timestamp(cur, user_id, previous_same_window[2])
        if same_window_screenshot:
            context['screenshotBeforeSameWindow'] = get_screenshot_for_ui_tree_event(cur, user_id, previous_same_window[1], previous_same_window[2])
    
    # Get screenshot for current event
    current_screenshot = get_screenshots_near_timestamp(cur, user_id, current_timestamp)
    if current_screenshot:
        context['screenshotAfter'] = get_screenshot_for_ui_tree_event(cur, user_id, current_event[1], current_event[2])
    
    # Get recent analyses for previous context
    recent_analyses = get_recent_analyses(cur, user_id, 10)
    if recent_analyses:
        # Convert to the format expected by context
        context['previousAnalyses'] = []
        for analysis in recent_analyses[:3]:  # Limit to 3 most recent
            # analysis structure: id, user_id, session_id, llm_structured_output, created_at, client_timestamp
            llm_output = analysis[3] if analysis[3] else {}  # llm_structured_output JSONB
            
            # Extract fields from JSONB, falling back to 'Not available in data'
            context['previousAnalyses'].append({
                'workflow': llm_output.get('workflow', 'Not available in data'),
                'step': llm_output.get('step', 'Not available in data'), 
                'description': llm_output.get('description', 'Not available in data'),
                'facts': llm_output.get('facts', 'Not available in data'),
                'logic': llm_output.get('logic', 'Not available in data'),
                'tech': llm_output.get('tech', 'Not available in data'),
                'apps': llm_output.get('apps', 'Not available in data'),
                'context': llm_output.get('context', 'Not available in data'),
                'client_timestamp': analysis[5].isoformat() if analysis[5] else None  # client_timestamp
            })
    
    return context

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    schedule=modal.Period(minutes=5),
    timeout=1800  # 30 minutes - much more generous for testing
)
def enqueue_jobs():
    print("Running producer to enqueue new analysis jobs...")
    conn = None
    try:
        conn = psycopg2.connect(os.environ["SUPABASE_CONN_STRING"])
        cur = conn.cursor()

        # Find all users who have UI tree events to process
        cur.execute("""
            SELECT DISTINCT user_id 
            FROM low_level_events 
            WHERE payload->'payload'->>'type' = 'ui_tree'
        """)
        user_ids = [row[0] for row in cur.fetchall()]
        print(f"Found {len(user_ids)} users with UI tree events")

        for user_id in user_ids:
            print(f"Checking for unprocessed events for user: {user_id}")
            
            cur.execute(GET_UNPROCESSED_EVENTS_SQL, (user_id,))
            unprocessed_events = cur.fetchall()

            if not unprocessed_events:
                print(f"No new events to process for user: {user_id}")
                continue

            print(f"Found {len(unprocessed_events)} unprocessed events for user {user_id}. Building context...")
            
            # Debug: Check structure of unprocessed events
            if unprocessed_events:
                sample_event = unprocessed_events[0]
                print(f"Sample unprocessed event structure: {len(sample_event)} fields, types: {[type(f) for f in sample_event]}")
            
            cur.execute(GET_ANALYSES_SQL, (user_id,))
            all_analyses = cur.fetchall()
            print(f"Found {len(all_analyses)} existing analyses for user {user_id}")
            
            # Filter for UI tree events with safe access
            ui_tree_events = []
            for e in unprocessed_events:
                try:
                    if len(e) >= 4:
                        payload = e[3] if len(e) == 4 else e[4] if len(e) >= 5 else None
                        if isinstance(payload, dict) and payload.get('payload', {}).get('type') == 'ui_tree':
                            ui_tree_events.append(e)
                except Exception as ex:
                    print(f"Error filtering event {e}: {ex}")
                    continue

            jobs_to_insert = []
            jobs_created = 0
            
            for event_to_process in unprocessed_events:
                try:
                    event_id = event_to_process[0]
                    session_id = event_to_process[2]
                    created_at = event_to_process[3]

                    print(f"Processing event {event_id} for user {user_id}")
                    
                    # Get current event details
                    current_event = get_current_event(cur, event_id)
                    if not current_event:
                        print(f"Could not find current event {event_id}")
                        continue
                    
                    # Build context using precise queries
                    context = build_context_for_event(cur, user_id, current_event)
                    print(f"Built context for event {event_id} with fields: {list(context.keys())}")
                    
                    job_payload = {
                        "context": context,
                        "event": { "session_id": session_id, "created_at": created_at.isoformat() }
                    }
                    
                    # psycopg2 can't handle dicts directly for jsonb, so we stringify
                    jobs_to_insert.append((user_id, event_id, json.dumps(job_payload)))
                    jobs_created += 1
                    
                except Exception as e:
                    print(f"Error processing event {event_to_process}: {e}")
                    import traceback
                    traceback.print_exc()
                    continue

            if jobs_to_insert:
                from psycopg2.extras import execute_values
                print(f"Enqueuing {len(jobs_to_insert)} jobs for user {user_id}...")
                execute_values(
                    cur,
                    "INSERT INTO workflow_analysis_jobs (user_id, event_id, payload) VALUES %s",
                    jobs_to_insert
                )
                conn.commit()
                print(f"Successfully created {jobs_created} jobs for user {user_id}")
            else:
                print(f"No jobs to create for user {user_id}")
        
        print("Producer completed successfully!")

    except Exception as e:
        print(f"An error occurred in the producer: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            cur.close()
            conn.close() 