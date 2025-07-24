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
  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    // If time range is provided, fetch filtered stats directly from tables
    if (startDate && endDate) {
      const startDateTime = new Date(startDate);
      const endDateTime = new Date(endDate);

      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
      }

      // Fetch filtered raw events count
      const { count: eventsCount, error: eventsError } = await supabaseAdmin
        .from('low_level_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', startDateTime.toISOString())
        .lte('created_at', endDateTime.toISOString());

      if (eventsError) {
        console.error(`Error counting events for user ${userId}:`, eventsError);
        throw eventsError;
      }

      // Fetch filtered analyses count
      const { count: analysesCount, error: analysesError } = await supabaseAdmin
        .from('low_level_workflow_analyses')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('client_timestamp', startDateTime.toISOString())
        .lte('client_timestamp', endDateTime.toISOString());

      if (analysesError) {
        console.error(`Error counting analyses for user ${userId}:`, analysesError);
        throw analysesError;
      }

      // Fetch filtered annotations count
      const { count: annotationsCount, error: annotationsError } = await supabaseAdmin
        .from('raw_timeline_event_annotations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', startDateTime.toISOString())
        .lte('created_at', endDateTime.toISOString());

      if (annotationsError) {
        console.error(`Error counting annotations for user ${userId}:`, annotationsError);
        // Don't throw here, annotations might not exist for this user
      }

      const filteredStats = {
        totalEvents: eventsCount || 0,
        totalAnalyses: analysesCount || 0,
        totalAnnotations: annotationsCount || 0,
        stepsProcessed: analysesCount || 0, // For backward compatibility
        totalSteps: eventsCount || 0, // For backward compatibility  
        labelingTotal: annotationsCount || 0, // For backward compatibility
        llmGeneratedLabeled: 0, // For backward compatibility
      };

      return NextResponse.json(filteredStats);
    }

    // Default behavior - fetch all-time stats from session metadata
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
        llmGeneratedLabeled: 0,
      });
    }

    // Aggregate the stats from all of the user's sessions
    const totalEvents = sessions.reduce((sum, s) => sum + (s.event_count || 0), 0);
    const totalUiSteps = sessions.reduce((sum, s) => sum + (s.total_ui_steps || 0), 0);
    const totalProcessedEvents = sessions.reduce((sum, s) => sum + (s.processed_event_count || 0), 0);
    const totalLabeled = sessions.reduce((sum, s) => sum + (s.total_labeled_steps || 0), 0);
    const totalLlmGeneratedLabeled = sessions.reduce((sum, s) => sum + (s.human_labeled_steps || 0), 0);

    const stats = {
      totalEvents,
      stepsProcessed: totalProcessedEvents,
      totalSteps: totalUiSteps,
      labelingTotal: totalLabeled,
      llmGeneratedLabeled: totalLlmGeneratedLabeled,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('An error occurred fetching user stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 