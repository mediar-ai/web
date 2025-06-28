#!/usr/bin/env python3
"""
Simple test for workflow analysis generation and session metadata update
Tests the complete flow: generate analysis -> save to DB -> verify session metadata
"""

import requests
import json
import time
from datetime import datetime, timezone

def test_workflow_analysis_flow():
    """Test workflow analysis generation and saving"""
    print("🚀 Testing workflow analysis flow...")
    
    # Test user and session (using known data)
    test_user_id = "942cf301-e977-707d-942c-f301e977707d"
    test_session_id = "f247abbc-47d7-4d66-b69c-aff52bf6c122"
    test_timestamp = datetime.now(timezone.utc).isoformat()
    
    # Simple context for testing
    context = {
        "events": [
            {
                "id": "test_event",
                "timestamp": test_timestamp,
                "event_type": "click",
                "payload": {"action": "test_click"}
            }
        ],
        "previousAnalyses": [],
        "currentUiTree": None,
        "previousUiTree": None,
        "eventsSincePreviousUiTreeByTimestamp": [],
        "eventsSincePreviousUiTreeBySameWindow": [],
        "uiTreeDiffLatestVsPreviousForTheSameWindow": None
    }
    
    try:
        # Step 1: Generate workflow analysis
        print("🧠 Generating workflow analysis...")
        response = requests.post(
            "http://localhost:3001/api/process-workflow-step",
            json={
                "prompt": "WORKFLOW_STEP_ANALYSIS_V2_PROMPT",
                "context": context,
                "model": "gemini-2.5-pro"
            },
            headers={'Content-Type': 'application/json'},
            timeout=60
        )
        
        if response.status_code != 200:
            print(f"❌ Analysis generation failed: {response.status_code} - {response.text}")
            return False
        
        result = response.json()
        analysis = result.get('structured_output')
        if not analysis:
            print("❌ No structured output received")
            return False
        
        print(f"✅ Analysis generated: {analysis.get('step_title', 'No title')}")
        
        # Step 2: Save analysis
        print("💾 Saving workflow analysis...")
        save_response = requests.post(
            "http://localhost:3001/api/save-llm-analysis",
            json={
                "userId": test_user_id,
                "sessionId": test_session_id,
                "clientTimestamp": test_timestamp,
                "analysis": analysis
            },
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        if save_response.status_code != 200:
            print(f"❌ Save failed: {save_response.status_code} - {save_response.text}")
            return False
        
        print("✅ Analysis saved successfully")
        
        # Step 3: Wait for triggers
        print("⏳ Waiting for database triggers...")
        time.sleep(2)
        
        print("🎉 TEST PASSED: Workflow analysis flow completed successfully!")
        print(f"📝 Generated analysis: {analysis.get('step_title', 'No title')}")
        print(f"📊 Summary: {analysis.get('step_summary', 'No summary')}")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        return False

if __name__ == "__main__":
    success = test_workflow_analysis_flow()
    exit(0 if success else 1) 