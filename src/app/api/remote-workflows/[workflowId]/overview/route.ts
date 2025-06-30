import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
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
    const { data: workflow, error } = await supabase
      .from('deployed_workflows')
      .select(`
        id,
        name,
        description,
        version,
        automation_sequence,
        validation_checks,
        error_handling,
        input_parameters,
        expected_outputs,
        sample_inputs,
        estimated_duration_seconds,
        category,
        tags,
        difficulty_level,
        successful_runs,
        failed_runs,
        total_executions,
        last_successful_execution,
        last_failed_execution,
        deployment_status,
        modal_function_name,
        created_at,
        updated_at
      `)
      .eq('id', workflowId)
      .eq('status', 'active')
      .single();

    if (error) throw error;
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    if (workflow.deployment_status !== 'deployed') {
      return NextResponse.json({ 
        error: 'Workflow not available for execution', 
        deployment_status: workflow.deployment_status 
      }, { status: 400 });
    }

    // Parse automation sequence to extract step information
    const steps = workflow.automation_sequence?.steps || [];
    const stepOverview = steps.map((step: any, index: number) => ({
      step_number: index + 1,
      action: step.action,
      description: step.description,
      estimated_duration: step.estimated_duration || 5 // default 5 seconds per step
    }));

    // Calculate reliability metrics
    const successRate = workflow.total_executions > 0 
      ? Math.round((workflow.successful_runs / workflow.total_executions) * 100) 
      : null;

    const reliabilityScore = workflow.total_executions >= 10 
      ? successRate >= 90 ? 'excellent' :
        successRate >= 80 ? 'good' :
        successRate >= 70 ? 'fair' : 'poor'
      : 'insufficient_data';

    // Extract required applications from steps
    const requiredApps = new Set<string>();
    steps.forEach((step: any) => {
      if (step.action === 'navigate_browser') requiredApps.add('browser');
      if (step.action === 'open_application') requiredApps.add(step.application);
      // Add more app detection logic as needed
    });

    const overview = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      category: workflow.category,
      tags: workflow.tags,
      difficulty_level: workflow.difficulty_level,
      
      // Execution information
      estimated_duration_seconds: workflow.estimated_duration_seconds,
      total_steps: steps.length,
      step_overview: stepOverview,
      required_applications: Array.from(requiredApps),
      
      // Input/Output schema
      input_parameters: workflow.input_parameters,
      expected_outputs: workflow.expected_outputs,
      sample_inputs: workflow.sample_inputs,
      
      // Reliability metrics
      statistics: {
        total_executions: workflow.total_executions,
        successful_runs: workflow.successful_runs,
        failed_runs: workflow.failed_runs,
        success_rate_percent: successRate,
        reliability_score: reliabilityScore,
        last_successful_execution: workflow.last_successful_execution,
        last_failed_execution: workflow.last_failed_execution
      },
      
      // Validation and error handling
      validation_checks: workflow.validation_checks,
      error_handling: workflow.error_handling,
      
      // Deployment info
      deployment_status: workflow.deployment_status,
      modal_function_name: workflow.modal_function_name,
      last_updated: workflow.updated_at
    };

    return NextResponse.json(overview);

  } catch (error) {
    console.error('Error fetching workflow overview:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
