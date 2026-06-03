import modal
import requests
import json
import os
from typing import Dict, Any, Optional
from datetime import datetime

app = modal.App("workflow-synthesis-orchestrator")
app.image = modal.Image.debian_slim().pip_install("requests")

def get_base_url() -> str:
    """Get the base URL for API calls (production mediar.ai domain)"""
    # For Modal deployment, always use the production mediar.ai URL
    return "https://app.mediar.ai"

def parse_sse_response(response) -> Dict[str, Any]:
    """Parse Server-Sent Events response to extract final data"""
    final_data = {}
    
    if not response.text:
        return final_data
    
    # Parse SSE format: data: {json}\n\n
    lines = response.text.split('\n')
    for line in lines:
        if line.startswith('data: '):
            try:
                data = json.loads(line[6:])  # Remove 'data: ' prefix
                if data.get('data'):
                    final_data.update(data['data'])
                # Keep track of the last status and progress
                if 'status' in data:
                    final_data['last_status'] = data['status']
                if 'progress' in data:
                    final_data['last_progress'] = data['progress']
            except json.JSONDecodeError:
                continue
    
    return final_data

@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")],
    timeout=10800,  # 3 hours = 10,800 seconds
    keep_warm=1
)
def orchestrate_workflow_synthesis(
    user_id: str, 
    model: str, 
    start_date: str, 
    end_date: str, 
    user_instructions: str = ""
) -> Dict[str, Any]:
    """
    Run all 5 workflow synthesis steps by calling Vercel endpoints sequentially.
    
    Args:
        user_id: User ID for the workflow synthesis
        model: AI model to use (e.g., 'gemini-2.5-pro')
        start_date: ISO timestamp for start of analysis period
        end_date: ISO timestamp for end of analysis period
        user_instructions: Optional user instructions for synthesis
    
    Returns:
        Dict with success status, step results, and any errors
    """
    
    base_url = get_base_url()
    start_time = datetime.now()
    
    print(f"🚀 Starting workflow synthesis orchestration for user: {user_id}")
    print(f"📅 Time range: {start_date} to {end_date}")
    print(f"🤖 Model: {model}")
    print(f"🌐 Base URL: {base_url}")
    
    results = {
        "success": False,
        "user_id": user_id,
        "model": model,
        "start_time": start_time.isoformat(),
        "steps_completed": 0,
        "step_results": {},
        "final_data": {},
        "error": None
    }
    
    try:
        # Common request headers
        headers = {
            "Content-Type": "application/json"
        }
        
        # Step 1: Initiate workflow analysis
        print("📋 Step 1/5: Initiating workflow analysis...")
        step1_payload = {
            "userId": user_id,
            "model": model,
            "startDate": start_date,
            "endDate": end_date
        }
        
        step1_response = requests.post(
            f"{base_url}/api/initiate-workflow-analysis",
            json=step1_payload,
            headers=headers,
            timeout=1800  # 30 minutes per step
        )
        
        if not step1_response.ok:
            raise Exception(f"Step 1 failed: {step1_response.status_code} - {step1_response.text}")
        
        step1_data = parse_sse_response(step1_response)
        results["step_results"]["step1"] = step1_data
        results["steps_completed"] = 1
        
        print(f"✅ Step 1 complete: Found context and {len(step1_data.get('workflowNames', []))} initial workflows")
        
        # Extract required data for next steps
        workflow_context = step1_data.get('workflowContext')
        draft_workflow_names = step1_data.get('workflowNames', [])
        
        if not workflow_context or not draft_workflow_names:
            raise Exception("Step 1 did not return required data: workflowContext and workflowNames")
        
        # Step 2: Refine workflow list
        print("🔍 Step 2/5: Refining workflow list...")
        step2_payload = {
            "userId": user_id,
            "model": model,
            "workflow_context": workflow_context,
            "draft_workflow_names": draft_workflow_names,
            "startDate": start_date,
            "endDate": end_date
        }
        
        step2_response = requests.post(
            f"{base_url}/api/refine-workflow-list",
            json=step2_payload,
            headers=headers,
            timeout=1800
        )
        
        if not step2_response.ok:
            raise Exception(f"Step 2 failed: {step2_response.status_code} - {step2_response.text}")
        
        step2_data = step2_response.json()
        results["step_results"]["step2"] = step2_data
        results["steps_completed"] = 2
        
        refined_workflow_names = step2_data.get('refined_workflow_names', [])
        print(f"✅ Step 2 complete: Refined to {len(refined_workflow_names)} workflows")
        
        # Step 3: Define workflow boundaries
        print("🎯 Step 3/5: Defining workflow boundaries...")
        step3_payload = {
            "model": model,
            "context": {
                "workflows": [{"workflow_name": name} for name in refined_workflow_names],
                "userId": user_id,
                "userContext": workflow_context,
                "userInstructions": user_instructions
            },
            "startDate": start_date,
            "endDate": end_date
        }
        
        step3_response = requests.post(
            f"{base_url}/api/define-workflow-boundaries",
            json=step3_payload,
            headers=headers,
            timeout=1800
        )
        
        if not step3_response.ok:
            raise Exception(f"Step 3 failed: {step3_response.status_code} - {step3_response.text}")
        
        step3_data = step3_response.json()
        results["step_results"]["step3"] = step3_data
        results["steps_completed"] = 3
        
        workflows_with_boundaries = step3_data.get('workflows', [])
        print(f"✅ Step 3 complete: Defined boundaries for {len(workflows_with_boundaries)} workflows")
        
        # Step 4: Synthesize workflows
        print("⚙️ Step 4/5: Synthesizing workflows...")
        step4_payload = {
            "model": model,
            "context": {
                "workflows": [
                    {
                        "name": wf["workflow_name"],
                        "trigger": wf.get("trigger", ""),
                        "terminator": wf.get("terminator", "")
                    }
                    for wf in workflows_with_boundaries
                ],
                "userId": user_id,
                "workflowContext": workflow_context,
                "userInstructions": user_instructions
            },
            "startDate": start_date,
            "endDate": end_date
        }
        
        step4_response = requests.post(
            f"{base_url}/api/synthesize-workflow",
            json=step4_payload,
            headers=headers,
            timeout=1800
        )
        
        if not step4_response.ok:
            raise Exception(f"Step 4 failed: {step4_response.status_code} - {step4_response.text}")
        
        step4_data = step4_response.json()
        results["step_results"]["step4"] = step4_data
        results["steps_completed"] = 4
        
        synthesized_workflows = step4_data.get('workflows', [])
        print(f"✅ Step 4 complete: Synthesized {len(synthesized_workflows)} complete workflows")
        
        # Step 5: Create timeline mapping
        print("🗓️ Step 5/5: Creating timeline mapping...")
        step5_payload = {
            "userId": user_id,
            "model": model,
            "startDate": start_date,
            "endDate": end_date
        }
        
        step5_response = requests.post(
            f"{base_url}/api/analyze-raw-timeline-events",
            json=step5_payload,
            headers=headers,
            timeout=1800
        )
        
        if not step5_response.ok:
            raise Exception(f"Step 5 failed: {step5_response.status_code} - {step5_response.text}")
        
        step5_data = parse_sse_response(step5_response)
        results["step_results"]["step5"] = step5_data
        results["steps_completed"] = 5
        
        timeline_annotations = step5_data.get('workflow_mappings', [])
        print(f"✅ Step 5 complete: Created {len(timeline_annotations)} timeline mappings")
        
        # Compile final results
        results["final_data"] = {
            "workflowContext": workflow_context,
            "identifiedWorkflowNames": refined_workflow_names,
            "workflowBoundaries": {
                wf["workflow_name"]: {
                    "trigger": wf.get("trigger", ""),
                    "terminator": wf.get("terminator", "")
                }
                for wf in workflows_with_boundaries
            },
            "synthesizedWorkflows": synthesized_workflows,
            "timelineAnnotations": timeline_annotations
        }
        
        results["success"] = True
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        print(f"🎉 All 5 steps completed successfully!")
        print(f"⏱️ Total duration: {duration:.2f} seconds")
        print(f"📊 Final results: {len(synthesized_workflows)} workflows, {len(timeline_annotations)} timeline mappings")
        
        results["end_time"] = end_time.isoformat()
        results["duration_seconds"] = duration
        
        return results
        
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Orchestration failed at step {results['steps_completed'] + 1}: {error_msg}")
        
        results["error"] = error_msg
        results["end_time"] = datetime.now().isoformat()
        results["duration_seconds"] = (datetime.now() - start_time).total_seconds()
        
        return results

# Trigger function for testing
@app.function(
    secrets=[modal.Secret.from_name("supabase-secret")]
)
def trigger_workflow_synthesis_test():
    """Test function to trigger workflow synthesis orchestration"""
    result = orchestrate_workflow_synthesis.remote(
        user_id=os.environ.get("TEST_USER_ID", "00000000-0000-0000-0000-000000000000"),
        model="gemini-2.5-pro", 
        start_date="2025-01-30T00:00:00Z",
        end_date="2025-01-31T23:59:59Z",
        user_instructions="Test orchestration"
    )
    print("Test orchestration result:", result)
    return result 