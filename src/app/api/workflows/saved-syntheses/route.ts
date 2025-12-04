import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch comprehensive saved syntheses
    const { data: savedSyntheses, error } = await supabaseAdmin
      .from('saved_workflow_syntheses')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching saved syntheses:', error);
      return NextResponse.json({ error: 'Failed to fetch saved syntheses' }, { status: 500 });
    }

    // Transform the data to be more usable in the frontend
    const transformedSyntheses = savedSyntheses.map(synthesis => {
      // Parse JSON fields safely
      const workflowIds = (() => {
        try {
          return JSON.parse(synthesis.workflow_ids || '[]');
        } catch {
          return [];
        }
      })();

      const identifiedWorkflowNames = (() => {
        try {
          return JSON.parse(synthesis.identified_workflow_names || '[]');
        } catch {
          return [];
        }
      })();

      const modelsUsed = (() => {
        try {
          return JSON.parse(synthesis.models_used || '[]');
        } catch {
          return [];
        }
      })();

      return {
        id: synthesis.id,
        title: synthesis.title,
        description: synthesis.description,
        
        // Steps 1-5 Process Data
        processData: {
          // Step 1: Context
          context: synthesis.workflow_context || {},
          
          // Step 2: Identified workflows
          identifiedWorkflows: identifiedWorkflowNames,
          
          // Step 3: Boundaries (triggers/terminators)
          boundaries: synthesis.workflow_boundaries || {},
          
          // Steps 1-5: Complete conversation
          conversation: synthesis.conversation_history || [],
          
          // Step 5: Final synthesis results
          results: synthesis.synthesis_results || [],
          
          // Full process data
          fullProcessData: synthesis.synthesis_process_data || {}
        },
        
        // Metadata
        workflowIds: workflowIds,
        modelsUsed: modelsUsed,
        totalTokensUsed: synthesis.total_tokens_used || 0,
        synthesisDuration: synthesis.synthesis_duration_seconds,
        version: synthesis.version,
        
        // Timestamps
        synthesisStartedAt: synthesis.synthesis_started_at,
        synthesisCompletedAt: synthesis.synthesis_completed_at,
        createdAt: synthesis.created_at,
        updatedAt: synthesis.updated_at,
        
        // References
        synthesisSessionId: synthesis.synthesis_session_id,
        savedByUserId: synthesis.saved_by_user_id
      };
    });

    console.log(`📋 Retrieved ${transformedSyntheses.length} comprehensive saved syntheses for user ${userId}`);

    return NextResponse.json({
      success: true,
      data: transformedSyntheses,
      count: transformedSyntheses.length
    });

  } catch (error) {
    console.error('Error in saved-syntheses route:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 