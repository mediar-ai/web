import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const { workflowId } = await request.json();

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the workflow
    const { data: workflow, error: workflowError } = await supabase
      .from('remote_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Create a new execution
    const { data: execution, error: execError } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: workflowId,
        status: 'running',
        started_at: new Date().toISOString(),
        execution_params: {}
      })
      .select()
      .single();

    if (execError) {
      console.error('Failed to create execution:', execError);
      return NextResponse.json(
        { error: 'Failed to create execution' },
        { status: 500 }
      );
    }

    // Simulate workflow execution
    console.log(`🚀 Executing workflow ${workflow.name} (${workflowId})`);

    // Parse the workflow YAML to get steps
    let steps = [];
    try {
      // Basic extraction of steps from YAML
      const yamlContent = workflow.yaml_content || '';
      const stepsMatch = yamlContent.match(/steps:[\s\S]*?(?=\n[a-z]|\n$)/);
      if (stepsMatch) {
        // Extract step names
        const stepLines = stepsMatch[0].split('\n').filter(line => line.includes('tool_name:') || line.includes('name:'));
        steps = stepLines.map(line => line.split(':')[1]?.trim()).filter(Boolean);
      }
    } catch {
      console.log('Could not parse steps from workflow');
    }

    const logs = [];
    const startTime = Date.now();

    // Simulate executing each step
    for (let i = 0; i < Math.max(steps.length, 3); i++) {
      const stepName = steps[i] || `Step ${i + 1}`;
      logs.push(`[${new Date().toISOString()}] Executing: ${stepName}`);

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 500));

      logs.push(`[${new Date().toISOString()}] ✓ Completed: ${stepName}`);
    }

    const duration = Date.now() - startTime;

    // Update execution with results
    const { error: updateError } = await supabase
      .from('workflow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        output_data: {
          success: true,
          message: 'Workflow executed successfully',
          steps_executed: steps.length || 3,
          duration_ms: duration,
          logs: logs,
          workflow_info: {
            name: workflow.name,
            version: workflow.version,
            description: workflow.description
          }
        }
      })
      .eq('id', execution.id);

    if (updateError) {
      console.error('Failed to update execution:', updateError);
    }

    return NextResponse.json({
      success: true,
      execution_id: execution.id,
      workflow_name: workflow.name,
      duration_ms: duration,
      steps_executed: steps.length || 3,
      logs: logs
    });

  } catch (error) {
    console.error('Error in test execution:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to test a specific workflow
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');

    if (!workflowId) {
      return NextResponse.json(
        { error: 'workflowId parameter required' },
        { status: 400 }
      );
    }

    // Trigger the workflow execution
    const response = await fetch(new URL('/api/workflows/test-execute', request.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workflowId: parseInt(workflowId) })
    });

    const result = await response.json();

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in GET test execution:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}