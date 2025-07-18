#!/usr/bin/env python3

import modal
import json

def manual_execute_5461():
    """Manually execute execution 5461 using unified workflow executor"""
    
    # Get the deployed function (unified executor)
    f = modal.Function.from_name("workflow-executor", "execute_workflow")
    
    # Execute with the correct parameters for execution 5461
    result = f.remote(
        workflow_id=1,
        mcp_endpoint="https://mcp-server-1.ngrok.app",  # Primary Windows VM endpoint
        execution_params={
            "applicant": {
                "date_of_birth": "05/20/1975",
                "gender": "Female", 
                "height": "5'10\"",
                "weight": "180",
                "state": "TX",
                "zip": "90210",
                "nicotine": "Never"
            },
            "coverage": {
                "face_value": "15000",
                "coverage_type": "Best Case: Graded Coverage"
            },
            "eligibility": {
                "open_enrollment_eligible": True
            },
            "product_types": ["FEX", "MedSup", "Preneed", "Term"]
        },
        client_id="vm1-test-client",
        execution_id=5461
    )
    
    print(f"✅ Execution 5461 dispatched using unified executor")
    print(f"📋 Modal future: {result}")
    return result

if __name__ == "__main__":
    manual_execute_5461() 