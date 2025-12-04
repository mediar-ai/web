import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: NextRequest) {
  try {
    const { userId, sessionId, analysis, clientTimestamp } = await req.json();

    if (!userId || !sessionId || !analysis || !clientTimestamp) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // The 'analysis' object is the raw V2 output. We just add metadata.
    const structuredOutput = {
      ...analysis,
      schema_version: 'v2',
      generation_timestamp: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .insert([
        {
          user_id: userId,
          session_id: sessionId,
          client_timestamp: clientTimestamp,
          llm_structured_output: structuredOutput,
        },
      ]);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error saving LLM analysis:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 