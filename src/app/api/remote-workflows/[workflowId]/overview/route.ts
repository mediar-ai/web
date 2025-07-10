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

  const { data: workflow, error } = await supabase
    .from('deployed_workflows')
    .select(`
      id,
      name,
      description,
      version,
      status,
      deployment_status,
      category,
      tags,
      difficulty_level,
      estimated_duration_seconds,
      successful_runs,
      failed_runs,
      total_executions,
      automation_sequence,
      created_at,
      updated_at
    `)
    .eq('id', workflowId)
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!workflow) {
    return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
  }

  let executionSchema = {};
  let sampleInputs = {};
  let expectedOutputs = {};

  try {
    if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0) {
      const mainSequence = workflow.automation_sequence[0];
      if (mainSequence.arguments) {
        if (mainSequence.arguments.variables) {
          executionSchema = mainSequence.arguments.variables;
          sampleInputs = mainSequence.arguments.variables;
        }
        if (mainSequence.arguments.output_parser && mainSequence.arguments.output_parser.fieldsToExtract) {
          expectedOutputs = Object.keys(mainSequence.arguments.output_parser.fieldsToExtract).reduce((acc, key) => {
            acc[key] = "dynamically extracted";
            return acc;
          }, {} as Record<string, string>);
        }
      }
    }
  } catch (e) {
    console.error(`Error parsing dynamic fields for workflow ${workflow.id}:`, e);
  }

  const responsePayload = {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    version: workflow.version,
    status: workflow.status,
    deployment_status: workflow.deployment_status,
    is_executable: workflow.deployment_status === 'deployed' && workflow.status === 'active',
    category: workflow.category,
    tags: workflow.tags,
    difficulty_level: workflow.difficulty_level,
    estimated_duration_seconds: workflow.estimated_duration_seconds,
    input_parameters: executionSchema,
    expected_outputs: expectedOutputs,
    sample_inputs: sampleInputs,
    performance_metrics: {
      successful_runs: workflow.successful_runs,
      failed_runs: workflow.failed_runs,
      total_executions: workflow.total_executions,
      success_rate: workflow.total_executions > 0
        ? Math.round((workflow.successful_runs / workflow.total_executions) * 100)
        : 0,
    },
    automation_sequence: workflow.automation_sequence,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
  };

  return NextResponse.json({
    success: true,
    workflow: responsePayload,
  });
}
