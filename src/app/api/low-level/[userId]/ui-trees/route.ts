import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('low_level_events')
      .select('*')
      .eq('user_id', userId)
      .eq('payload->payload->>type', 'ui_tree')
      .order('created_at', { ascending: false });

    if (eventsError) {
      console.error('[API/ui-trees] Error fetching ui_tree events:', eventsError);
      throw eventsError;
    }

    return NextResponse.json({
        events: events || [],
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/ui-trees] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch ui_tree events', details: error.message }, { status: 500 });
  }
} 