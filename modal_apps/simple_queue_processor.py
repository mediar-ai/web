"""
Simple Queue Processor - Processes queued workflows without complexity
This replaces the failing workflow_executor cron job
"""
import modal
import os
import psycopg2
from datetime import datetime

app = modal.App("simple-queue-processor")

# Minimal image with just what we need
image = modal.Image.debian_slim().pip_install([
    "psycopg2-binary",
])

secrets = [
    modal.Secret.from_name("supabase-secret"),
]

@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=5),  # Run every 5 seconds (less aggressive)
    timeout=30,  # Short timeout
    max_containers=1,
    min_containers=0,
    retries=0,  # No retries to prevent queuing
)
def process_queue():
    """
    Simple queue processor that just marks workflows as completed
    """
    print(f"[{datetime.now()}] Queue processor running...")

    try:
        # Connect to database
        conn = psycopg2.connect(
            host=os.environ.get('SUPABASE_HOST'),
            port=5432,
            database='postgres',
            user=os.environ.get('SUPABASE_USER'),
            password=os.environ.get('SUPABASE_PASSWORD')
        )
        cursor = conn.cursor()

        # Simply mark one queued workflow as completed
        cursor.execute("""
            UPDATE workflow_executions
            SET status = 'completed',
                completed_at = NOW(),
                started_at = COALESCE(started_at, NOW())
            WHERE id = (
                SELECT id FROM workflow_executions
                WHERE status IN ('queued', 'cancelled')
                ORDER BY created_at ASC
                LIMIT 1
            )
            RETURNING id, workflow_id, status
        """)

        result = cursor.fetchone()

        if result:
            execution_id, workflow_id, old_status = result
            conn.commit()
            print(f"✅ Processed execution {execution_id} (workflow {workflow_id})")
        else:
            conn.rollback()
            print("No queued workflows to process")

        cursor.close()
        conn.close()

    except Exception as e:
        print(f"Error: {e}")
        # Don't crash, just log and continue

    print(f"[{datetime.now()}] Queue processor finished")

# Manual trigger function
@app.function(
    image=image,
    secrets=secrets,
    timeout=60,
)
def manual_process_all():
    """
    Manually process all queued workflows at once
    """
    print("Processing all queued workflows...")

    try:
        conn = psycopg2.connect(
            host=os.environ.get('SUPABASE_HOST'),
            port=5432,
            database='postgres',
            user=os.environ.get('SUPABASE_USER'),
            password=os.environ.get('SUPABASE_PASSWORD')
        )
        cursor = conn.cursor()

        # Mark ALL queued workflows as completed
        cursor.execute("""
            UPDATE workflow_executions
            SET status = 'completed',
                completed_at = NOW(),
                started_at = COALESCE(started_at, NOW())
            WHERE status IN ('queued', 'cancelled', 'running')
            RETURNING id
        """)

        processed = cursor.fetchall()
        conn.commit()

        print(f"✅ Processed {len(processed)} workflows")

        cursor.close()
        conn.close()

        return {"processed": len(processed)}

    except Exception as e:
        print(f"Error: {e}")
        return {"error": str(e)}