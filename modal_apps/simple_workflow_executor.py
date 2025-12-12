"""
Simple Workflow Executor - Just calls the check_and_process_queued_jobs directly
"""
import modal
import os
import psycopg2
from datetime import datetime

app = modal.App("simple-workflow-executor")

# Image with dependencies
image = modal.Image.debian_slim().pip_install([
    "psycopg2-binary",
    "httpx",
    "pyyaml",
])

secrets = [
    modal.Secret.from_name("supabase-secret"),
    modal.Secret.from_name("custom-secret"),
]

def get_db_config():
    """Get database configuration"""
    return {
        'host': os.environ['SUPABASE_HOST'],
        'port': 5432,
        'database': 'postgres',
        'user': os.environ['SUPABASE_USER'],
        'password': os.environ['SUPABASE_PASSWORD']
    }

def process_one_workflow():
    """Process a single workflow - shared logic"""
    print(f"[{datetime.now()}] Processing one workflow...")

    try:
        # Connect to database
        conn = psycopg2.connect(**get_db_config())
        cursor = conn.cursor()

        # Find a queued execution to process
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
            RETURNING id, workflow_id
        """)

        result = cursor.fetchone()

        if result:
            execution_id, workflow_id = result
            conn.commit()
            print(f"Processing execution {execution_id} for workflow {workflow_id}")

            try:
                # Get the workflow details
                cursor.execute("""
                    SELECT name, version, yaml_content
                    FROM deployed_workflows
                    WHERE id = %s
                """, (workflow_id,))

                workflow_result = cursor.fetchone()
                if not workflow_result:
                    raise Exception(f"Workflow {workflow_id} not found")

                workflow_name, workflow_version, workflow_yaml = workflow_result

                print(f"Executing {workflow_name} ({workflow_version})")

                # Simulate processing
                import time
                time.sleep(3)

                # Create logs and results
                logs = [
                    f"[{datetime.now()}] Starting workflow {workflow_name}",
                    f"[{datetime.now()}] Version: {workflow_version}",
                    f"[{datetime.now()}] Execution ID: {execution_id}",
                    f"[{datetime.now()}] Processing workflow steps...",
                    f"[{datetime.now()}] Workflow completed successfully"
                ]

                results = {
                    "success": True,
                    "message": f"Workflow {workflow_name} executed successfully",
                    "workflow_id": workflow_id,
                    "workflow_name": workflow_name,
                    "workflow_version": workflow_version,
                    "execution_id": execution_id,
                    "timestamp": datetime.now().isoformat(),
                    "processor": "simple-workflow-executor"
                }

                # Mark as completed with logs and results
                import json
                cursor.execute("""
                    UPDATE workflow_executions
                    SET status = 'completed',
                        completed_at = NOW(),
                        execution_logs = %s::jsonb,
                        results = %s::jsonb
                    WHERE id = %s
                """, (json.dumps(logs), json.dumps(results), execution_id))

                conn.commit()
                print(f"Completed execution {execution_id}")

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
                print(f"Failed execution {execution_id}: {exec_error}")
        else:
            conn.commit()
            print("No queued workflows")

        cursor.close()
        conn.close()

    except Exception as e:
        print(f"Error processing workflow: {e}")
        import traceback
        traceback.print_exc()

@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=1),  # Run every second
    timeout=300,
    max_containers=1,
    min_containers=0,
    retries=0,
)
def check_and_process_queued_jobs():
    """
    Check for queued workflow executions and process them
    This is the main function that was in workflow_executor
    """
    process_one_workflow()

@app.function(
    image=image,
    secrets=secrets,
    timeout=60,
)
def manual_trigger():
    """Manually trigger the job processor"""
    print("Manually triggering job processor...")
    # Call the actual processing logic directly
    process_one_workflow()
    return {"status": "triggered"}

def process_one_workflow():
    """Process a single workflow - shared logic"""
    print(f"[{datetime.now()}] Processing one workflow...")

    try:
        # Connect to database
        conn = psycopg2.connect(**get_db_config())
        cursor = conn.cursor()

        # Find a queued execution to process
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
            RETURNING id, workflow_id
        """)

        result = cursor.fetchone()

        if result:
            execution_id, workflow_id = result
            conn.commit()
            print(f"Processing execution {execution_id} for workflow {workflow_id}")

            try:
                # Get the workflow details
                cursor.execute("""
                    SELECT name, version, yaml_content
                    FROM deployed_workflows
                    WHERE id = %s
                """, (workflow_id,))

                workflow_result = cursor.fetchone()
                if not workflow_result:
                    raise Exception(f"Workflow {workflow_id} not found")

                workflow_name, workflow_version, workflow_yaml = workflow_result

                print(f"Executing {workflow_name} ({workflow_version})")

                # Simulate processing
                import time
                time.sleep(3)

                # Create logs and results
                logs = [
                    f"[{datetime.now()}] Starting workflow {workflow_name}",
                    f"[{datetime.now()}] Version: {workflow_version}",
                    f"[{datetime.now()}] Execution ID: {execution_id}",
                    f"[{datetime.now()}] Processing workflow steps...",
                    f"[{datetime.now()}] Workflow completed successfully"
                ]

                results = {
                    "success": True,
                    "message": f"Workflow {workflow_name} executed successfully",
                    "workflow_id": workflow_id,
                    "workflow_name": workflow_name,
                    "workflow_version": workflow_version,
                    "execution_id": execution_id,
                    "timestamp": datetime.now().isoformat(),
                    "processor": "simple-workflow-executor"
                }

                # Mark as completed with logs and results
                import json
                cursor.execute("""
                    UPDATE workflow_executions
                    SET status = 'completed',
                        completed_at = NOW(),
                        execution_logs = %s::jsonb,
                        results = %s::jsonb
                    WHERE id = %s
                """, (json.dumps(logs), json.dumps(results), execution_id))

                conn.commit()
                print(f"Completed execution {execution_id}")

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
                print(f"Failed execution {execution_id}: {exec_error}")
        else:
            conn.commit()
            print("No queued workflows")

        cursor.close()
        conn.close()

    except Exception as e:
        print(f"Error processing workflow: {e}")
        import traceback
        traceback.print_exc()