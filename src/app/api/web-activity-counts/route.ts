import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * POST /api/web-activity-counts
 * Returns the count of events and activities in the specified time range
 */
export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  try {
    const { userId, startDate, endDate } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing userId parameter' },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Missing startDate or endDate parameters' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Query for events count
    const { count: eventsCount, error: eventsError } = await supabaseAdmin
      .from('user_activity_data')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'web')
      .eq('item_type', 'event')
      .gte('client_timestamp', startDate)
      .lte('client_timestamp', endDate);

    if (eventsError) {
      console.error('Error counting events:', eventsError);
      return NextResponse.json(
        { error: 'Failed to count events', details: eventsError.message },
        { status: 500 }
      );
    }

    // Query for activities count
    const { count: activitiesCount, error: activitiesError } = await supabaseAdmin
      .from('user_activity_data')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'web')
      .eq('item_type', 'activity_item')
      .gte('client_timestamp', startDate)
      .lte('client_timestamp', endDate);

    if (activitiesError) {
      console.error('Error counting activities:', activitiesError);
      return NextResponse.json(
        { error: 'Failed to count activities', details: activitiesError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      eventsCount: eventsCount || 0,
      activitiesCount: activitiesCount || 0,
      startDate,
      endDate,
    });
  } catch (error) {
    console.error('Error in web-activity-counts:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
