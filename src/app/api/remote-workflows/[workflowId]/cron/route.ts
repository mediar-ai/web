import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * PATCH /api/remote-workflows/[workflowId]/cron - Toggle cron schedule
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'enabled field must be a boolean' },
        { status: 400 }
      );
    }

    console.log(`🔄 ${enabled ? 'Enabling' : 'Disabling'} cron schedule for workflow ${workflowIdNum}`);

    // Update the cron_enabled status
    const { data: updatedWorkflow, error } = await supabase
      .from('deployed_workflows')
      .update({ 
        cron_enabled: enabled,
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowIdNum)
      .select('id, name, cron_expression, cron_enabled, cron_timezone')
      .single();

    if (error) {
      console.error('❌ Error updating cron schedule:', error);
      return NextResponse.json(
        { success: false, error: `Failed to update cron schedule: ${error.message}` },
        { status: 500 }
      );
    }

    if (!updatedWorkflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    console.log(`✅ Cron schedule ${enabled ? 'enabled' : 'disabled'} for workflow: ${updatedWorkflow.name}`);

    return NextResponse.json({
      success: true,
      workflow: updatedWorkflow,
      message: `Cron schedule ${enabled ? 'enabled' : 'disabled'} successfully`
    });

  } catch (error) {
    console.error('❌ Cron toggle error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/remote-workflows/[workflowId]/cron - Get cron schedule info
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    const { data: workflow, error } = await supabase
      .from('deployed_workflows')
      .select(`
        id,
        name,
        cron_expression,
        cron_timezone,
        cron_enabled,
        last_scheduled_execution,
        next_scheduled_execution,
        cron_max_concurrent,
        cron_retry_on_failure,
        cron_retry_count
      `)
      .eq('id', workflowIdNum)
      .single();

    if (error || !workflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      cron_config: workflow
    });

  } catch (error) {
    console.error('❌ Error fetching cron config:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
