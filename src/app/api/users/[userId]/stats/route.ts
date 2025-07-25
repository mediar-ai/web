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

      // Fetch filtered annotations count from correct table (low_level_workflow_labeling)
      // First get analysis IDs for the user in the date range
      const { data: userAnalyses, error: userAnalysesError } = await supabaseAdmin
        .from('low_level_workflow_analyses')
        .select('id')
        .eq('user_id', userId)
        .gte('client_timestamp', startDateTime.toISOString())
        .lte('client_timestamp', endDateTime.toISOString());

      let annotationsCount = 0;
      let annotationsError = null;

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

    // Default behavior - fetch all-time stats directly from tables (more accurate than session metadata)
    
    // Get total events count
    const { count: totalEvents, error: eventsError } = await supabaseAdmin
      .from('low_level_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (eventsError) {
      console.error(`Error counting events for user ${userId}:`, eventsError);
      throw eventsError;
    }

    // Get total analyses count
    const { count: totalAnalyses, error: analysesError } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (analysesError) {
      console.error(`Error counting analyses for user ${userId}:`, analysesError);
      throw analysesError;
    }

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
      totalEvents: totalEvents || 0,
      totalAnalyses: totalAnalyses || 0,
      totalAnnotations: totalAnnotations,
      stepsProcessed: totalAnalyses || 0, // For backward compatibility
      totalSteps: totalEvents || 0, // For backward compatibility  
      labelingTotal: totalAnnotations, // For backward compatibility
      llmGeneratedLabeled: totalAnnotations, // For backward compatibility (assuming most are LLM generated)
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('An error occurred fetching user stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 