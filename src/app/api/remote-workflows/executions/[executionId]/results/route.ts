import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const { executionId } = await params;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    const url = new URL(req.url);
    const includeScreenshots = url.searchParams.get('include_screenshots') === 'true';
    const includeLogs = url.searchParams.get('include_logs') === 'true';

    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        execution_params,
        results,
        execution_logs,
        error_message,
        screenshots,
        queued_at,
        started_at,
        completed_at,
        execution_duration_seconds,
        modal_call_id,
        compute_cost_cents,
        workflow:deployed_workflows(
          id,
          name,
          expected_outputs
        )
      `)
      .eq('id', executionId)
      .single();

    if (error) throw error;
    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // Only return results for completed executions
    if (execution.status !== 'completed') {
      return NextResponse.json({ 
        error: 'Execution not completed', 
        current_status: execution.status,
        message: execution.status === 'failed' 
          ? 'Execution failed. Check logs for details.'
          : 'Execution still in progress. Check status endpoint.'
      }, { status: 400 });
    }

    // Parse and structure results
    const results = execution.results || {};
    const workflow = Array.isArray(execution.workflow) ? execution.workflow[0] : execution.workflow;
    const expectedOutputs = workflow?.expected_outputs || {};

    // Validate results against expected schema
    const validationResult = validateResults(results, expectedOutputs);

    const response = {
      execution_id: execution.id,
      workflow_id: execution.workflow_id,
      workflow_name: workflow?.name,
      status: execution.status,
      
      // Timing information
      queued_at: execution.queued_at,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
      execution_duration_seconds: execution.execution_duration_seconds,
      
      // Input parameters used
      execution_params: execution.execution_params,
      
      // Results data
      results: results,
      results_validation: validationResult,
      
      // Optional data based on query parameters
      ...(includeScreenshots && { screenshots: execution.screenshots || [] }),
      ...(includeLogs && { execution_logs: execution.execution_logs || [] }),
      
      // Billing information
      compute_cost_cents: execution.compute_cost_cents,
      
      // Meta information
      modal_call_id: execution.modal_call_id,
      
      // Download URLs for large data
      download_urls: {
        full_results: `/api/remote-workflows/executions/${execution.id}/download/results`,
        screenshots: execution.screenshots?.length > 0 
          ? `/api/remote-workflows/executions/${execution.id}/download/screenshots`
          : null,
        logs: `/api/remote-workflows/executions/${execution.id}/download/logs`
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching execution results:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

// Validate results against expected output schema
function validateResults(results: Record<string, unknown>, expectedSchema: Record<string, unknown>): { valid: boolean; warnings: string[]; summary: Record<string, unknown> } {
  const warnings: string[] = [];
  const summary: Record<string, unknown> = {};

  if (!expectedSchema || Object.keys(expectedSchema).length === 0) {
    return { valid: true, warnings: ['No output schema defined'], summary: {} };
  }

  for (const [key, definition] of Object.entries(expectedSchema)) {
    const def = definition as Record<string, unknown>;
    const value = results[key];

    summary[key] = {
      expected_type: def.type,
      actual_type: Array.isArray(value) ? 'array' : typeof value,
      present: value !== undefined && value !== null,
      description: def.description
    };

    if (def.required && (value === undefined || value === null)) {
      warnings.push(`Missing expected output: ${key}`);
      continue;
    }

    if (value !== undefined && value !== null) {
      // Type validation
      if (def.type === 'array' && !Array.isArray(value)) {
        warnings.push(`Output '${key}' expected to be array but got ${typeof value}`);
      }
      if (def.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
        warnings.push(`Output '${key}' expected to be object but got ${typeof value}`);
      }
      if (def.type === 'string' && typeof value !== 'string') {
        warnings.push(`Output '${key}' expected to be string but got ${typeof value}`);
      }
      if (def.type === 'number' && typeof value !== 'number') {
        warnings.push(`Output '${key}' expected to be number but got ${typeof value}`);
      }

      // Array length validation
      if (def.type === 'array' && Array.isArray(value)) {
        const summaryObj = summary[key] as Record<string, unknown>;
        summaryObj.count = value.length;
        if (typeof def.min_items === 'number' && value.length < def.min_items) {
          warnings.push(`Output '${key}' has ${value.length} items but expected at least ${def.min_items}`);
        }
        if (typeof def.max_items === 'number' && value.length > def.max_items) {
          warnings.push(`Output '${key}' has ${value.length} items but expected at most ${def.max_items}`);
        }
      }
    }
  }

  return { 
    valid: warnings.length === 0, 
    warnings, 
    summary 
  };
}
