"""
Check what's actually stored for an execution
"""
import modal
import os
import psycopg2
import json

app = modal.App("check-execution")

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
def check_execution_data():
    """Check what's stored for execution 10162"""
    print("Checking execution 10162...")

    try:
        conn = psycopg2.connect(
            host=os.environ.get('SUPABASE_HOST'),
            port=5432,
            database='postgres',
            user=os.environ.get('SUPABASE_USER'),
            password=os.environ.get('SUPABASE_PASSWORD')
        )
        cursor = conn.cursor()

        # Get the execution data
        cursor.execute("""
            SELECT id, status, execution_logs, results
            FROM workflow_executions
            WHERE id = 10162
        """)

        result = cursor.fetchone()
        if result:
            exec_id, status, logs, results = result
            print(f"Execution {exec_id}")
            print(f"Status: {status}")
            print(f"Logs type: {type(logs)}")
            print(f"Logs: {logs}")
            print(f"Results type: {type(results)}")
            print(f"Results: {results}")
        else:
            print("Execution 10162 not found")

        cursor.close()
        conn.close()

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()