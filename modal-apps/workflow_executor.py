import modal
import json
import time
import random
from datetime import datetime, timezone
from typing import Dict, Any, Optional
import os
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Modal app configuration - lightweight for mock execution
app = modal.App("workflow-executor")

# Create lightweight image for mock execution
image = modal.Image.debian_slim().pip_install([
    "supabase==2.3.4"
])

# Secrets for database access
secrets = [
    modal.Secret.from_name("supabase-secret"),
    modal.Secret.from_name("custom-secret")
]

@app.function(
    image=image,
    secrets=secrets,
    timeout=600,   # 10 minutes for mock execution
    memory=512,    # 512MB memory (much lighter)
    cpu=1.0        # Single CPU sufficient for mock
)
def execute_workflow(workflow_id: int, execution_params: Dict[str, Any] = None, client_id: str = None) -> Dict[str, Any]:
    """
    🚀 MOCK EXECUTION: Simulate workflow execution with realistic timing
    
    This function simulates workflow execution by:
    - Processing each automation step with realistic delays
    - Updating progress in database
    - Generating mock results
    - Handling mock errors occasionally
    
    Args:
        workflow_id: ID of workflow to execute
        execution_params: Input parameters for the workflow
        client_id: Optional client identifier
        
    Returns:
        Dict with execution results and metadata
    """
    start_time = time.time()
    execution_id = None
    
    try:
        from supabase import create_client
        
        # Initialize database connection
        supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
        
        if not supabase_url or not supabase_key:
            raise Exception("Missing Supabase credentials")
            
        supabase = create_client(supabase_url, supabase_key)
        
        logger.info(f"🚀 Starting MOCK workflow execution {workflow_id} on Modal...")
        
        # Get workflow details from database
        workflow_result = supabase.table('deployed_workflows').select('*').eq('id', workflow_id).single().execute()
        
        if not workflow_result.data:
            raise Exception(f"Workflow {workflow_id} not found")
            
        workflow = workflow_result.data
        automation_sequence = workflow.get('automation_sequence', [])
        total_steps = len(automation_sequence)
        
        logger.info(f"📋 Loaded {workflow['name']} - {total_steps} steps to simulate")
        
        # Create execution record
        execution_data = {
            'workflow_id': workflow_id,
            'status': 'running',
            'started_at': datetime.now(timezone.utc).isoformat(),
            'execution_params': execution_params or {},
            'modal_call_id': f"modal-{int(time.time())}-{random.randint(1000, 9999)}",
            'total_steps': total_steps,
            'current_step': 0,
            'progress_percentage': 0
        }
        
        if client_id:
            execution_data['client_id'] = client_id
            
        execution_result = supabase.table('workflow_executions').insert(execution_data).execute()
        execution_id = execution_result.data[0]['id']
        
        logger.info(f"📝 Created execution record {execution_id}")
        
        # Mock execution of workflow steps
        results = _execute_mock_workflow(supabase, execution_id, workflow, execution_params or {})
        
        # Calculate final metrics
        end_time = time.time()
        execution_duration = int(end_time - start_time)
        
        # Update execution with final results
        final_update = {
            'status': 'completed',
            'completed_at': datetime.now(timezone.utc).isoformat(),
            'execution_duration_seconds': execution_duration,
            'results': results,
            'progress_percentage': 100,
            'current_step': total_steps
        }
        
        supabase.table('workflow_executions').update(final_update).eq('id', execution_id).execute()
        
        # Update workflow success metrics
        try:
            supabase.rpc('increment_workflow_success', {'workflow_id': workflow_id}).execute()
        except Exception as rpc_error:
            logger.warning(f"Failed to update workflow success metrics: {rpc_error}")
        
        logger.info(f"✅ Completed mock execution {execution_id} in {execution_duration}s")
        
        return {
            'success': True,
            'execution_id': execution_id,
            'workflow_id': workflow_id,
            'status': 'completed',
            'execution_duration_seconds': execution_duration,
            'results': results,
            'steps_completed': total_steps,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'execution_type': 'mock'
        }
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"❌ Mock workflow execution failed: {error_msg}")
        
        # Update execution with error if we have execution_id
        if execution_id:
            try:
                error_update = {
                    'status': 'failed',
                    'completed_at': datetime.now(timezone.utc).isoformat(),
                    'execution_duration_seconds': int(time.time() - start_time),
                    'error_message': error_msg
                }
                
                from supabase import create_client
                supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
                supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
                supabase = create_client(supabase_url, supabase_key)
                
                supabase.table('workflow_executions').update(error_update).eq('id', execution_id).execute()
                
                try:
                    supabase.rpc('increment_workflow_failure', {'workflow_id': workflow_id}).execute()
                except Exception as rpc_error:
                    logger.warning(f"Failed to update workflow failure metrics: {rpc_error}")
                
            except Exception as update_error:
                logger.error(f"Failed to update error status: {update_error}")
        
        return {
            'success': False,
            'error': error_msg,
            'execution_id': execution_id,
            'workflow_id': workflow_id,
            'execution_duration_seconds': int(time.time() - start_time),
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'execution_type': 'mock'
        }

