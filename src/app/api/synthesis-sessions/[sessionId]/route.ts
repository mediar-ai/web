import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { session_state } = await req.json();

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId parameter' }, { status: 400 });
  }

  if (!session_state) {
    return NextResponse.json({ error: 'Missing session_state in request body' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('synthesis_sessions')
      .update({
        session_state: session_state,
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ 
          error: 'Synthesis session not found', 
          message: `Session ${sessionId} has been deleted or does not exist` 
        }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error(`Error updating synthesis session ${sessionId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId parameter' }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from('synthesis_sessions')
      .delete()
      .eq('id', sessionId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, message: `Deleted synthesis session ${sessionId}` });

  } catch (error) {
    console.error(`Error deleting synthesis session ${sessionId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 