import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { ActivityItem } from '@/types';

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
    
    console.log(`[API] Fetching activities for user ${userId}, session ${sessionId}`);
    
    // Fetch activity items from Supabase
    const { data, error } = await supabaseAdmin
      .from('user_activity_data')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('item_type', 'activity_item')
      .order('client_timestamp', { ascending: false });

    if (error) {
      console.error('[API] Error fetching activities:', error);
      return NextResponse.json({ error: 'Failed to fetch activities', details: error.message }, { status: 500 });
    }

    // Extract the activity items from the item_data field
    const activities: ActivityItem[] = data?.map(row => ({
      ...row.item_data,
      user_id: row.user_id,
      session_id: row.session_id,
      timestamp: row.client_timestamp
    })) || [];

    console.log(`[API] Found ${activities.length} activities for session ${sessionId}`);

    return NextResponse.json(activities);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API] Critical error in activities route:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 