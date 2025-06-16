import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; sessionId: string }> }
) {
  const { searchParams } = new URL(request.url);
  const targetTimestamp = searchParams.get('timestamp');
  const { userId, sessionId } = await params;

  if (!targetTimestamp) {
    return NextResponse.json({ error: 'Timestamp is required' }, { status: 400 });
  }
  
  // The JS timestamp is in milliseconds, which is what our SQL function now expects
  const targetEpoch = new Date(targetTimestamp).getTime().toString();

  try {
    const { data, error } = await supabaseAdmin.rpc('find_closest_screenshot', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_target_timestamp_text: targetEpoch,
    });

    if (error) {
      console.error('[API/find-closest-screenshot] RPC Error:', error);
      throw error;
    }

    if (!data) {
      return NextResponse.json({ error: 'No suitable screenshot found.' }, { status: 404 });
    }
    
    // The RPC function now returns a JSON object with all the data we need.
    const { filename, screenshot_timestamp, event_timestamp } = data;
    
    const imagePath = `${userId}/${sessionId}/screenshots/${filename}`;
    
    const { data: urlData } = supabaseAdmin.storage
      .from('low-level-event-screenshots')
      .getPublicUrl(imagePath);

    return NextResponse.json({ 
      url: urlData.publicUrl, 
      screenshotTimestamp: screenshot_timestamp,
      eventTimestamp: event_timestamp
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
    console.error('[API/find-closest-screenshot] Critical error:', err);
    return NextResponse.json({ error: 'Failed to find screenshot', details: errorMessage }, { status: 500 });
  }
} 