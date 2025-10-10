#!/usr/bin/env python3
"""
Test script for the Rust workflow executor API.

This script demonstrates testing the workflow executor by:
1. Checking API health
2. Creating a test workflow execution
3. Monitoring execution status
4. Verifying results
"""

import requests
import json
import time
import sys
from uuid import uuid4
from datetime import datetime

# Configuration
API_BASE_URL = "http://localhost:8080/api/v1"
MCP_ENDPOINT = "http://localhost:3000"  # Adjust to your MCP server

# Test workflow ID - you'll need to replace with an actual workflow ID from your database
# This would typically be a workflow deployed in your system
TEST_WORKFLOW_ID = "123e4567-e89b-12d3-a456-426614174000"  # Replace with actual ID


def check_health():
    """Check if the API is healthy."""
    try:
        response = requests.get(f"{API_BASE_URL}/health")
        if response.status_code == 200:
            data = response.json()
            print(f"✓ API is healthy: {data}")
            return True
        else:
            print(f"✗ API health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Failed to connect to API: {e}")
        return False


def list_workflows():
    """List available workflows."""
    try:
        response = requests.get(f"{API_BASE_URL}/workflows")
        if response.status_code == 200:
            workflows = response.json()
            print(f"\n✓ Found {len(workflows)} workflows:")
            for wf in workflows:
                print(f"  - ID: {wf.get('id')}")
                print(f"    Name: {wf.get('name')}")
                print(f"    Version: {wf.get('version')}")
                print(f"    Status: {wf.get('status')}")
            return workflows
        else:
            print(f"✗ Failed to list workflows: {response.status_code}")
            return []
    except Exception as e:
        print(f"✗ Failed to list workflows: {e}")
        return []


def create_test_execution(workflow_id, test_params=None):
    """Create a test workflow execution."""
    execution_request = {
        "workflow_id": workflow_id,
        "execution_params": test_params or {
            "test_input": "Hello from test script",
            "timestamp": datetime.now().isoformat()
        },
        "client_id": f"test-client-{uuid4().hex[:8]}",
        "mcp_endpoint": MCP_ENDPOINT
    }

    print(f"\nCreating execution with params: {json.dumps(execution_request, indent=2)}")

    try:
        response = requests.post(
            f"{API_BASE_URL}/executions",
            json=execution_request,
            headers={"Content-Type": "application/json"}
        )

        if response.status_code == 200:
            execution = response.json()
            print(f"✓ Execution created successfully!")
            print(f"  Execution ID: {execution.get('execution_id')}")
            print(f"  Status: {execution.get('status')}")
            print(f"  Message: {execution.get('message')}")
            return execution
        else:
            print(f"✗ Failed to create execution: {response.status_code}")
            print(f"  Response: {response.text}")
            return None
    except Exception as e:
        print(f"✗ Failed to create execution: {e}")
        return None


def get_execution_status(execution_id):
    """Get the status of an execution."""
    try:
        response = requests.get(f"{API_BASE_URL}/executions/{execution_id}")
        if response.status_code == 200:
            return response.json()
        else:
            print(f"✗ Failed to get execution status: {response.status_code}")
            return None
    except Exception as e:
        print(f"✗ Failed to get execution status: {e}")
        return None


def monitor_execution(execution_id, timeout=60):
    """Monitor an execution until completion or timeout."""
    print(f"\nMonitoring execution {execution_id}...")
    start_time = time.time()

    while time.time() - start_time < timeout:
        status = get_execution_status(execution_id)
        if status:
            current_status = status.get('status')
            print(f"  Status: {current_status}")

            if current_status in ['completed', 'failed', 'cancelled']:
                print(f"\n✓ Execution finished with status: {current_status}")
                if status.get('error_message'):
                    print(f"  Error: {status.get('error_message')}")
                if status.get('result'):
                    print(f"  Result: {json.dumps(status.get('result'), indent=2)}")
                return status

            # Show progress if available
            if status.get('completed_steps') is not None and status.get('total_steps'):
                progress = (status.get('completed_steps') / status.get('total_steps')) * 100
                print(f"  Progress: {status.get('completed_steps')}/{status.get('total_steps')} ({progress:.1f}%)")
                if status.get('current_step'):
                    print(f"  Current step: {status.get('current_step')}")

        time.sleep(2)  # Poll every 2 seconds

    print(f"✗ Execution monitoring timed out after {timeout} seconds")
    return None


def test_queue_status():
    """Check queue status."""
    try:
        response = requests.get(f"{API_BASE_URL}/queue/status")
        if response.status_code == 200:
            status = response.json()
            print("\n✓ Queue Status:")
            print(f"  Queued: {status.get('queued_count', 0)}")
            print(f"  Running: {status.get('running_count', 0)}")
            print(f"  Failed: {status.get('failed_count', 0)}")
            print(f"  Completed: {status.get('completed_count', 0)}")
            return status
        else:
            print(f"✗ Failed to get queue status: {response.status_code}")
            return None
    except Exception as e:
        print(f"✗ Failed to get queue status: {e}")
        return None


def main():
    """Run the test workflow."""
    print("=" * 60)
    print("Rust Workflow Executor Test Script")
    print("=" * 60)

    # Step 1: Check API health
    if not check_health():
        print("\n❌ API is not responding. Make sure the Rust executor is running:")
        print("   cd rust-executor && cargo run")
        sys.exit(1)

    # Step 2: List available workflows
    workflows = list_workflows()

    # Use the first workflow if available, otherwise use test ID
    if workflows:
        workflow_id = workflows[0].get('id')
        print(f"\nUsing workflow ID: {workflow_id}")
    else:
        workflow_id = TEST_WORKFLOW_ID
        print(f"\nNo workflows found. Using test workflow ID: {workflow_id}")
        print("Note: This will likely fail if the workflow doesn't exist in the database.")

    # Step 3: Check queue status
    test_queue_status()

    # Step 4: Create and monitor execution
    test_params = {
        "url": "https://example.com",
        "action": "screenshot",
        "test_mode": True
    }

    execution = create_test_execution(workflow_id, test_params)

    if execution:
        execution_id = execution.get('execution_id')

        # If execution was queued, monitor it
        if execution.get('status') in ['queued', 'running']:
            result = monitor_execution(execution_id)

            if result and result.get('status') == 'completed':
                print("\n✅ Test completed successfully!")
            else:
                print("\n⚠️ Test completed with issues")
        elif execution.get('status') == 'completed':
            print("\n✅ Execution completed immediately!")
        else:
            print(f"\n⚠️ Execution returned status: {execution.get('status')}")

    # Step 5: Final queue status
    print("\n" + "=" * 60)
    test_queue_status()

    print("\n" + "=" * 60)
    print("Test completed!")


if __name__ == "__main__":
    main()