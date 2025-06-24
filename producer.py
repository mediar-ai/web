import modal
import os
import psycopg2

app = modal.App("workflow-analysis-producer")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary")

# This script is responsible for finding unprocessed events and creating jobs for them.

GET_UNPROCESSED_EVENTS_SQL = """
    SELECT id, user_id, session_id, created_at, payload
    FROM public.get_unprocessed_ui_tree_events(p_user_id := %s);
"""

# We need the full event history to build context for each job.
GET_ALL_EVENTS_SQL = "SELECT id, session_id, created_at, payload FROM low_level_events WHERE user_id = %s ORDER BY created_at ASC;"

# Get existing analyses for previous context
GET_ANALYSES_SQL = "SELECT id, user_id, session_id, workflow, step, description, facts, logic, tech, apps, context, created_at, client_timestamp FROM low_level_workflow_analyses WHERE user_id = %s ORDER BY created_at DESC;"

# Simplified versions of the frontend utils
def get_event_timestamp(event):
    try:
        # Handle different tuple structures safely
        if len(event) >= 5:
            payload = event[4] # Index of payload column
            if isinstance(payload, dict):
                return payload.get('payload', {}).get('timestamp', event[2]) # Index of created_at
        elif len(event) >= 4:
            payload = event[3] # Try different index
            if isinstance(payload, dict):
                return payload.get('payload', {}).get('timestamp', event[2])
        
        # Fallback to created_at if available
        if len(event) >= 3:
            return event[2] if event[2] else str(event[2])
        
        print(f"Warning: Unexpected event structure: {event}")
        return None
    except Exception as e:
        print(f"Error getting timestamp from event {event}: {e}")
        return None

def generate_simplified_ui_tree_string(tree_str):
    # This is a placeholder for the more complex logic in the frontend.
    # For now, we just pass the stringified tree.
    import json
    try:
        if tree_str:
            parsed = json.loads(tree_str)
            # A real implementation would simplify this further.
            return json.dumps(parsed, indent=2)
    except:
        pass
    return tree_str or ""

def generate_event_summary_string(event):
    try:
        # Handle different tuple structures safely
        if len(event) >= 5:
            payload = event[4]
        elif len(event) >= 4:
            payload = event[3]
        else:
            return f"Event: unknown (structure: {len(event)} fields)"
        
        if isinstance(payload, dict):
            event_type = payload.get('payload', {}).get('type', 'unknown')
            return f"Event: {event_type}"
        else:
            return f"Event: unknown (payload type: {type(payload)})"
    except Exception as e:
        print(f"Error generating event summary: {e}")
        return "Event: error"

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