def _execute_mock_workflow(supabase, execution_id: int, workflow: Dict, params: Dict) -> Dict[str, Any]:
    """
    🎭 Execute mock workflow steps with realistic simulation
    
    This function simulates workflow execution by:
    - Processing each step with random delays
    - Updating progress in real-time
    - Generating realistic mock outputs
    - Occasionally simulating failures (5% chance)
    """
    automation_sequence = workflow.get('automation_sequence', [])
    total_steps = len(automation_sequence)
    
    results = {
        'execution_type': 'mock_simulation',
        'workflow_name': workflow.get('name', 'Unknown Workflow'),
        'executed_steps': [],
        'extracted_data': {},
        'performance_metrics': {
            'total_steps': total_steps,
            'successful_steps': 0,
            'failed_steps': 0,
            'total_execution_time_seconds': 0
        },
        'mock_outputs': {}
    }
    
    logger.info(f"🎭 Starting mock execution of {total_steps} steps...")
    
    for i, step in enumerate(automation_sequence):
        try:
            # Update progress in database
            progress = int((i / total_steps) * 100) if total_steps > 0 else 0
            supabase.table('workflow_executions').update({
                'current_step': i + 1,
                'progress_percentage': progress
            }).eq('id', execution_id).execute()
            
            # Simulate step execution with realistic timing
            step_result = _execute_mock_step(step, params, i + 1)
            
            results['executed_steps'].append(step_result)
            
            if step_result['success']:
                results['performance_metrics']['successful_steps'] += 1
                
                # Generate mock extracted data
                if step.get('action_type') in ['extract_data', 'get_text']:
                    step_key = f"step_{i+1}_{step.get('action_type', 'unknown')}"
                    results['extracted_data'][step_key] = f"Mock extracted data from {step.get('description', 'step')}"
                
                # Generate mock outputs for different step types
                if step.get('action_type') == 'navigate':
                    results['mock_outputs'][f'navigation_step_{i+1}'] = f"Successfully navigated to {step.get('url', 'mock-url')}"
                elif step.get('action_type') == 'fill_input':
                    results['mock_outputs'][f'input_step_{i+1}'] = f"Filled form field with mock data"
                elif step.get('action_type') == 'click':
                    results['mock_outputs'][f'click_step_{i+1}'] = f"Clicked element successfully"
                    
            else:
                results['performance_metrics']['failed_steps'] += 1
                logger.warning(f"Mock step {i+1} failed: {step_result.get('error')}")
                
                # For mock execution, we continue even if a step "fails"
                # In real execution, you might want to stop on critical failures
            
            results['performance_metrics']['total_execution_time_seconds'] += step_result.get('duration_seconds', 0)
            
            # Small delay to make it feel realistic
            time.sleep(random.uniform(0.1, 0.3))
            
        except Exception as step_error:
            logger.error(f"Error in mock step {i+1}: {step_error}")
            results['executed_steps'].append({
                'step_number': i + 1,
                'step_type': step.get('action_type', 'unknown'),
                'success': False,
                'error': str(step_error),
                'duration_seconds': 0
            })
            results['performance_metrics']['failed_steps'] += 1
    
    # Generate final mock result summary
    success_rate = (results['performance_metrics']['successful_steps'] / max(total_steps, 1)) * 100
    
    results['execution_summary'] = {
        'workflow_completed': True,
        'success_rate_percentage': round(success_rate, 2),
        'total_execution_time': results['performance_metrics']['total_execution_time_seconds'],
        'mock_completion_message': f"Mock execution completed successfully for {workflow.get('name', 'workflow')}",
        'generated_outputs_count': len(results['mock_outputs']),
        'extracted_data_points': len(results['extracted_data'])
    }
    
    logger.info(f"✅ Mock execution completed: {results['performance_metrics']['successful_steps']}/{total_steps} steps successful")
    
    return results

