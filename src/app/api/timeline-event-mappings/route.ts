import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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



interface WorkflowComponent {
  id: number;
  name?: string;
  step_name?: string;
  substep_name?: string;
  type_name?: string;
  instance_name?: string;
  substeps?: WorkflowComponent[];
}

interface WorkflowData {
  title?: string;
  detailed_workflow_data?: {
    workflow_components_with_ids?: {
      workflow_types?: WorkflowComponent[];
      workflow_instances?: WorkflowComponent[];
      steps?: WorkflowComponent[];
    };
  };
}

interface RawAnnotationWithWorkflow {
  user_id: string;
  raw_event_id: number;
  analysis_id: number;
  confidence_score: number;
  is_workflow_related: boolean;
  model_used: string;
  unrelated_reason: string | null;
  workflow_template_id: number | null;
  workflow_type_id: number | null;
  workflow_instance_id: number | null;
  workflow_step_id: number | null;
  workflow_substep_id: number | null;
  inputs: string | null;
  outputs: string | null;
  business_logics: string | null;
  created_at: string;
  event_data?: {
    payload: Record<string, unknown>;
    created_at: string;
  };
  workflow_data?: WorkflowData;
  analysis_data?: {
    id: number;
    window_title?: string;
    llm_structured_output?: Record<string, unknown>;
    labeling_data?: {
      selected_labels: string[] | null;
      suggested_labels: string[] | null;
    } | null;
  };
}

