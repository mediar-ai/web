import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  FetchTimelineEventMappingsResponse,
  SaveTimelineEventMappingsRequest,
  SaveTimelineEventMappingsResponse,
  EnhancedTimelineEvent,
  TimelineEventUnrelated,
  TimelineEventWorkflowMappingWithDetails
} from '@/lib/timelineMappingTypes';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// =============================================================================
// GET: Fetch timeline event workflow mappings
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user_id = searchParams.get('user_id');
    const timeline_event_ids = searchParams.get('timeline_event_ids')?.split(',').map(Number);
    const start_date = searchParams.get('start_date');
    const end_date = searchParams.get('end_date');
    const include_unrelated = searchParams.get('include_unrelated') === 'true';

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    // Build base query for timeline events
    let eventsQuery = supabase
      .from('low_level_events')
      .select('*')
      .eq('user_id', user_id);

    // Apply filters
    if (timeline_event_ids && timeline_event_ids.length > 0) {
      eventsQuery = eventsQuery.in('id', timeline_event_ids);
    }
    if (start_date) {
      eventsQuery = eventsQuery.gte('timestamp', start_date);
    }
    if (end_date) {
      eventsQuery = eventsQuery.lte('timestamp', end_date);
    }

    const { data: events, error: eventsError } = await eventsQuery.order('timestamp', { ascending: true });

    if (eventsError) {
      console.error('Error fetching timeline events:', eventsError);
      return NextResponse.json({ error: 'Failed to fetch timeline events' }, { status: 500 });
    }

    if (!events || events.length === 0) {
      return NextResponse.json({
        events: [],
        total_events: 0,
        workflow_related_count: 0,
        unrelated_count: 0,
        unmapped_count: 0
      } as FetchTimelineEventMappingsResponse);
    }

    const eventIds = events.map(e => e.id);

    // Fetch workflow mappings with joined details
    const { data: mappings, error: mappingsError } = await supabase
      .from('timeline_event_workflow_mappings')
      .select(`
        *,
        workflow_template:low_level_workflows!timeline_event_workflow_mappings_workflow_template_id_fkey(id, title, steps),
        workflow_type:workflow_types!timeline_event_workflow_mappings_workflow_type_id_fkey(id, type_name, type_description),
        workflow_instance:workflow_instances!timeline_event_workflow_mappings_workflow_instance_id_fkey(id, instance_name, status)
      `)
      .in('timeline_event_id', eventIds)
      .eq('user_id', user_id);

    if (mappingsError) {
      console.error('Error fetching workflow mappings:', mappingsError);
      return NextResponse.json({ error: 'Failed to fetch workflow mappings' }, { status: 500 });
    }

    // Fetch unrelated events if requested
    let unrelatedEvents: TimelineEventUnrelated[] = [];
    if (include_unrelated) {
      const { data: unrelated, error: unrelatedError } = await supabase
        .from('timeline_event_unrelated')
        .select('*')
        .in('timeline_event_id', eventIds)
        .eq('user_id', user_id);

      if (unrelatedError) {
        console.error('Error fetching unrelated events:', unrelatedError);
      } else {
        unrelatedEvents = unrelated || [];
      }
    }

    // Group mappings by timeline event
    const mappingsByEvent = new Map<number, TimelineEventWorkflowMappingWithDetails[]>();
    (mappings || []).forEach((mapping: TimelineEventWorkflowMappingWithDetails) => {
      const eventId = mapping.timeline_event_id;
      if (!mappingsByEvent.has(eventId)) {
        mappingsByEvent.set(eventId, []);
      }
      mappingsByEvent.get(eventId)!.push(mapping);
    });

    // Group unrelated by event
    const unrelatedByEvent = new Map<number, TimelineEventUnrelated>();
    unrelatedEvents.forEach(unrelated => {
      unrelatedByEvent.set(unrelated.timeline_event_id, unrelated);
    });

    // Enhance timeline events with workflow mapping data
    const enhancedEvents: EnhancedTimelineEvent[] = events.map(event => {
      const eventMappings = mappingsByEvent.get(event.id) || [];
      const unrelatedInfo = unrelatedByEvent.get(event.id);
      
      return {
        ...event,
        workflow_mappings: eventMappings,
        unrelated_info: unrelatedInfo,
        is_workflow_related: eventMappings.length > 0,
        total_mappings: eventMappings.length,
        confidence_score: eventMappings.length > 0 
          ? eventMappings.reduce((sum, m) => sum + (m.confidence_score || 0), 0) / eventMappings.length
          : unrelatedInfo?.confidence_score
      };
    });

    // Calculate summary statistics
    const workflow_related_count = enhancedEvents.filter(e => e.is_workflow_related).length;
    const unrelated_count = enhancedEvents.filter(e => e.unrelated_info).length;
    const unmapped_count = enhancedEvents.length - workflow_related_count - unrelated_count;

    const response: FetchTimelineEventMappingsResponse = {
      events: enhancedEvents,
      total_events: enhancedEvents.length,
      workflow_related_count,
      unrelated_count,
      unmapped_count
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/timeline-event-mappings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// =============================================================================
// POST: Save timeline event workflow mappings from LLM analysis
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: SaveTimelineEventMappingsRequest = await request.json();
    const { user_id, session_id, analysis_result } = body;

    if (!user_id || !analysis_result) {
      return NextResponse.json({ error: 'user_id and analysis_result are required' }, { status: 400 });
    }

    const response: SaveTimelineEventMappingsResponse = {
      success: true,
      workflow_types_created: 0,
      workflow_instances_created: 0,
      timeline_mappings_created: 0,
      unrelated_events_created: 0,
      errors: []
    };

    // Process workflow mappings
    for (const mapping of analysis_result.workflow_mappings) {
      try {
        // 1. Upsert workflow type
        const { data: workflowType, error: typeError } = await supabase
          .from('workflow_types')
          .upsert({
            workflow_template_id: mapping.workflow_template_id,
            type_name: mapping.workflow_type_name,
            type_description: mapping.workflow_type_description,
            user_id,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'workflow_template_id,type_name',
            ignoreDuplicates: false
          })
          .select()
          .single();

        if (typeError) {
          response.errors?.push(`Failed to create workflow type: ${typeError.message}`);
          continue;
        }

        if (!workflowType) {
          response.errors?.push('Failed to create workflow type: no data returned');
          continue;
        }

        response.workflow_types_created++;

        // 2. Upsert workflow instance
        const { data: workflowInstance, error: instanceError } = await supabase
          .from('workflow_instances')
          .upsert({
            workflow_type_id: workflowType.id,
            instance_name: mapping.workflow_instance_name,
            instance_data: mapping.workflow_instance_data || {},
            status: 'active',
            user_id,
            session_id,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'workflow_type_id,instance_name',
            ignoreDuplicates: false
          })
          .select()
          .single();

        if (instanceError) {
          response.errors?.push(`Failed to create workflow instance: ${instanceError.message}`);
          continue;
        }

        if (!workflowInstance) {
          response.errors?.push('Failed to create workflow instance: no data returned');
          continue;
        }

        response.workflow_instances_created++;

        // 3. Create timeline event workflow mapping
        const { error: mappingError } = await supabase
          .from('timeline_event_workflow_mappings')
          .upsert({
            timeline_event_id: mapping.timeline_event_id,
            workflow_template_id: mapping.workflow_template_id,
            workflow_type_id: workflowType.id,
            workflow_instance_id: workflowInstance.id,
            workflow_step: mapping.workflow_step,
            workflow_substep: mapping.workflow_substep,
            step_sequence: mapping.step_sequence,
            event_inputs: mapping.event_inputs,
            event_outputs: mapping.event_outputs,
            business_logics: mapping.business_logics,
            confidence_score: mapping.confidence_score,
            analysis_timestamp: analysis_result.analysis_timestamp,
            model_used: analysis_result.model_used,
            user_id,
            session_id
          }, {
            onConflict: 'timeline_event_id,workflow_instance_id,workflow_step,workflow_substep',
            ignoreDuplicates: false
          });

        if (mappingError) {
          response.errors?.push(`Failed to create timeline mapping: ${mappingError.message}`);
          continue;
        }

        response.timeline_mappings_created++;

      } catch (error) {
        response.errors?.push(`Error processing workflow mapping: ${error}`);
      }
    }

    // Process unrelated events
    for (const unrelated of analysis_result.unrelated_events) {
      try {
        const { error: unrelatedError } = await supabase
          .from('timeline_event_unrelated')
          .upsert({
            timeline_event_id: unrelated.timeline_event_id,
            unrelated_reason: unrelated.unrelated_reason,
            confidence_score: unrelated.confidence_score,
            analysis_timestamp: analysis_result.analysis_timestamp,
            model_used: analysis_result.model_used,
            user_id,
            session_id
          }, {
            onConflict: 'timeline_event_id',
            ignoreDuplicates: false
          });

        if (unrelatedError) {
          response.errors?.push(`Failed to create unrelated event: ${unrelatedError.message}`);
          continue;
        }

        response.unrelated_events_created++;

      } catch (error) {
        response.errors?.push(`Error processing unrelated event: ${error}`);
      }
    }

    // Determine overall success
    response.success = (response.errors?.length || 0) === 0;

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/timeline-event-mappings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
