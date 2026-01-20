import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const limit = searchParams.get('limit') || '1000';

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Fetch analyses first, then get labels separately (Supabase doesn't support complex LEFT JOINs in the client)
    console.log(`🔍 Fetching analyses for userId: ${userId}, limit: ${limit}`);

    const { data: analysesData, error: analysesError } = await getSupabaseAdmin()
      .from('low_level_workflow_analyses')
      .select('id, client_timestamp, window_title, llm_structured_output')
      .eq('user_id', userId)
      .order('client_timestamp', { ascending: false })
      .limit(parseInt(limit));

    console.log(`[STATS] Raw analyses query result:`, { 
      dataLength: analysesData?.length || 0, 
      error: analysesError,
      firstRecord: analysesData?.[0] || null 
    });

    if (analysesError) {
      console.error('Error fetching analyses:', analysesError);
      return NextResponse.json({ error: 'Failed to fetch analyses' }, { status: 500 });
    }

    // Get all analysis IDs to fetch labels
    const analysisIds = analysesData?.map(item => item.id) || [];
    
    // Fetch labels for these analyses
    const { data: labelsData, error: labelsError } = await getSupabaseAdmin()
      .from('low_level_workflow_labeling')
      .select('low_level_workflow_analysis_id, selected_labels')
      .in('low_level_workflow_analysis_id', analysisIds);

    if (labelsError) {
      console.error('Error fetching labels:', labelsError);
      // Continue without labels rather than failing completely
    }

    // Create a map of analysis_id -> labels for quick lookup
    const labelsMap = new Map();
    labelsData?.forEach(label => {
      labelsMap.set(label.low_level_workflow_analysis_id, label.selected_labels);
    });

    const combinedData = analysesData;

    // Transform data to simplified format
    const transformedData = combinedData?.map((item: Record<string, unknown>) => {
      // Extract the JSONB analysis data
      const analysisData = item.llm_structured_output || {};
      
      // Remove unwanted fields from analysis data and keep only the ones we want
      const cleanAnalysisData = Object.fromEntries(
        Object.entries(analysisData).filter(([key]) => 
          !['generation_timestamp', 'context_metadata', 'label_status', 'schema_version'].includes(key)
        )
      );

      // Get selected labels from the labels map
      const selectedLabels = labelsMap.get(item.id) || [];

      return {
        id: item.id,
        client_timestamp: item.client_timestamp,
        window_title: item.window_title,
        analysis_data: cleanAnalysisData,
        selected_labels: selectedLabels
      };
    }) || [];

    // Log first and last transformed records for debugging
    console.log(`🎯 Transformed data summary:`, {
      totalRecords: transformedData.length,
      recordsWithLabels: transformedData.filter((item: { selected_labels: string[] }) => item.selected_labels.length > 0).length,
      firstRecord: transformedData[0] || null,
      lastRecord: transformedData[transformedData.length - 1] || null
    });

    return NextResponse.json({
      success: true,
      data: transformedData,
      count: transformedData.length
    });

  } catch (error) {
    console.error('Error in v2/fetch-combined-analyses:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 