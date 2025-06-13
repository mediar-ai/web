import asyncio
import modal
import psycopg2
import os

# Define the Modal "App" which is the main app object.
# This is the entrypoint for all Modal functions.
app = modal.App("session-event-aggregator")

# Define the container image for our functions.
# We need to install libraries to connect to Postgres and to create a web endpoint.
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary", "fastapi")

# Define a function that runs on a schedule.
# This function is the core of our solution.
@app.function(
    # To connect to Supabase, we need the connection string.
    # We store this securely in a Modal Secret, not in our code.
    # You will need to create a secret in the Modal UI named "supabase-secret"
    # with a key "SUPABASE_CONN_STRING".
    secrets=[modal.Secret.from_name("supabase-secret")],
    
    # Set the schedule to run every 1 second.
    schedule=modal.Period(seconds=1),
    
    # Allow this function to run for a while if needed.
    timeout=60
)
def aggregate_and_update_sessions():
    """
    This function connects to the Supabase DB and does two things:
    1. Aggregates all events that haven't been counted yet.
    2. Updates the session_metadata table with the new counts.
    3. Marks the events as "counted" so they are not processed again.
    """
    print("Running scheduled aggregation...")
    
    try:
        # Connect to the database using the connection string from the secret.
        conn = psycopg2.connect(os.environ["SUPABASE_CONN_STRING"])
        cur = conn.cursor()

        # We will use the same robust SQL logic we developed earlier.
        # This can be moved to a separate .sql file for cleanliness in a real app.
        sql_query = """
        DO $$
        BEGIN
            -- Step 1: Aggregate all uncounted events from both tables into a temporary table
            CREATE TEMP TABLE temp_new_counts AS
            WITH new_events_with_rn AS (
                SELECT
                    session_id,
                    user_id,
                    'lowLevel' as session_type,
                    created_at AS last_event_timestamp,
                    -- Low-level events are always considered "processed"
                    1 as processed_event_increment,
                    ROW_NUMBER() OVER(PARTITION BY session_id ORDER BY created_at) as rn
                FROM public.low_level_events
                WHERE is_counted = false AND session_id IS NOT NULL
                UNION ALL
                SELECT
                    session_id,
                    user_id,
                    'web' as session_type,
                    client_timestamp AS last_event_timestamp,
                    -- Web events are "processed" if they are of type 'activity_item'
                    CASE WHEN item_type = 'activity_item' THEN 1 ELSE 0 END as processed_event_increment,
                    ROW_NUMBER() OVER(PARTITION BY session_id ORDER BY client_timestamp) as rn
                FROM public.user_activity_data
                WHERE is_counted = false AND session_id IS NOT NULL
            )
            SELECT
                session_id,
                (SELECT user_id FROM new_events_with_rn WHERE rn = 1 AND session_id = ne.session_id LIMIT 1) as user_id,
                MAX(session_type) as session_type,
                MAX(last_event_timestamp) as last_event_timestamp,
                COUNT(*) as new_event_count,
                SUM(processed_event_increment) as new_processed_event_count
            FROM new_events_with_rn ne
            GROUP BY session_id;

            -- If there's nothing to update, exit early.
            IF NOT EXISTS (SELECT 1 FROM temp_new_counts) THEN
                DROP TABLE temp_new_counts;
                RETURN;
            END IF;

            -- Step 2: Update the session_metadata table from the temporary table
            UPDATE session_metadata sm
            SET
                event_count = sm.event_count + tnc.new_event_count,
                processed_event_count = COALESCE(sm.processed_event_count, 0) + tnc.new_processed_event_count,
                last_event_timestamp = tnc.last_event_timestamp
            FROM temp_new_counts tnc
            WHERE sm.session_id = tnc.session_id;

            -- Step 3: Insert new sessions if they don't exist in session_metadata
            INSERT INTO public.session_metadata (session_id, user_id, session_type, event_count, processed_event_count, last_event_timestamp)
            SELECT
                session_id,
                user_id,
                session_type,
                new_event_count,
                new_processed_event_count,
                last_event_timestamp
            FROM temp_new_counts
            WHERE session_id NOT IN (SELECT session_id FROM public.session_metadata);

            -- Step 4: Mark the events we just counted as "done"
            UPDATE public.low_level_events SET is_counted = true WHERE is_counted = false;
            UPDATE public.user_activity_data SET is_counted = true WHERE is_counted = false;

            -- Step 5: Clean up the temporary table
            DROP TABLE temp_new_counts;
        END;
        $$;
        """
        
        cur.execute(sql_query)
        conn.commit()
        
        print("Aggregation successful.")

    except Exception as e:
        print(f"An error occurred: {e}")
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