import asyncio
import modal
import psycopg2
import os

# Define the Modal "App" which is the main app object.
# This is the entrypoint for all Modal functions.
app = modal.App("session-event-aggregator-v2")

# Define the container image for our functions.
# We need to install libraries to connect to Postgres and to create a web endpoint.
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary")

# This is the new, comprehensive aggregation query.
# It recalculates all stats from the source-of-truth tables on every run.
NEW_AGGREGATION_SQL = """
DO $$
BEGIN
    -- This temporary table will hold the new, correct stats for each session.
    CREATE TEMP TABLE temp_session_stats AS
    WITH session_base AS (
        -- Get all unique session IDs from the events table
        SELECT DISTINCT session_id, user_id
        FROM low_level_events
        WHERE session_id IS NOT NULL
    ),
    analysis_stats AS (
        -- Calculate stats based on workflow analyses
        SELECT
            session_id,
            COUNT(*) as total_analyses,
            COUNT(DISTINCT workflow) as distinct_workflows
        FROM low_level_workflow_analyses
        GROUP BY session_id
    ),
    label_stats AS (
        -- Calculate stats based on the low_level_datasets table
        SELECT
            llwa.session_id,
            COUNT(lld.id) as total_labels,
            COUNT(lld.id) FILTER (WHERE lld.feedback IS NOT NULL) as human_labels
        FROM low_level_datasets lld
        JOIN low_level_workflow_analyses llwa ON lld.low_level_workflow_analysis_id = llwa.id
        GROUP BY llwa.session_id
    ),
    event_timing_stats AS (
        -- Get the first and last event timestamps for duration calculation
        SELECT
            session_id,
            MIN(created_at) as first_event_timestamp,
            MAX(created_at) as last_event_timestamp,
            COUNT(*) as total_event_count
        FROM low_level_events
        GROUP BY session_id
    )
    -- Final combined stats per session
    SELECT
        sb.session_id,
        sb.user_id,
        ets.total_event_count,
        COALESCE(als.total_analyses, 0) as total_workflow_analyses,
        COALESCE(als.distinct_workflows, 0) as distinct_workflows_created,
        COALESCE(ls.total_labels, 0) as total_labeled_steps,
        COALESCE(ls.human_labels, 0) as human_labeled_steps,
        ets.first_event_timestamp,
        ets.last_event_timestamp
    FROM session_base sb
    LEFT JOIN analysis_stats als ON sb.session_id = als.session_id
    LEFT JOIN label_stats ls ON sb.session_id = ls.session_id
    JOIN event_timing_stats ets ON sb.session_id = ets.session_id;

    -- Now, update the main session_metadata table from our temp table.
    -- This is an "upsert" operation.
    INSERT INTO public.session_metadata (
        session_id, user_id, event_count, processed_event_count, 
        total_workflow_analyses, distinct_workflows_created, total_labeled_steps, human_labeled_steps,
        first_event_timestamp, last_event_timestamp, duration_seconds, session_type
    )
    SELECT
        tss.session_id,
        tss.user_id,
        tss.total_event_count,
        tss.total_workflow_analyses, -- processed_event_count is now the same as total_workflow_analyses
        tss.total_workflow_analyses,
        tss.distinct_workflows_created,
        tss.total_labeled_steps,
        tss.human_labeled_steps,
        tss.first_event_timestamp,
        tss.last_event_timestamp,
        EXTRACT(EPOCH FROM (tss.last_event_timestamp - tss.first_event_timestamp)),
        'low-level' -- Hardcoded for now as this script only handles low-level
    FROM temp_session_stats tss
    ON CONFLICT (session_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        event_count = EXCLUDED.event_count,
        processed_event_count = EXCLUDED.processed_event_count,
        total_workflow_analyses = EXCLUDED.total_workflow_analyses,
        distinct_workflows_created = EXCLUDED.distinct_workflows_created,
        total_labeled_steps = EXCLUDED.total_labeled_steps,
        human_labeled_steps = EXCLUDED.human_labeled_steps,
        first_event_timestamp = EXCLUDED.first_event_timestamp,
        last_event_timestamp = EXCLUDED.last_event_timestamp,
        duration_seconds = EXCLUDED.duration_seconds;

    DROP TABLE temp_session_stats;
END;
$$;
"""

# Define a function that runs on a schedule.
# This function is the core of our solution.
@app.function(
    # To connect to Supabase, we need the connection string.
    # We store this securely in a Modal Secret, not in our code.
    # You will need to create a secret in the Modal UI named "supabase-secret"
    # with a key "SUPABASE_CONN_STRING".
    secrets=[modal.Secret.from_name("supabase-secret")],
    
    # Set the schedule to run every 5 minutes.
    schedule=modal.Period(minutes=5),
    
    # Allow this function to run for a while if needed.
    timeout=120
)
def aggregate_and_update_sessions():
    """
    This function connects to the Supabase DB and does two things:
    1. Aggregates all events that haven't been counted yet.
    2. Updates the session_metadata table with the new counts.
    3. Marks the events as "counted" so they are not processed again.
    """
    print("Running scheduled aggregation v2...")
    
    try:
        # Connect to the database using the connection string from the secret.
        conn = psycopg2.connect(os.environ["SUPABASE_CONN_STRING"])
        cur = conn.cursor()

        cur.execute(NEW_AGGREGATION_SQL)
        conn.commit()
        
        print("Aggregation v2 successful.")

    except Exception as e:
        print(f"An error occurred in v2 aggregation: {e}")
        # In a production environment, you would add more robust error handling,
        # perhaps sending a notification to an observability platform.
    finally:
        if 'conn' in locals() and conn is not None:
            cur.close()
            conn.close()
            
# This is a dummy function to keep the service running.
# A stub with only a scheduled function might be paused by Modal.
# Having a dummy web endpoint is a good practice to ensure it's always "on".
@app.function()
@modal.fastapi_endpoint()
def dummy():
    return {"status": "ok"}