@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    schedule=modal.Period(minutes=5),
    timeout=300
)
def enqueue_jobs():
    print("Running producer to enqueue new analysis jobs...")
    conn = None
    try:
        conn = psycopg2.connect(os.environ["SUPABASE_CONN_STRING"])
        cur = conn.cursor()

        # Find all users who have had recent activity to check for new work.
        cur.execute("SELECT DISTINCT user_id FROM low_level_events WHERE created_at > NOW() - INTERVAL '1 day';")
        user_ids = [row[0] for row in cur.fetchall()]

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
            
            cur.execute(GET_ALL_EVENTS_SQL, (user_id,))
            all_events = cur.fetchall()
            
            # Debug: Check structure of all events
            if all_events:
                sample_all_event = all_events[0]
                print(f"Sample all_events structure: {len(sample_all_event)} fields, types: {[type(f) for f in sample_all_event]}")
            
            # Get existing analyses for context building
            cur.execute(GET_ANALYSES_SQL, (user_id,))
            all_analyses = cur.fetchall()
            print(f"Found {len(all_analyses)} existing analyses for user {user_id}")
            
            # Filter for UI tree events with safe access
            ui_tree_events = []
            for e in all_events:
                try:
                    if len(e) >= 4:
                        payload = e[3] if len(e) == 4 else e[4] if len(e) >= 5 else None
                        if isinstance(payload, dict) and payload.get('payload', {}).get('type') == 'ui_tree':
                            ui_tree_events.append(e)
                except Exception as ex:
                    print(f"Error filtering event {e}: {ex}")
                    continue

            jobs_to_insert = []
            for event_to_process in unprocessed_events:
                try:
                    event_id = event_to_process[0]
                    session_id = event_to_process[2]
                    created_at = event_to_process[3]

                    # Build context (matching frontend logic)
                    context = {}
                    
                    # Find current event in ui_tree_events
                    current_event_in_ui_list = None
                    current_index = -1
                    for i, ui_event in enumerate(ui_tree_events):
                        if ui_event[0] == event_id:
                            current_event_in_ui_list = ui_event
                            current_index = i
                            break
                    
                    if current_event_in_ui_list is not None:
                        prev_event = ui_tree_events[current_index - 1] if current_index > 0 else None
                        
                        # Previous UI Tree and Window Title
                        if prev_event:
                            payload_idx = 3 if len(prev_event) == 4 else 4
                            prev_tree = prev_event[payload_idx].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
                            context['previousUiTree'] = generate_simplified_ui_tree_string(prev_tree)
                            
                            # Add window title from previous event
                            prev_app_name = prev_event[payload_idx].get('payload', {}).get('event', {}).get('app_name', 'Unknown App')
                            context['previousWindowTitle'] = prev_app_name
                            context['previousWindowTimestamp'] = str(prev_event[3])  # created_at
                            
                            # Add screenshot for previous UI tree
                            prev_screenshot = get_screenshot_for_ui_tree_event(cur, user_id, session_id, prev_event[3])
                            if prev_screenshot:
                                context['screenshotBefore'] = prev_screenshot

                        # Current UI Tree
                        payload_idx = 3 if len(event_to_process) == 4 else 4
                        current_tree = event_to_process[payload_idx].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
                        context['currentUiTree'] = generate_simplified_ui_tree_string(current_tree)
                        
                        # Add screenshot for current UI tree
                        current_screenshot = get_screenshot_for_ui_tree_event(cur, user_id, session_id, created_at)
                        if current_screenshot:
                            context['screenshotAfter'] = current_screenshot
                        
                        # Add previous analyses (up to 3, matching frontend logic)
                        if current_index > 0 and all_analyses:
                            # Get timestamps of the 3 preceding UI tree events
                            preceding_events = ui_tree_events[max(0, current_index - 3):current_index]
                            preceding_timestamps = set()
                            for pe in preceding_events:
                                pe_ts = get_event_timestamp(pe)
                                if pe_ts:
                                    preceding_timestamps.add(pe_ts)
                            
                            # Find analyses that match these timestamps
                            previous_analyses = []
                            for analysis in all_analyses:
                                # analysis structure: (id, user_id, session_id, workflow, step, description, facts, logic, tech, apps, context, created_at, client_timestamp)
                                analysis_timestamp = str(analysis[12]) if analysis[12] else str(analysis[11])  # client_timestamp or created_at
                                if analysis_timestamp in preceding_timestamps and len(previous_analyses) < 3:
                                    previous_analyses.append({
                                        'created_at': analysis_timestamp,
                                        'step': analysis[4] or '',  # step
                                        'description': analysis[5] or ''  # description
                                    })
                            
                            if previous_analyses:
                                context['previousAnalyses'] = previous_analyses
                                print(f"Added {len(previous_analyses)} previous analyses to context")
                        
                        # Events between previous and current UI tree
                        if prev_event:
                            prev_ts = get_event_timestamp(prev_event)
                            current_ts = get_event_timestamp(event_to_process)
                            if prev_ts and current_ts:
                                events_between = []
                                for e in all_events:
                                    e_ts = get_event_timestamp(e)
                                    if e_ts and prev_ts < e_ts < current_ts:
                                        events_between.append(generate_event_summary_string(e))
                                context['eventsSincePreviousUiTreeByTimestamp'] = events_between
                        
                        # Find previous same window UI tree for diff calculation
                        current_app_name = event_to_process[payload_idx].get('payload', {}).get('event', {}).get('app_name', 'Unknown App')
                        prev_same_window_event = None
                        for i in range(current_index - 1, -1, -1):
                            ui_event = ui_tree_events[i]
                            event_payload_idx = 3 if len(ui_event) == 4 else 4
                            event_app_name = ui_event[event_payload_idx].get('payload', {}).get('event', {}).get('app_name', 'Unknown App')
                            if event_app_name == current_app_name:
                                prev_same_window_event = ui_event
                                break
                        
                        # Events between same window UI trees
                        if prev_same_window_event:
                            prev_same_ts = get_event_timestamp(prev_same_window_event)
                            if prev_same_ts and current_ts:
                                events_same_window = []
                                for e in all_events:
                                    e_ts = get_event_timestamp(e)
                                    if e_ts and prev_same_ts < e_ts < current_ts:
                                        events_same_window.append(generate_event_summary_string(e))
                                context['eventsSincePreviousUiTreeBySameWindow'] = events_same_window
                            
                            # UI Tree Diff (simplified - full diff logic would be complex in Python)
                            prev_same_payload_idx = 3 if len(prev_same_window_event) == 4 else 4
                            prev_same_tree = prev_same_window_event[prev_same_payload_idx].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
                            if prev_same_tree and current_tree:
                                # Simplified diff indication
                                context['uiTreeDiffLatestVsPreviousForTheSameWindow'] = f"UI Tree changed from previous state in {current_app_name}"
                            
                            # Add screenshot for previous same window UI tree (if different from previous by timestamp)
                            if prev_same_window_event != prev_event:
                                prev_same_window_screenshot = get_screenshot_for_ui_tree_event(cur, user_id, session_id, prev_same_window_event[3])
                                if prev_same_window_screenshot:
                                    context['screenshotBeforeSameWindow'] = prev_same_window_screenshot

                    job_payload = {
                        "context": context,
                        "event": { "session_id": session_id, "created_at": created_at.isoformat() }
                    }
                    
                    # psycopg2 can't handle dicts directly for jsonb, so we stringify
                    import json
                    jobs_to_insert.append((user_id, event_id, json.dumps(job_payload)))
                    
                except Exception as e:
                    print(f"Error processing event {event_to_process}: {e}")
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

    except Exception as e:
        print(f"An error occurred in the producer: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            cur.close()
            conn.close() 