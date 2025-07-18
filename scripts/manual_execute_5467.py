#!/usr/bin/env python3

import modal
import json

def manual_execute_5467():
    """Manually execute execution 5467 using unified workflow executor with machine endpoint"""
    
    # Get the deployed function (unified executor)
    f = modal.Function.from_name("workflow-executor", "execute_workflow")
    
    # Execute with the user's specific insurance quote parameters
    result = f.remote(
        workflow_id=1,
        mcp_endpoint="https://mcp-server-1.ngrok.app",  # Primary Windows VM endpoint
        execution_params={
            "url": "https://v2preview.online.bestplanpro.com/",
            "quote_type": "Face Value", 
            "quote_value": "5000",
            "applicant_dob": "01/15/1985",
            "product_types": [
                "FEX",
                "MedSup",
                "Preneed", 
                "Term"
            ],
            "applicant_state": "California",
            "applicant_gender": "Male",
            "applicant_height": "5 10",
            "applicant_weight": "180",
            "registration_key": "4WV-HJR-SA9",
            "applicant_zip_code": "90210",
            "registration_email": "louis@mediar.ai",
            "policy_coverage_type": "Best Case: Graded Coverage",
            "open_enrollment_status": "Yes",
            "applicant_tobacco_usage": "Never"
        },
        client_id="vm1-manual-test",
        execution_id=5467
    )
    
    print(f"✅ Execution 5467 dispatched using unified executor to Primary Windows VM")
    print(f"📋 Insurance quote parameters:")
    print(f"   • Face Value: $5,000")
    print(f"   • Applicant: Male, DOB 01/15/1985, California")
    print(f"   • Height/Weight: 5'10\", 180 lbs") 
    print(f"   • Coverage: Best Case Graded Coverage")
    print(f"   • Products: FEX, MedSup, Preneed, Term")
    print(f"📋 Modal future: {result}")
    return result

if __name__ == "__main__":
    manual_execute_5467() 