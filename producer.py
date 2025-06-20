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
    payload = event[4] # Index of payload column
    return payload.get('payload', {}).get('timestamp', event[2]) # Index of created_at

def generate_simplified_ui_tree_string(tree_str):
    # This is a placeholder for the more complex logic in the frontend.
    # For now, we just pass the stringified tree.
    import json
    try:
        parsed = json.loads(tree_str)
        # A real implementation would simplify this further.
        return json.dumps(parsed, indent=2)
    except:
        return tree_str or ""

def generate_event_summary_string(event):
    # Simplified version
    event_type = event[4].get('payload', {}).get('type', 'unknown')
    return f"Event: {event_type}"


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
            
            cur.execute(GET_ALL_EVENTS_SQL, (user_id,))
            all_events = cur.fetchall()
            
            ui_tree_events = [e for e in all_events if e[4].get('payload', {}).get('type') == 'ui_tree']

            jobs_to_insert = []
            for event_to_process in unprocessed_events:
                event_id = event_to_process[0]
                session_id = event_to_process[2]
                created_at = event_to_process[3]

                # Build context (simplified version of frontend logic)
                context = {}
                try:
                    current_index = ui_tree_events.index(next(e for e in ui_tree_events if e[0] == event_id))
                    prev_event = ui_tree_events[current_index - 1] if current_index > 0 else None
                    
                    if prev_event:
                        prev_tree = prev_event[4].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
                        context['previousUiTree'] = generate_simplified_ui_tree_string(prev_tree)

                    current_tree = event_to_process[4].get('payload', {}).get('event', {}).get('screen', {}).get('ui_tree')
                    context['currentUiTree'] = generate_simplified_ui_tree_string(current_tree)
                    
                    if prev_event:
                        prev_ts = get_event_timestamp(prev_event)
                        current_ts = get_event_timestamp(event_to_process)
                        events_between = [
                            generate_event_summary_string(e) for e in all_events 
                            if get_event_timestamp(e) > prev_ts and get_event_timestamp(e) < current_ts
                        ]
                        context['eventsSincePreviousUiTreeByTimestamp'] = events_between
                except Exception as e:
                    print(f"Warning: Could not build full context for event {event_id}: {e}")

                job_payload = {
                    "context": context,
                    "event": { "session_id": session_id, "created_at": created_at.isoformat() }
                }
                
                # psycopg2 can't handle dicts directly for jsonb, so we stringify
                import json
                jobs_to_insert.append((user_id, event_id, json.dumps(job_payload)))

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
    finally:
        if conn:
            cur.close()
            conn.close() 