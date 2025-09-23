#!/usr/bin/env python
"""
External trigger for Modal queue processor
Run this with a cron job or Windows Task Scheduler to process queued workflows
"""

import time
import sys
from modal import Function

def trigger_queue_processing():
    """Trigger the Modal queue processor"""
    try:
        # Get the queue processor function
        queue_processor = Function.from_name('workflow-executor', 'check_and_process_queued_jobs')

        # Trigger it
        result = queue_processor.remote()

        if result:
            status = result.get('status', 'unknown')
            if status == 'jobs_claimed':
                print(f"✓ Processed {result.get('total_dispatched', 0)} jobs")
            elif status == 'no_available_jobs':
                print("• No jobs in queue")
            else:
                print(f"• Status: {status}")
        return True
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == "__main__":
    # Run continuously every second
    print("Queue processor trigger started. Press Ctrl+C to stop.")
    while True:
        try:
            trigger_queue_processing()
            time.sleep(1)  # Wait 1 second before next check
        except KeyboardInterrupt:
            print("\nStopping queue processor trigger")
            sys.exit(0)
        except Exception as e:
            print(f"Error in main loop: {e}")
            time.sleep(5)  # Wait longer on errors