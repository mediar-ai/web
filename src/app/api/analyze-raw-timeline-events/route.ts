import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { TIMELINE_MAPPING_ANALYSIS_PROMPT } from '@/lib/prompts';

function toSSE(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// Schema for single batch mapping results with ID-based workflow mapping
const SINGLE_BATCH_MAPPING_SCHEMA = {
  type: "object",
  properties: {
    event_mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw_event_id: { type: "number" },
          confidence_score: { type: "number", minimum: 0, maximum: 1 },
          workflow_template_id: { type: "number" },
          workflow_type_id: { type: "number" },
          workflow_instance_id: { type: "number" },
          workflow_step_id: { type: "number" },
          workflow_substep_id: { type: "number" },
          inputs: { type: "string" },
          outputs: { type: "string" },
          business_logics: { type: "string" },
          unrelated_reason: { type: "string" }
        },
        required: ["raw_event_id", "confidence_score"]
      }
    }
  },
  required: ["event_mappings"]
};

interface EventMappingResult {
  raw_event_id: number;
  confidence_score: number;
  workflow_template_id?: number;
  workflow_type_id?: number;
  workflow_instance_id?: number;
  workflow_step_id?: number;
  workflow_substep_id?: number;
  inputs?: string;
  outputs?: string;
  business_logics?: string;
  unrelated_reason?: string;
}

interface TimelineAnnotation {
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
}

