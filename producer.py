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

                    # Build context (simplified version of frontend logic)
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
                        
                        if prev_event:
                            payload_idx = 3 if len(prev_event) == 4 else 4
                            prev_tree = prev_event[payload_idx].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
                            context['previousUiTree'] = generate_simplified_ui_tree_string(prev_tree)

                        payload_idx = 3 if len(event_to_process) == 4 else 4
                        current_tree = event_to_process[payload_idx].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
                        context['currentUiTree'] = generate_simplified_ui_tree_string(current_tree)
                        
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