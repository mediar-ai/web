import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface SavedSynthesis {
  synthesis_session_id: number;
  saved_at: string;
  created_at: string;
  workflow_count: number;
  workflows: Array<Record<string, unknown>>;
  sample_titles: string[];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch saved syntheses grouped by synthesis_session_id
    const { data: savedSyntheses, error } = await supabaseAdmin
      .from('low_level_workflows')
      .select(`
        id,
        title,
        synthesis_status,
        saved_at,
        created_at,
        synthesis_session_id,
        detailed_workflow_data,
        saved_by_user_id
      `)
      .eq('user_id', userId)
      .eq('synthesis_status', 'saved')
      .not('synthesis_session_id', 'is', null)
      .order('saved_at', { ascending: false });

    if (error) {
      console.error('Error fetching saved syntheses:', error);
      return NextResponse.json({ error: 'Failed to fetch saved syntheses' }, { status: 500 });
    }

    // Group workflows by synthesis session
    const groupedSyntheses = savedSyntheses.reduce((acc, workflow) => {
      const sessionId = workflow.synthesis_session_id;
      if (!acc[sessionId]) {
        acc[sessionId] = {
          synthesis_session_id: sessionId,
          saved_at: workflow.saved_at,
          created_at: workflow.created_at,
          workflow_count: 0,
          workflows: [],
          sample_titles: []
        };
      }
      
      acc[sessionId].workflows.push(workflow);
      acc[sessionId].workflow_count++;
      acc[sessionId].sample_titles.push(workflow.title);
      
      // Use the latest saved_at timestamp
      if (!acc[sessionId].saved_at || new Date(workflow.saved_at) > new Date(acc[sessionId].saved_at)) {
        acc[sessionId].saved_at = workflow.saved_at;
      }
      
      return acc;
    }, {} as Record<string, SavedSynthesis>);

    // Convert to array and add summary info
    const synthesesArray = Object.values(groupedSyntheses).map((synthesis: SavedSynthesis) => ({
      ...synthesis,
      display_name: synthesis.sample_titles.length > 0 
        ? synthesis.sample_titles.slice(0, 2).join(', ') + 
          (synthesis.sample_titles.length > 2 ? ` +${synthesis.sample_titles.length - 2} more` : '')
        : 'Unnamed Synthesis',
      total_workflows: synthesis.workflow_count
    }));

    console.log(`📋 Found ${synthesesArray.length} saved syntheses for user ${userId}`);

    return NextResponse.json({
      success: true,
      data: synthesesArray,
      total: synthesesArray.length
    });

  } catch (error) {
    console.error('Error in saved-syntheses:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 