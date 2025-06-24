import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { session_id, user_id, payload } = body;

    if (!session_id || !payload || !payload.type) {
      return NextResponse.json({ error: 'session_id and payload with a type are required' }, { status: 400 });
    }

    // Extract the actual event timestamp for proper ordering
    const eventTimestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();
    
    const { error: rawInsertError } = await supabaseAdmin
      .from('low_level_events')
      .insert({
        session_id,
        user_id,
        payload: body, // Save the entire request body in the payload column
        source: 'windows_app', // Add a source to distinguish from other potential low-level sources
        created_at: eventTimestamp // Use actual event timestamp for proper chronological ordering
      });

    if (rawInsertError) {
      console.error('[INGEST] Error saving raw event:', rawInsertError);
      return NextResponse.json({ error: 'Failed to save raw event.', details: rawInsertError.message }, { status: 500 });
    }

    // The screenshot_diff events will now be processed by the scheduled Modal job,
    // so the real-time trigger call has been removed to prevent race conditions.

    console.log(`[INGEST] Successfully saved raw event: ${payload.type}`);
    return NextResponse.json({ success: true, message: 'Data ingested' });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[INGEST] Error processing request:', error);
    return NextResponse.json({ 
      error: 'Failed to process request', 
      details: errorMessage,
      type: 'generic_error'
    }, { status: 500 });
  }
}
