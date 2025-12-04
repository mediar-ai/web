import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get the min and max timestamps from low_level_events table
    const { data, error } = await supabaseAdmin
      .from('low_level_events')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);

    const { data: latestData, error: latestError } = await supabaseAdmin
      .from('low_level_events')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || latestError) {
      console.error(`Error fetching data range for user ${userId}:`, error || latestError);
      throw error || latestError;
    }

    if (!data || data.length === 0 || !latestData || latestData.length === 0) {
      return NextResponse.json({ 
        error: 'No data found for this user',
        earliestTimestamp: null,
        latestTimestamp: null 
      }, { status: 404 });
    }

    const earliestTimestamp = data[0].created_at;
    const latestTimestamp = latestData[0].created_at;

    console.log(`Data range for user ${userId}: ${earliestTimestamp} to ${latestTimestamp}`);

    return NextResponse.json({
      earliestTimestamp,
      latestTimestamp,
      totalRangeHours: Math.round(
        (new Date(latestTimestamp).getTime() - new Date(earliestTimestamp).getTime()) / (1000 * 60 * 60)
      )
    });

  } catch (error) {
    console.error('Error fetching user data range:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 