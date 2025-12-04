import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;

  try {
    // 1. Verify authentication
    const { userId: authenticatedUserId } = await auth();

    if (!authenticatedUserId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const updatedData = await req.json();

    if (!workflowId) {
      return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 });
    }

    // 2. Verify workflow ownership BEFORE allowing update
    const { data: existingWorkflow, error: fetchError } = await supabaseAdmin
      .from('low_level_workflows')
      .select('user_id')
      .eq('id', workflowId)
      .single();

    if (fetchError || !existingWorkflow) {
      return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    }

    // 3. Ensure authenticated user owns the workflow
    if (existingWorkflow.user_id !== authenticatedUserId) {
      console.log(`Authorization failed: User ${authenticatedUserId} attempted to modify workflow ${workflowId} owned by ${existingWorkflow.user_id}`);
      return NextResponse.json({ success: false, error: 'Not authorized to modify this workflow' }, { status: 403 });
    }

    // 4. Now safe to update - build update fields
    const updateFields: Record<string, unknown> = {};

    if (updatedData.title) {
      updateFields.title = updatedData.title;
    }

    if (updatedData.chat_history) {
      updateFields.chat_history = updatedData.chat_history;
    }

    // Handle new detailed workflow data format
    if (updatedData.detailed_workflow_data) {
      updateFields.detailed_workflow_data = updatedData.detailed_workflow_data;
    }

    // Handle legacy format for backward compatibility
    if (updatedData.inputs) updateFields.inputs = updatedData.inputs;
    if (updatedData.outputs) updateFields.outputs = updatedData.outputs;
    if (updatedData.steps) updateFields.steps = updatedData.steps;
    if (updatedData.businessLogic) updateFields.business_logic = updatedData.businessLogic;

    const { data, error } = await supabaseAdmin
      .from('low_level_workflows')
      .update(updateFields)
      .eq('id', workflowId)
      .eq('user_id', authenticatedUserId) // Extra safety check
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error(`Error updating workflow ${workflowId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;

  try {
    // 1. Verify authentication
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!workflowId) {
      return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 });
    }

    // 2. Verify workflow ownership BEFORE allowing deletion
    const { data: workflow, error: fetchError } = await supabaseAdmin
      .from('low_level_workflows')
      .select('user_id, title')
      .eq('id', workflowId)
      .single();

    if (fetchError || !workflow) {
      return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    }

    // 3. Ensure authenticated user owns the workflow
    if (workflow.user_id !== userId) {
      console.log(`Authorization failed: User ${userId} attempted to delete workflow ${workflowId} owned by ${workflow.user_id}`);
      return NextResponse.json({ success: false, error: 'Not authorized to delete this workflow' }, { status: 403 });
    }

    // 4. Now safe to delete
    const { error } = await supabaseAdmin
      .from('low_level_workflows')
      .delete()
      .eq('id', workflowId)
      .eq('user_id', userId); // Extra safety check

    if (error) {
      throw error;
    }

    console.log(`User ${userId} successfully deleted workflow ${workflowId} (${workflow.title})`);
    return NextResponse.json({ success: true, message: `Deleted workflow ${workflowId}` });

  } catch (error) {
    console.error(`Error deleting workflow ${workflowId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 