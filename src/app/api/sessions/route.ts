import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // These should be in environment variables, but for now, we'll use them directly
    // Be sure to move them to your .env.local file for production
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const { data: lowLevelEvents, error: lowLevelError } = await supabase
      .from('low_level_events')
      .select('session_id');

    if (lowLevelError) {
      console.error('[api/sessions] Error fetching low level event sessions:', lowLevelError);
      return NextResponse.json({ error: lowLevelError.message }, { status: 500 });
    }

    const { data: webRecorderEvents, error: webRecorderError } = await supabase
      .from('user_activity_data')
      .select('session_id');

    if (webRecorderError) {
      console.error('[api/sessions] Error fetching web recorder sessions:', webRecorderError);
      return NextResponse.json({ error: webRecorderError.message }, { status: 500 });
    }

    const lowLevelSessions = [...new Set(lowLevelEvents?.map(item => item.session_id) || [])];
    const webSessions = [...new Set(webRecorderEvents?.map(item => item.session_id) || [])];
    
    return NextResponse.json({ lowLevel: lowLevelSessions, web: webSessions });
  } catch (err) {
    console.error('[api/sessions] Failed to get sessions:', err);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
} 