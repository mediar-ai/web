import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);

    console.log('Resume API called with workflowId:', workflowId, 'parsed:', workflowIdNum);

    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    // Initialize Supabase with service key to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if workflow exists and is currently paused
    console.log('Querying database for workflow ID:', workflowIdNum);
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, status')
      .eq('id', workflowIdNum)
      .single();

    console.log('Database result:', { workflow, workflowError });

    if (workflowError || !workflow) {
      console.log('Workflow not found or error:', workflowError);
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    if (workflow.status !== 'paused') {
      return NextResponse.json(
        { 
          success: false, 
          error: `Workflow ${workflowIdNum} is not paused (current status: ${workflow.status})` 
        },
        { status: 400 }
      );
    }

    // Resume the workflow: set status to 'deployed' and skip next cancellation check
    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update({
        status: 'deployed',
        skip_next_cancellation_check: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowIdNum);

    if (updateError) {
      console.error('Failed to resume workflow:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to resume workflow' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Workflow "${workflow.name}" resumed successfully`,
      workflow: {
        id: workflowIdNum,
        name: workflow.name,
        status: 'deployed',
        skip_next_cancellation_check: true
      }
    });

  } catch (error) {
    console.error('Error in resume workflow API:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
} 