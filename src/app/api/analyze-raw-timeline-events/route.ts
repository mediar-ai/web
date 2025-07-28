import { TIMELINE_MAPPING_ANALYSIS_PROMPT } from '@/lib/prompts';
import { TranscriptItem } from '@/lib/transcriptUtils';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

function toSSE(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// Schema for single batch mapping results with ID-based workflow mapping
// Note: Conditional validation (if/then) removed because Vertex AI doesn't support it
// Validation is handled in application code instead
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
  // Required when confidence_score > 0.5
  workflow_template_id?: number;
  workflow_type_id?: number;
  workflow_instance_id?: number;
  workflow_step_id?: number;
  // Optional
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
  const { userId, model, targetUiEventIds, startDate, endDate, synthesis_session_id }: { 
    userId: string; 
    model: string; 
    targetUiEventIds?: string[];
    startDate?: string;
    endDate?: string;
    synthesis_session_id?: string;
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

        // Get synthesized workflows for the user (include both draft and saved workflows)
        controller.enqueue(toSSE({ status: 'Loading workflows for mapping...', progress: 10 }));
        const { data: workflows, error: workflowError } = await supabaseAdmin
          .from('low_level_workflows')
          .select('id, title, detailed_workflow_data, synthesis_session_id, synthesis_status')
          .eq('user_id', userId)
          .in('synthesis_status', ['draft', 'saved']) // Include both draft and saved workflows
          .not('detailed_workflow_data', 'is', null);

        if (workflowError) {
          console.error('❌ Error fetching workflows:', workflowError);
          controller.enqueue(toSSE({ error: 'Failed to fetch workflows' }));
          controller.close();
          return;
        }

        if (!workflows || workflows.length === 0) {
          controller.enqueue(toSSE({ error: 'No workflows found for mapping. Please ensure you have synthesized workflows available.' }));
          controller.close();
          return;
        }

        console.log(`📊 Found ${workflows.length} workflows for mapping (draft + saved)`);
        controller.enqueue(toSSE({ status: `Found ${workflows.length} workflows for mapping`, progress: 20 }));

        // Fetch transcripts for correlation with timeline events
        controller.enqueue(toSSE({ status: 'Loading conversation transcripts...', progress: 25 }));
        let transcriptsData: TranscriptItem[] = [];
        try {
          let transcriptQuery = supabaseAdmin
            .from('agent_live_transcriptions')
            .select('session_id, role, content, created_at, type, item_id')
            .eq('user_id', userId);

          // Apply same time filtering as other data
          if (startDate && endDate) {
            transcriptQuery = transcriptQuery
              .gte('created_at', startDate)
              .lte('created_at', endDate);
          }

          const { data: transcripts, error: transcriptError } = await transcriptQuery
            .order('created_at', { ascending: true })
            .limit(1000); // More transcripts for timeline correlation

          if (transcriptError) {
            console.warn('Error fetching transcripts for timeline mapping:', transcriptError);
          } else {
            transcriptsData = transcripts || [];
            console.log(`📝 Loaded ${transcriptsData.length} transcript items for timeline correlation`);
          }
        } catch (error) {
          console.warn('Transcript fetching failed, continuing without transcripts:', error);
        }

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
          
          // DEBUG: Log the actual count of UI tree events fetched
          console.log(`🔍 DEBUG: UI tree events fetched: ${uiTreeEvents?.length || 0} events`);
          if (startDate && endDate) {
            console.log(`🔍 DEBUG: Time filtering applied: ${startDate} to ${endDate}`);
          }
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

          // Send initial table setup signal for first batch
          if (batchIndex === 0) {
            controller.enqueue(toSSE({ 
              status: 'Initializing results table...',
              progress: Math.round(currentProgress),
              data: { 
                initializeTable: true,
                totalBatches,
                annotations: [] // Initialize empty table
              }
            }));
          }

          // Fix time window logic for DESC-ordered events
          // For DESC order: current event is newer, next event is older
          const endTime = new Date(uiTreeEvents[batchIndex].created_at);
          let startTime = batchIndex + 1 < totalBatches 
            ? new Date(uiTreeEvents[batchIndex + 1].created_at)
            : new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago for last batch

          // 🛡️ HANDLE DUPLICATE TIMESTAMPS: Add buffer when start and end times are identical
          if (startTime.getTime() === endTime.getTime()) {
            // When timestamps are identical, create a small time window:
            // - Move startTime back by 1 second
            // - Keep endTime as is (or add 1 second for safety)
            startTime = new Date(startTime.getTime() - 1000); // 1 second before
            console.log(`⚠️ Batch ${batchIndex + 1}: Identical timestamps detected, adjusted window to prevent 0-second range`);
            console.log(`   📅 Original time: ${uiTreeEvents[batchIndex].created_at}`);
            console.log(`   📅 Adjusted window: ${startTime.toISOString()} → ${endTime.toISOString()}`);
          }

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

          // IMPROVED: Find corresponding analysis using source UI tree event first, fallback to client_timestamp
          console.log(`🔍 Batch ${batchIndex + 1}: Looking for analysis for UI event at ${endTime.toISOString()}`);
          
          // Strategy 1: Try to find analysis that directly references this UI tree event
          let analysisData = null;
          let analysisError = null;
          
          const currentUiEventId = uiTreeEvents[batchIndex].id;
          console.log(`🎯 Batch ${batchIndex + 1}: Trying direct UI event reference for event ID ${currentUiEventId}`);
          
          const { data: directAnalysisData, error: directAnalysisError } = await supabaseAdmin
            .from('low_level_workflow_analyses')
            .select('id, created_at, client_timestamp, window_title, llm_structured_output, source_ui_tree_event_id')
            .eq('user_id', userId)
            .eq('source_ui_tree_event_id', currentUiEventId)
            .maybeSingle();
          
          if (!directAnalysisError && directAnalysisData) {
            analysisData = directAnalysisData;
            console.log(`✅ Batch ${batchIndex + 1}: Found direct analysis match via source_ui_tree_event_id`);
          } else {
            // Strategy 2: Fallback to improved client_timestamp matching (smaller window)
            console.log(`⚠️ Batch ${batchIndex + 1}: No direct match, falling back to client_timestamp matching`);
            const timeWindow = 30; // REDUCED: 30 seconds instead of 30 minutes!
            const beforeTime = new Date(endTime.getTime() - timeWindow * 1000).toISOString();
            const afterTime = new Date(endTime.getTime() + timeWindow * 1000).toISOString();
            
            const { data: fallbackAnalysisData, error: fallbackAnalysisError } = await supabaseAdmin
              .from('low_level_workflow_analyses')
              .select('id, created_at, client_timestamp, window_title, llm_structured_output, source_ui_tree_event_id')
              .eq('user_id', userId)
              .gte('client_timestamp', beforeTime)  // FIXED: Use client_timestamp instead of created_at
              .lte('client_timestamp', afterTime)   // FIXED: Use client_timestamp instead of created_at
              .order('client_timestamp', { ascending: true })
              .limit(1)
              .maybeSingle();
            
            analysisData = fallbackAnalysisData;
            analysisError = fallbackAnalysisError;
            
            if (analysisData) {
              const timeDiff = Math.abs(new Date(endTime).getTime() - new Date(analysisData.client_timestamp).getTime()) / 1000;
              console.log(`⚠️ Batch ${batchIndex + 1}: Fallback match found with ${timeDiff.toFixed(1)}s difference`);
              
              if (timeDiff > 60) {
                console.warn(`⚠️ Batch ${batchIndex + 1}: Large time difference (${timeDiff.toFixed(1)}s) - annotation may be inaccurate`);
              }
            }
          }

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

          // Fetch labeling data for this analysis to enhance mapping context
          console.log(`🏷️ Fetching labeling data for analysis ID: ${analysisData.id}`);
          const { data: labelingData, error: labelingError } = await supabaseAdmin
            .from('low_level_workflow_labeling')
            .select('selected_labels, suggested_labels')
            .eq('low_level_workflow_analysis_id', analysisData.id)
            .maybeSingle();

          if (labelingError && labelingError.code !== 'PGRST116') {
            console.warn(`⚠️ Error fetching labeling data for analysis ${analysisData.id}:`, labelingError);
          }

          console.log(`✅ Batch ${batchIndex + 1}: ${batchEvents.length} events, analysis: found, labels: ${labelingData?.selected_labels?.length || 0}`);
          
          const batchAnalysis = {
            id: analysisData.id,
            created_at: analysisData.created_at,
            window_title: analysisData.window_title,
            analysis: analysisData.llm_structured_output as {
              step_title?: string;
              step_summary?: string;
              user_goal?: string;
              workflow_context?: Record<string, unknown>;
            },
            // Include labeling data for enhanced context
            selected_labels: labelingData?.selected_labels || [],
            suggested_labels: labelingData?.suggested_labels || []
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
          const prompt = `${TIMELINE_MAPPING_ANALYSIS_PROMPT}\n\nCURRENT BATCH ANALYSIS STEP:\n- Window: ${batchAnalysis.window_title || 'Unknown'}\n- Step: ${batchAnalysis.analysis?.step_title || 'Unknown'}\n- Summary: ${batchAnalysis.analysis?.step_summary || 'No summary'}\n- User Goal: ${batchAnalysis.analysis?.user_goal || 'Unknown goal'}\n- LLM Generated Labels: ${batchAnalysis.selected_labels.length > 0 ? batchAnalysis.selected_labels.join(', ') : 'None'}\n- AI Suggested Labels: ${batchAnalysis.suggested_labels.length > 0 ? batchAnalysis.suggested_labels.join(', ') : 'None'}\n\nAVAILABLE WORKFLOW COMPONENTS WITH IDS:\n\n${workflowComponents.map(wf => `\nWORKFLOW TEMPLATE: ${wf.title} (ID: ${wf.workflow_template_id})\n\nWORKFLOW TYPES:\n${wf.workflow_types.map((wt: Record<string, unknown>) => `- ID: ${wt.id}, Name: "${wt.type_name}", Description: "${wt.type_description}"`).join('\n')}\n\nWORKFLOW INSTANCES:\n${wf.workflow_instances.map((wi: Record<string, unknown>) => `- ID: ${wi.id}, Name: "${wi.instance_name}"`).join('\n')}\n\nWORKFLOW STEPS:\n${wf.steps.map((step: Record<string, unknown>) => `- Step ID: ${step.id}, Name: "${step.step_name}"\n  Substeps: ${(step.substeps as Record<string, unknown>[])?.map((sub: Record<string, unknown>) => `ID: ${sub.id}, Name: "${sub.substep_name}"`).join(', ') || ''}`).join('\n')}\n`).join('\n---\n')}\n\nRAW EVENTS TO MAP (${batchEvents.length} events):\n${batchEvents.map(event => `Event ${event.id}: ${JSON.stringify(event.payload)}`).join('\n')}\n\nANALYSIS GOAL:\nMap each raw event above to determine if it belongs to the current workflow analysis step. Focus on the specific step: "${batchAnalysis.analysis?.step_title || 'Unknown'}" with the goal: "${batchAnalysis.analysis?.user_goal || 'Unknown goal'}"\n\nIMPORTANT: Only use the exact IDs provided above in the WORKFLOW COMPONENTS section.\n\nReturn your analysis in the specified JSON format.`;

          controller.enqueue(toSSE({ 
            status: `Processing batch ${batchIndex + 1} of ${totalBatches} with LLM...`, 
            progress: Math.round(currentProgress),
            data: { currentBatch: batchIndex + 1, totalBatches, phase: 'llm_processing' }
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
            
            // Validate and fix data consistency issues
            result.event_mappings = result.event_mappings.map(mapping => {
              // If confidence > 0.5 but missing required workflow IDs, reduce confidence
              if (mapping.confidence_score > 0.5) {
                const hasRequiredFields = mapping.workflow_template_id && 
                                        mapping.workflow_type_id && 
                                        mapping.workflow_instance_id && 
                                        mapping.workflow_step_id;
                
                if (!hasRequiredFields) {
                  console.warn(`⚠️ Event ${mapping.raw_event_id}: High confidence (${mapping.confidence_score}) but missing workflow IDs. Reducing confidence to 0.4.`);
                  return {
                    ...mapping,
                    confidence_score: 0.4,
                    unrelated_reason: "Could not identify specific workflow components"
                  };
                }
              }
              return mapping;
            });
            
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
              business_logics: mapping.business_logics || null,
              // Session tracking for proper reset behavior
              synthesis_session_id: synthesis_session_id || null,
              annotation_status: 'draft' // Mark as draft during current session
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
                progress: Math.round(currentProgress),
                data: { 
                  annotations: [], // Always send annotations array (empty for failed batches)
                  currentBatch: batchIndex + 1, 
                  totalBatches, 
                  totalMappings,
                  batchHasResults: false,
                  batchStatus: 'error'
                }
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
                annotations: annotationsToInsert, // Always send annotations array
                currentBatch: batchIndex + 1, 
                totalBatches, 
                totalMappings,
                batchHasResults: true,
                batchStatus: 'completed'
              }
            }));
          } else {
            // Always send batch completion status, even for empty batches
            controller.enqueue(toSSE({ 
              status: `⚠️ Batch ${batchIndex + 1}: No mappings generated`, 
              progress: Math.round(currentProgress),
              data: { 
                annotations: [], // Always send empty annotations array for empty batches
                currentBatch: batchIndex + 1, 
                totalBatches, 
                totalMappings,
                batchHasResults: false,
                batchStatus: 'empty'
              }
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