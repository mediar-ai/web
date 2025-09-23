"""
Fix data format - Convert logs from array to JSON
"""
import modal
import os
import psycopg2
import json

app = modal.App("fix-data-format")

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
def fix_all_data_formats():
    """Fix data format for all completed executions"""
    print("Fixing data formats...")

    try:
        conn = psycopg2.connect(
            host=os.environ.get('SUPABASE_HOST'),
            port=5432,
            database='postgres',
            user=os.environ.get('SUPABASE_USER'),
            password=os.environ.get('SUPABASE_PASSWORD')
        )
        cursor = conn.cursor()

        # Get all completed executions with logs/results
        cursor.execute("""
            SELECT id, execution_logs, results
            FROM workflow_executions
            WHERE status = 'completed'
              AND (execution_logs IS NOT NULL OR results IS NOT NULL)
            LIMIT 100
        """)

        executions = cursor.fetchall()
        fixed_count = 0

        for exec_id, logs, results in executions:
            print(f"Checking execution {exec_id}")

            # If logs is a list, convert to JSON properly
            if isinstance(logs, list):
                print(f"  Fixing logs format for {exec_id}")
                cursor.execute("""
                    UPDATE workflow_executions
                    SET execution_logs = %s::jsonb
                    WHERE id = %s
                """, (json.dumps(logs), exec_id))
                fixed_count += 1

            # If results is a dict, ensure it's proper JSON
            if isinstance(results, dict) and not isinstance(results, str):
                print(f"  Fixing results format for {exec_id}")
                cursor.execute("""
                    UPDATE workflow_executions
                    SET results = %s::jsonb
                    WHERE id = %s
                """, (json.dumps(results), exec_id))
                fixed_count += 1

        conn.commit()
        print(f"Fixed {fixed_count} data format issues")

        cursor.close()
        conn.close()

        return {"fixed": fixed_count}

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}