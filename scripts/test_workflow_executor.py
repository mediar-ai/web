#!/usr/bin/env python3
"""
Test script for workflow_executor Modal functions
Run this locally before deploying to Modal to test functionality
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'modal-apps'))

# Mock Modal for local testing
class MockApp:
    def __init__(self, name):
        self.name = name
        self.image = None
    
    def function(self, **kwargs):
        def decorator(func):
            return func
        return decorator

class MockImage:
    @staticmethod
    def debian_slim():
        return MockImage()
    
    def pip_install(self, *packages):
        return self

class MockSecret:
    @staticmethod
    def from_name(name):
        return MockSecret()

# Mock modal module
sys.modules['modal'] = type('MockModal', (), {
    'App': MockApp,
    'Image': MockImage,
    'Secret': MockSecret
})()

# Now import the workflow executor
from workflow_executor import (
    list_workflows,
    get_workflow_details, 
    execute_workflow,
    get_execution_status,
    get_execution_results,
    list_executions,
    health_check
)

def test_list_workflows():
    """Test listing all workflows"""
    print("🧪 Testing list_workflows()...")
    try:
        result = list_workflows()
        print(f"✅ Success: Found {result.get('total_count', 0)} workflows")
        
        if result.get('workflows'):
            first_workflow = result['workflows'][0]
            print(f"   First workflow: {first_workflow.get('name')} (ID: {first_workflow.get('id')})")
            print(f"   Status: {first_workflow.get('deployment_status')}")
            print(f"   Success rate: {first_workflow.get('success_rate')}%")
        
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def test_get_workflow_details(workflow_id=1):
    """Test getting workflow details"""
    print(f"\n🧪 Testing get_workflow_details({workflow_id})...")
    try:
        result = get_workflow_details(workflow_id)
        if result.get('success'):
            workflow = result['workflow']
            print(f"✅ Success: Retrieved details for '{workflow.get('name')}'")
            print(f"   Trigger endpoint: {workflow.get('trigger_info', {}).get('endpoint')}")
            print(f"   Is executable: {workflow.get('trigger_info', {}).get('is_executable')}")
            print(f"   Automation steps: {len(workflow.get('automation_sequence', []))}")
            print(f"   Validation checks: {len(workflow.get('validation_checks', []))}")
            print(f"   Error handling rules: {len(workflow.get('error_handling', []))}")
            print(f"   Recent executions: {len(workflow.get('recent_executions', []))}")
        else:
            print(f"❌ Error: {result.get('error')}")
        
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def test_execute_workflow(workflow_id=1):
    """Test executing a workflow"""
    print(f"\n🧪 Testing execute_workflow({workflow_id})...")
    try:
        # Test with sample parameters
        test_parameters = {
            "test_mode": True,
            "user_id": "test_user_123"
        }
        
        result = execute_workflow(
            workflow_id=workflow_id,
            parameters=test_parameters,
            client_id="test_client_script",
            execution_mode="async"
        )
        
        if result.get('success'):
            print(f"✅ Success: Execution started")
            print(f"   Execution ID: {result.get('execution_id')}")
            print(f"   Status: {result.get('status')}")
            print(f"   Steps completed: {len(result.get('execution_steps', []))}")
            print(f"   Modal call ID: {result.get('modal_call_id')}")
            
            # Print execution summary
            if result.get('results', {}).get('execution_summary'):
                summary = result['results']['execution_summary']
                print(f"   Total steps: {summary.get('total_steps')}")
                print(f"   Successful steps: {summary.get('successful_steps')}")
                print(f"   Failed steps: {summary.get('failed_steps')}")
                print(f"   Total duration: {summary.get('total_duration')}s")
        else:
            print(f"❌ Error: {result.get('error')}")
        
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def test_get_execution_status(execution_id):
    """Test getting execution status"""
    print(f"\n🧪 Testing get_execution_status({execution_id})...")
    try:
        result = get_execution_status(execution_id)
        if result.get('success'):
            execution = result['execution']
            print(f"✅ Success: Retrieved execution status")
            print(f"   Status: {execution.get('status')}")
            print(f"   Workflow: {execution.get('workflow_name')}")
            print(f"   Is running: {execution.get('is_running')}")
            print(f"   Progress: {execution.get('progress_status')}")
            print(f"   Duration: {execution.get('execution_duration_seconds')}s")
        else:
            print(f"❌ Error: {result.get('error')}")
        
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def test_get_execution_results(execution_id):
    """Test getting execution results"""
    print(f"\n🧪 Testing get_execution_results({execution_id})...")
    try:
        result = get_execution_results(execution_id)
        if result.get('success'):
            print(f"✅ Success: Retrieved execution results")
            print(f"   Status: {result.get('status')}")
            print(f"   Workflow: {result.get('workflow_name')}")
            print(f"   Duration: {result.get('execution_duration_seconds')}s")
            if result.get('results'):
                print(f"   Results available: Yes")
        else:
            print(f"❌ Error: {result.get('error')}")
        
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def test_list_executions():
    """Test listing executions"""
    print(f"\n🧪 Testing list_executions()...")
    try:
        result = list_executions(limit=10)
        if result.get('success'):
            executions = result['executions']
            pagination = result['pagination']
            print(f"✅ Success: Retrieved {len(executions)} executions")
            print(f"   Total count: {pagination.get('total_count')}")
            print(f"   Has more: {pagination.get('has_more')}")
            
            if executions:
                recent = executions[0]
                print(f"   Most recent: {recent.get('workflow_name')} - {recent.get('status')}")
        else:
            print(f"❌ Error: {result.get('error')}")
        
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def test_health_check():
    """Test health check"""
    print(f"\n🧪 Testing health_check()...")
    try:
        result = health_check()
        if result.get('status') == 'healthy':
            print(f"✅ Success: System is healthy")
            print(f"   Database: {result.get('database_connection')}")
            
            stats = result.get('system_stats', {})
            workflows = stats.get('workflows', {})
            executions = stats.get('executions_last_24h', {})
            
            print(f"   Workflows: {workflows.get('total')} total, {workflows.get('deployed')} deployed")
            print(f"   Executions (24h): {executions.get('total')} total, {executions.get('running')} running")
        else:
            print(f"❌ Unhealthy: {result.get('error')}")
        
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def main():
    """Run all tests"""
    print("🚀 Starting workflow executor tests...\n")
    
    # Test health check first
    health_result = test_health_check()
    if not health_result or health_result.get('status') != 'healthy':
        print("❌ Health check failed, aborting tests")
        return
    
    # Test workflow listing
    workflows_result = test_list_workflows()
    if not workflows_result or not workflows_result.get('success'):
        print("❌ Cannot list workflows, aborting tests")
        return
    
    # Get first workflow ID for testing
    workflows = workflows_result.get('workflows', [])
    if not workflows:
        print("❌ No workflows found, aborting execution tests")
        return
    
    test_workflow_id = workflows[0]['id']
    print(f"\n📝 Using workflow ID {test_workflow_id} for execution tests")
    
    # Test workflow details
    details_result = test_get_workflow_details(test_workflow_id)
    
    # Test workflow execution
    execution_result = test_execute_workflow(test_workflow_id)
    
    if execution_result and execution_result.get('success'):
        execution_id = execution_result.get('execution_id')
        
        # Test execution status
        test_get_execution_status(execution_id)
        
        # Test execution results
        test_get_execution_results(execution_id)
    
    # Test listing executions
    test_list_executions()
    
    print("\n✅ All tests completed!")

if __name__ == "__main__":
    main() 