#!/usr/bin/env python3

import modal
import json

def manual_execute_5455():
    """Manually execute execution 5455 using unified workflow executor"""
    
    # Get the deployed function (unified executor)
    f = modal.Function.from_name("workflow-executor", "execute_workflow")
    
    # Execute with the correct parameters
    result = f.remote(
        workflow_id=1,
        mcp_endpoint="https://mcp-server-1.ngrok.app",  # Primary Windows VM endpoint
        execution_params={"test": "value"},
        client_id="debug-test",
        execution_id=5455
    )
    
    print(f"✅ Execution 5455 dispatched using unified executor")
    print(f"📋 Modal future: {result}")
    return result

if __name__ == "__main__":
    manual_execute_5455() 