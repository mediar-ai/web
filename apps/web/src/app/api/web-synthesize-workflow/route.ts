import { WORKFLOW_SYNTHESIS_PROMPT, WORKFLOW_SYNTHESIS_SCHEMA } from '@/lib/prompts';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

interface WorkflowSynthesisInput {
  name: string;
  trigger?: string;
  terminator?: string;
}

// Web activity item from user_activity_data table
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

// Transform web data to analysis format for LLM
function transformWebDataToAnalyses(
  activityItems: WebActivityItem[],
  events: WebEvent[]
): Array<{
  analysis_id: string;
  timestamp: string;
  window_title: string;
  step_title: string;
  step_summary: string;
  what_was_clicked: string | null;
  what_was_typed: string | null;
  events_that_happened: string;
  how_content_changed: string | null;
}> {
  const activityMap = new Map(activityItems.map(item => [item.id, item]));

  return events.map(event => {
    const relatedActivities = (event.activity_ids || [])
      .map(id => activityMap.get(id))
      .filter(Boolean) as WebActivityItem[];

    const firstActivity = relatedActivities[0];

    return {
      analysis_id: event.id,
      timestamp: event.timestamp,
      window_title: firstActivity?.window_title || firstActivity?.application_name || 'Unknown',
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
    };
  });
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

    // Fetch from user_activity_data table (where /web page stores data)
    console.log(`🔍 [${debugSessionId}] FETCHING WEB DATA FOR USER: ${context.userId}`);

    // Support both sessionId and time-based filtering
    let query = supabaseAdmin
      .from('user_activity_data')
      .select('id, session_id, client_timestamp, item_type, item_data, client_item_id')
      .eq('user_id', context.userId)
      .eq('source', 'web');

    // Apply time filtering or session filtering
    if (context.sessionId) {
      query = query.eq('session_id', context.sessionId);
      console.log(`📋 [${debugSessionId}] SESSION FILTERING: ${context.sessionId}`);
    } else {
      query = query
        .gte('client_timestamp', startDate)
        .lte('client_timestamp', endDate);
      console.log(`🕐 [${debugSessionId}] TIME FILTERING: Applied from ${startDate} to ${endDate}`);
    }

    const { data: webData, error: webError } = await query
      .order('client_timestamp', { ascending: true })
      .limit(1000);

    if (webError) {
      console.log(`[ERROR] [${debugSessionId}] WEB DATA FETCH ERROR:`, webError);
      throw new Error(`Failed to fetch web data: ${webError.message}`);
    }

    if (!webData || webData.length === 0) {
      console.log(`[ERROR] [${debugSessionId}] NO WEB DATA FOUND`);
      throw new Error('No web recording data found. Make sure you have recorded a session first.');
    }

    console.log(`[SUCCESS] [${debugSessionId}] FETCHED ${webData.length} WEB DATA ITEMS`);

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

    console.log(`📊 [${debugSessionId}] SEPARATED: ${activityItems.length} activity items, ${events.length} events`);

    if (events.length === 0) {
      throw new Error('No events found in recording. Events are required for workflow synthesis.');
    }

    // Transform web data to analysis format
    const analyses = transformWebDataToAnalyses(activityItems, events);
    console.log(`🔄 [${debugSessionId}] TRANSFORMED ${analyses.length} ANALYSES`);
    console.log(`[STATS] [${debugSessionId}] SAMPLE TRANSFORMED ANALYSIS:`, JSON.stringify(analyses[0], null, 2));

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

      const workflowDetails = context.workflows.map((workflow: WorkflowSynthesisInput) => {
        return `WORKFLOW: ${workflow.name}
TRIGGER: ${workflow.trigger || 'Auto-detected from events'}
TERMINATOR: ${workflow.terminator || 'Auto-detected from events'}`;
      }).join('\n\n---\n\n');

      const workflowNames = context.workflows.map((w: WorkflowSynthesisInput) => w.name).join(', ');
      console.log(`📝 [${debugSessionId}] WORKFLOW NAMES: ${workflowNames}`);
      console.log(`📋 [${debugSessionId}] WORKFLOW DETAILS:`, workflowDetails);

      // Build user instructions section (no transcripts for web)
      let userInstructionsSection = '';
      if (context.userInstructions) {
        userInstructionsSection = `\n\nUSER INSTRUCTIONS:\n${context.userInstructions}`;
        console.log(`📋 [${debugSessionId}] USER INSTRUCTIONS: YES - ${context.userInstructions.length} chars`);
      }

      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize workflows for EXACTLY these workflow names (do not change or create new names): ${workflowNames}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}
${userInstructionsSection}

WORKFLOW DEFINITIONS:
${workflowDetails}

ALL EVENTS (determine which events belong to which workflows based on context):
${JSON.stringify(analyses, null, 2)}

Note: This data comes from web-based screen capture and activity analysis.`;

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
          workflowDetails: workflowDetails.length,
          processedEvents: JSON.stringify(analyses, null, 2).length,
          userInstructions: userInstructionsSection.length
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
      console.log(`  - Workflow Details: ${promptStats.contextSections.workflowDetails} chars`);
      console.log(`  - Processed Events: ${promptStats.contextSections.processedEvents} chars`);
      console.log(`  - User Instructions: ${promptStats.contextSections.userInstructions} chars`);
      console.log(`  - Other (prompt template, formatting): ${promptStats.totalCharacters - promptStats.contextSections.workflowDetails - promptStats.contextSections.processedEvents - promptStats.contextSections.userInstructions} chars`);
      
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
          timeRange: { start: startDate, end: endDate },
          userInstructions: context.userInstructions,
          eventsCount: analyses.length,
          activityItemsCount: activityItems.length,
          source: 'web'
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
        modelName,
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

      // Single workflow synthesis using web data
      let userInstructionsSection = '';
      if (context.userInstructions) {
        userInstructionsSection = `\n\nUSER INSTRUCTIONS:\n${context.userInstructions}`;
      }

      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize a workflow with EXACTLY this name (do not change it): ${context.workflow_name}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}
${userInstructionsSection}

WORKFLOW: ${context.workflow_name}
TRIGGER: ${context.trigger || 'Auto-detected from events'}
TERMINATOR: ${context.terminator || 'Auto-detected from events'}
EVENTS: ${JSON.stringify(analyses, null, 2)}

Note: This data comes from web-based screen capture and activity analysis.`;

      console.log(`📏 [${debugSessionId}] FINAL PROMPT LENGTH: ${prompt.length} characters`);

      // Call Vertex AI for single workflow
      const result = await callVertexWithStructuredOutput(
        prompt,
        {},
        modelName,
        WORKFLOW_SYNTHESIS_SCHEMA,
        "application/json",
        true,
        { trackingSource: 'workflow_synthesis' as const, trackingUserId: context.userId }
      );

      return NextResponse.json({
        workflows: result.content.workflows,
        metadata: {
          sessionId: debugSessionId,
          source: 'web'
        }
      });
    }

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