import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Convert pool steps to full workflow YAML
function createWorkflowYaml(name: string, description: string, steps: any[]): string {
  let yaml = `name: ${name}\n`;
  yaml += `description: ${description}\n`;
  yaml += `version: 1.0.0\n\n`;
  yaml += `steps:\n`;

  const yamlSteps = steps.map((step, index) => {
    const stepId = step.step_id || `step_${index + 1}`;
    let stepYaml = `  - id: ${stepId}\n`;
    stepYaml += `    tool_name: ${step.tool_name}\n`;

    if (step.step_name) {
      stepYaml += `    name: ${step.step_name}\n`;
    }

    if (step.arguments && Object.keys(step.arguments).length > 0) {
      stepYaml += `    arguments:\n`;
      for (const [key, value] of Object.entries(step.arguments)) {
        if (typeof value === 'object' && value !== null) {
          stepYaml += `      ${key}: ${JSON.stringify(value)}\n`;
        } else if (typeof value === 'string' && value.includes('\n')) {
          // Handle multi-line strings
          stepYaml += `      ${key}: |\n`;
          const lines = value.split('\n');
          lines.forEach(line => {
            stepYaml += `        ${line}\n`;
          });
        } else {
          stepYaml += `      ${key}: ${value}\n`;
        }
      }
    }

    // Add success criteria if we have result data
    if (step.result && step.succeeded) {
      stepYaml += `    on_success:\n`;
      stepYaml += `      continue: true\n`;
    }

    // Add retry logic for failed steps that were retried
    if (!step.succeeded && step.error) {
      stepYaml += `    on_error:\n`;
      stepYaml += `      retry: 3\n`;
      stepYaml += `      delay: 1000\n`;
    }

    return stepYaml;
  });

  yaml += yamlSteps.join('\n');
  return yaml;
}

// CORS headers for cross-origin requests from Tauri app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// OPTIONS: Handle CORS preflight requests
export async function OPTIONS(_request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders });
}

// POST: Create a new workflow from selected pool steps
export async function POST(request: NextRequest) {
  try {
    // Dual authentication: Desktop token or Clerk session
    let authenticatedUserId: string | null = null;
    let userEmail: string | null = null;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import('@/lib/auth/validateDesktopToken');
      const validation = await validateDesktopToken(token);

      if (validation.valid) {
        authenticatedUserId = validation.userId!;
        userEmail = validation.email || null;
      }
    }

    // Fall back to Clerk auth if no valid desktop token
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
      userEmail = clerkAuth.sessionClaims?.email as string || null;
    }

    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.step_ids || !Array.isArray(body.step_ids)) {
      return NextResponse.json(
        { success: false, error: 'name and step_ids array are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const {
      name,
      description = '',
      step_ids,
      session_id,
      organization_id,
      is_public = false,
      category = 'custom'
    } = body;

    // Fetch the selected steps
    const { data: steps, error: fetchError } = await supabase
      .from('user_step_pool')
      .select('*')
      .in('id', step_ids)
      .eq('user_id', authenticatedUserId)
      .eq('status', 'active')
      .order('pool_order', { ascending: true });

    if (fetchError || !steps || steps.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch pool steps or no steps found' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Create workflow YAML from steps
    const workflowYaml = createWorkflowYaml(name, description, steps);

    // Create automation sequence JSON (for backward compatibility)
    const automationSequence = {
      name,
      description,
      version: '1.0.0',
      steps: steps.map((step, index) => ({
        id: step.step_id || `step_${index + 1}`,
        tool_name: step.tool_name,
        name: step.step_name || step.tool_name,
        arguments: step.arguments || {},
        timeout: step.duration_ms ? step.duration_ms * 2 : 30000, // Double actual duration for timeout
        retries: step.succeeded ? 1 : 3,
        continueOnError: false
      }))
    };

    // Create the new workflow
    const workflowData = {
      name,
      description,
      automation_sequence: automationSequence,
      automation_sequence_yaml: workflowYaml,
      created_by: userEmail || authenticatedUserId || null, // Store email or user ID for author tracking
      organization_id: organization_id || null,
      is_public,
      category,
      status: 'active',
      version: '1.0.0',
      total_versions: 1,
      total_executions: 0,
      successful_executions: 0,
      failed_executions: 0,
      step_count: steps.length, // Computed step count for list display
      average_duration_seconds: Math.round(
        steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0) / 1000
      )
    };

    const { data: newWorkflow, error: createError } = await supabase
      .from('deployed_workflows')
      .insert([workflowData])
      .select()
      .single();

    if (createError) {
      console.error('Error creating workflow:', createError);
      return NextResponse.json(
        { success: false, error: 'Failed to create workflow' },
        { status: 500, headers: corsHeaders }
      );
    }

    // Mark steps as added to workflow
    const { error: markError } = await supabase
      .from('user_step_pool')
      .update({
        status: 'added_to_workflow',
        added_to_workflow_id: newWorkflow.id,
        added_to_workflow_at: new Date().toISOString(),
        is_selected: false
      })
      .in('id', step_ids)
      .eq('user_id', authenticatedUserId);

    if (markError) {
      console.error('Error marking steps as added:', markError);
      // Non-critical error, continue
    }

    // Get remaining active steps count if session provided
    let remainingSteps = null;
    if (session_id) {
      const { count } = await supabase
        .from('user_step_pool')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', session_id)
        .eq('status', 'active')
        .eq('user_id', authenticatedUserId);

      remainingSteps = count;
    }

    return NextResponse.json({
      success: true,
      workflow: {
        id: newWorkflow.id,
        name: newWorkflow.name,
        description: newWorkflow.description,
        version: newWorkflow.version,
        step_count: steps.length
      },
      steps_added: steps.length,
      remaining_pool_steps: remainingSteps
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Error in POST /api/step-pool/create-workflow:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}