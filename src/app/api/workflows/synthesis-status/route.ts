import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing required "sessionId" parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase environment variables');
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('synthesis_sessions')
      .select('orchestration_status, orchestration_progress, orchestration_data, final_result_url')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw new Error(`Failed to fetch synthesis session: ${sessionError.message}`);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...session });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to fetch synthesis status', details: errorMessage }, { status: 500 });
  }
} 