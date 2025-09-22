"""
High Frequency Processor - Combines workflow checking and sync processing
Reduces cron jobs from 2 to 1 for the most frequent tasks
"""
import modal
import asyncio
import time
from datetime import datetime

app = modal.App("high-frequency-processor")

# Image with all necessary dependencies
image = modal.Image.debian_slim().pip_install([
    "aiohttp",
    "psycopg2-binary",
    "pyyaml",
    "httpx",
])

secrets = [
    modal.Secret.from_name("supabase-secret"),
    modal.Secret.from_name("custom-secret"),
]

# Track last run times
last_sync_run = 0

@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Period(seconds=1),  # Run every second for workflow checks
    timeout=300,
    max_containers=1,
    min_containers=0,
    retries=0,
)
async def high_frequency_check():
    """
    Combines:
    1. Workflow checking (every 1 second)
    2. Sync processing (every 2 seconds)

    This reduces 2 cron jobs to 1.
    """
    global last_sync_run
    current_time = time.time()

    # Always run workflow check (every 1 second)
    try:
        import sys
        import os
        # Add current directory to path for imports
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from workflow_executor import check_and_process_queued_jobs
        check_and_process_queued_jobs()
    except Exception as e:
        print(f"Workflow check error: {e}")
        import traceback
        traceback.print_exc()

    # Run sync processor every 2 seconds
    if current_time - last_sync_run >= 2:
        try:
            import sys
            import os
            # Add current directory to path for imports
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from sync_processor import backup_sync_and_metadata_processor
            await backup_sync_and_metadata_processor()
            last_sync_run = current_time
        except Exception as e:
            print(f"Sync process error: {e}")
            import traceback
            traceback.print_exc()