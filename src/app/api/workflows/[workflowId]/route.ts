import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  const updatedData = await req.json();

  if (!workflowId) {
    return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 });
  }

  if (!updatedData.userId) {
    return NextResponse.json({ error: 'Missing userId in request' }, { status: 400 });
  }

  try {
    // Handle both old and new data formats for backward compatibility
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
      .eq('user_id', updatedData.userId)
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

  if (!workflowId) {
    return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from('low_level_workflows')
      .delete()
      .eq('id', workflowId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, message: `Deleted workflow ${workflowId}` });

  } catch (error) {
    console.error(`Error deleting workflow ${workflowId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 