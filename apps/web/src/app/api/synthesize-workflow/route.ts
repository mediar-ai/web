import { WORKFLOW_SYNTHESIS_PROMPT, WORKFLOW_SYNTHESIS_SCHEMA } from '@/lib/prompts';
import { buildComprehensiveContext, TranscriptItem } from '@/lib/transcriptUtils';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

interface WorkflowSynthesisInput {
  name: string;
  trigger?: string;
  terminator?: string;
}

// Helper function to process events (same as original)
function processEvents(events: Array<{ id: string; timestamp: string; window_title: string; analysis: Record<string, unknown>; labels: string[] }>) {
  return events.map(event => ({
    analysis_id: event.id,
    timestamp: event.timestamp,
    window_title: event.window_title,
    ...event.analysis,
    embedded_labels: event.labels // Include labels directly in the event data
  }));
}

export async function POST(req: NextRequest) {
  console.log('🚀 ===== SYNTHESIS DEBUG SESSION STARTED =====');
  const debugSessionId = Date.now().toString();
  console.log(`📋 DEBUG SESSION ID: ${debugSessionId}`);
  
  try {
    const requestBody = await req.json();
    console.log(`🔍 [${debugSessionId}] RAW REQUEST BODY:`, JSON.stringify(requestBody, null, 2));
    
    const { model: modelName, context, startDate, endDate } = requestBody;
    console.log(`🎯 [${debugSessionId}] MODEL NAME: ${modelName}`);
    console.log(`[STATS] [${debugSessionId}] CONTEXT KEYS: ${Object.keys(context || {}).join(', ')}`);

    if (!modelName || !context) {
      console.log(`[ERROR] [${debugSessionId}] MISSING REQUIRED PARAMETERS:`, { modelName: !!modelName, context: !!context });
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    if (!context.userId) {
      console.log(`[ERROR] [${debugSessionId}] MISSING USER ID`);
      return NextResponse.json({ error: 'Missing userId in context' }, { status: 400 });
    }

    // 🔧 NEW: Require explicit timeframe selection
    if (!startDate || !endDate) {
      console.log(`❌ [${debugSessionId}] MISSING TIMEFRAME: startDate=${!!startDate}, endDate=${!!endDate}`);
      return NextResponse.json({ 
        error: 'Timeframe selection is required. Please specify both startDate and endDate for workflow synthesis.',
        details: 'Select a time period using the timeframe selector before synthesizing workflows.'
      }, { status: 400 });
    }

    console.log(`👤 [${debugSessionId}] USER ID: ${context.userId}`);
    console.log(`🕐 [${debugSessionId}] TIME BOUNDARIES: ${startDate} to ${endDate}`);
    console.log(`📝 [${debugSessionId}] USER INSTRUCTIONS: ${context.userInstructions ? 'YES - ' + context.userInstructions.length + ' chars' : 'NO'}`);
    console.log(`🏢 [${debugSessionId}] WORKFLOW CONTEXT:`, JSON.stringify(context.workflowContext, null, 2));
    console.log(`📋 [${debugSessionId}] WORKFLOWS COUNT: ${context.workflows ? context.workflows.length : 'N/A'}`);

    // Fetch analyses from database (reusing logic from fetch-combined-analyses-v2)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.log(`[ERROR] [${debugSessionId}] MISSING SUPABASE ENV VARS`);
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    console.log(`[SUCCESS] [${debugSessionId}] SUPABASE CLIENT CREATED`);
    
    // Fetch analyses first
    console.log(`🔍 [${debugSessionId}] FETCHING ANALYSES FOR USER: ${context.userId}`);
    // Fetch analyses first with optional time filtering
    let query = supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('id, client_timestamp, window_title, llm_structured_output')
      .eq('user_id', context.userId);

    // Apply time filtering (now required)
    query = query
      .gte('client_timestamp', startDate)
      .lte('client_timestamp', endDate);
    console.log(`🕐 [${debugSessionId}] TIME FILTERING: Applied to analyses query from ${startDate} to ${endDate}`);

    const { data: analysesData, error: analysesError } = await query
      .order('client_timestamp', { ascending: false })
      .limit(1000);

    if (analysesError) {
      console.log(`[ERROR] [${debugSessionId}] ANALYSES FETCH ERROR:`, analysesError);
      throw new Error(`Failed to fetch analyses: ${analysesError.message}`);
    }

    if (!analysesData || analysesData.length === 0) {
      console.log(`[ERROR] [${debugSessionId}] NO ANALYSIS DATA FOUND`);
      throw new Error('No analysis data found for this user');
    }

    console.log(`[SUCCESS] [${debugSessionId}] FETCHED ${analysesData.length} ANALYSES`);
    console.log(`[STATS] [${debugSessionId}] FIRST ANALYSIS SAMPLE:`, JSON.stringify(analysesData[0], null, 2));

    // Get all analysis IDs to fetch labels
    const analysisIds = analysesData.map(item => item.id);
    console.log(`🏷️ [${debugSessionId}] FETCHING LABELS FOR ${analysisIds.length} ANALYSES`);
    
    // Fetch labels for these analyses
    const { data: labelsData, error: labelsError } = await supabaseAdmin
      .from('low_level_workflow_labeling')
      .select('low_level_workflow_analysis_id, selected_labels')
      .in('low_level_workflow_analysis_id', analysisIds);

    if (labelsError) {
      console.warn(`[WARN] [${debugSessionId}] LABELS FETCH ERROR:`, labelsError);
      // Continue without labels rather than failing completely
    }

    console.log(`🏷️ [${debugSessionId}] FETCHED ${labelsData?.length || 0} LABEL RECORDS`);

    // Create a map of analysis_id -> labels for quick lookup
    const labelsMap = new Map();
    labelsData?.forEach(label => {
      labelsMap.set(label.low_level_workflow_analysis_id, label.selected_labels);
    });

    console.log(`🗺️ [${debugSessionId}] CREATED LABELS MAP WITH ${labelsMap.size} ENTRIES`);

    // Transform data to the same format as fetch-combined-analyses-v2
    const analyses = analysesData.map((item: Record<string, unknown>) => {
      // Extract the JSONB analysis data
      const analysisData = item.llm_structured_output || {};
      
      // Remove unwanted fields from analysis data and keep only the ones we want
      const cleanAnalysisData = Object.fromEntries(
        Object.entries(analysisData).filter(([key]) => 
          !['generation_timestamp', 'context_metadata', 'label_status', 'schema_version'].includes(key)
        )
      );

      // Get selected labels from the labels map
      const selectedLabels = labelsMap.get(item.id) || [];

      return {
        id: item.id as string,
        timestamp: item.client_timestamp as string,
        window_title: item.window_title as string,
        analysis: cleanAnalysisData,
        labels: selectedLabels as string[]
      };
    });

    console.log(`🔄 [${debugSessionId}] TRANSFORMED ${analyses.length} ANALYSES`);
    console.log(`[STATS] [${debugSessionId}] SAMPLE TRANSFORMED ANALYSIS:`, JSON.stringify(analyses[0], null, 2));

    // Fetch transcripts for the same time range if they exist
    let transcriptsData: TranscriptItem[] = [];
    console.log(`🎤 [${debugSessionId}] FETCHING TRANSCRIPTS FOR USER: ${context.userId}`);
    try {
      let transcriptQuery = supabaseAdmin
        .from('agent_live_transcriptions')
        .select('session_id, role, content, created_at, type, item_id')
        .eq('user_id', context.userId);

      // Apply same time filtering as analyses (now required)
      transcriptQuery = transcriptQuery
        .gte('created_at', startDate)
        .lte('created_at', endDate);
      console.log(`🕐 [${debugSessionId}] TIME FILTERING: Applied to transcripts query from ${startDate} to ${endDate}`);

      const { data: transcripts, error: transcriptError } = await transcriptQuery.order('created_at', { ascending: true })
        .limit(500); // Limit transcripts to prevent overwhelming context

      if (transcriptError) {
        console.warn(`[ERROR] [${debugSessionId}] TRANSCRIPT FETCH ERROR:`, transcriptError);
      } else {
        transcriptsData = transcripts || [];
        console.log(`[SUCCESS] [${debugSessionId}] LOADED ${transcriptsData.length} TRANSCRIPT ITEMS`);
        
        if (transcriptsData.length > 0) {
          console.log(`[STATS] [${debugSessionId}] TRANSCRIPT SESSION: ${transcriptsData[0]?.session_id}`);
          console.log(`[STATS] [${debugSessionId}] TRANSCRIPT TIME RANGE: ${transcriptsData[0]?.created_at} to ${transcriptsData[transcriptsData.length - 1]?.created_at}`);
          console.log(`[STATS] [${debugSessionId}] SAMPLE TRANSCRIPT:`, JSON.stringify(transcriptsData[0], null, 2));
        }
      }
    } catch (error) {
      console.error(`[ERROR] [${debugSessionId}] TRANSCRIPT FETCH EXCEPTION:`, error);
    }

    // Check if this is multiple workflows synthesis  
    const isMultipleWorkflows = context.workflows && Array.isArray(context.workflows);
    console.log(`🔀 [${debugSessionId}] IS MULTIPLE WORKFLOWS: ${isMultipleWorkflows}`);
    
    console.log(`🎯 [${debugSessionId}] SYNTHESIZING:`, isMultipleWorkflows ? 
      `${context.workflows.length} workflows with ${analyses.length} analyses` :
      `single workflow with ${context.events?.length || 0} events`);
    
    let prompt: string;
    
    if (isMultipleWorkflows && context.workflows) {
      console.log(`🔄 [${debugSessionId}] PROCESSING MULTIPLE WORKFLOWS`);
      console.log(`📋 [${debugSessionId}] WORKFLOWS:`, JSON.stringify(context.workflows, null, 2));
      
      // Multiple workflows synthesis - events are now global
      const processedGlobalEvents = analyses ? processEvents(analyses) : [];
      console.log(`🔄 [${debugSessionId}] PROCESSED ${processedGlobalEvents.length} GLOBAL EVENTS`);
      console.log(`[STATS] [${debugSessionId}] SAMPLE PROCESSED EVENT:`, JSON.stringify(processedGlobalEvents[0], null, 2));
      
      const workflowDetails = context.workflows.map((workflow: WorkflowSynthesisInput) => {
        return `WORKFLOW: ${workflow.name}
TRIGGER: ${workflow.trigger || 'Not specified'}
TERMINATOR: ${workflow.terminator || 'Not specified'}`;
      }).join('\n\n---\n\n');
      
      const workflowNames = context.workflows.map((w: WorkflowSynthesisInput) => w.name).join(', ');
      console.log(`📝 [${debugSessionId}] WORKFLOW NAMES: ${workflowNames}`);
      console.log(`📋 [${debugSessionId}] WORKFLOW DETAILS:`, workflowDetails);
      
      // Build comprehensive context including transcripts and user instructions
      console.log(`🚀 [${debugSessionId}] BUILDING COMPREHENSIVE CONTEXT`);
      console.log(`📋 [${debugSessionId}] USER INSTRUCTIONS: ${context.userInstructions ? 'YES - ' + context.userInstructions.substring(0, 50) + '...' : 'NO'}`);
      
      const comprehensiveContext = buildComprehensiveContext(
        transcriptsData, 
        context.userInstructions
      );

      console.log(`🔗 [${debugSessionId}] COMPREHENSIVE CONTEXT LENGTH: ${comprehensiveContext.length} characters`);
      console.log(`📤 [${debugSessionId}] CONTEXT PREVIEW:`, comprehensiveContext.substring(0, 200) + '...');
      
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}
      
      IMPORTANT: You must synthesize workflows for EXACTLY these workflow names (do not change or create new names): ${workflowNames}
      
      User's High-Level Context:
      ${JSON.stringify(context.workflowContext, null, 2)}
      
      ${comprehensiveContext}
      
      WORKFLOW DEFINITIONS:
${workflowDetails}

ALL EVENTS (determine which events belong to which workflows based on the triggers/terminators above):
${JSON.stringify(processedGlobalEvents, null, 2)}

Note: Each event contains embedded labels where available.`;

      console.log(`📏 [${debugSessionId}] FINAL PROMPT LENGTH: ${prompt.length} characters`);
      console.log(`📤 [${debugSessionId}] PROMPT PREVIEW (first 500 chars):`, prompt.substring(0, 500) + '...');
      console.log(`📤 [${debugSessionId}] PROMPT PREVIEW (last 500 chars):`, '...' + prompt.substring(prompt.length - 500));
      
      // [STATS] CONTEXT SIZE MONITORING & WARNINGS
      console.log(`🔍 [${debugSessionId}] ===== CONTEXT SIZE ANALYSIS =====`);
      
      const promptStats = {
        totalCharacters: prompt.length,
        totalBytes: Buffer.byteLength(prompt, 'utf8'),
        estimatedTokens: Math.ceil(prompt.length / 4), // Rough estimation: 1 token ≈ 4 characters
        contextSections: {
          comprehensiveContext: comprehensiveContext.length,
          workflowDetails: workflowDetails.length,
          processedEvents: JSON.stringify(processedGlobalEvents, null, 2).length
        }
      };
      
      console.log(`[STATS] [${debugSessionId}] PROMPT STATISTICS:`, promptStats);
      
      // Define size thresholds and warnings
      const sizeThresholds = {
        WARNING_CHARS: 800000, // 800K characters
        CRITICAL_CHARS: 1200000, // 1.2M characters  
        DANGER_CHARS: 1500000, // 1.5M characters
        WARNING_TOKENS: 200000, // ~200K tokens
        CRITICAL_TOKENS: 300000, // ~300K tokens
        DANGER_TOKENS: 375000 // ~375K tokens (near model limits)
      };
      
      // Check for size warnings
      if (promptStats.totalCharacters >= sizeThresholds.DANGER_CHARS) {
        console.error(`🚨 [${debugSessionId}] DANGER: Prompt size ${promptStats.totalCharacters} chars exceeds danger threshold (${sizeThresholds.DANGER_CHARS})`);
        console.error(`🚨 [${debugSessionId}] RISK: Very high risk of timeout or model rejection`);
      } else if (promptStats.totalCharacters >= sizeThresholds.CRITICAL_CHARS) {
        console.warn(`[WARN] [${debugSessionId}] CRITICAL: Prompt size ${promptStats.totalCharacters} chars exceeds critical threshold (${sizeThresholds.CRITICAL_CHARS})`);
        console.warn(`[WARN] [${debugSessionId}] RISK: High risk of timeout or reduced performance`);
      } else if (promptStats.totalCharacters >= sizeThresholds.WARNING_CHARS) {
        console.warn(`[WARN] [${debugSessionId}] WARNING: Prompt size ${promptStats.totalCharacters} chars exceeds warning threshold (${sizeThresholds.WARNING_CHARS})`);
        console.warn(`[WARN] [${debugSessionId}] RISK: Moderate risk of slower processing`);
      } else {
        console.log(`[SUCCESS] [${debugSessionId}] GOOD: Prompt size ${promptStats.totalCharacters} chars within safe limits`);
      }
      
      // Token-based warnings
      if (promptStats.estimatedTokens >= sizeThresholds.DANGER_TOKENS) {
        console.error(`🚨 [${debugSessionId}] DANGER: Estimated ${promptStats.estimatedTokens} tokens near model limits`);
      } else if (promptStats.estimatedTokens >= sizeThresholds.CRITICAL_TOKENS) {
        console.warn(`[WARN] [${debugSessionId}] CRITICAL: Estimated ${promptStats.estimatedTokens} tokens may cause issues`);
      } else if (promptStats.estimatedTokens >= sizeThresholds.WARNING_TOKENS) {
        console.warn(`[WARN] [${debugSessionId}] WARNING: Estimated ${promptStats.estimatedTokens} tokens requires monitoring`);
      }
      
      // Size breakdown analysis
      console.log(`📋 [${debugSessionId}] SIZE BREAKDOWN:`);
      console.log(`  - Comprehensive Context: ${promptStats.contextSections.comprehensiveContext} chars`);
      console.log(`  - Workflow Details: ${promptStats.contextSections.workflowDetails} chars`);
      console.log(`  - Processed Events: ${promptStats.contextSections.processedEvents} chars`);
      console.log(`  - Other (prompt template, formatting): ${promptStats.totalCharacters - promptStats.contextSections.comprehensiveContext - promptStats.contextSections.workflowDetails - promptStats.contextSections.processedEvents} chars`);
      
      // Dynamic timeout adjustment based on size
      let adjustedTimeoutMs = 120000; // Default 2 minutes
      if (promptStats.totalCharacters >= sizeThresholds.DANGER_CHARS) {
        adjustedTimeoutMs = 300000; // 5 minutes for very large prompts
        console.log(`[TIME] [${debugSessionId}] TIMEOUT ADJUSTED: Increased to ${adjustedTimeoutMs/1000}s due to large prompt size`);
      } else if (promptStats.totalCharacters >= sizeThresholds.CRITICAL_CHARS) {
        adjustedTimeoutMs = 180000; // 3 minutes for large prompts  
        console.log(`[TIME] [${debugSessionId}] TIMEOUT ADJUSTED: Increased to ${adjustedTimeoutMs/1000}s due to prompt size`);
      }
      
      console.log(`🔍 [${debugSessionId}] ===== CONTEXT SIZE ANALYSIS COMPLETE =====`);
      
      // [DB] STORE INTERMEDIATE RESULTS - Save progress before VertexAI call
      console.log(`[DB] [${debugSessionId}] ===== STORING INTERMEDIATE RESULTS =====`);
      
      const intermediateResults = {
        sessionId: debugSessionId,
        timestamp: new Date().toISOString(),
        stage: 'pre_synthesis',
        userId: context.userId,
        requestData: {
          workflows: context.workflows?.map((w: WorkflowSynthesisInput) => ({ name: w.name, trigger: w.trigger, terminator: w.terminator })),
          timeRange: { start: context.startTime, end: context.endTime },
          userInstructions: context.userInstructions,
          contextLength: comprehensiveContext.length,
          eventsCount: processedGlobalEvents.length,
          transcriptsCount: transcriptsData.length
        },
        promptStats: promptStats,
        status: 'prepared'
      };
      
      console.log(`[DB] [${debugSessionId}] INTERMEDIATE CHECKPOINT:`, {
        stage: intermediateResults.stage,
        promptSize: intermediateResults.promptStats.totalCharacters,
        workflowCount: intermediateResults.requestData.workflows?.length,
        status: intermediateResults.status
      });
      
      // Store in-memory for this session (could be extended to database)
      const sessionStorage = new Map();
      sessionStorage.set(`${debugSessionId}_intermediate`, intermediateResults);
      console.log(`[DB] [${debugSessionId}] Stored intermediate results for recovery`);
      
      // Enhanced VertexAI call with timeout and progress tracking
      console.log(`🚀 [${debugSessionId}] STARTING VERTEX AI CALL WITH ENHANCED FEATURES`);
      
      const vertexAIOptions = {
        timeoutMs: adjustedTimeoutMs, // Dynamic timeout based on prompt size
        onProgress: (stage: string, elapsed: number) => {
          console.log(`[STATS] [${debugSessionId}] VERTEX AI PROGRESS: ${stage} (${elapsed}ms)`);
          
          // Update intermediate results with progress
          const updatedResults = {
            ...intermediateResults,
            stage: 'in_progress',
            status: `vertex_ai_${stage.toLowerCase().replace(/ /g, '_')}`,
            lastUpdate: new Date().toISOString(),
            elapsedMs: elapsed
          };
          sessionStorage.set(`${debugSessionId}_intermediate`, updatedResults);
        },
        onTimeout: (elapsed: number) => {
          console.error(`⏰ [${debugSessionId}] VERTEX AI TIMEOUT after ${elapsed}ms`);
          console.error(`💡 [${debugSessionId}] SUGGESTION: Consider reducing prompt size or increasing timeout`);
          
          // Store timeout context for recovery
          const timeoutResults = {
            ...intermediateResults,
            stage: 'timeout',
            status: 'vertex_ai_timeout',
            lastUpdate: new Date().toISOString(),
            elapsedMs: elapsed,
            recovery: {
              canRetry: true,
              suggestedActions: ['reduce_prompt_size', 'increase_timeout', 'retry_later']
            }
          };
          sessionStorage.set(`${debugSessionId}_timeout`, timeoutResults);
        },
        maxRetries: 3, // More retries for synthesis due to complexity
        retryDelayMs: 2000, // 2 second initial delay
        trackingSource: 'workflow_synthesis' as const,
        trackingUserId: context.userId
      };
      
      const startTime = Date.now();
      
      const result = await callVertexWithStructuredOutput(
        prompt,
        {},
        'gemini-2.5-pro',
        WORKFLOW_SYNTHESIS_SCHEMA,
        "application/json",
        true, // Include usage metadata
        vertexAIOptions
      );
      
      const endTime = Date.now();
      
      // [DB] STORE SUCCESSFUL RESULTS
      const successResults = {
        ...intermediateResults,
        stage: 'completed',
        status: 'synthesis_success',
        completedAt: new Date().toISOString(),
        processingTime: endTime - startTime,
        result: {
          workflowCount: Array.isArray(result.content?.workflows) ? result.content.workflows.length : 0,
          hasUsageData: !!result.usage,
          hasMetadata: !!result.metadata
        }
      };
      
      sessionStorage.set(`${debugSessionId}_success`, successResults);
      console.log(`[DB] [${debugSessionId}] Stored successful synthesis results`);
      
      console.log(`[SUCCESS] [${debugSessionId}] VERTEX AI CALL COMPLETED IN ${endTime - startTime}ms`);
      console.log(`[STATS] [${debugSessionId}] RESULT STRUCTURE:`, {
        hasContent: !!result.content,
        hasUsage: !!result.usage,
        hasMetadata: !!result.metadata,
        contentType: typeof result.content,
        workflowCount: Array.isArray(result.content?.workflows) ? result.content.workflows.length : 'N/A'
      });
      
      if (result.usage) {
        console.log(`[STATS] [${debugSessionId}] TOKEN USAGE:`, result.usage);
      }
      
      if (result.metadata) {
        console.log(`[STATS] [${debugSessionId}] CALL METADATA:`, result.metadata);
      }

      console.log(`[FIX] [${debugSessionId}] WORKFLOW RESULT:`, JSON.stringify(result.content, null, 2));

      return NextResponse.json({ 
        workflows: result.content.workflows,
        metadata: {
          sessionId: debugSessionId,
          processingTime: endTime - startTime,
          usage: result.usage,
          callMetadata: result.metadata,
          intermediateResultsStored: true
        }
      });
    } else {
      console.log(`🔄 [${debugSessionId}] PROCESSING SINGLE WORKFLOW`);
      
      // Single workflow synthesis (legacy support)
      const processedSingleEvents = context.events ? processEvents(context.events) : [];
      console.log(`🔄 [${debugSessionId}] PROCESSED ${processedSingleEvents.length} SINGLE EVENTS`);
      
      // Build comprehensive context including transcripts and user instructions
      console.log(`🚀 [${debugSessionId}] BUILDING COMPREHENSIVE CONTEXT (SINGLE)`);
      console.log(`📋 [${debugSessionId}] USER INSTRUCTIONS: ${context.userInstructions ? 'YES - ' + context.userInstructions.substring(0, 50) + '...' : 'NO'}`);
      
      const comprehensiveContext = buildComprehensiveContext(
        transcriptsData, 
        context.userInstructions
      );

      console.log(`🔗 [${debugSessionId}] COMPREHENSIVE CONTEXT LENGTH: ${comprehensiveContext.length} characters`);

      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize a workflow with EXACTLY this name (do not change it): ${context.workflow_name}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

${comprehensiveContext}

WORKFLOW: ${context.workflow_name}
TRIGGER: ${context.trigger || 'Not specified'}
TERMINATOR: ${context.terminator || 'Not specified'}
EVENTS: ${JSON.stringify(processedSingleEvents, null, 2)}`;

      console.log(`📏 [${debugSessionId}] FINAL PROMPT LENGTH: ${prompt.length} characters`);
    }
    
    // Note: Enhanced VertexAI call with timeout and progress tracking is handled above
    // This section should not be reached for multi-workflow synthesis

  } catch (error) {
    console.error(`[ERROR] [${debugSessionId}] ===== SYNTHESIS DEBUG SESSION FAILED =====`);
    console.error(`[ERROR] [${debugSessionId}] ERROR TYPE: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[ERROR] [${debugSessionId}] ERROR MESSAGE: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[ERROR] [${debugSessionId}] ERROR STACK:`, error instanceof Error ? error.stack : 'No stack trace');
    
    // [PROTECTION] GRACEFUL DEGRADATION - Handle different types of failures
    console.log(`[PROTECTION] [${debugSessionId}] ===== GRACEFUL DEGRADATION ANALYSIS =====`);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeoutError = errorMessage.includes('timeout') || errorMessage.includes('Timeout');
    const isConnectionError = errorMessage.includes('connection') || errorMessage.includes('ECONNRESET') || errorMessage.includes('network');
    const isVertexAIError = errorMessage.includes('VertexAI') || errorMessage.includes('vertex');
    const isPromptSizeError = errorMessage.includes('prompt') && (errorMessage.includes('large') || errorMessage.includes('size'));
    
    console.log(`🔍 [${debugSessionId}] ERROR CLASSIFICATION:`);
    console.log(`  - Timeout Error: ${isTimeoutError}`);
    console.log(`  - Connection Error: ${isConnectionError}`);
    console.log(`  - VertexAI Error: ${isVertexAIError}`);
    console.log(`  - Prompt Size Error: ${isPromptSizeError}`);
    
    // Generate helpful error response with degradation options
    const degradedResponse = {
      error: true,
      message: errorMessage,
      type: 'synthesis_failure' as string,
      suggestions: [] as string[],
      fallbackOptions: {} as Record<string, unknown>,
      debugSessionId
    };
    
    // Handle different error types with specific degradation strategies
    if (isTimeoutError) {
      console.log(`⏰ [${debugSessionId}] TIMEOUT DEGRADATION: Providing timeout-specific guidance`);
      
      degradedResponse.type = 'timeout_error';
      degradedResponse.suggestions = [
        'The synthesis request timed out due to complexity. Try reducing the time range or number of events.',
        'Consider breaking down the workflow synthesis into smaller chunks.',
        'If transcripts are very long, try synthesizing workflows for shorter time periods.',
        'The server may be under heavy load - try again in a few minutes.'
      ];
      
      degradedResponse.fallbackOptions = {
        retryWithSmallerTimeRange: true,
        retryWithFewerEvents: true,
        simplifiedSynthesis: true,
        contactSupport: true
      };
      
    } else if (isConnectionError) {
      console.log(`🌐 [${debugSessionId}] CONNECTION DEGRADATION: Providing connection-specific guidance`);
      
      degradedResponse.type = 'connection_error';
      degradedResponse.suggestions = [
        'Connection to AI service was lost. Please check your internet connection.',
        'The AI service may be temporarily unavailable - try again in a few minutes.',
        'If the problem persists, there may be a service outage.',
        'Consider retrying with a shorter timeout or smaller data set.'
      ];
      
      degradedResponse.fallbackOptions = {
        retryImmediately: true,
        retryWithTimeout: true,
        checkServiceStatus: true,
        contactSupport: true
      };
      
    } else if (isPromptSizeError) {
      console.log(`📏 [${debugSessionId}] SIZE DEGRADATION: Providing prompt size guidance`);
      
      degradedResponse.type = 'prompt_size_error';
      degradedResponse.suggestions = [
        'The workflow data is too large for processing. Try reducing the time range.',
        'Consider excluding transcript data or processing fewer events.',
        'Break down the synthesis into multiple smaller requests.',
        'Remove detailed event data and focus on high-level workflow patterns.'
      ];
      
      degradedResponse.fallbackOptions = {
        retryWithoutTranscripts: true,
        retryWithFewerEvents: true,
        retryWithShorterTimeRange: true,
        simplifiedSynthesis: true
      };
      
    } else if (isVertexAIError) {
      console.log(`[LLM] [${debugSessionId}] VERTEXAI DEGRADATION: Providing AI service guidance`);
      
      degradedResponse.type = 'ai_service_error';
      degradedResponse.suggestions = [
        'The AI service encountered an error processing your request.',
        'Try simplifying the request or reducing the amount of data.',
        'The AI model may be overloaded - try again in a few minutes.',
        'Consider using a different time range or fewer workflow parameters.'
      ];
      
      degradedResponse.fallbackOptions = {
        retryWithDifferentModel: true,
        retryWithSimplifiedPrompt: true,
        retryAfterDelay: true,
        contactSupport: true
      };
      
    } else {
      console.log(`❓ [${debugSessionId}] GENERIC DEGRADATION: Providing general guidance`);
      
      degradedResponse.suggestions = [
        'An unexpected error occurred during workflow synthesis.',
        'Try reducing the complexity of your request or the amount of data.',
        'If the problem persists, please contact support with the debug session ID.',
        'Consider trying again with a smaller time range or fewer parameters.'
      ];
      
      degradedResponse.fallbackOptions = {
        retryWithSimplifiedParameters: true,
        retryAfterDelay: true,
        contactSupport: true
      };
    }
    
    // Save error context for debugging (partial result preservation)
    // Note: Some variables may not be available in catch block, provide safe fallbacks
    const errorContext = {
      debugSessionId,
      timestamp: new Date().toISOString(),
      errorType: degradedResponse.type,
      errorMessage: errorMessage,
      requestInfo: 'Request data not available in error context'
    };
    
    console.log(`[DB] [${debugSessionId}] PRESERVING ERROR CONTEXT:`, errorContext);
    
    // Add context preservation information
    degradedResponse.fallbackOptions.errorContext = errorContext;
    degradedResponse.fallbackOptions.preservedData = {
      note: 'Detailed request data not available during error handling'
    };
    
    console.log(`[PROTECTION] [${debugSessionId}] ===== GRACEFUL DEGRADATION COMPLETE =====`);
    console.log(`📋 [${debugSessionId}] DEGRADED RESPONSE:`, {
      type: degradedResponse.type,
      suggestionsCount: degradedResponse.suggestions.length,
      fallbackOptionsCount: Object.keys(degradedResponse.fallbackOptions).length
    });

    return NextResponse.json(degradedResponse, { status: 500 });
  }
}