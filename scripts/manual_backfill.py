import psycopg2
import os
import sys

# This is the comprehensive aggregation query from the old batch_processor.
# It recalculates all stats from the source-of-truth tables.
BACKFILL_SQL = """
DO $$
BEGIN
    -- This temporary table will hold the new, correct stats for each session.
    CREATE TEMP TABLE temp_session_stats AS
    WITH session_base AS (
        -- Get all unique session IDs and determine their definitive type
        SELECT
            session_id,
            (array_agg(user_id))[1] as user_id, -- Grab the first user_id
            CASE
                WHEN COUNT(DISTINCT session_type) > 1 THEN 'mixed'
                ELSE MAX(session_type)
            END as session_type
        FROM (
            SELECT session_id, user_id, 'low-level' as session_type FROM low_level_events WHERE session_id IS NOT NULL
            UNION ALL
            SELECT session_id, user_id, COALESCE(source, 'web') as session_type FROM user_activity_data WHERE session_id IS NOT NULL
        ) as all_sessions
        GROUP BY session_id
    ),
    analysis_stats AS (
        -- Calculate stats based on workflow analyses
        SELECT
            session_id,
            COUNT(*) as total_analyses,
            COUNT(DISTINCT llm_structured_output->>'step_title') as distinct_workflows
        FROM low_level_workflow_analyses
        WHERE llm_structured_output IS NOT NULL
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
    ui_step_stats AS (
        -- Count only the events that are UI tree events
        SELECT
            session_id,
            COUNT(*) as total_ui_steps
        FROM low_level_events
        WHERE payload->'payload'->>'type' = 'ui_tree'
        GROUP BY session_id
    ),
    event_timing_stats AS (
        -- Get the first and last event timestamps
        SELECT
            session_id,
            MIN(created_at) as first_event_timestamp,
            MAX(created_at) as last_event_timestamp,
            COUNT(*) as total_event_count
        FROM low_level_events
        GROUP BY session_id
        UNION ALL
        SELECT
            session_id,
            MIN(client_timestamp) as first_event_timestamp,
            MAX(client_timestamp) as last_event_timestamp,
            COUNT(*) as total_event_count
        FROM user_activity_data
        GROUP BY session_id
    ),
    combined_timing AS (
        -- Combine timing stats
        SELECT
            session_id,
            MIN(first_event_timestamp) as first_event_timestamp,
            MAX(last_event_timestamp) as last_event_timestamp,
            SUM(total_event_count) as total_event_count
        FROM event_timing_stats
        GROUP BY session_id
    )
    -- Final combined stats per session
    SELECT
        sb.session_id,
        sb.user_id,
        cts.total_event_count,
        COALESCE(uss.total_ui_steps, 0) as total_ui_steps,
        sb.session_type,
        COALESCE(als.total_analyses, 0) as total_workflow_analyses,
        COALESCE(als.distinct_workflows, 0) as distinct_workflows_created,
        COALESCE(ls.total_labels, 0) as total_labeled_steps,
        COALESCE(ls.human_labels, 0) as human_labeled_steps,
        cts.first_event_timestamp,
        cts.last_event_timestamp
    FROM session_base sb
    LEFT JOIN analysis_stats als ON sb.session_id = als.session_id
    LEFT JOIN label_stats ls ON sb.session_id = ls.session_id
    LEFT JOIN ui_step_stats uss ON sb.session_id = uss.session_id
    JOIN combined_timing cts ON sb.session_id = cts.session_id;

    -- Upsert into the main session_metadata table
    INSERT INTO public.session_metadata (
        session_id, user_id, event_count, processed_event_count, 
        total_ui_steps, total_workflow_analyses, distinct_workflows_created, 
        total_labeled_steps, human_labeled_steps,
        first_event_timestamp, last_event_timestamp, duration_seconds, session_type
    )
    SELECT
        tss.session_id,
        tss.user_id,
        tss.total_event_count,
        tss.total_workflow_analyses,
        tss.total_ui_steps,
        tss.total_workflow_analyses,
        tss.distinct_workflows_created,
        tss.total_labeled_steps,
        tss.human_labeled_steps,
        tss.first_event_timestamp,
        tss.last_event_timestamp,
        EXTRACT(EPOCH FROM (
            CASE
                WHEN tss.last_event_timestamp > tss.first_event_timestamp
                THEN tss.last_event_timestamp - tss.first_event_timestamp
                ELSE '0 seconds'::interval
            END
        )),
        tss.session_type
    FROM temp_session_stats tss
    ON CONFLICT (session_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        event_count = EXCLUDED.event_count,
        processed_event_count = EXCLUDED.processed_event_count,
        total_ui_steps = EXCLUDED.total_ui_steps,
        total_workflow_analyses = EXCLUDED.total_workflow_analyses,
        distinct_workflows_created = EXcluded.distinct_workflows_created,
        total_labeled_steps = EXCLUDED.total_labeled_steps,
        human_labeled_steps = EXCLUDED.human_labeled_steps,
        first_event_timestamp = EXCLUDED.first_event_timestamp,
        last_event_timestamp = EXCLUDED.last_event_timestamp,
        duration_seconds = EXCLUDED.duration_seconds,
        session_type = EXCLUDED.session_type;

    DROP TABLE temp_session_stats;
END;
$$;
"""

def run_backfill():
    """Connects to the database and runs the backfill script."""
    conn_string = os.environ.get("SUPABASE_CONN_STRING")
    if not conn_string:
        print("Error: SUPABASE_CONN_STRING environment variable not set.")
        sys.exit(1)

    try:
        print("Connecting to the database...")
        conn = psycopg2.connect(conn_string)
        # Set a generous timeout for this one-time, heavy operation
        conn.set_session(autocommit=False)
        cur = conn.cursor()
        cur.execute("SET statement_timeout = '300s';") # 5 minutes

        print("Running backfill aggregation... This may take a few minutes.")
        cur.execute(BACKFILL_SQL)
        conn.commit()
        
        print("\n✅ Backfill complete. session_metadata table is now up-to-date.")

    except Exception as e:
        print(f"\n❌ An error occurred during the backfill: {e}")
        if 'conn' in locals() and conn:
            conn.rollback()
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close()
        print("Database connection closed.")

if __name__ == "__main__":
    run_backfill() 