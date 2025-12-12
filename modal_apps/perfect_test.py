"""
Perfect test with exact format UI expects
"""
import modal
import os
import psycopg2
import json
from datetime import datetime

app = modal.App("perfect-test")

image = modal.Image.debian_slim().pip_install([
    "psycopg2-binary",
])

secrets = [
    modal.Secret.from_name("supabase-secret"),
]

@app.function(
    image=image,
    secrets=secrets,
    timeout=30,
)
def create_perfect_test():
    """Create a test with EXACT format the UI expects"""
    print("Creating perfect test execution...")

    try:
        conn = psycopg2.connect(
            host=os.environ.get('SUPABASE_HOST'),
            port=5432,
            database='postgres',
            user=os.environ.get('SUPABASE_USER'),
            password=os.environ.get('SUPABASE_PASSWORD')
        )
        cursor = conn.cursor()

        # Create a new execution
        cursor.execute("""
            INSERT INTO workflow_executions (workflow_id, client_id, status, execution_params)
            VALUES (21, 1, 'completed', %s)
            RETURNING id
        """, (json.dumps({"test": True}),))

        exec_id = cursor.fetchone()[0]

        # Create logs in EXACT format UI expects
        logs = [
            {
                "timestamp": datetime.now().isoformat(),
                "level": "info",
                "message": "Starting workflow execution"
            },
            {
                "timestamp": datetime.now().isoformat(),
                "level": "info",
                "message": "Initializing browser context"
            },
            {
                "timestamp": datetime.now().isoformat(),
                "level": "info",
                "message": "Navigating to target page"
            },
            {
                "timestamp": datetime.now().isoformat(),
                "level": "success",
                "message": "Page loaded successfully"
            },
            {
                "timestamp": datetime.now().isoformat(),
                "level": "info",
                "message": "Extracting data from page"
            },
            {
                "timestamp": datetime.now().isoformat(),
                "level": "success",
                "message": "Workflow completed successfully!"
            }
        ]

        # Create results
        results = {
            "success": True,
            "execution_id": exec_id,
            "workflow_name": "Test Workflow",
            "data": {
                "extracted": True,
                "items": 42,
                "status": "SUCCESS"
            },
            "mediar_parser": [
                {
                    "field1": "value1",
                    "field2": "value2",
                    "field3": "value3"
                }
            ]
        }

        # Update with logs and results
        cursor.execute("""
            UPDATE workflow_executions
            SET execution_logs = %s::jsonb,
                results = %s::jsonb,
                started_at = NOW(),
                completed_at = NOW()
            WHERE id = %s
        """, (json.dumps(logs), json.dumps(results), exec_id))

        conn.commit()
        print(f"Created perfect execution {exec_id} with proper logs and results!")

        cursor.close()
        conn.close()

        return {"execution_id": exec_id, "message": "Check the deployments page!"}

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}