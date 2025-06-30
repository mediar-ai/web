import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface WorkflowMapping {
  analysis_id: number;
  workflow_template_id: number;
  workflow_type_id: number;
  workflow_instance_id: number;
  workflow_step_id: number;
  workflow_substep_id?: number;
  event_inputs?: string[];
  event_outputs?: string[];
  business_logics?: string[];
  confidence_score: number;
}

interface UnrelatedEvent {
  analysis_id: number;
  unrelated_reason: string;
  confidence_score: number;
}

interface AnalysisResult {
  workflow_mappings: WorkflowMapping[];
  unrelated_events: UnrelatedEvent[];
}

interface TimelineAnnotation {
  id: number;
  analysis_id: number;
  is_workflow_related: boolean;
  workflow_id: number | null;
  workflow_type_id: number | null;
  workflow_instance_id: number | null;
  workflow_step_id: number | null;
  workflow_substep_id: number | null;
  inputs: string[] | null;
  outputs: string[] | null;
  business_logic: string[] | null;
  unrelated_reason: string | null;
  confidence_score: number | null;
  model_used: string | null;
  user_id: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  workflow?: {
    id: number;
    title: string;
    detailed_workflow_data: Record<string, unknown>;
  } | null;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user_id, analysis_result, model_used } = await req.json();

    if (!user_id || !analysis_result) {
      return NextResponse.json({ 
        error: 'Missing required parameters', 
        details: 'user_id and analysis_result are required' 
      }, { status: 400 });
    }

    const { workflow_mappings, unrelated_events }: AnalysisResult = analysis_result;

    console.log(`💾 Saving timeline mappings: ${workflow_mappings.length} mapped events, ${unrelated_events.length} unrelated events`);

    // Prepare records for database insertion
    const records = [];

    // Process workflow mappings (related events)
    for (const mapping of workflow_mappings) {
      records.push({
        analysis_id: mapping.analysis_id,
        is_workflow_related: true,
        workflow_id: mapping.workflow_template_id,
        // ID-based columns
        workflow_type_id: mapping.workflow_type_id,
        workflow_instance_id: mapping.workflow_instance_id,
        workflow_step_id: mapping.workflow_step_id,
        workflow_substep_id: mapping.workflow_substep_id || null,
        // Event context
        inputs: mapping.event_inputs || null,
        outputs: mapping.event_outputs || null,
        business_logic: mapping.business_logics || null,
        unrelated_reason: null,
        confidence_score: mapping.confidence_score,
        model_used: model_used || 'gemini-2.5-pro',
        user_id: user_id,
        session_id: null, // Could be passed in if needed
      });
    }

    // Process unrelated events
    for (const unrelated of unrelated_events) {
      records.push({
        analysis_id: unrelated.analysis_id,
        is_workflow_related: false,
        workflow_id: null,
        // ID columns - all null for unrelated events
        workflow_type_id: null,
        workflow_instance_id: null,
        workflow_step_id: null,
        workflow_substep_id: null,
        inputs: null,
        outputs: null,
        business_logic: null,
        unrelated_reason: unrelated.unrelated_reason,
        confidence_score: unrelated.confidence_score,
        model_used: model_used || 'gemini-2.5-pro',
        user_id: user_id,
        session_id: null, // Could be passed in if needed
      });
    }

    // Handle re-runs: delete existing annotations for these events, then insert new ones
    const eventIds = [...workflow_mappings.map(m => m.analysis_id), ...unrelated_events.map(u => u.analysis_id)];
    
    // Delete existing annotations for these events (handles re-runs)
    const { error: deleteError } = await supabase
      .from('timeline_event_annotations')
      .delete()
      .eq('user_id', user_id)
      .in('analysis_id', eventIds);

    if (deleteError) {
      console.error('Error deleting existing annotations:', deleteError);
      // Continue anyway - might be first run with no existing data
    }

    // Insert new records
    const { data, error } = await supabase
      .from('timeline_event_annotations')
      .insert(records)
      .select();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ 
        error: 'Failed to save timeline annotations', 
        details: error.message 
      }, { status: 500 });
    }

    console.log(`✅ Successfully saved ${data?.length || 0} timeline annotations with IDs`);
    
    return NextResponse.json({ 
      success: true, 
      saved_count: data?.length || 0,
      message: `Saved ${data?.length || 0} timeline annotations with component IDs`
    });

  } catch (error) {
    console.error('Error in POST /api/timeline-event-mappings:', error);
    return NextResponse.json({ 
      error: 'Failed to save timeline mappings', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get('user_id');
    const include_unrelated = searchParams.get('include_unrelated') === 'true';

    if (!user_id) {
      return NextResponse.json({ 
        error: 'Missing required parameter', 
        details: 'user_id is required' 
      }, { status: 400 });
    }

    // Build query based on parameters
    let query = supabase
      .from('timeline_event_annotations')
      .select(`
        *,
        workflow:low_level_workflows(id, title, detailed_workflow_data)
      `)
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    // Filter by workflow relation if requested
    if (!include_unrelated) {
      query = query.eq('is_workflow_related', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ 
        error: 'Failed to fetch timeline annotations', 
        details: error.message 
      }, { status: 500 });
    }

    // Transform data for frontend consumption
    const events = data.map((annotation: TimelineAnnotation) => ({
      id: annotation.id,
      analysis_id: annotation.analysis_id,
      is_workflow_related: annotation.is_workflow_related,
      workflow_id: annotation.workflow_id,
      workflow_title: annotation.workflow?.title || null,
      // ID-based fields
      workflow_type_id: annotation.workflow_type_id,
      workflow_instance_id: annotation.workflow_instance_id,
      workflow_step_id: annotation.workflow_step_id,
      workflow_substep_id: annotation.workflow_substep_id,
      inputs: annotation.inputs,
      outputs: annotation.outputs,
      business_logic: annotation.business_logic,
      unrelated_reason: annotation.unrelated_reason,
      confidence_score: annotation.confidence_score,
      model_used: annotation.model_used,
      created_at: annotation.created_at,
      updated_at: annotation.updated_at,
    }));

    console.log(`📋 Retrieved ${events.length} timeline annotations with IDs for user ${user_id}`);
    
    return NextResponse.json({ 
      events,
      total_count: events.length,
      workflow_related_count: events.filter(e => e.is_workflow_related).length,
      unrelated_count: events.filter(e => !e.is_workflow_related).length
    });

  } catch (error) {
    console.error('Error in GET /api/timeline-event-mappings:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch timeline mappings', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 