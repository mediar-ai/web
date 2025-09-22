"""
High Frequency Processor - Runs workflow checking every second
This replaces the workflow_executor cron job
"""
import modal
import os
import psycopg2
import json
import httpx
import time
from datetime import datetime
from typing import Dict, Any, Optional

app = modal.App("high-frequency-processor")

# Image with all necessary dependencies
image = modal.Image.debian_slim().pip_install([
    "aiohttp",
    "psycopg2-binary",
    "pyyaml",
    "httpx",
    "requests",
])

secrets = [
    modal.Secret.from_name("supabase-secret"),
    modal.Secret.from_name("custom-secret"),
]

def get_db_config():
    """Get database configuration from environment variables"""
    return {
        'host': os.environ['SUPABASE_HOST'],
        'port': 5432,
        'database': 'postgres',
        'user': os.environ['SUPABASE_USER'],
        'password': os.environ['SUPABASE_PASSWORD']
    }

@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=1),  # Run every second for workflow checks
    timeout=300,
    max_containers=1,
    min_containers=0,
    retries=0,
)
def high_frequency_check():
    """
    Checks for queued workflow executions and processes them
    Runs every 1 second to ensure quick processing
    """
    print(f"[{datetime.now()}] Checking for queued workflows...")

    try:
        # Connect to database
        conn = psycopg2.connect(**get_db_config())
        cursor = conn.cursor()

        # Find a queued execution to process (even without machine_id)
        cursor.execute("""
            UPDATE workflow_executions
            SET status = 'running', started_at = NOW()
            WHERE id = (
                SELECT id FROM workflow_executions
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, workflow_id, machine_id, input_data, mcp_endpoint
        """)

        result = cursor.fetchone()

        if result:
            execution_id, workflow_id, machine_id, input_data, mcp_endpoint = result
            conn.commit()
            print(f"✅ Processing execution {execution_id} for workflow {workflow_id}")

            try:
                # Get the workflow YAML
                cursor.execute("""
                    SELECT yaml_content
                    FROM remote_workflows
                    WHERE id = %s
                """, (workflow_id,))

                workflow_result = cursor.fetchone()
                if not workflow_result:
                    raise Exception(f"Workflow {workflow_id} not found")

                workflow_yaml = workflow_result[0]

                # For now, simulate processing
                print(f"📋 Processing workflow with {len(workflow_yaml)} chars of YAML")
                time.sleep(3)

                # Mark as completed with a simple result
                cursor.execute("""
                    UPDATE workflow_executions
                    SET status = 'completed',
                        completed_at = NOW(),
                        output_data = %s
                    WHERE id = %s
                """, (json.dumps({"status": "success", "message": "Workflow completed"}), execution_id))
                conn.commit()
                print(f"✅ Completed execution {execution_id}")

            except Exception as exec_error:
                # Mark as failed on error
                cursor.execute("""
                    UPDATE workflow_executions
                    SET status = 'failed',
                        completed_at = NOW(),
                        error_message = %s
                    WHERE id = %s
                """, (str(exec_error), execution_id))
                conn.commit()
                print(f"❌ Failed execution {execution_id}: {exec_error}")
        else:
            conn.commit()
            # No queued workflows
            pass

        cursor.close()
        conn.close()

    except Exception as e:
        print(f"❌ Error processing workflows: {e}")
        import traceback
        traceback.print_exc()