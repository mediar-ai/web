import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const userId = url.searchParams.get('userId');

    if (!startDate || !endDate || !userId) {
      return NextResponse.json(
        { error: 'Missing required parameters: startDate, endDate, userId' },
        { status: 400 }
      );
    }

    console.log(`[api/sessions/filtered-stats] Fetching filtered stats for user ${userId}: ${startDate} to ${endDate}`);

    // Get filtered events count using low_level_events
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

    // Get filtered analyses count using low_level_workflow_analyses
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

    // Get filtered annotations count from low_level_workflow_labeling
    let annotationsCount = 0;
    
    if (analysesCount && analysesCount > 0) {
      // First get the analysis IDs in the time range
      const { data: userAnalyses, error: userAnalysesError } = await supabaseAdmin
        .from('low_level_workflow_analyses')
        .select('id')
        .eq('user_id', userId)
        .gte('client_timestamp', startDate)
        .lte('client_timestamp', endDate);

      if (userAnalysesError) {
        console.error(`Error fetching user analyses for annotations count:`, userAnalysesError);
      } else if (userAnalyses && userAnalyses.length > 0) {
        const analysisIds = userAnalyses.map(a => a.id);
        
        const { count, error: annotationsError } = await supabaseAdmin
          .from('low_level_workflow_labeling')
          .select('*', { count: 'exact', head: true })
          .in('low_level_workflow_analysis_id', analysisIds);
        
        if (annotationsError) {
          console.error(`Error counting annotations for user ${userId}:`, annotationsError);
        } else {
          annotationsCount = count || 0;
        }
      }
    }

    const filteredStats = {
      totalEvents: eventsCount || 0,
      totalAnalyses: analysesCount || 0,
      totalAnnotations: annotationsCount || 0,
    };

    console.log(`[api/sessions/filtered-stats] Returning filtered stats for user ${userId}:`, filteredStats);
    return NextResponse.json(filteredStats);
  } catch (error) {
    console.error('An error occurred fetching filtered session stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 