export async function POST(req: NextRequest) {
  const { userId, model, targetUiEventIds, startDate, endDate }: { 
    userId: string; 
    model: string; 
    targetUiEventIds?: string[];
    startDate?: string;
    endDate?: string;
  } = await req.json();

  if (!userId || !model) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Log time boundary information
  if (startDate && endDate) {
    console.log(`🔄 Starting time-bounded timeline mapping for user: ${userId} from ${startDate} to ${endDate}`);
  } else {
    console.log(`🔄 Starting timeline mapping for user: ${userId}`);
  }

  // Use a ReadableStream to send progress updates as they happen
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(toSSE({ status: 'Initializing timeline mapping...', progress: 5 }));

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          throw new Error('Missing Supabase environment variables');
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Get synthesized workflows for the user (only draft, not saved syntheses)
        controller.enqueue(toSSE({ status: 'Loading draft workflows for mapping...', progress: 10 }));
        const { data: workflows, error: workflowError } = await supabaseAdmin
          .from('low_level_workflows')
          .select('id, title, detailed_workflow_data, synthesis_session_id, synthesis_status')
          .eq('user_id', userId)
          .eq('synthesis_status', 'draft') // Only map to draft workflows, not saved ones
          .not('detailed_workflow_data', 'is', null);

        if (workflowError) {
          console.error('❌ Error fetching workflows:', workflowError);
          controller.enqueue(toSSE({ error: 'Failed to fetch workflows' }));
          controller.close();
          return;
        }

        if (!workflows || workflows.length === 0) {
          controller.enqueue(toSSE({ error: 'No draft workflows found for mapping. Saved syntheses are excluded from timeline mapping.' }));
          controller.close();
          return;
        }

        console.log(`📊 Found ${workflows.length} draft workflows for mapping`);
        controller.enqueue(toSSE({ status: `Found ${workflows.length} draft workflows for mapping`, progress: 20 }));

        // Fetch UI tree events - either specific ones if targetUiEventIds provided, or recent ones for full processing
        const statusMessage = targetUiEventIds 
          ? `Loading specific UI tree events (${targetUiEventIds.length})...`
          : 'Loading recent UI tree events for full processing...';
        controller.enqueue(toSSE({ status: statusMessage, progress: 30 }));

        let uiTreeEvents;
        let recentEventsError;

        if (targetUiEventIds && targetUiEventIds.length > 0) {
          // Fetch specific UI tree events by ID
          const { data, error } = await supabaseAdmin
            .from('low_level_events_enriched')
            .select('id, created_at, payload')
            .eq('user_id', userId)
            .eq('event_type', 'ui_tree')
            .in('id', targetUiEventIds.map(id => parseInt(id)))
            .order('created_at', { ascending: false });
          uiTreeEvents = data;
          recentEventsError = error;
        } else {
          // Use time boundaries if provided, otherwise fetch recent UI tree events (last 7 days)
          let query = supabaseAdmin
            .from('low_level_events_enriched')
            .select('id, created_at, payload')
            .eq('user_id', userId)
            .eq('event_type', 'ui_tree'); // Use optimized column instead of JSONB filter

          if (startDate && endDate) {
            // Apply user-specified time boundaries
            query = query
              .gte('created_at', startDate)
              .lte('created_at', endDate);
            controller.enqueue(toSSE({ 
              status: `Filtering events from ${new Date(startDate).toLocaleString()} to ${new Date(endDate).toLocaleString()}...`,
              progress: 35 
            }));
          } else {
            // Default behavior: fetch recent UI tree events (last 7 days)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            query = query.gte('created_at', sevenDaysAgo);
          }

          const { data, error } = await query.order('created_at', { ascending: false });
          uiTreeEvents = data;
          recentEventsError = error;
        }

        if (recentEventsError) {
          console.error('❌ Error fetching UI tree events:', recentEventsError);
          controller.enqueue(toSSE({ error: 'Failed to fetch UI tree events' }));
          controller.close();
          return;
        }

        if (!uiTreeEvents || uiTreeEvents.length === 0) {
          console.log('ℹ️ No UI tree events found for user');
          controller.enqueue(toSSE({ 
            error: 'No UI tree events found for user',
            data: { totalMappings: 0, totalBatches: 0 }
          }));
          controller.close();
          return;
        }

        const totalBatches = uiTreeEvents.length;
        console.log(`📊 Found ${totalBatches} UI tree events, processing all batches`);
        controller.enqueue(toSSE({ 
          status: `Processing ${totalBatches} UI tree events sequentially...`, 
          progress: 50,
          data: { totalBatches }
        }));

        let totalMappings = 0;
        const allAnnotations: TimelineAnnotation[] = [];

        // Process all batches for full timeline mapping
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const currentProgress = 50 + (batchIndex / totalBatches) * 40;
          controller.enqueue(toSSE({ 
            status: `Processing batch ${batchIndex + 1} of ${totalBatches}...`, 
            progress: Math.round(currentProgress),
            data: { currentBatch: batchIndex + 1, totalBatches, totalMappings }
          }));

          // Fix time window logic for DESC-ordered events
          // For DESC order: current event is newer, next event is older
          const endTime = new Date(uiTreeEvents[batchIndex].created_at);
          const startTime = batchIndex + 1 < totalBatches 
            ? new Date(uiTreeEvents[batchIndex + 1].created_at)
            : new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago for last batch

          console.log(`📦 Processing batch ${batchIndex + 1}: ${startTime.toISOString()} → ${endTime.toISOString()}`);

          // Fetch events between start and end time using enriched view
          const { data: allBatchEvents, error: batchError } = await supabaseAdmin
            .from('low_level_events_enriched')
            .select('*')
            .eq('user_id', userId)
            .gte('created_at', startTime.toISOString())
            .lt('created_at', endTime.toISOString())
            .not('event_type', 'in', '(screenshot_diff,ui_tree)') // Exclude both screenshot_diff and ui_tree events
            .order('created_at', { ascending: true });

          if (batchError) {
            console.error(`❌ Error fetching batch events for batch ${batchIndex + 1}:`, batchError);
            controller.enqueue(toSSE({ 
              status: `⚠️ Batch ${batchIndex + 1}: Error fetching events`, 
              progress: Math.round(currentProgress)
            }));
            continue;
          }

          const batchEvents = allBatchEvents || [];

          if (!batchEvents || batchEvents.length === 0) {
            console.log(`⚠️ Batch ${batchIndex + 1}: No events found after filtering`);
            controller.enqueue(toSSE({ 
              status: `⚠️ Batch ${batchIndex + 1}: No events found`, 
              progress: Math.round(currentProgress)
            }));
            continue;
          }

          // Find corresponding analysis for this batch (30-minute window for this user's pattern)
          const timeWindow = 1800; // 30 minutes = 1800 seconds  
          const beforeTime = new Date(endTime.getTime() - timeWindow * 1000).toISOString();
          const afterTime = new Date(endTime.getTime() + timeWindow * 1000).toISOString();
          
          const { data: analysisData, error: analysisError } = await supabaseAdmin
            .from('low_level_workflow_analyses')
            .select('id, created_at, window_title, llm_structured_output')
            .eq('user_id', userId)
            .gte('created_at', beforeTime)
            .lte('created_at', afterTime)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (analysisError && analysisError.code !== 'PGRST116') {
            console.error(`❌ Error fetching analysis for batch ${batchIndex + 1}:`, analysisError);
          }

          if (!analysisData) {
            console.log(`⚠️ Batch ${batchIndex + 1}: No corresponding analysis found`);
            controller.enqueue(toSSE({ 
              status: `⚠️ Batch ${batchIndex + 1}: No analysis found`, 
              progress: Math.round(currentProgress)
            }));
            continue;
          }

          console.log(`✅ Batch ${batchIndex + 1}: ${batchEvents.length} events, analysis: found`);
          
          const batchAnalysis = {
            id: analysisData.id,
            created_at: analysisData.created_at,
            window_title: analysisData.window_title,
            analysis: analysisData.llm_structured_output as {
              step_title?: string;
              step_summary?: string;
              user_goal?: string;
              workflow_context?: Record<string, unknown>;
            }
          };

          // Extract workflow components with IDs for LLM context
          const workflowComponents = workflows
            .map(w => {
              const data = w.detailed_workflow_data as Record<string, unknown>;
              const componentsWithIds = data?.workflow_components_with_ids as Record<string, unknown>;
              if (!data || !componentsWithIds) return null;
              
              return {
                workflow_template_id: w.id,
                title: w.title,
                workflow_types: (componentsWithIds.workflow_types as Record<string, unknown>[]) || [],
                workflow_instances: (componentsWithIds.workflow_instances as Record<string, unknown>[]) || [],
                steps: (componentsWithIds.steps as Record<string, unknown>[]) || []
              };
            })
            .filter((wf): wf is NonNullable<typeof wf> => wf !== null);

          // Create comprehensive prompt for this batch using the comprehensive prompt template
          const prompt = `${TIMELINE_MAPPING_ANALYSIS_PROMPT}

CURRENT BATCH ANALYSIS STEP:
- Window: ${batchAnalysis.window_title || 'Unknown'}
- Step: ${batchAnalysis.analysis?.step_title || 'Unknown'}
- Summary: ${batchAnalysis.analysis?.step_summary || 'No summary'}
- User Goal: ${batchAnalysis.analysis?.user_goal || 'Unknown goal'}

AVAILABLE WORKFLOW COMPONENTS WITH IDS:

${workflowComponents.map(wf => `
WORKFLOW TEMPLATE: ${wf.title} (ID: ${wf.workflow_template_id})

WORKFLOW TYPES:
${wf.workflow_types.map((wt: Record<string, unknown>) => `- ID: ${wt.id}, Name: "${wt.type_name}", Description: "${wt.type_description}"`).join('\n')}

WORKFLOW INSTANCES:
${wf.workflow_instances.map((wi: Record<string, unknown>) => `- ID: ${wi.id}, Name: "${wi.instance_name}"`).join('\n')}

WORKFLOW STEPS:
${wf.steps.map((step: Record<string, unknown>) => `- Step ID: ${step.id}, Name: "${step.step_name}"
  Substeps: ${(step.substeps as Record<string, unknown>[])?.map((sub: Record<string, unknown>) => `ID: ${sub.id}, Name: "${sub.substep_name}"`).join(', ') || ''}`).join('\n')}
`).join('\n---\n')}

RAW EVENTS TO MAP (${batchEvents.length} events):
${batchEvents.map(event => `Event ${event.id}: ${JSON.stringify(event.payload)}`).join('\n')}

ANALYSIS GOAL:
Map each raw event above to determine if it belongs to the current workflow analysis step. Focus on the specific step: "${batchAnalysis.analysis?.step_title || 'Unknown'}" with the goal: "${batchAnalysis.analysis?.user_goal || 'Unknown goal'}"

IMPORTANT: Only use the exact IDs provided above in the WORKFLOW COMPONENTS section.

Return your analysis in the specified JSON format.`;

          controller.enqueue(toSSE({ 
            status: `Processing batch ${batchIndex + 1} with LLM...`, 
            progress: Math.round(currentProgress)
          }));

          console.log(`Sending batch ${batchIndex + 1} to LLM for timeline mapping...`);

          let result;
          try {
            const llmResponse = await callVertexWithStructuredOutput(
              prompt,
              {},
              model,
              SINGLE_BATCH_MAPPING_SCHEMA
            );
            
            result = llmResponse as { event_mappings: EventMappingResult[] };
            console.log(`✅ Successfully mapped batch ${batchIndex + 1}: ${result.event_mappings.length} events mapped`);
          } catch (llmError) {
            console.error(`❌ LLM call failed for batch ${batchIndex + 1}:`, llmError);
            controller.enqueue(toSSE({ 
              status: `❌ Batch ${batchIndex + 1}: LLM processing failed`, 
              progress: Math.round(currentProgress)
            }));
            continue;
          }

          // Save batch results to database
          if (result.event_mappings.length > 0) {
            console.log(`💾 Preparing to save ${result.event_mappings.length} mappings for batch ${batchIndex + 1}`);
            console.log(`💾 Analysis ID to use: ${batchAnalysis.id}`);
            console.log(`💾 Sample mapping result:`, JSON.stringify(result.event_mappings[0], null, 2));
            
            const annotationsToInsert = result.event_mappings.map((mapping: EventMappingResult) => ({
              user_id: userId,
              raw_event_id: mapping.raw_event_id,
              analysis_id: batchAnalysis.id, // Use the known analysis ID from this batch
              confidence_score: mapping.confidence_score,
              is_workflow_related: mapping.confidence_score > 0.5,
              model_used: model,
              unrelated_reason: mapping.unrelated_reason || null,
              workflow_template_id: mapping.workflow_template_id || null,
              workflow_type_id: mapping.workflow_type_id || null,
              workflow_instance_id: mapping.workflow_instance_id || null,
              workflow_step_id: mapping.workflow_step_id || null,
              workflow_substep_id: mapping.workflow_substep_id || null,
              inputs: mapping.inputs || null,
              outputs: mapping.outputs || null,
              business_logics: mapping.business_logics || null
            }));

            const { error: insertError } = await supabaseAdmin
              .from('raw_timeline_event_annotations')
              .insert(annotationsToInsert);

            if (insertError) {
              console.error(`❌ Error saving batch ${batchIndex + 1} annotations:`, insertError);
              console.error(`❌ Error details:`, JSON.stringify(insertError, null, 2));
              console.error(`❌ Attempted to insert ${annotationsToInsert.length} annotations:`);
              console.error(`❌ Sample annotation:`, JSON.stringify(annotationsToInsert[0], null, 2));
              controller.enqueue(toSSE({ 
                status: `❌ Batch ${batchIndex + 1}: Failed to save results - ${insertError.message || insertError.code}`, 
                progress: Math.round(currentProgress)
              }));
              continue;
            }

            console.log(`💾 Successfully saved batch ${batchIndex + 1}: ${result.event_mappings.length} annotations`);
            totalMappings += result.event_mappings.length;
            allAnnotations.push(...annotationsToInsert);

            // Send incremental results to frontend for real-time table updates
            controller.enqueue(toSSE({ 
              status: `✅ Batch ${batchIndex + 1}: Saved ${result.event_mappings.length} annotations`, 
              progress: Math.round(currentProgress),
              data: { 
                annotations: annotationsToInsert,
                currentBatch: batchIndex + 1, 
                totalBatches, 
                totalMappings 
              }
            }));
          } else {
            controller.enqueue(toSSE({ 
              status: `⚠️ Batch ${batchIndex + 1}: No mappings generated`, 
              progress: Math.round(currentProgress)
            }));
          }

          // Small delay to prevent overwhelming the UI
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Final completion
        controller.enqueue(toSSE({ 
          status: `🎉 Timeline mapping completed! Total mappings: ${totalMappings}`, 
          progress: 100,
          data: { 
            totalMappings, 
            totalBatches,
            completed: true,
            annotations: allAnnotations
          }
        }));

        console.log(`🎉 Timeline mapping completed for user ${userId}. Total mappings: ${totalMappings}`);
        controller.close();

      } catch (error) {
        console.error('❌ Timeline mapping failed:', error);
        controller.enqueue(toSSE({ error: `Timeline mapping failed: ${error instanceof Error ? error.message : String(error)}` }));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
} 