import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    const body = await request.json();
    
    console.log(`🚀 Executing workflow ${workflowIdNum} with parameters:`, body);
    
    // Extract parameters from request body
    const { 
      parameters: execution_params = {}, 
      client_id = `web-${Date.now()}`,
      execution_mode = 'async'
    } = body;

    console.log('✅ Extracted execution_params:', execution_params);

    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Check if workflow exists and is executable
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('name, status')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} not found`,
          execution_id: null
        },
        { status: 404 }
      );
    }

    if (workflow.status !== 'deployed') {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} is not executable (status: ${workflow.status})`,
          execution_id: null
        },
        { status: 400 }
      );
    }

    // Create execution record in database with 'queued' status
    // Modal scheduled job will pick it up and process it
    const modal_call_id = `modal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const { data: execution, error: executionError } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: workflowIdNum,
        client_id,
        status: 'queued',
        execution_params: execution_params,
        modal_call_id
      })
      .select()
      .single();

    if (executionError) {
      throw executionError;
    }

    console.log(`✅ Created execution ${execution.id} for workflow "${workflow.name}" - will be processed by Modal scheduler`);
    
    // Return immediate response - Modal will process this asynchronously
        return NextResponse.json({ 
      success: true,
      execution_id: execution.id,
      workflow_id: workflowIdNum,
      workflow_name: workflow.name,
      status: 'queued',
      modal_call_id: modal_call_id,
      created_at: new Date().toISOString(),
      execution_mode,
      client_id,
      message: `Workflow execution queued successfully. Modal will process it within 10 seconds. Use execution ID ${execution.id} to monitor progress.`
    }, { status: 200 });

  } catch (error) {
    console.error('❌ Error executing workflow:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute workflow',
        details: error instanceof Error ? error.message : String(error),
        execution_id: null
      },
      { status: 500 }
    );
    }
  }


