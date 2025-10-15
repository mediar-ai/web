"""
Test script to execute workflow via Modal's Python API
Bypasses CLI type annotation parsing issues
"""

import modal
import json

def test_modal_execution():
    """Execute workflow using Modal's programmatic API"""

    print("[INFO] Looking up Modal function...")

    # Get reference to deployed Modal app
    execute_workflow_func = modal.Function.lookup("workflow-executor", "execute_workflow")

    print("[OK] Found function: execute_workflow")
    print("\n[UPLOAD] Executing workflow...")
    print("  - Workflow ID: 74")
    print("  - MCP Endpoint: http://20.163.215.81:8080/mcp")

    # Call function programmatically (bypasses CLI type parsing)
    result = execute_workflow_func.remote(
        workflow_id=74,
        mcp_endpoint="http://20.163.215.81:8080/mcp"
    )

    print("\n[DOWNLOAD] Execution completed!")
    print("\n--- Results ---")
    print(json.dumps(result, indent=2))

    # Check for screenshots in result
    if "screenshots" in result:
        screenshot_count = len(result["screenshots"])
        print(f"\n[SCREENSHOT] Screenshots captured: {screenshot_count}")
        if screenshot_count > 0:
            print(f"   First screenshot (80 chars): {result['screenshots'][0][:80]}...")
    else:
        print("\n[WARNING] No screenshots found in result")

    return result

if __name__ == "__main__":
    test_modal_execution()
