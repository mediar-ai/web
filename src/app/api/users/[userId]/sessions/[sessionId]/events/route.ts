import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { Event } from '@/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface Params {
  params: Promise<{
    userId: string;
    sessionId: string;
  }>;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { userId, sessionId } = await params;
    
    console.log(`[API] Fetching events for user ${userId}, session ${sessionId}`);
    
    // Fetch events from Supabase
    const { data, error } = await supabaseAdmin
      .from('user_activity_data')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('item_type', 'event')
      .order('client_timestamp', { ascending: false });

    if (error) {
      console.error('[API] Error fetching events:', error);
      return NextResponse.json({ error: 'Failed to fetch events', details: error.message }, { status: 500 });
    }

    // Extract the events from the item_data field
    const events: Event[] = data?.map(row => ({
      ...row.item_data,
      timestamp: row.client_timestamp // Ensure timestamp is included
    })) || [];

    console.log(`[API] Found ${events.length} events for session ${sessionId}`);

    return NextResponse.json(events);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API] Critical error in events route:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 