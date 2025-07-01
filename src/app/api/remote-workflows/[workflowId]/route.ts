import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    console.log(`⚡ Fast workflow details for ${workflowIdNum} from Vercel...`);
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get workflow details with recent executions in one optimized query
    const [workflowResult, executionsResult] = await Promise.all([
      supabase
        .from('deployed_workflows')
        .select('*')
        .eq('id', workflowIdNum)
        .single(),
      
      supabase
        .from('workflow_executions')
        .select('id, status, started_at, completed_at, execution_duration_seconds, execution_params, error_message, modal_call_id')
        .eq('workflow_id', workflowIdNum)
        .order('created_at', { ascending: false })
        .limit(10)
    ]);

    if (workflowResult.error || !workflowResult.data) {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} not found`,
          timestamp: new Date().toISOString()
        },
        { status: 404 }
      );
    }

    const workflow = workflowResult.data;
    const executions = executionsResult.data || [];

    // Build comprehensive workflow details
    const workflowDetails = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      status: workflow.status,
      
      // Execution Information
      trigger_info: {
        endpoint: `/api/remote-workflows/${workflowIdNum}/execute`,
        method: 'POST',
        required_headers: ['Content-Type: application/json'],
        modal_function: workflow.modal_function_name || 'execute_workflow',
        deployment_status: workflow.deployment_status,
        is_executable: workflow.deployment_status === 'deployed' && workflow.status === 'active'
      },
      
      // Workflow Definition (from database)
      automation_sequence: workflow.automation_sequence,
      validation_checks: workflow.validation_checks,
      error_handling: workflow.error_handling,
      
      // Parameters & I/O
      input_parameters: workflow.input_parameters,
      expected_outputs: workflow.expected_outputs,
      sample_inputs: workflow.sample_inputs,
      
      // Metadata
      estimated_duration_seconds: workflow.estimated_duration_seconds,
      category: workflow.category,
      tags: workflow.tags,
      difficulty_level: workflow.difficulty_level,
      
      // Performance Metrics
      performance_metrics: {
        successful_runs: workflow.successful_runs,
        failed_runs: workflow.failed_runs,
        total_executions: workflow.total_executions,
        success_rate: workflow.total_executions > 0 
          ? Math.round((workflow.successful_runs / workflow.total_executions) * 100) 
          : 0
      },
      
      // Recent Execution History
      recent_executions: executions.map(exec => ({
        execution_id: exec.id,
        status: exec.status,
        started_at: exec.started_at,
        completed_at: exec.completed_at,
        duration_seconds: exec.execution_duration_seconds,
        execution_params: exec.execution_params,
        error_message: exec.error_message,
        modal_call_id: exec.modal_call_id
      })),
      
      // Usage Examples
      usage_examples: {
        curl_example: `curl -X POST \\
  ${process.env.VERCEL_URL || 'https://app.mediar.ai'}/api/remote-workflows/${workflowIdNum}/execute \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(workflow.sample_inputs || {}, null, 2)}'`,
        
        javascript_example: `fetch('/api/remote-workflows/${workflowIdNum}/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(workflow.sample_inputs || {})})
}).then(response => response.json())`
      }
    };

    return NextResponse.json({
      success: true,
      workflow: workflowDetails,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting workflow details:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflow details',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 