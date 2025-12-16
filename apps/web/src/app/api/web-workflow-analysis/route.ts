import {
    CONTEXT_SYNTHESIS_SCHEMA,
    PROMPT_REFINE_WORKFLOWS_AND_CONTEXT,
    PROMPT_SYNTHESIZE_CONTEXT,
    WORKFLOW_IDENTIFICATION_PROMPT,
    WORKFLOW_IDENTIFICATION_SCHEMA,
    WORKFLOW_REFINEMENT_SCHEMA,
} from '@/lib/prompts';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

function toSSE(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// Transform /web page ActivityItems and Events into the analysis format expected by LLM
interface WebActivityItem {
  id: string;
  type: string;
  timestamp: string;
  change_description?: string;
  click_details?: {
    element_clicked?: string;
    element_role?: string;
    click_purpose?: string;
  };
  typing_details?: {
    text_typed?: string;
    input_field?: string;
    typing_purpose?: string;
  };
  new_content_detected?: string;
  window_title?: string;
  application_name?: string;
}

interface WebEvent {
  id: string;
  summary: string;
  thoughts?: string;
  timestamp: string;
  activity_ids?: string[];
}

function transformWebDataToAnalyses(
  activityItems: WebActivityItem[],
  events: WebEvent[]
): Array<{
  id: string;
  timestamp: string;
  window_title: string;
  analysis: Record<string, unknown>;
  labels: string[];
}> {
  // Use Events as the primary steps, enriched with ActivityItem details
  const activityMap = new Map(activityItems.map(item => [item.id, item]));

  return events.map(event => {
    // Get related activity items for this event
    const relatedActivities = (event.activity_ids || [])
      .map(id => activityMap.get(id))
      .filter(Boolean) as WebActivityItem[];

    // Build analysis from event + activities
    const firstActivity = relatedActivities[0];

    return {
      id: event.id,
      timestamp: event.timestamp,
      window_title: firstActivity?.window_title || firstActivity?.application_name || 'Unknown',
      analysis: {
        step_title: event.summary,
        step_summary: event.summary,
        what_was_clicked: relatedActivities
          .filter(a => a.click_details)
          .map(a => `${a.click_details?.element_clicked || ''} (${a.click_details?.click_purpose || ''})`)
          .join('; ') || null,
        what_was_typed: relatedActivities
          .filter(a => a.typing_details)
          .map(a => `${a.typing_details?.text_typed || ''} in ${a.typing_details?.input_field || ''}`)
          .join('; ') || null,
        events_that_happened: relatedActivities
          .map(a => a.change_description)
          .filter(Boolean)
          .join('; ') || event.summary,
        how_content_changed: relatedActivities
          .map(a => a.new_content_detected)
          .filter(Boolean)
          .join('; ') || null,
      },
      labels: [] // No labeling for /web workflow synthesis
    };
  });
}

export async function POST(req: NextRequest) {
  const { userId, sessionId, model, startDate, endDate } = await req.json();

  if (!userId || !model) {
    return new Response(JSON.stringify({ error: 'Missing required "userId" and "model" parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // sessionId is optional - if provided, filter by session; otherwise use time range
  if (!sessionId && (!startDate || !endDate)) {
    return new Response(JSON.stringify({
      error: 'Either sessionId or timeframe (startDate + endDate) is required.',
      details: 'Provide sessionId to analyze a specific recording session, or startDate/endDate for time-based filtering.'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('Initiating web workflow analysis for userId:', userId, 'sessionId:', sessionId, 'model:', model);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(toSSE({ status: 'Loading web recording data...', progress: 10 }));

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          throw new Error('Missing Supabase environment variables');
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch from user_activity_data table (where /web page stores data)
        let query = supabaseAdmin
          .from('user_activity_data')
          .select('id, session_id, client_timestamp, item_type, item_data, client_item_id')
          .eq('user_id', userId)
          .eq('source', 'web');

        // Filter by session or time range
        if (sessionId) {
          query = query.eq('session_id', sessionId);
          controller.enqueue(toSSE({ status: `Loading session ${sessionId}...`, progress: 15 }));
        } else {
          query = query
            .gte('client_timestamp', startDate)
            .lte('client_timestamp', endDate);
          controller.enqueue(toSSE({ status: `Filtering data from ${new Date(startDate).toLocaleString()} to ${new Date(endDate).toLocaleString()}...`, progress: 15 }));
        }

        const { data: webData, error: webError } = await query
          .order('client_timestamp', { ascending: true })
          .limit(1000);

        if (webError) {
          throw new Error(`Failed to fetch web data: ${webError.message}`);
        }

        if (!webData || webData.length === 0) {
          throw new Error('No web recording data found. Make sure you have recorded a session first.');
        }

        // Separate activity_items and events
        const activityItems: WebActivityItem[] = [];
        const events: WebEvent[] = [];

        webData.forEach((row: { item_type: string; item_data: Record<string, unknown>; client_timestamp: string }) => {
          const itemData = row.item_data as Record<string, unknown>;
          if (row.item_type === 'activity_item') {
            activityItems.push({
              ...itemData,
              timestamp: row.client_timestamp
            } as WebActivityItem);
          } else if (row.item_type === 'event') {
            events.push({
              ...itemData,
              timestamp: row.client_timestamp
            } as WebEvent);
          }
        });

        console.log(`Loaded ${activityItems.length} activity items and ${events.length} events`);

        if (events.length === 0) {
          throw new Error('No events found in recording. Events are required for workflow analysis.');
        }

        controller.enqueue(toSSE({
          status: `Loaded ${events.length} events and ${activityItems.length} activities`,
          progress: 20
        }));

        // Transform web data to analysis format
        const analyses = transformWebDataToAnalyses(activityItems, events);
        console.log(`Transformed into ${analyses.length} analyses for LLM`);

        controller.enqueue(toSSE({ status: 'Starting workflow identification...', progress: 25 }));

        // Build context for LLM (same structure as low-level route)
        const context = {
          combinedAnalyses: analyses,
          transcripts: [], // No transcripts for web recordings
          transcriptSummary: null
        };

        // Step 1: Initial Workflow Identification
        controller.enqueue(toSSE({ status: 'Identifying initial workflows...', progress: 30 }));
        const initialIdentification = await callVertexWithStructuredOutput(
          WORKFLOW_IDENTIFICATION_PROMPT,
          context,
          model,
          WORKFLOW_IDENTIFICATION_SCHEMA,
          "application/json",
          false,
          { trackingSource: 'workflow_analysis' as const }
        );
        let workflowNames = initialIdentification.workflow_names || [];
        controller.enqueue(toSSE({ status: 'Initial workflows identified.', progress: 40, data: { workflowNames } }));

        // Step 2: Context Synthesis
        controller.enqueue(toSSE({ status: 'Synthesizing user context...', progress: 50 }));
        let workflowContext = await callVertexWithStructuredOutput(
          PROMPT_SYNTHESIZE_CONTEXT,
          context,
          model,
          CONTEXT_SYNTHESIS_SCHEMA,
          "application/json",
          false,
          { trackingSource: 'workflow_analysis' as const }
        );
        controller.enqueue(toSSE({ status: 'User context synthesized.', progress: 60, data: { workflowContext } }));

        // Step 3: Iterative Refinement (2 cycles)
        controller.enqueue(toSSE({ status: 'Refining workflows with context...', progress: 70 }));
        for (let i = 0; i < 2; i++) {
          const refinementResult = await callVertexWithStructuredOutput(
            PROMPT_REFINE_WORKFLOWS_AND_CONTEXT,
            {
              ...context,
              workflow_context: workflowContext,
              workflow_names: workflowNames,
            },
            model,
            WORKFLOW_REFINEMENT_SCHEMA,
            "application/json",
            false,
            { trackingSource: 'workflow_analysis' as const }
          );

          workflowContext = {
            user_job_role: refinementResult.user_job_role || workflowContext.user_job_role,
            project_name: refinementResult.project_name || workflowContext.project_name,
            user_goal_from_recordings: refinementResult.user_goal_from_recordings || workflowContext.user_goal_from_recordings,
            overall_project_goal: refinementResult.overall_project_goal || workflowContext.overall_project_goal,
            overall_project_description: refinementResult.overall_project_description || workflowContext.overall_project_description,
          };
          workflowNames = refinementResult.refined_workflow_names;
          controller.enqueue(toSSE({ status: `Refinement cycle ${i + 1} complete.`, progress: 75 + ((i+1)*10) }));
        }

        // Step 4: Final Output
        controller.enqueue(toSSE({
          status: 'Analysis complete.',
          progress: 100,
          data: {
            workflowContext,
            workflowNames,
            sourceStats: {
              eventsCount: events.length,
              activityItemsCount: activityItems.length,
              analysesGenerated: analyses.length
            }
          }
        }));

      } catch (error) {
        console.error('Error in web workflow analysis stream:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        controller.enqueue(toSSE({ error: 'Internal server error', details: errorMessage }));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