/**
 * @deprecated This POST endpoint is for the legacy timeline_event_annotations system.
 * New raw event mappings should use /api/analyze-raw-timeline-events which creates
 * granular mappings for individual raw events rather than analysis-level mappings.
 * This endpoint is kept for backward compatibility but should not be used for new features.
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user_id, analysis_result, model_used, synthesis_session_id } = await req.json();

    if (!user_id || !analysis_result) {
      return NextResponse.json({ 
        error: 'Missing required parameters', 
        details: 'user_id and analysis_result are required' 
      }, { status: 400 });
    }

    const { workflow_mappings, unrelated_events }: AnalysisResult = analysis_result;

    console.log(`[DB] [DEPRECATED] Saving timeline mappings: ${workflow_mappings.length} mapped events, ${unrelated_events.length} unrelated events`);

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
        session_id: synthesis_session_id || null, // Link to current synthesis session
        // Session tracking for proper reset behavior
        synthesis_session_id: synthesis_session_id || null,
        annotation_status: 'draft', // Mark as draft during current session
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
        session_id: synthesis_session_id || null, // Link to current synthesis session
        // Session tracking for proper reset behavior
        synthesis_session_id: synthesis_session_id || null,
        annotation_status: 'draft', // Mark as draft during current session
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

    console.log(`[SUCCESS] [DEPRECATED] Successfully saved ${data?.length || 0} timeline annotations with IDs`);
    
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
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get('user_id');
    const include_unrelated = searchParams.get('include_unrelated') === 'true';
    const raw_events = searchParams.get('raw_events') === 'true';
    const synthesis_session_id = searchParams.get('synthesis_session_id');
    const include_saved = searchParams.get('include_saved') === 'true';

    if (!user_id) {
      return NextResponse.json({ 
        error: 'Missing required parameter', 
        details: 'user_id is required' 
      }, { status: 400 });
    }

    // Handle raw event annotations (new system)
    if (raw_events) {
      let query = supabase
        .from('raw_timeline_event_annotations')
        .select(`
          *,
          event_data:low_level_events!raw_timeline_event_annotations_raw_event_id_fkey(
            payload,
            created_at
          ),
          workflow_data:low_level_workflows!raw_timeline_event_annotations_workflow_template_id_fkey(
            id,
            title,
            detailed_workflow_data
          ),
          analysis_data:low_level_workflow_analyses!raw_timeline_event_annotations_analysis_id_fkey(
            id,
            window_title,
            llm_structured_output,
            labeling_data:low_level_workflow_labeling(
              selected_labels,
              suggested_labels
            )
          )
        `)
        .eq('user_id', user_id)
        .order('created_at', { ascending: false });

      // FIXED FILTERING LOGIC: Ensure proper separation between TOP and Saved sections
      if (synthesis_session_id) {
        // TOP section: Only draft annotations for the specific session
        // Never include saved annotations in TOP section regardless of session
        query = query
          .eq('synthesis_session_id', synthesis_session_id)
          .eq('annotation_status', 'draft');
      } else if (!include_saved) {
        // Fallback: Only draft annotations when no session specified
        // Exclude NULL sessions by requiring a valid session ID
        query = query
          .eq('annotation_status', 'draft')
          .not('synthesis_session_id', 'is', null);
      } else {
        // Saved section: Include both draft and saved annotations
        // But still exclude NULL sessions to prevent orphaned data issues
        query = query
          .in('annotation_status', ['draft', 'saved'])
          .not('synthesis_session_id', 'is', null);
      }

      // Filter by workflow relation if requested
      if (!include_unrelated) {
        query = query.eq('is_workflow_related', true);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Database error fetching raw annotations:', error);
        return NextResponse.json({ 
          error: 'Failed to fetch raw timeline annotations', 
          details: error.message 
        }, { status: 500 });
      }

      // Helper function to find names from workflow data
      const findWorkflowNames = (workflowData: WorkflowData | null | undefined, annotation: RawAnnotationWithWorkflow) => {
        if (!workflowData?.detailed_workflow_data?.workflow_components_with_ids) {
          return {
            template_name: workflowData?.title || 'Unknown Template',
            type_name: 'Unknown Type',
            instance_name: 'Unknown Instance', 
            step_name: 'Unknown Step',
            substep_name: 'Unknown Substep'
          };
        }

        const components = workflowData.detailed_workflow_data.workflow_components_with_ids;
        const result = {
          template_name: workflowData.title || 'Unknown Template',
          type_name: 'Unknown Type',
          instance_name: 'Unknown Instance',
          step_name: 'Unknown Step', 
          substep_name: 'Unknown Substep'
        };

        // Find type name
        if (components.workflow_types && annotation.workflow_type_id) {
          const type = components.workflow_types.find((t: WorkflowComponent) => t.id === annotation.workflow_type_id);
          if (type) {
            result.type_name = type.type_name || type.name || 'Unknown Type';
          }
        }

        // Find instance name  
        if (components.workflow_instances && annotation.workflow_instance_id) {
          const instance = components.workflow_instances.find((i: WorkflowComponent) => i.id === annotation.workflow_instance_id);
          if (instance) {
            result.instance_name = instance.instance_name || instance.name || 'Unknown Instance';
          }
        }

        // Find step name
        if (components.steps && annotation.workflow_step_id) {
          const step = components.steps.find((s: WorkflowComponent) => s.id === annotation.workflow_step_id);
          if (step) {
            result.step_name = step.name || step.step_name || 'Unknown Step';
          }
        }

        // Find substep name (nested in steps)
        if (components.steps && annotation.workflow_substep_id) {
          for (const step of components.steps) {
            if (step.substeps) {
              const substep = step.substeps.find((ss: WorkflowComponent) => ss.id === annotation.workflow_substep_id);
              if (substep) {
                result.substep_name = substep.name || substep.substep_name || 'Unknown Substep';
                break;
              }
            }
          }
        }

        return result;
      };

             // Transform raw event data for frontend consumption with workflow names
       const annotations = data.map((annotation: RawAnnotationWithWorkflow) => {
        const names = findWorkflowNames(annotation.workflow_data, annotation);
        
        // Extract event type from payload
        const eventType = (() => {
          try {
            const payload = annotation.event_data?.payload as Record<string, unknown>;
            const innerPayload = payload?.payload as Record<string, unknown>;
            return (innerPayload?.type as string) || 'unknown';
          } catch {
            return 'unknown';
          }
        })();

        // Extract analysis information
        const analysisInfo = (() => {
          try {
            const analysisData = annotation.analysis_data as { llm_structured_output?: Record<string, unknown>, window_title?: string, labeling_data?: { selected_labels: string[] | null, suggested_labels: string[] | null } | null };
            const structuredOutput = analysisData?.llm_structured_output;
            return {
              step_title: (structuredOutput?.step_title as string) || 'Unknown Step',
              user_intent: (structuredOutput?.user_intent as string) || '',
              step_summary: (structuredOutput?.step_summary as string) || '',
              events_that_happened: (structuredOutput?.events_that_happened as string) || '',
              how_content_changed: (structuredOutput?.how_content_changed as string) || '',
              results_if_any: (structuredOutput?.results_if_any as string) || '',
              what_was_clicked: (structuredOutput?.what_was_clicked as string) || '',
              what_was_typed: (structuredOutput?.what_was_typed as string) || '',
              window_title: analysisData?.window_title || ''
            };
          } catch {
            return {
              step_title: 'Unknown Step',
              user_intent: '',
              step_summary: '',
              events_that_happened: '',
              how_content_changed: '',
              results_if_any: '',
              what_was_clicked: '',
              what_was_typed: '',
              window_title: ''
            };
          }
        })();

        // Extract labeling information
        const labelingInfo = (() => {
          try {
            const analysisData = annotation.analysis_data as { labeling_data?: { selected_labels: string[] | null, suggested_labels: string[] | null } | null };
            const labelingData = analysisData?.labeling_data;
            return {
              selected_labels: labelingData?.selected_labels || [],
              suggested_labels: labelingData?.suggested_labels || []
            };
          } catch {
            return { selected_labels: [], suggested_labels: [] };
          }
        })();

        return {
          user_id: annotation.user_id,
          raw_event_id: annotation.raw_event_id,
          analysis_id: annotation.analysis_id,
          confidence_score: annotation.confidence_score,
          is_workflow_related: annotation.is_workflow_related,
          model_used: annotation.model_used,
          unrelated_reason: annotation.unrelated_reason,
          workflow_id: annotation.workflow_template_id, // Use the correct field name
          workflow_type_id: annotation.workflow_type_id,
          workflow_instance_id: annotation.workflow_instance_id,
          workflow_step_id: annotation.workflow_step_id,
          workflow_substep_id: annotation.workflow_substep_id,
          // Add human-readable names
          template_name: names.template_name,
          type_name: names.type_name,
          instance_name: names.instance_name,
          step_name: names.step_name,
          substep_name: names.substep_name,
          // Add event type from payload
          event_type: eventType,
          // Add analysis information
          step_title: analysisInfo.step_title,
          user_intent: analysisInfo.user_intent,
          step_summary: analysisInfo.step_summary,
          events_that_happened: analysisInfo.events_that_happened,
          how_content_changed: analysisInfo.how_content_changed,
          results_if_any: analysisInfo.results_if_any,
          what_was_clicked: analysisInfo.what_was_clicked,
          what_was_typed: analysisInfo.what_was_typed,
          window_title: analysisInfo.window_title,
          inputs: annotation.inputs,
          outputs: annotation.outputs,
          business_logics: annotation.business_logics,
          created_at: annotation.created_at,
          // Include event payload and timestamp
          event_payload: annotation.event_data?.payload,
          event_created_at: annotation.event_data?.created_at,
          // Include labeling data
          selected_labels: labelingInfo.selected_labels,
          suggested_labels: labelingInfo.suggested_labels,
        };
      });

      console.log(`📋 Retrieved ${annotations.length} raw event annotations for user ${user_id}`);
      
      return NextResponse.json({ 
        annotations,
        total_count: annotations.length,
        workflow_related_count: annotations.filter(a => a.is_workflow_related).length,
        unrelated_count: annotations.filter(a => !a.is_workflow_related).length
      });
    }

    // Legacy timeline_event_annotations system has been removed.
    // Only raw_timeline_event_annotations (raw_events=true) is supported.
    return NextResponse.json({ 
      error: 'Legacy timeline annotations system is no longer supported', 
      details: 'Use raw_events=true parameter to access the current raw timeline annotation system' 
    }, { status: 400 });

  } catch (error) {
    console.error('Error in GET /api/timeline-event-mappings:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch timeline mappings', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}