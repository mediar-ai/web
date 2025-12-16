import { TIMELINE_MAPPING_ANALYSIS_PROMPT } from '@/lib/prompts';
import { TranscriptItem } from '@/lib/transcriptUtils';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

function toSSE(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

interface TimelineAnnotation {
  id?: number;
  raw_event_id: number;
  analysis_id: number;
  confidence_score: number;
  is_workflow_related: boolean;
  model_used: string;
  unrelated_reason?: string;
  workflow_template_id?: number;
  workflow_type_id?: number;
  workflow_instance_id?: number;
  workflow_step_id?: number;
  workflow_substep_id?: number;
  inputs?: string;
  outputs?: string;
  business_logics?: string;
  created_at?: string;
  updated_at?: string;
  
  // Additional fields for enriched display
  template_name?: string;
  type_name?: string;
  instance_name?: string;
  step_name?: string;
  substep_name?: string;
  step_title?: string;
  user_intent?: string;
  step_summary?: string;
  window_title?: string;
  event_type?: string;
  selected_labels?: string[];
  suggested_labels?: string[];
}

// Types and interfaces for parallel processing
interface BatchProcessingParams {
  batchIndex: number;
  uiEvent: any; // UI tree event from database
  previousUiEvent?: any; // Add previous UI tree event parameter
  supabaseAdmin: any;
  userId: string;
  model: string;
  workflows: any[];
  synthesis_session_id?: string;
  totalBatches: number;
  TIMELINE_MAPPING_ANALYSIS_PROMPT: string;
  SINGLE_BATCH_MAPPING_SCHEMA: any;
  startDate: string; // Add startDate for timeline start boundary
}

interface BatchResult {
  batchIndex: number;
  uiEventId: number;
  status: 'success' | 'failed_no_events' | 'failed_no_analysis' | 'failed_llm' | 'failed_db' | 'empty_result' | 'skipped_no_previous' | 'empty_no_events';
  eventCount?: number;
  mappingCount?: number;
  error?: string;
  processingTimeMs: number;
  annotations?: any[];
  batchAnalysis?: any;
  startTime?: Date;
  endTime?: Date;
}

interface EventMappingResult {
  raw_event_id: number;
  confidence_score: number;
  unrelated_reason?: string;
  workflow_template_id?: number;
  workflow_type_id?: number;
  workflow_instance_id?: number;
  workflow_step_id?: number;
  workflow_substep_id?: number;
  inputs?: string;
  outputs?: string;
  business_logics?: string;
}

// Helper function to process a single batch in parallel
async function processSingleBatch(params: BatchProcessingParams): Promise<BatchResult> {
  const {
    batchIndex, 
    uiEvent, 
    previousUiEvent, // Add previous UI tree event to parameters
    supabaseAdmin, 
    userId, 
    model, 
    workflows, 
    synthesis_session_id,
    totalBatches,
    TIMELINE_MAPPING_ANALYSIS_PROMPT,
    SINGLE_BATCH_MAPPING_SCHEMA,
    startDate // Timeline start boundary
  } = params;

  const batchStartTime = Date.now();
  const displayIndex = batchIndex + 1; // Convert to 1-based for display

  console.log(`\n📦 [BATCH-${displayIndex}/${totalBatches}] Starting parallel batch processing...`);

  try {
    // ✅ NEW LOGIC: Use UI tree event boundaries (following sequential processor)
    const currentUiEventTimestamp = new Date(uiEvent.created_at);
    
    // Declare variables that will be used throughout the function
    let earlierTimestamp: Date;
    let laterTimestamp: Date;
    let batchEvents: any[];
    
    if (!previousUiEvent) {
      // ✅ ENHANCED: First UI tree - process events from timeline START to first UI tree
      console.log(`✅ [BATCH-${displayIndex}] First UI tree detected - processing from timeline start`);
      const timelineStart = new Date(startDate);
      const firstUiEventTimestamp = new Date(uiEvent.created_at);
      
      console.log(`   Timeline Start: ${timelineStart.toISOString()}`);
      console.log(`   First UI tree:  ${firstUiEventTimestamp.toISOString()}`);
      
      // Set timestamps for processing
      earlierTimestamp = timelineStart;
      laterTimestamp = firstUiEventTimestamp;
      
      // Fetch events BETWEEN timeline start and first UI tree
      const { data: allBatchEvents, error: batchError } = await supabaseAdmin
        .from('low_level_events_enriched')
        .select('*')
        .eq('user_id', userId)
        .gt('created_at', timelineStart.toISOString())     // AFTER timeline start
        .lt('created_at', firstUiEventTimestamp.toISOString()) // BEFORE first UI tree
        .not('event_type', 'in', '(screenshot_diff,ui_tree)') // Exclude both screenshot_diff and ui_tree events
        .order('created_at', { ascending: true });

      if (batchError) {
        console.error(`ERROR fetching batch events for first batch ${displayIndex}:`, batchError);
        return {
          batchIndex: displayIndex,
          uiEventId: uiEvent.id,
          status: 'failed_no_events',
          eventCount: 0,
          processingTimeMs: Date.now() - batchStartTime,
          error: `Error fetching events: ${batchError.message}`
        };
      }

      batchEvents = allBatchEvents || [];

      if (!batchEvents || batchEvents.length === 0) {
        const processingTime = Date.now() - batchStartTime;
        console.log(`WARNING [BATCH-${displayIndex}] No events found between timeline start and first UI tree (${processingTime}ms)`);
        console.log(`WARNING [BATCH-${displayIndex}] Timeline window: ${timelineStart.toISOString()} → ${firstUiEventTimestamp.toISOString()}`);
        
        return {
          batchIndex: displayIndex,
          uiEventId: uiEvent.id,
          status: 'empty_no_events',
          eventCount: 0,
          processingTimeMs: processingTime
        };
      }

      console.log(`SUCCESS [BATCH-${displayIndex}] Found ${batchEvents.length} events between timeline start and first UI tree`);
      
    } else {
    
      const previousUiEventTimestamp = new Date(previousUiEvent.created_at);
      
      console.log(`Processing batch ${displayIndex}: Events between UI trees`);
      console.log(`   Previous UI tree: ${previousUiEventTimestamp.toISOString()}`);
      console.log(`   Current UI tree:  ${currentUiEventTimestamp.toISOString()}`);

      // 🔧 FIX: Since UI events are processed newest-first, we need to swap the comparison logic
      // We want events BETWEEN the two UI tree timestamps, regardless of processing order
      earlierTimestamp = currentUiEventTimestamp < previousUiEventTimestamp ? currentUiEventTimestamp : previousUiEventTimestamp;
      laterTimestamp = currentUiEventTimestamp > previousUiEventTimestamp ? currentUiEventTimestamp : previousUiEventTimestamp;
      
      console.log(`   ✅ CORRECTED: Finding events between ${earlierTimestamp.toISOString()} and ${laterTimestamp.toISOString()}`);
      
      // Fetch events BETWEEN consecutive UI tree events (like sequential processor)
      const { data: allBatchEvents, error: batchError } = await supabaseAdmin
        .from('low_level_events_enriched')
        .select('*')
        .eq('user_id', userId)
        .gt('created_at', earlierTimestamp.toISOString())  // AFTER earlier timestamp
        .lt('created_at', laterTimestamp.toISOString())    // BEFORE later timestamp
        .not('event_type', 'in', '(screenshot_diff,ui_tree)') // Exclude both screenshot_diff and ui_tree events
        .order('created_at', { ascending: true });

      if (batchError) {
        console.error(`ERROR fetching batch events for batch ${displayIndex}:`, batchError);
        return {
          batchIndex: displayIndex,
          uiEventId: uiEvent.id,
          status: 'failed_no_events',
          eventCount: 0,
          processingTimeMs: Date.now() - batchStartTime,
          error: `Error fetching events: ${batchError.message}`
        };
      }

      batchEvents = allBatchEvents || [];

      if (!batchEvents || batchEvents.length === 0) {
        const processingTime = Date.now() - batchStartTime;
        console.log(`WARNING [BATCH-${displayIndex}] No events found between UI tree boundaries (${processingTime}ms)`);
        console.log(`WARNING [BATCH-${displayIndex}] UI tree window: ${earlierTimestamp.toISOString()} → ${laterTimestamp.toISOString()}`);
        
        return {
          batchIndex: displayIndex,
          uiEventId: uiEvent.id,
          status: 'empty_no_events',
          eventCount: 0,
          processingTimeMs: processingTime
        };
      }

      console.log(`SUCCESS [BATCH-${displayIndex}] Found ${batchEvents.length} events between UI tree boundaries`);
    }

    // Find corresponding analysis using ONLY direct UI tree event ID matching
    console.log(`DEBUG Batch ${displayIndex}: Looking for analysis for UI event at ${currentUiEventTimestamp.toISOString()}`);
    
    const currentUiEventId = uiEvent.id;
    console.log(`DEBUG Batch ${displayIndex}: Trying direct UI event reference for event ID ${currentUiEventId}`);
    
    const { data: analysisData, error: analysisError } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('id, created_at, client_timestamp, window_title, llm_structured_output, source_ui_tree_event_id')
      .eq('user_id', userId)
      .eq('source_ui_tree_event_id', currentUiEventId)
      .maybeSingle();
    
    if (!analysisError && analysisData) {
      console.log(`SUCCESS Batch ${displayIndex}: Found direct analysis match via source_ui_tree_event_id`);
    } else {
      console.log(`WARNING Batch ${displayIndex}: No direct analysis match found for UI event ID ${currentUiEventId}`);
    }

    if (analysisError && analysisError.code !== 'PGRST116') {
      console.error(`ERROR fetching analysis for batch ${displayIndex}:`, analysisError);
    }

    if (!analysisData) {
      const processingTime = Date.now() - batchStartTime;
      console.log(`WARNING [BATCH-${displayIndex}] No corresponding analysis found (${processingTime}ms)`);
      console.log(`WARNING [BATCH-${displayIndex}] UI Event ID: ${currentUiEventId}, tried direct + 30s fallback`);
      console.log(`WARNING [BATCH-${displayIndex}] ${batchEvents.length} events will be skipped`);
      
      return {
        batchIndex: displayIndex,
        uiEventId: uiEvent.id,
        status: 'failed_no_analysis',
        eventCount: batchEvents.length,
        processingTimeMs: processingTime,
        error: 'No matching analysis found within 30s window'
      };
    }

    console.log(`SUCCESS [BATCH-${displayIndex}] Analysis found: ${analysisData.id} - "${analysisData.window_title}"`);

    // Fetch labeling data for this analysis to enhance mapping context
    console.log(`LABEL Fetching labeling data for analysis ID: ${analysisData.id}`);
    const { data: labelingData, error: labelingError } = await supabaseAdmin
      .from('low_level_workflow_labeling')
      .select('selected_labels, suggested_labels')
      .eq('low_level_workflow_analysis_id', analysisData.id)
      .maybeSingle();

    if (labelingError && labelingError.code !== 'PGRST116') {
      console.warn(`WARNING Error fetching labeling data for analysis ${analysisData.id}:`, labelingError);
    }

    console.log(`SUCCESS Batch ${displayIndex}: ${batchEvents.length} events, analysis: found, labels: ${labelingData?.selected_labels?.length || 0}`);
    
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
    const prompt = `${TIMELINE_MAPPING_ANALYSIS_PROMPT}\n\nCURRENT BATCH ANALYSIS STEP:\n- Window: ${batchAnalysis.window_title || 'Unknown'}\n- Step: ${batchAnalysis.analysis?.step_title || 'Unknown'}\n- Summary: ${batchAnalysis.analysis?.step_summary || 'No summary'}\n- User Goal: ${batchAnalysis.analysis?.user_goal || 'Unknown goal'}\n- LLM Generated Labels: ${batchAnalysis.selected_labels.length > 0 ? batchAnalysis.selected_labels.join(', ') : 'None'}\n- AI Suggested Labels: ${batchAnalysis.suggested_labels.length > 0 ? batchAnalysis.suggested_labels.join(', ') : 'None'}\n\nAVAILABLE WORKFLOW COMPONENTS WITH IDS:\n\n${workflowComponents.map(wf => `\nWORKFLOW TEMPLATE: ${wf.title} (ID: ${wf.workflow_template_id})\n\nWORKFLOW TYPES:\n${wf.workflow_types.map((wt: Record<string, unknown>) => `- ID: ${wt.id}, Name: "${wt.type_name}", Description: "${wt.type_description}"`).join('\n')}\n\nWORKFLOW INSTANCES:\n${wf.workflow_instances.map((wi: Record<string, unknown>) => `- ID: ${wi.id}, Name: "${wi.instance_name}"`).join('\n')}\n\nWORKFLOW STEPS:\n${wf.steps.map((step: Record<string, unknown>) => `- Step ID: ${step.id}, Name: "${step.step_name}"\n  Substeps: ${(step.substeps as Record<string, unknown>[])?.map((sub: Record<string, unknown>) => `ID: ${sub.id}, Name: "${sub.substep_name}"`).join(', ') || ''}`).join('\n')}\n`).join('\n---\n')}\n\nRAW EVENTS TO MAP (${batchEvents.length} events):\n${batchEvents.map((event: any) => `Event ${event.id}: ${JSON.stringify(event.payload)}`).join('\n')}\n\nANALYSIS GOAL:\nMap each raw event above to determine if it belongs to the current workflow analysis step. Focus on the specific step: "${batchAnalysis.analysis?.step_title || 'Unknown'}" with the goal: "${batchAnalysis.analysis?.user_goal || 'Unknown goal'}"\n\nIMPORTANT: Only use the exact IDs provided above in the WORKFLOW COMPONENTS section.\n\nReturn your analysis in the specified JSON format.`;

    console.log(`Sending batch ${displayIndex} to LLM for timeline mapping...`);

    let result;
    try {
      // Enhanced LLM call logging
      const promptLength = prompt.length;
      const llmStartTime = Date.now();
      console.log(`LLM [BATCH-${displayIndex}] Sending to LLM: ${promptLength} chars, ${batchEvents.length} events, model: ${model}`);
      console.log(`LLM [BATCH-${displayIndex}] Analysis: "${batchAnalysis.analysis?.step_title || 'Unknown'}" in "${batchAnalysis.window_title}"`);
      
      // Retry logic with exponential backoff for rate limits
      const MAX_RETRIES = 3;
      let attempt = 0;
      let lastError: Error | null = null;

      while (attempt < MAX_RETRIES) {
        try {
          const llmResponse = await callVertexWithStructuredOutput(
            prompt,
            {},
            model,
            SINGLE_BATCH_MAPPING_SCHEMA,
            "application/json",
            false,
            { trackingSource: 'workflow_analysis' as const }
          );
          
          const llmProcessingTime = Date.now() - llmStartTime;
          console.log(`SUCCESS [BATCH-${displayIndex}] LLM response received (${llmProcessingTime}ms)`);
          
          result = llmResponse as { event_mappings: EventMappingResult[] };
          break; // Success, exit retry loop
          
        } catch (error) {
          lastError = error as Error;
          attempt++;
          
          // Check if this is a rate limit error
          const isRateLimitError = error instanceof Error && (
            error.message.includes('429') ||
            error.message.includes('quota') ||
            error.message.includes('rate limit') ||
            error.message.includes('Too Many Requests')
          );
          
          if (isRateLimitError && attempt < MAX_RETRIES) {
            // Exponential backoff with jitter for rate limits
            const baseDelay = 1000; // 1 second base
            const backoffDelay = baseDelay * Math.pow(2, attempt - 1);
            const jitter = Math.random() * 1000; // Add up to 1 second jitter
            const totalDelay = backoffDelay + jitter;
            
            console.log(`RATE_LIMIT [BATCH-${displayIndex}] Rate limit detected (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${Math.round(totalDelay)}ms...`);
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, totalDelay));
            continue;
          } else {
            // Non-rate-limit error or max retries reached, throw immediately
            throw error;
          }
        }
      }
      
      if (!result) {
        throw lastError || new Error('Failed to get LLM response after retries');
      }
      
      // Log LLM response details
      if (result.event_mappings) {
        const highConfidence = result.event_mappings.filter(m => m.confidence_score > 0.5).length;
        const lowConfidence = result.event_mappings.filter(m => m.confidence_score <= 0.5).length;
        console.log(`STATS [BATCH-${displayIndex}] LLM Results: ${result.event_mappings.length} mappings (${highConfidence} high confidence, ${lowConfidence} low confidence)`);
      }
      
      // Validate and fix data consistency issues
      result.event_mappings.forEach(mapping => {
        // If high confidence but missing workflow IDs, downgrade confidence
        if (mapping.confidence_score > 0.5 && 
            !mapping.workflow_template_id && !mapping.workflow_type_id && 
            !mapping.workflow_instance_id && !mapping.workflow_step_id) {
          console.log(`WARNING Event ${mapping.raw_event_id}: High confidence (${mapping.confidence_score}) but missing workflow IDs. Reducing confidence to 0.4.`);
          mapping.confidence_score = 0.4;
          mapping.unrelated_reason = mapping.unrelated_reason || "Could not identify specific workflow components.";
        }
      });
      
      console.log(`SUCCESS Successfully mapped batch ${displayIndex}: ${result.event_mappings.length} events mapped`);
    } catch (error) {
      const processingTime = Date.now() - batchStartTime;
              console.error(`ERROR [BATCH-${displayIndex}] LLM processing failed (${processingTime}ms):`, error);
      
      // Determine if this was a rate limit failure for reporting
      const wasRateLimited = error instanceof Error && (
        error.message.includes('429') ||
        error.message.includes('quota') ||
        error.message.includes('rate limit')
      );
      
      return {
        batchIndex: displayIndex,
        uiEventId: uiEvent.id,
        status: 'failed_llm',
        eventCount: batchEvents.length,
        processingTimeMs: processingTime,
        error: `LLM Error${wasRateLimited ? ' (Rate Limited)' : ''}: ${error instanceof Error ? error.message : String(error)}`
      };
    }

    // Save batch results to database
    if (result.event_mappings.length > 0) {
      console.log(`DB [BATCH-${displayIndex}] Preparing to save ${result.event_mappings.length} mappings`);
      console.log(`DB [BATCH-${displayIndex}] Analysis ID: ${batchAnalysis.id}, Session: ${synthesis_session_id || 'none'}`);
      
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

      // Log sample annotation for debugging
              console.log(`DB [BATCH-${displayIndex}] Sample annotation:`, JSON.stringify({
        raw_event_id: annotationsToInsert[0]?.raw_event_id,
        confidence_score: annotationsToInsert[0]?.confidence_score,
        is_workflow_related: annotationsToInsert[0]?.is_workflow_related,
        workflow_template_id: annotationsToInsert[0]?.workflow_template_id,
        unrelated_reason: annotationsToInsert[0]?.unrelated_reason?.slice(0, 100) + '...'
      }, null, 2));

      const dbStartTime = Date.now();
      const { error: insertError } = await supabaseAdmin
        .from('raw_timeline_event_annotations')
        .insert(annotationsToInsert);

      const dbProcessingTime = Date.now() - dbStartTime;

      if (insertError) {
        const totalProcessingTime = Date.now() - batchStartTime;
        console.error(`ERROR [BATCH-${displayIndex}] Database save failed (${dbProcessingTime}ms):`, insertError);
        console.error(`ERROR [BATCH-${displayIndex}] DB Error details:`, {
          errorCode: insertError.code,
          errorMessage: insertError.message,
          errorDetails: insertError.details,
          annotationCount: annotationsToInsert.length,
          analysisId: batchAnalysis.id,
          userId: userId
        });
        
        return {
          batchIndex: displayIndex,
          uiEventId: uiEvent.id,
          status: 'failed_db',
          eventCount: batchEvents.length,
          mappingCount: result.event_mappings.length,
          processingTimeMs: totalProcessingTime,
          error: `DB Error: ${insertError.code} - ${insertError.message}`
        };
      }

              console.log(`DB Successfully saved batch ${displayIndex}: ${result.event_mappings.length} annotations`);
      
      // Helper function to resolve workflow names for real-time UI updates
      const enrichAnnotationsWithNames = (annotations: typeof annotationsToInsert) => {
        return annotations.map(annotation => {
          // Find the workflow this annotation refers to
          const workflow = workflows.find(w => w.id === annotation.workflow_template_id);
          if (!workflow?.detailed_workflow_data?.workflow_components_with_ids) {
            return {
              ...annotation,
              template_name: workflow?.title || 'Unknown Template',
              type_name: 'Unknown Type',
              instance_name: 'Unknown Instance',
              step_name: 'Unknown Step',
              substep_name: 'Unknown Substep',
              step_title: batchAnalysis.analysis?.step_title || 'Unknown Step',
              user_intent: batchAnalysis.analysis?.user_goal || '',
              step_summary: batchAnalysis.analysis?.step_summary || '',
              window_title: batchAnalysis.window_title || '',
              event_type: 'unknown',
              selected_labels: batchAnalysis.selected_labels || [],
              suggested_labels: batchAnalysis.suggested_labels || []
            };
          }

          const components = workflow.detailed_workflow_data.workflow_components_with_ids as any;
          const names: any = {
            template_name: workflow.title,
            type_name: 'Unknown Type',
            instance_name: 'Unknown Instance',
            step_name: 'Unknown Step',
            substep_name: 'Unknown Substep'
          };

          // Find names for each component
          if (annotation.workflow_type_id && components.workflow_types) {
            const type = components.workflow_types.find((t: any) => t.id === annotation.workflow_type_id);
            if (type) names.type_name = type.type_name;
          }

          if (annotation.workflow_instance_id && components.workflow_instances) {
            const instance = components.workflow_instances.find((i: any) => i.id === annotation.workflow_instance_id);
            if (instance) names.instance_name = instance.instance_name;
          }

          if (annotation.workflow_step_id && components.steps) {
            const step = components.steps.find((s: any) => s.id === annotation.workflow_step_id);
            if (step) {
              names.step_name = step.step_name;
              
              if (annotation.workflow_substep_id && step.substeps) {
                const substep = step.substeps.find((sub: any) => sub.id === annotation.workflow_substep_id);
                if (substep) names.substep_name = substep.substep_name;
              }
            }
          }

          return {
            ...annotation,
            ...names,
            step_title: batchAnalysis.analysis?.step_title || 'Unknown Step',
            user_intent: batchAnalysis.analysis?.user_goal || '',
            step_summary: batchAnalysis.analysis?.step_summary || '',
            window_title: batchAnalysis.window_title || '',
            event_type: 'unknown',
            selected_labels: batchAnalysis.selected_labels || [],
            suggested_labels: batchAnalysis.suggested_labels || []
          };
        });
      };

      // Enrich annotations with human-readable names for UI
      const enrichedAnnotations = enrichAnnotationsWithNames(annotationsToInsert);

      const totalProcessingTime = Date.now() - batchStartTime;
              console.log(`SUCCESS [BATCH-${displayIndex}] SUCCESS: ${result.event_mappings.length} annotations saved in ${totalProcessingTime}ms (DB: ${dbProcessingTime}ms)`);
      
      return {
        batchIndex: displayIndex,
        uiEventId: uiEvent.id,
        status: 'success',
        eventCount: batchEvents.length,
        mappingCount: result.event_mappings.length,
        processingTimeMs: totalProcessingTime,
        annotations: enrichedAnnotations,
        batchAnalysis,
        startTime: earlierTimestamp, // Use start of time window
        endTime: laterTimestamp // Use end of time window
      };
    } else {
      const totalProcessingTime = Date.now() - batchStartTime;
              console.log(`WARNING [BATCH-${displayIndex}] No mappings generated after LLM processing (${totalProcessingTime}ms)`);
      
      return {
        batchIndex: displayIndex,
        uiEventId: uiEvent.id,
        status: 'empty_result',
        eventCount: batchEvents.length,
        mappingCount: 0,
        processingTimeMs: totalProcessingTime
      };
    }

  } catch (error) {
    const processingTime = Date.now() - batchStartTime;
          console.error(`ERROR [BATCH-${displayIndex}] Unexpected error during processing (${processingTime}ms):`, error);
    
    return {
      batchIndex: displayIndex,
      uiEventId: uiEvent.id,
      status: 'failed_llm',
      eventCount: 0,
      processingTimeMs: processingTime,
      error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
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

  // 🔧 NEW: Require explicit timeframe selection
  if (!startDate || !endDate) {
    return new Response(JSON.stringify({ 
      error: 'Timeframe selection is required. Please specify both startDate and endDate to process timeline annotations.',
      details: 'Select a time period using the timeframe selector before processing timeline annotations.'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Enhanced logging with timestamp and request details
  const startTime = new Date().toISOString();
  console.log(`🔄 [${startTime}] Starting time-bounded timeline mapping for user: ${userId} from ${startDate} to ${endDate}`);
  console.log(`📋 [TIMELINE-MAPPING] Model: ${model}, Session: ${synthesis_session_id || 'none'}, Target events: ${targetUiEventIds?.length || 'all'}`);

  // Log time boundary information
  console.log(`🔄 Starting time-bounded timeline mapping for user: ${userId} from ${startDate} to ${endDate}`);

  // Use a ReadableStream to send progress updates as they happen
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(toSSE({ status: 'Initializing timeline mapping...', progress: 5 }));

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

        // ✅ SEQUENTIAL PROCESSOR APPROACH: Fetch UI tree events as boundaries for event selection
        // Each UI tree represents a state snapshot - events between UI trees represent user interactions
        const statusMessage = targetUiEventIds 
          ? `Loading specific UI tree events (${targetUiEventIds.length})...`
          : 'Loading UI tree state boundaries for event selection...';
        controller.enqueue(toSSE({ status: statusMessage, progress: 30 }));

        console.log(`🔄 [TIMELINE-MAPPING] Using sequential processor approach: UI tree events as boundaries`);
        console.log(`📋 [APPROACH] Each batch processes events BETWEEN consecutive UI tree events (not arbitrary time windows)`);

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
          // Apply user-specified time boundaries (now required)
          const query = supabaseAdmin
            .from('low_level_events_enriched')
            .select('id, created_at, payload')
            .eq('user_id', userId)
            .eq('event_type', 'ui_tree')
            .gte('created_at', startDate)
            .lte('created_at', endDate);

          controller.enqueue(toSSE({ 
            status: `Filtering events from ${new Date(startDate).toLocaleString()} to ${new Date(endDate).toLocaleString()}...`,
            progress: 35 
          }));

          const { data, error } = await query.order('created_at', { ascending: false });
          uiTreeEvents = data;
          recentEventsError = error;
          
          // DEBUG: Log the actual count of UI tree events fetched
          console.log(`🔍 DEBUG: UI tree events fetched: ${uiTreeEvents?.length || 0} events`);
          console.log(`🔍 DEBUG: Time filtering applied: ${startDate} to ${endDate}`);
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
        controller.enqueue(toSSE({ 
          status: `Processing ${totalBatches} UI tree events in parallel...`, 
          progress: 50,
          data: { totalBatches }
        }));

        console.log(`STATS [TIMELINE-MAPPING] Starting ${totalBatches} parallel batch processing`);

        // Initialize batch list for frontend
        controller.enqueue(toSSE({
          type: 'batch_init',
          data: {
            batches: uiTreeEvents.map((event, index) => {
              const prevEvent = index > 0 ? uiTreeEvents[index - 1] : null;
              return {
                id: index + 1,
                timeWindow: prevEvent 
                  ? `${new Date(prevEvent.created_at).toLocaleTimeString()} → ${new Date(event.created_at).toLocaleTimeString()}`
                  : 'First event (no previous)',
                status: 'pending'
              };
            })
          }
        }));

        // Initialize table for first batch (send immediately for parallel processing)
          controller.enqueue(toSSE({ 
          status: 'Initializing parallel batch processing...',
          progress: 50,
              data: { 
                initializeTable: true,
                totalBatches,
                annotations: [] // Initialize empty table
              }
            }));

        // Parallel processing: Create all batch promises at once
        let completedBatches = 0;
        let totalMappings = 0;
        const parallelAnnotations: TimelineAnnotation[] = [];
        const parallelBatchResults: Array<BatchResult> = [];

        // Find the SINGLE_BATCH_MAPPING_SCHEMA constant
        const SINGLE_BATCH_MAPPING_SCHEMA = {
          type: "object",
          properties: {
            event_mappings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  raw_event_id: { type: "number" },
                  confidence_score: { type: "number" },
                  unrelated_reason: { type: "string" },
                  workflow_template_id: { type: "number" },
                  workflow_type_id: { type: "number" },
                  workflow_instance_id: { type: "number" },
                  workflow_step_id: { type: "number" },
                  workflow_substep_id: { type: "number" },
                  inputs: { type: "string" },
                  outputs: { type: "string" },
                  business_logics: { type: "string" }
                },
                required: ["raw_event_id", "confidence_score"]
              }
            }
          },
          required: ["event_mappings"]
        };

        // Progress tracking for parallel execution
        const handleBatchCompletion = (result: BatchResult) => {
          completedBatches++;
          parallelBatchResults.push(result);
          
          const progress = 50 + (completedBatches / totalBatches) * 40;
          
          console.log(`SUCCESS [PARALLEL-BATCH-${result.batchIndex}] Completed: ${completedBatches}/${totalBatches} batches done`);
          
          // Stream individual batch completion
          if (result.status === 'success' && result.annotations) {
            parallelAnnotations.push(...result.annotations);
            totalMappings += result.mappingCount || 0;

            // Send incremental results to frontend for real-time table updates
            controller.enqueue(toSSE({ 
              type: 'batch_update',
              status: `Batch ${result.batchIndex} completed (${result.processingTimeMs}ms) - ${completedBatches}/${totalBatches} done`, 
              progress: Math.round(progress),
              data: { 
                annotations: result.annotations, // Send batch annotations for incremental UI update
                currentBatch: result.batchIndex, 
                totalBatches, 
                totalMappings,
                completedCount: completedBatches,
                batchHasResults: true,
                batchStatus: 'completed',
                parallelMode: true, // Flag to indicate parallel processing
                batchIndex: result.batchIndex,
                processingTimeMs: result.processingTimeMs,
                eventCount: result.eventCount || 0,
                mappingCount: result.mappingCount || 0
              }
            }));
          } else {
            // Handle failed batches
            controller.enqueue(toSSE({ 
              type: 'batch_update',
              status: `Batch ${result.batchIndex} ${result.status} - ${completedBatches}/${totalBatches} done`, 
              progress: Math.round(progress),
              data: { 
                annotations: [], 
                currentBatch: result.batchIndex, 
                totalBatches, 
                totalMappings,
                completedCount: completedBatches,
                batchHasResults: false,
                batchStatus: result.status,
                batchError: result.error,
                parallelMode: true,
                batchIndex: result.batchIndex,
                processingTimeMs: result.processingTimeMs || 0,
                eventCount: result.eventCount || 0,
                mappingCount: 0
              }
            }));
          }
        };

        // Create batch processing promises for all batches
        const batchPromises = uiTreeEvents.map((uiEvent: any, index: number) => 
          processSingleBatch({
            batchIndex: index,
            uiEvent,
            previousUiEvent: index > 0 ? uiTreeEvents[index - 1] : undefined, // Pass previous UI tree event
            supabaseAdmin,
            userId,
            model,
            workflows,
            synthesis_session_id,
            totalBatches,
            TIMELINE_MAPPING_ANALYSIS_PROMPT,
            SINGLE_BATCH_MAPPING_SCHEMA,
            startDate // Pass startDate for timeline boundary
          }).then(result => {
            // Handle completion in real-time
            handleBatchCompletion(result);
            return result;
          }).catch((error: Error) => {
            // Handle unexpected errors in batch processing
            const errorResult: BatchResult = {
              batchIndex: index + 1,
              uiEventId: uiEvent.id,
              status: 'failed_llm',
              eventCount: 0,
              processingTimeMs: 0,
              error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
            };
            handleBatchCompletion(errorResult);
            return errorResult;
          })
        );

        // Send initial parallel processing status
        controller.enqueue(toSSE({ 
          status: `🚀 Processing ${totalBatches} batches in parallel...`, 
          progress: 55,
          data: { 
            totalBatches,
            parallelMode: true,
            phase: 'parallel_processing_started'
          }
        }));

        // Wait for all batches to complete
        console.log(`🚀 [PARALLEL-PROCESSING] Starting ${totalBatches} concurrent batch operations...`);
        const results = await Promise.allSettled(batchPromises);
        
        // All batches completed - process final results
        const successful = results
          .filter(r => r.status === 'fulfilled' && r.value.status === 'success')
          .map(r => (r as PromiseFulfilledResult<BatchResult>).value);

        const failed = results
          .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status !== 'success'))
          .map((r, index) => ({ 
            batchIndex: index + 1, 
            error: r.status === 'rejected' ? r.reason : (r as PromiseFulfilledResult<BatchResult>).value.error 
          }));

        console.log(`🎉 [PARALLEL-PROCESSING] Completed: ${successful.length} successful, ${failed.length} failed batches`);
        console.log(`📋 [PROCESSING-APPROACH] Used UI tree boundaries instead of arbitrary time windows - should eliminate previous Batch 14 failures`);

        // Use parallel results for final processing
        const allAnnotations = parallelAnnotations;
        const batchResults = parallelBatchResults;

        // Comprehensive batch processing summary
        const endTime = new Date().toISOString();
        const totalProcessingTime = Date.now() - new Date(startTime).getTime();
        
        console.log(`\n📊 [TIMELINE-MAPPING] FINAL SUMMARY (${endTime})`);
        console.log(`⏱️  Total processing time: ${totalProcessingTime}ms`);
        console.log(`📈 Total batches processed: ${totalBatches}`);
        console.log(`📈 Total mappings created: ${totalMappings}`);
        console.log(`📈 Success rate: ${((batchResults.filter(b => b.status === 'success').length / totalBatches) * 100).toFixed(1)}%`);
        
        // Batch status breakdown
        const statusCounts = batchResults.reduce((acc, batch) => {
          acc[batch.status] = (acc[batch.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        console.log(`\n📊 [BATCH-BREAKDOWN] Status distribution:`);
        Object.entries(statusCounts).forEach(([status, count]) => {
          const percentage = ((count / totalBatches) * 100).toFixed(1);
          console.log(`  ${status}: ${count}/${totalBatches} (${percentage}%)`);
        });
        
        // Failed batch analysis
        const failedBatches = batchResults.filter(b => b.status !== 'success');
        if (failedBatches.length > 0) {
          console.log(`\n🚨 [FAILED-BATCHES] ${failedBatches.length} batches failed:`);
          failedBatches.forEach(batch => {
            console.log(`  Batch ${batch.batchIndex}: ${batch.status} - ${batch.error || 'No error details'} (${batch.processingTimeMs}ms)`);
          });
        }
        
        // Performance analysis
        const avgProcessingTime = batchResults.reduce((sum, b) => sum + (b.processingTimeMs || 0), 0) / batchResults.length;
        const maxProcessingTime = Math.max(...batchResults.map(b => b.processingTimeMs || 0));
        const minProcessingTime = Math.min(...batchResults.map(b => b.processingTimeMs || 0));
        
        console.log(`\n⚡ [PERFORMANCE] Batch processing times:`);
        console.log(`  Average: ${avgProcessingTime.toFixed(0)}ms`);
        console.log(`  Range: ${minProcessingTime}ms - ${maxProcessingTime}ms`);
        
        // Events analysis
        const totalEvents = batchResults.reduce((sum, b) => sum + (b.eventCount || 0), 0);
        const totalMapped = batchResults.reduce((sum, b) => sum + (b.mappingCount || 0), 0);
        
        console.log(`\n📋 [EVENTS-ANALYSIS]:`);
        console.log(`  Total events in all batches: ${totalEvents}`);
        console.log(`  Total events mapped: ${totalMapped}`);
        console.log(`  Mapping rate: ${totalEvents > 0 ? ((totalMapped / totalEvents) * 100).toFixed(1) : 0}%`);

        // Final completion
        controller.enqueue(toSSE({ 
          status: `Timeline mapping completed! Total mappings: ${totalMappings}`, 
          progress: 100,
          data: { 
            totalMappings, 
            totalBatches,
            completed: true,
            annotations: allAnnotations
          }
        }));

        console.log(`🎉 [TIMELINE-MAPPING] Completed for user ${userId}. Final result: ${totalMappings}/${totalEvents} events mapped (${((totalMappings/totalEvents)*100).toFixed(1)}%)`);
        controller.close();

      } catch (error) {
        const errorTime = new Date().toISOString();
        const totalRunTime = Date.now() - new Date(startTime).getTime();
        
        console.error(`❌ [TIMELINE-MAPPING] CRITICAL FAILURE (${errorTime}):`, error);
        console.error(`❌ [TIMELINE-MAPPING] Runtime before failure: ${totalRunTime}ms`);
        console.error(`❌ [TIMELINE-MAPPING] Context:`, {
          userId,
          model,
          synthesis_session_id,
          targetUiEventIds: targetUiEventIds?.length || 'all',
          hasStartEndDate: !!(startDate && endDate),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          stackTrace: error instanceof Error ? error.stack : 'No stack trace'
        });
        
        controller.enqueue(toSSE({ 
          error: `Timeline mapping failed: ${error instanceof Error ? error.message : String(error)}`,
          data: { 
            failureTime: errorTime,
            runtime: totalRunTime,
            context: { userId, model, synthesis_session_id }
          }
        }));
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