import modal
import os
import requests
import psycopg2

app = modal.App("workflow-analysis-starter")
app.image = modal.Image.debian_slim().pip_install("psycopg2-binary", "requests")

# This script ensures the processing chain is always active if there are pending jobs.

@app.function(
    secrets=[
        modal.Secret.from_name("supabase-secret"),
        modal.Secret.from_name("custom-secret") # For VERCEL_URL
    ],
    schedule=modal.Period(seconds=30),
    timeout=60
)
def kickstart_user_chains():
    print("Running user chain kick-starter...")
    conn = None
    try:
        conn = psycopg2.connect(os.environ["SUPABASE_CONN_STRING"])
        cur = conn.cursor()

        # Find all users who have pending jobs but no jobs currently in progress.
        # This identifies stalled chains.
        cur.execute("""
            SELECT DISTINCT user_id FROM workflow_analysis_jobs
            WHERE status = 'pending'
            AND user_id NOT IN (
                SELECT DISTINCT user_id FROM workflow_analysis_jobs WHERE status = 'in_progress'
            );
        """)
        
        stalled_users = [row[0] for row in cur.fetchall()]

        if not stalled_users:
            print("No stalled user queues found. Exiting.")
            return
            
        print(f"Found {len(stalled_users)} stalled user chain(s). Triggering a worker for each...")
        
        vercel_url = os.environ["VERCEL_URL"]
        trigger_url = f"https://{vercel_url}/api/process-workflow-job"
        
        for user_id in stalled_users:
            print(f"Triggering worker for user: {user_id}")
            try:
                response = requests.post(trigger_url, json={"userId": str(user_id)})
                response.raise_for_status()
                print(f"Successfully triggered worker for user {user_id}. Status: {response.status_code}")
            except Exception as e:
                print(f"Failed to trigger worker for user {user_id}: {e}")

    except Exception as e:
        print(f"An error occurred in the kick-starter: {e}")
    finally:
        if conn:
            cur.close()
            conn.close() 