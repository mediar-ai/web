import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const { workflowId } = await params;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    const body = await req.json();
    const { 
      client_id, 
      execution_params = {}, 
      webhook_url, 
      priority = 5,
      execution_mode = 'async' // 'sync' or 'async'
    } = body;

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
    }

    // Validate workflow exists and is deployable
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, deployment_status, modal_function_name, input_parameters, estimated_duration_seconds')
      .eq('id', workflowId)
      .eq('status', 'active')
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    if (workflow.deployment_status !== 'deployed') {
      return NextResponse.json({ 
        error: 'Workflow not available for execution', 
        deployment_status: workflow.deployment_status 
      }, { status: 400 });
    }

    // Validate input parameters against schema
    const inputSchema = workflow.input_parameters;
    const validationResult = validateInputs(execution_params, inputSchema);
    if (!validationResult.valid) {
      return NextResponse.json({ 
        error: 'Invalid input parameters', 
        details: validationResult.errors 
      }, { status: 400 });
    }

    // Create execution record
    const { data: execution, error: executionError } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: parseInt(workflowId),
        client_id,
        client_ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
        user_agent: req.headers.get('user-agent'),
        execution_params,
        priority,
        status: 'queued'
      })
      .select()
      .single();

    if (executionError) throw executionError;

    // Get full workflow definition for Modal execution
    const { data: fullWorkflow, error: fullWorkflowError } = await supabase
      .from('deployed_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();

    if (fullWorkflowError) throw fullWorkflowError;

    // Import Modal integration functions
    const { triggerModalExecution, mockModalExecution } = await import('@/lib/modalIntegration');
    
    let modalResult;
    let modalCallId;
    
    // Use mock execution in development, real Modal in production
    const useMockExecution = process.env.NODE_ENV === 'development' || !process.env.MODAL_TOKEN;
    
    if (useMockExecution) {
      // Mock execution for development
      modalCallId = `mock_${execution.id}_${Date.now()}`;
      
      // Update execution status to running
      await supabase
        .from('workflow_executions')
        .update({ 
          modal_call_id: modalCallId,
          status: 'running',
          started_at: new Date().toISOString()
        })
        .eq('id', execution.id);
      
      // Trigger mock execution asynchronously
      if (execution_mode === 'async') {
        // Don't await - let it run in background
        mockModalExecution(execution.id, fullWorkflow, execution_params)
          .then(async (result) => {
            // Update execution with results
            await supabase
              .from('workflow_executions')
              .update({
                status: result.success ? 'completed' : 'failed',
                results: result.results,
                execution_logs: result.execution_logs,
                screenshots: result.screenshots,
                error_message: result.error,
                completed_at: new Date().toISOString(),
                execution_duration_seconds: result.execution_duration_seconds
              })
              .eq('id', execution.id);
          })
          .catch(async (error) => {
            await supabase
              .from('workflow_executions')
              .update({
                status: 'failed',
                error_message: error.message,
                completed_at: new Date().toISOString()
              })
              .eq('id', execution.id);
          });
      } else {
        // Sync mode - wait for completion
        const mockResult = await mockModalExecution(execution.id, fullWorkflow, execution_params);
        await supabase
          .from('workflow_executions')
          .update({
            status: mockResult.success ? 'completed' : 'failed',
            results: mockResult.results,
            execution_logs: mockResult.execution_logs,
            screenshots: mockResult.screenshots,
            error_message: mockResult.error,
            completed_at: new Date().toISOString(),
            execution_duration_seconds: mockResult.execution_duration_seconds
          })
          .eq('id', execution.id);
      }
    } else {
      // Real Modal execution
      modalResult = await triggerModalExecution(execution.id, fullWorkflow, execution_params);
      
      if (!modalResult.success) {
        // Modal trigger failed
        await supabase
          .from('workflow_executions')
          .update({ 
            status: 'failed',
            error_message: `Modal execution failed: ${modalResult.error}`,
            completed_at: new Date().toISOString()
          })
          .eq('id', execution.id);
          
        return NextResponse.json({ 
          error: 'Failed to start workflow execution', 
          details: modalResult.error 
        }, { status: 500 });
      }
      
      modalCallId = modalResult.modalCallId;
      
      // Update execution with Modal call ID
      await supabase
        .from('workflow_executions')
        .update({ 
          modal_call_id: modalCallId,
          status: execution_mode === 'sync' ? 'running' : 'queued'
        })
        .eq('id', execution.id);
    }
    const response = {
      execution_id: execution.id,
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      status: execution_mode === 'sync' ? 'running' : 'queued',
      modal_call_id: modalCallId,
      estimated_duration_seconds: workflow.estimated_duration_seconds,
      execution_mode,
      webhook_url,
      created_at: execution.created_at,
      
      // URLs for tracking
      status_url: `/api/remote-workflows/executions/${execution.id}/status`,
      results_url: `/api/remote-workflows/executions/${execution.id}/results`,
      logs_url: `/api/remote-workflows/executions/${execution.id}/logs`
    };

    // Execution has been triggered above

    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('Error executing workflow:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

// Input validation helper
function validateInputs(params: Record<string, unknown>, schema: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!schema || !schema.required) {
    return { valid: true, errors: [] };
  }

  // Check required parameters
  for (const [key, definition] of Object.entries(schema.required || {})) {
    if (!(key in params)) {
      errors.push(`Missing required parameter: ${key}`);
      continue;
    }

    const value = params[key];
    const def = definition as Record<string, unknown>;

    // Type validation
    if (def.type === 'string' && typeof value !== 'string') {
      errors.push(`Parameter '${key}' must be a string`);
    }
    if (def.type === 'number' && typeof value !== 'number') {
      errors.push(`Parameter '${key}' must be a number`);
    }
    if (def.type === 'enum' && Array.isArray(def.values) && !def.values.includes(value)) {
      errors.push(`Parameter '${key}' must be one of: ${def.values.join(', ')}`);
    }

    // Format validation
    if (def.format === 'MM/DD/YYYY' && typeof value === 'string') {
      const dateRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
      if (!dateRegex.test(value)) {
        errors.push(`Parameter '${key}' must be in MM/DD/YYYY format`);
      }
    }

    // Length validation
    if (def.length && typeof value === 'string' && value.length !== def.length) {
      errors.push(`Parameter '${key}' must be exactly ${def.length} characters`);
    }
  }

  return { valid: errors.length === 0, errors };
}
