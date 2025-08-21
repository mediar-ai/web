import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// POST /api/remote-workflows/[workflowId]/activate/[version] - Activate specific version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string; version: string }> }
) {
  try {
    const { workflowId, version } = await params;
    const workflowIdNum = parseInt(workflowId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify workflow exists
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, version, status')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Check if target version exists
    const { data: targetVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .select('id, version_number, is_active, automation_sequence, change_notes')
      .eq('workflow_id', workflowIdNum)
      .eq('version_number', version)
      .single();

    if (versionError || !targetVersion) {
      return NextResponse.json(
        { success: false, error: `Version ${version} not found for workflow ${workflowIdNum}` },
        { status: 404 }
      );
    }

    // Check if already active
    if (targetVersion.is_active) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Version ${version} is already active`,
          current_version: version
        },
        { status: 400 }
      );
    }

    // Activate the target version using the database function
    const { error: activateError } = await supabase
      .rpc('activate_workflow_version', {
        p_workflow_id: workflowIdNum,
        p_version_number: version
      });

    if (activateError) {
      throw new Error(`Failed to activate version: ${activateError.message}`);
    }

    // Get updated workflow info
    const { data: updatedWorkflow } = await supabase
      .from('deployed_workflows')
      .select('version, current_version_id, updated_at')
      .eq('id', workflowIdNum)
      .single();

    const response = {
      success: true,
      message: `Successfully activated version ${version} for workflow "${workflow.name}"`,
             activation: {
         workflow_id: workflowIdNum,
         workflow_name: workflow.name,
         previous_version: workflow.version,
         activated_version: version,
         activated_at: new Date().toISOString(),
         change_notes: targetVersion.change_notes
       },
      workflow_status: {
        id: workflowIdNum,
        current_version: updatedWorkflow?.version || version,
        current_version_id: updatedWorkflow?.current_version_id,
        status: workflow.status,
        last_updated: updatedWorkflow?.updated_at
      },
      impact: {
        description: 'All new executions will now use this version',
        automation_sequence_updated: true,
        existing_executions_unaffected: true
      }
    };

    console.log(`[SUCCESS] Activated version ${version} for workflow ${workflowIdNum} (${workflow.name})`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('[ERROR] Error activating workflow version:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to activate workflow version',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 