def _execute_mock_step(step: Dict, params: Dict, step_number: int) -> Dict[str, Any]:
    """Execute individual mock automation step"""
    step_start = time.time()
    action_type = step.get('action_type', 'unknown')
    
    # Simulate realistic step execution time
    execution_time = random.uniform(0.5, 3.0)
    time.sleep(execution_time)
    
    # 5% chance of mock failure for realistic simulation
    mock_failure = random.random() < 0.05
    
    if mock_failure:
        return {
            'step_number': step_number,
            'step_type': action_type,
            'success': False,
            'error': f"Mock error in {action_type} step: simulated network timeout",
            'duration_seconds': round(time.time() - step_start, 2),
            'mock_step': True
        }
    
    # Generate step-specific mock results
    mock_results = {
        'navigate': f"Mock navigation to {step.get('url', 'https://example.com')}",
        'click': f"Mock click on element {step.get('selector', '.mock-button')}",
        'fill_input': f"Mock filled input {step.get('selector', '#mock-input')} with value",
        'extract_data': f"Mock extracted: '{step.get('expected_text', 'sample data')}'",
        'wait': f"Mock waited {step.get('duration_seconds', 1)} seconds",
        'scroll': f"Mock scrolled to {step.get('selector', 'bottom of page')}",
        'screenshot': f"Mock screenshot captured: mock_screenshot_{step_number}.png"
    }
    
    result_message = mock_results.get(action_type, f"Mock executed {action_type} action")
    
    return {
        'step_number': step_number,
        'step_type': action_type,
        'success': True,
        'result': result_message,
        'duration_seconds': round(time.time() - step_start, 2),
        'mock_step': True,
        'step_description': step.get('description', f'Step {step_number}')
    }

@app.function(image=image, secrets=secrets, timeout=60)
def health_check() -> Dict[str, Any]:
    """
    🏥 MODAL INFRASTRUCTURE: Health check for Modal deployment
    
    Tests Modal-specific capabilities:
    - Container startup time
    - Memory allocation
    - Database connectivity
    - Secret access
    """
    try:
        from supabase import create_client
        
        start_time = time.time()
        health_data = {
            'modal_status': 'healthy',
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'checks': {}
        }
        
        # Test 1: Environment and secrets
        try:
            supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
            supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
            
            if supabase_url and supabase_key:
                health_data['checks']['secrets'] = {'status': 'pass', 'message': 'Environment variables accessible'}
            else:
                health_data['checks']['secrets'] = {'status': 'fail', 'message': 'Missing environment variables'}
        except Exception as e:
            health_data['checks']['secrets'] = {'status': 'error', 'error': str(e)}
        
        # Test 2: Database connectivity
        try:
            supabase = create_client(supabase_url, supabase_key)
            result = supabase.table('deployed_workflows').select('count').limit(1).execute()
            health_data['checks']['database'] = {'status': 'pass', 'message': 'Database connection successful'}
        except Exception as e:
            health_data['checks']['database'] = {'status': 'error', 'error': str(e)}
        
        # Test 3: System resources (lightweight check)
        try:
            health_data['checks']['system'] = {
                'status': 'pass',
                'memory_optimized': True,
                'execution_type': 'mock_simulation'
            }
        except Exception as e:
            health_data['checks']['system'] = {'status': 'error', 'error': str(e)}
        
        # Overall assessment
        failed_checks = [k for k, v in health_data['checks'].items() if v['status'] in ['fail', 'error']]
        
        if failed_checks:
            health_data['modal_status'] = 'degraded'
            health_data['failed_checks'] = failed_checks
        
        health_data['response_time_ms'] = int((time.time() - start_time) * 1000)
        health_data['container_info'] = {
            'modal_environment': True,
            'serverless_compute': True,
            'optimized_for': 'mock_workflow_execution',
            'lightweight_deployment': True
        }
        
        logger.info(f"🏥 Health check completed in {health_data['response_time_ms']}ms - Status: {health_data['modal_status']}")
        
        return health_data
        
    except Exception as e:
        logger.error(f"❌ Health check failed: {e}")
        return {
            'modal_status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'response_time_ms': int((time.time() - start_time) * 1000) if 'start_time' in locals() else 0
        }

# Entry point for Modal deployment
if __name__ == "__main__":
    print("🚀 Workflow Executor Modal App")
    print("🎭 Optimized for lightweight mock execution")
    print("🔗 Vercel handles fast database operations")
    print("⚡ Modal handles mock workflow execution")
    print("\n📋 Available Functions:")
    print("  • execute_workflow() - Mock workflow execution (realistic simulation)")
    print("  • health_check() - Modal infrastructure monitoring")
    print("\n🚀 Moved to Vercel for speed:")
    print("  • list_workflows() -> /api/remote-workflows/list")
    print("  • get_workflow_details() -> /api/remote-workflows/[workflowId]")
    print("  • get_execution_status() -> /api/remote-workflows/executions/[executionId]/status")
    print("  • get_execution_results() -> /api/remote-workflows/executions/[executionId]/results")
    print("  • list_executions() -> /api/remote-workflows/executions")
