import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    console.log(`[api/users/${userId}/stats] Fetching user stats`);

    const url = new URL(req.url);
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    if (startDate && endDate) {
      // For time-filtered stats, use direct startDate/endDate filtering (same as other working APIs)
      console.log(`[api/users/${userId}/stats] Time filtering: ${startDate} to ${endDate}`);
      
      // Get filtered events count (use created_at for low_level_events)
      const { count: eventsCount, error: eventsError } = await supabaseAdmin
        .from('low_level_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', startDate)
        .lte('created_at', endDate);

      if (eventsError) {
        console.error(`Error counting filtered events for user ${userId}:`, eventsError);
        throw eventsError;
      }

      // Get filtered analyses count (use client_timestamp for analyses)
      const { count: analysesCount, error: analysesError } = await supabaseAdmin
        .from('low_level_workflow_analyses')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('client_timestamp', startDate)
        .lte('client_timestamp', endDate);

      if (analysesError) {
        console.error(`Error counting filtered analyses for user ${userId}:`, analysesError);
        throw analysesError;
      }

      // Get filtered annotations count
      let annotationsCount = 0;
      let annotationsError = null;

      const { data: userAnalyses, error: userAnalysesError } = await supabaseAdmin
        .from('low_level_workflow_analyses')
        .select('id')
        .eq('user_id', userId)
        .gte('client_timestamp', startDate)
        .lte('client_timestamp', endDate);

      if (userAnalysesError) {
        annotationsError = userAnalysesError;
      } else if (userAnalyses && userAnalyses.length > 0) {
        const analysisIds = userAnalyses.map(a => a.id);
        
        const { count, error } = await supabaseAdmin
          .from('low_level_workflow_labeling')
          .select('*', { count: 'exact', head: true })
          .in('low_level_workflow_analysis_id', analysisIds);
        
        annotationsCount = count || 0;
        annotationsError = error;
      }

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

    // Default behavior - get all-time stats from session metadata (matches admin dashboard)
    console.log(`[api/users/${userId}/stats] Fetching all-time stats from session metadata`);
    
    // Get session metadata for user - this contains the correct processed counts
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from('session_metadata')
      .select('event_count, processed_event_count, total_ui_steps')
      .eq('user_id', userId);

    if (sessionError) {
      console.error(`Error fetching session metadata for user ${userId}:`, sessionError);
      throw sessionError;
    }

    // Aggregate the session data (same way as admin dashboard)
    const totalEvents = sessionData?.reduce((sum, session) => sum + (session.event_count || 0), 0) || 0;
    const totalProcessedEvents = sessionData?.reduce((sum, session) => sum + (session.processed_event_count || 0), 0) || 0;
    const totalUiSteps = sessionData?.reduce((sum, session) => sum + (session.total_ui_steps || 0), 0) || 0;

    // Get total annotations count from correct table
    const { data: allUserAnalyses, error: allUserAnalysesError } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('id')
      .eq('user_id', userId);

    let totalAnnotations = 0;
    if (allUserAnalysesError) {
      console.error(`Error fetching user analyses for annotations count:`, allUserAnalysesError);
    } else if (allUserAnalyses && allUserAnalyses.length > 0) {
      const allAnalysisIds = allUserAnalyses.map(a => a.id);
      
      const { count, error: annotationsError } = await supabaseAdmin
        .from('low_level_workflow_labeling')
        .select('*', { count: 'exact', head: true })
        .in('low_level_workflow_analysis_id', allAnalysisIds);
      
      if (annotationsError) {
        console.error(`Error counting annotations for user ${userId}:`, annotationsError);
      } else {
        totalAnnotations = count || 0;
      }
    }

    const stats = {
      totalEvents: totalEvents,
      totalAnalyses: totalProcessedEvents, // processed_event_count = workflow analyses completed
      totalAnnotations: totalAnnotations,
      stepsProcessed: totalProcessedEvents, // FIXED: Now shows processed events (workflow analyses)
      totalSteps: totalUiSteps, // FIXED: Now shows UI steps, not all events
      labelingTotal: totalAnnotations, // For backward compatibility
      llmGeneratedLabeled: totalAnnotations, // For backward compatibility (assuming most are LLM generated)
    };

    console.log(`[api/users/${userId}/stats] Returning stats:`, stats);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('An error occurred fetching user stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 