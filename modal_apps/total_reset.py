"""
Total reset - Mark EVERYTHING as completed
"""
import modal
import os
import psycopg2

app = modal.App("total-reset")

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
def reset_everything():
    """Reset ALL workflows to completed regardless of status"""
    print("TOTAL RESET - marking ALL workflows as completed...")

    try:
        conn = psycopg2.connect(
            host=os.environ.get('SUPABASE_HOST'),
            port=5432,
            database='postgres',
            user=os.environ.get('SUPABASE_USER'),
            password=os.environ.get('SUPABASE_PASSWORD')
        )
        cursor = conn.cursor()

        # Mark EVERYTHING as completed - all statuses
        cursor.execute("""
            UPDATE workflow_executions
            SET status = 'completed',
                completed_at = COALESCE(completed_at, NOW())
            WHERE status != 'completed'
            RETURNING id, status
        """)

        results = cursor.fetchall()
        count = cursor.rowcount
        conn.commit()

        print(f"Reset {count} workflows to completed")
        if results:
            for wf_id, old_status in results:
                print(f"  - Workflow {wf_id} was {old_status}")

        cursor.close()
        conn.close()

        return {"reset": count}

    except Exception as e:
        print(f"Error: {e}")
        return {"error": str(e)}