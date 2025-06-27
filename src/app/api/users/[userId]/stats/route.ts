import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from('session_metadata')
      .select('event_count, total_ui_steps, processed_event_count, total_labeled_steps, human_labeled_steps')
      .eq('user_id', userId);

    if (sessionsError) {
      console.error(`Error fetching sessions for user ${userId}:`, sessionsError);
      throw sessionsError;
    }

    if (!sessions) {
      return NextResponse.json({
        totalEvents: 0,
        stepsProcessed: 0,
        totalSteps: 0,
        labelingTotal: 0,
        humanLabeled: 0,
      });
    }

    // Aggregate the stats from all of the user's sessions
    const totalEvents = sessions.reduce((sum, s) => sum + (s.event_count || 0), 0);
    const totalUiSteps = sessions.reduce((sum, s) => sum + (s.total_ui_steps || 0), 0);
    const totalProcessedEvents = sessions.reduce((sum, s) => sum + (s.processed_event_count || 0), 0);
    const totalLabeled = sessions.reduce((sum, s) => sum + (s.total_labeled_steps || 0), 0);
    const totalHumanLabeled = sessions.reduce((sum, s) => sum + (s.human_labeled_steps || 0), 0);

    const stats = {
      totalEvents,
      stepsProcessed: totalProcessedEvents,
      totalSteps: totalUiSteps,
      labelingTotal: totalLabeled,
      humanLabeled: totalHumanLabeled,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('An error occurred fetching user stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 