import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);





export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, user_id, payload } = body;

    if (!session_id || !payload || !payload.type) {
      return NextResponse.json({ error: 'session_id and payload with a type are required' }, { status: 400 });
    }

    // Extract timestamp for created_at
    const eventTimestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();
    
    console.log(`[INGEST] Processing event for session ${session_id}`);

    const { error } = await supabaseAdmin
      .from('low_level_events')
      .insert({
        session_id,
        user_id,
        payload: body,
        source: 'windows_app',
        created_at: eventTimestamp
      });

    if (error) {
      console.error('[INGEST] Error saving raw event:', error);
      return NextResponse.json({ error: 'Failed to save event' }, { status: 500 });
    }

    console.log(`[INGEST] Successfully saved raw event for session ${session_id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[INGEST] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
