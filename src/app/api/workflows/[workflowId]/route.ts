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

  try {
    const { data, error } = await supabaseAdmin
      .from('low_level_workflows')
      .update({
          title: updatedData.title,
          inputs: updatedData.inputs,
          outputs: updatedData.outputs,
          steps: updatedData.steps,
          business_logic: updatedData.businessLogic,
          chat_history: updatedData.chat_history,
      })
      .eq('id', workflowId)
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