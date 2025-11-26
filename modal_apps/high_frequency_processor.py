"""
High Frequency Processor - Triggers workflow_executor every second
This is the scheduler that calls the actual workflow processor
"""
import modal
import os
from datetime import datetime

app = modal.App("high-frequency-processor")

# Minimal image - we're just triggering the other function
image = modal.Image.debian_slim()

@app.function(
    image=image,
    schedule=modal.Period(seconds=1),  # Run every second
    timeout=10,  # Quick trigger only
    max_containers=1,
    min_containers=0,
    retries=0,
)
def trigger_workflow_check():
    """
    Triggers the workflow executor's check_and_process_queued_jobs function
    Runs every 1 second to ensure quick processing
    """
    print(f"[{datetime.now()}] Triggering workflow check...")

    try:
        # Import and call the workflow executor function
        from modal import Function

        # Get the deployed workflow-executor function
        workflow_fn = Function.from_name("workflow-executor", "check_and_process_queued_jobs")

        # Trigger it asynchronously
        result = workflow_fn.remote()

        print(f"[{datetime.now()}] Triggered workflow executor")

    except Exception as e:
        print(f"[{datetime.now()}] Error triggering workflow executor: {e}")