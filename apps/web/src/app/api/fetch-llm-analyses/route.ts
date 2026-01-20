import { NextRequest, NextResponse } from 'next/server';
import { flattenWorkflowAnalyses } from '@/lib/workflowAnalysisHelpers';
import { WorkflowStepAnalysisWithJSONB } from '@/types';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 300;

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('low_level_workflow_analyses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    // Flatten the analyses to provide backward-compatible access
    const flattenedAnalyses = flattenWorkflowAnalyses(data as WorkflowStepAnalysisWithJSONB[]);

    return NextResponse.json({ 
      analyses: flattenedAnalyses,
      raw_analyses: data // Include raw data for advanced use cases
    });
  } catch (error) {
    console.error('Error fetching LLM analyses:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 