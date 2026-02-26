// Force Vercel rebuild - clear cache issue
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  executeServerTool as executeKnowledgeTool,
  getServerToolDeclarations as getKnowledgeToolDeclarations,
  isServerSideTool as isKnowledgeTool,
  serverSideTools as knowledgeTools,
} from '@/lib/server-tools/knowledge-tools';
// DEPRECATED: workflow-editing-tools and dev-log-tools removed - TypeScript workflows use file-based editing on desktop
import { SignJWT, importPKCS8 } from 'jose';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
// Redis removed - desktop app uses Rust backend directly, this route is only for testing
import { handleAnthropicChat } from './providers/anthropic';
import type { AIProviderRequest } from './providers/types';
import { analyzeToolResults, checkTokenLimit, logProviderDiagnostics } from './providers/utils';
import { getVertexModelName } from '@/lib/vertexai';
import type { FunctionDeclaration, Content, Part } from './types/vertex';

// Redis removed - route is now stateless (each call independent)
// Desktop app uses Rust backend → Vertex AI directly, not this route

// LLM usage tracking - insert into mediar_llm_traces table (v2 - with source field)
async function trackLLMUsage(params: {
  userId: string;
  orgId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) return;

    const supabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);
    console.log(`[Web AI] Tracking usage: model=${params.model}, input=${params.inputTokens}, output=${params.outputTokens}`);
    await supabase.from('mediar_llm_traces').insert({
      user_id: params.userId,
      org_id: params.orgId,
      model: params.model,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      source: 'web_ai',
    });
  } catch (e) {
    console.error('[LLM Tracking] Failed to track usage:', e);
  }
}

// Generate 1-hour Google OAuth access token for Vertex AI REST API
async function generateVertexAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  let credentials: { client_email: string; private_key: string; token_uri: string };

  if (clientEmail && privateKey) {
    credentials = {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri: 'https://oauth2.googleapis.com/token',
    };
  } else {
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) {
      throw new Error('Missing Google credentials configuration');
    }
    credentials = JSON.parse(Buffer.from(credentialsBase64, 'base64').toString('utf-8'));
    credentials.token_uri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtKey = await importPKCS8(credentials.private_key, 'RS256');

  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.client_email)
    .setSubject(credentials.client_email)
    .setAudience(credentials.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(jwtKey);

  const tokenResponse = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Call Vertex AI REST API directly with OAuth token
async function callVertexAIRest(params: {
  accessToken: string;
  project: string;
  location: string;
  model: string;
  contents: Content[];
  config: {
    temperature?: number;
    maxOutputTokens?: number;
    systemInstruction?: string;
    tools?: any[];
    thinkingConfig?: any;
  };
}): Promise<any> {
  const { accessToken, project, location, model, contents, config } = params;

  // Global endpoint uses different URL format (no location prefix on domain)
  const domain = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;
  const url = `https://${domain}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const requestBody: any = {
    contents,
    generationConfig: {
      temperature: config.temperature ?? 0.7,
      maxOutputTokens: config.maxOutputTokens ?? 1000,
    },
  };

  if (config.systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: config.systemInstruction }] };
  }

  if (config.tools && config.tools.length > 0) {
    requestBody.tools = config.tools;
  }

  if (config.thinkingConfig) {
    requestBody.generationConfig.thinkingConfig = config.thinkingConfig;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vertex AI API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

// =================================================================
// Multi-Provider AI endpoint (Vertex AI + Anthropic)
// Supports both stateless (client-side history) and stateful (KV-backed)
// architectures with native function calling
// =================================================================

// CORS (using shared helper)
import { getCorsHeaders } from '@/lib/cors';

// Allowed models (per workspace rule)
const VERTEX_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-pro-latest'] as const;
const ANTHROPIC_MODELS = ['claude-sonnet-4-5-20250929'] as const;
const ALLOWED_MODELS = [...VERTEX_MODELS, ...ANTHROPIC_MODELS] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];
type VertexModel = (typeof VERTEX_MODELS)[number];
type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];

// Client-side tools: server accepts any tools from client and returns tool calls
type JSONSchema = Record<string, unknown>;

// Tools allowed in ask mode - import from config (single source of truth)
import { ASK_MODE_ALLOWED_TOOLS as ASK_MODE_ALLOWED_TOOLS_ARRAY } from './config/constants';
const ASK_MODE_ALLOWED_TOOLS = new Set(ASK_MODE_ALLOWED_TOOLS_ARRAY);

// Vertex AI message format for history
interface VertexMessage {
  role: 'user' | 'model';
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
}

// KV session storage
interface SessionData {
  history: VertexMessage[];
  provider?: 'vertex' | 'anthropic'; // Track which provider is being used
  system?: string;
  tools?: FunctionDeclaration[]; // Cached tool declarations from Turn 1 (stripped - for AI)
  originalClientTools?: Array<{ name: string; description?: string; parameters?: any }>; // Original client tools (full schemas - for get_tool_details)
  model: AllowedModel;
  createdAt: string;
  updatedAt: string;
}

// =================================================================
// SSE Streaming Types for server-side tool visibility
// =================================================================
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'server_tool_start'; name: string; args: Record<string, any> }
  | { type: 'server_tool_complete'; name: string; result: any; elapsedMs: number; error?: string }
  | { type: 'client_tools'; toolCalls: Array<{ id?: string; name: string; args: Record<string, any> }> }
  | { type: 'done'; finishReason: string; sessionId: string; model: string; workflowData?: any; metrics?: any }
  | { type: 'error'; error: string; details?: string };

// Helper to create SSE encoder and emit function
function createSSEEmitter(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();
  return {
    emit: (event: StreamEvent) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close: () => {
      controller.close();
    },
    error: (err: Error) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`));
      controller.close();
    }
  };
}

// Session storage removed - route is stateless
const KV_SESSION_TTL = 0; // Unused - kept for compatibility

// Helpers ------------------------------------------------------------
async function authenticate(request: NextRequest): Promise<{
  authenticated: boolean;
  userId: string | null;
  orgId: string | null;
  email?: string | null;
}> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { authenticated: false, userId: null, orgId: null };

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // Try to validate as desktop token
    try {
      const validation = await validateDesktopToken(token);
      if (validation.valid) {
        console.log(
          `[AI API] Authenticated with desktop token for user: ${validation.email}`
        );
        return {
          authenticated: true,
          userId: validation.userId || null,
          orgId: validation.orgId || null,
          email: validation.email || null,
        };
      }
    } catch (error) {
      console.error('[AI API] Desktop token validation error:', error);
    }

    // Desktop validation failed
    return { authenticated: false, userId: null, orgId: null };
  }

  if (authHeader.startsWith('Basic ')) {
    // Basic auth removed - requires Bearer token
    return { authenticated: false, userId: null, orgId: null };
  }

  return { authenticated: false, userId: null, orgId: null };
}

function cleanSchema(schema: unknown): JSONSchema {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  const src = schema as Record<string, unknown>;
  const dst: Record<string, unknown> = {
    type: (src.type as string) || 'object',
  };
  if (src.properties && typeof src.properties === 'object') {
    const cleanedProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      src.properties as Record<string, unknown>
    )) {
      cleanedProps[k] = cleanSchema(v);
    }
    dst.properties = cleanedProps;
  }
  if (Array.isArray(src.required)) dst.required = src.required;
  if (typeof src.description === 'string') dst.description = src.description;
  if (Array.isArray(src.enum)) dst.enum = src.enum;
  if (typeof src.format === 'string') dst.format = src.format;
  if (src.type === 'array' && src.items) dst.items = cleanSchema(src.items);
  return dst;
}

function toFunctionDeclarations(
  tools:
    | Array<{ name: string; description?: string; parameters?: JSONSchema }>
    | undefined
): FunctionDeclaration[] {
  if (!tools) return [];
  // Full tool declarations with descriptions and schemas for native function calling
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description || tool.name,
    parameters: cleanSchema(tool.parameters) as any,
  }));
}

function validateModel(model: string | undefined): model is AllowedModel {
  return !!model && (ALLOWED_MODELS as readonly string[]).includes(model);
}

// Reserved for future use when explicit Vertex routing is needed
function _isVertexModel(model: string): model is VertexModel {
  return (VERTEX_MODELS as readonly string[]).includes(model);
}

function isAnthropicModel(model: string): model is AnthropicModel {
  return (ANTHROPIC_MODELS as readonly string[]).includes(model);
}

// Session storage removed - route is now stateless
// Each request must pass full history if multi-turn is needed
async function loadSession(_sessionId: string): Promise<SessionData | null> {
  // No-op: sessions not persisted, return null (caller uses passed history)
  console.log(`[AI API] Session storage disabled - using stateless mode`);
  return null;
}

async function saveSession(
  _sessionId: string,
  _data: SessionData
): Promise<void> {
  // No-op: sessions not persisted
  // Caller should handle persistence via Supabase workflow_chat_sessions if needed
}

function createSessionId(): string {
  return randomUUID();
}

/**
 * Wrap tool results for Gemini API compatibility
 * Gemini API requires function_response.response to be an object (Struct), not a primitive
 *
 * NOTE: Previously truncated to 500 chars which caused AI to "autocomplete" incomplete code.
 * Now returns full results to prevent hallucination from truncation.
 *
 * @param result - The tool result to wrap
 * @returns Wrapped result (object format for Gemini API)
 */
function wrapToolResult(result: any): any {
  // Gemini API requires function_response.response to be an object (Struct), not a primitive
  // Wrap strings/primitives in an object
  if (result === null || result === undefined) {
    return { result: null };
  }

  // If result is a string, wrap it in an object
  if (typeof result === 'string') {
    return { result };
  }

  // If result is a number or boolean, wrap it
  if (typeof result !== 'object') {
    return { result };
  }

  // Result is already an object - return as-is
  return result;
}

// Helper to capture workflow data from tool results
function captureWorkflowData(toolResult: any, currentWorkflowData: any): any {
  if (
    'workflow_updated' in toolResult &&
    toolResult.workflow_updated &&
    'workflow_data' in toolResult &&
    toolResult.workflow_data
  ) {
    console.log(
      `📦 Captured updated workflow data for workflow ID: ${toolResult.workflow_data.id}`
    );
    return toolResult.workflow_data;
  }
  return currentWorkflowData;
}

// Helper to execute a single server-side tool (workflow or knowledge)
async function executeServerTool(
  toolCall: { name: string; args: any; id?: string },
  context: {
    authenticatedUserId: string | null;
    orgId: string | null;
    email?: string | null;
    workflowId?: number;
    clientTools?: Array<{ name: string; description?: string; parameters?: any }>; // Original client tools for get_tool_details
  },
  options: {
    preserveId: boolean; // Anthropic needs IDs, Vertex doesn't
    isAdditional?: boolean; // For logging (initial vs additional)
  }
): Promise<{
  name: string;
  result: any;
  id?: string;
  workflowData?: any;
} | null> {
  // Only knowledge tools remain (workflow-editing-tools and dev-log-tools deprecated)
  if (!isKnowledgeTool(toolCall.name)) {
    return null;
  }

  const prefix = options.isAdditional
    ? 'additional server-side'
    : 'server-side';
  console.log(`🔧 Executing ${prefix} knowledge tool: ${toolCall.name}`);

  try {
    // All server-side tools require authenticated user context
    if (!context.authenticatedUserId) {
      throw new Error(
        'Server-side tools require authentication with a user account'
      );
    }

    // Execute the tool
    const toolResult = await executeKnowledgeTool(toolCall.name, toolCall.args, {
      clientTools: context.clientTools,
    });

    const logPrefix = options.isAdditional ? 'Additional server' : 'Server';
    console.log(`✅ ${logPrefix} tool ${toolCall.name} executed successfully`);

    return {
      name: toolCall.name,
      result: toolResult,
      ...(options.preserveId && toolCall.id && { id: toolCall.id }),
    };
  } catch (error) {
    console.error(`❌ Server tool ${toolCall.name} failed:`, error);
    return {
      name: toolCall.name,
      result: {
        error: error instanceof Error ? error.message : 'Tool execution failed',
      },
      ...(options.preserveId && toolCall.id && { id: toolCall.id }),
    };
  }
}

// Helper to process raw parts in order - emits text/tool events in the correct sequence
async function processRawPartsInOrder(
  rawParts: any[] | undefined,
  emit: (event: StreamEvent) => void,
  executeContext: {
    authenticatedUserId: string | null;
    orgId: string | null;
    email?: string | null;
    workflowId?: number;
    clientTools?: Array<{ name: string; description?: string; parameters?: any }>;
  },
  options: {
    preserveId: boolean;
    isAdditional?: boolean;
    mode?: 'ask' | 'act';
  }
): Promise<{
  serverToolResults: Array<{ name: string; result: any; id?: string }>;
  clientToolCalls: Array<{ name: string; args: Record<string, any>; id?: string }>;
  workflowData: any;
}> {
  const serverToolResults: Array<{ name: string; result: any; id?: string }> = [];
  const clientToolCalls: Array<{ name: string; args: Record<string, any>; id?: string }> = [];
  let workflowData = null;
  const blockedToolNames: string[] = []; // Track blocked tools in ask mode

  if (!rawParts || rawParts.length === 0) {
    return { serverToolResults, clientToolCalls, workflowData };
  }

  for (const part of rawParts) {
    // Handle text parts (excluding thinking/thought)
    if (part.text && !part.thought) {
      emit({ type: 'text', content: part.text });
    }
    // Handle function calls
    else if (part.functionCall) {
      const toolCall = {
        name: part.functionCall.name,
        args: part.functionCall.args || {},
        ...(part.functionCall.id && { id: part.functionCall.id }),
      };

      // In ask mode, block tools not in the allowed list
      if (options.mode === 'ask' && !ASK_MODE_ALLOWED_TOOLS.has(toolCall.name)) {
        console.log(`🔒 [processRawPartsInOrder] Ask mode: Blocking action tool: ${toolCall.name}`);
        blockedToolNames.push(toolCall.name);
        continue; // Skip this tool call
      }

      const isServerTool = isKnowledgeTool(toolCall.name);

      if (isServerTool) {
        // Emit start event
        emit({ type: 'server_tool_start', name: toolCall.name, args: toolCall.args });
        const startTime = Date.now();

        // Execute the server tool
        const executed = await executeServerTool(toolCall, executeContext, options);

        if (executed) {
          // Emit completion event
          const elapsedMs = Date.now() - startTime;
          emit({
            type: 'server_tool_complete',
            name: executed.name,
            result: executed.result,
            elapsedMs,
            ...(executed.result?.error && { error: executed.result.error }),
          });
          if (executed.workflowData) {
            workflowData = executed.workflowData;
          }
          serverToolResults.push({
            name: executed.name,
            result: executed.result,
            ...(executed.id && { id: executed.id }),
          });
        }
      } else {
        // Client-side tool - queue it
        // Validate execute_sequence doesn't contain server-side tools
        if (toolCall.name === 'execute_sequence' && toolCall.args?.steps) {
          const steps = toolCall.args.steps as Array<{ tool_name?: string }>;
          const invalidTools = steps
            .filter(s => s.tool_name && isKnowledgeTool(s.tool_name))
            .map(s => s.tool_name);

          if (invalidTools.length > 0) {
            // Return error as a tool result so AI learns the pattern
            emit({ type: 'server_tool_start', name: toolCall.name, args: toolCall.args });
            serverToolResults.push({
              name: toolCall.name,
              result: {
                error: `execute_sequence can only contain desktop automation tools (MCP tools). The following server-side tools are NOT valid inside execute_sequence: ${invalidTools.join(', ')}. Call these tools as separate top-level tool calls instead.`,
                invalid_tools: invalidTools,
              },
              ...(toolCall.id && { id: toolCall.id }),
            });
            emit({
              type: 'server_tool_complete',
              name: toolCall.name,
              result: { error: `Invalid tools: ${invalidTools.join(', ')}` },
              elapsedMs: 0,
              error: `Invalid tools in execute_sequence: ${invalidTools.join(', ')}`,
            });
            continue; // Skip adding to clientToolCalls
          }
        }
        clientToolCalls.push(toolCall);
      }
    }
    // Skip thought parts and other unknown parts
  }

  // Emit action button when tools are blocked in ask mode
  if (blockedToolNames.length > 0) {
    const uniqueBlocked = [...new Set(blockedToolNames)];
    const blockedMsg = `\n\n> **Blocked in Ask mode:** ${uniqueBlocked.join(', ')}`;
    emit({ type: 'text', content: blockedMsg });
    // Auto-emit render_action_button so user can switch to act mode
    clientToolCalls.push({
      name: 'render_action_button',
      args: { action: 'switch_to_act_mode', blocked_tools: uniqueBlocked }
    });
  }

  return { serverToolResults, clientToolCalls, workflowData };
}

// Helper function to determine if an error is retryable
function isRetryableError(error: any): boolean {
  // Check for HTTP status codes that are retryable
  const errorMessage = error?.message || String(error);
  const errorString = errorMessage.toLowerCase();

  // Retryable: 503 Service Unavailable, 429 Too Many Requests, 500 Internal Server Error
  // Also retry on timeout/network errors
  const retryablePatterns = [
    '503',
    'service unavailable',
    '429',
    'too many requests',
    'rate limit',
    '500',
    'internal server error',
    'timeout',
    'econnreset',
    'enotfound',
    'unavailable',
    'visibility check was unavailable', // Specific Google error
  ];

  return retryablePatterns.some(pattern => errorString.includes(pattern));
}

// Helper function to retry Vertex AI sendMessage with exponential backoff
async function _sendMessageWithRetry(
  chat: any,
  message: any,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    messageType?: string;
  } = {}
): Promise<any> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    messageType = 'message',
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Calculate exponential backoff delay: baseDelay * 2^(attempt-1)
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(
          `[VERTEX-RETRY] Attempt ${attempt + 1}/${maxRetries + 1} - waiting ${delayMs}ms before retry...`
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      console.log(
        `[VERTEX-HTTP] Sending ${messageType} to Vertex AI (attempt ${attempt + 1}/${maxRetries + 1})`
      );
      const response = await chat.sendMessage(message);

      if (attempt > 0) {
        console.log(`[VERTEX-RETRY] ✅ Success after ${attempt} retries`);
      }

      return response;
    } catch (error: any) {
      lastError = error;

      const isRetryable = isRetryableError(error);
      const errorDetails = {
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        errorType: error?.constructor?.name || 'Unknown',
        errorMessage: error?.message || String(error),
        isRetryable,
      };

      console.error(`[VERTEX-HTTP] API error:`, errorDetails);

      // If it's not retryable or we've exhausted retries, throw immediately
      if (!isRetryable) {
        console.error(
          `[VERTEX-HTTP] Non-retryable error detected, failing immediately`
        );
        throw error;
      }

      if (attempt >= maxRetries) {
        console.error(
          `[VERTEX-HTTP] Max retries (${maxRetries + 1}) exhausted`
        );
        throw new Error(
          `Vertex AI request failed after ${maxRetries + 1} attempts: ${error?.message || String(error)}`
        );
      }

      console.log(`[VERTEX-HTTP] Retryable error detected, will retry...`);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

// Stateless chat handling with history reconstruction ----
async function handleVertexChat(params: {
  accessToken: string;
  project: string;
  location: string;
  model: VertexModel;
  system?: string;
  history: VertexMessage[];
  functionDeclarations: FunctionDeclaration[];
  input?: string;
  toolResults?: Array<{ name: string; result: any }>;
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
  thinkingLevel?: 'low' | 'high';
}): Promise<{
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, any>; id?: string }>;
  rawParts?: any[];
  finishReason: 'stop' | 'tool_calls';
  metrics: { elapsedMs: number; tokens?: any };
}> {
  const {
    accessToken,
    project,
    location,
    model,
    system,
    history,
    functionDeclarations,
    input,
    toolResults,
    generationConfig,
    thinkingLevel,
  } = params;

  const t0 = Date.now();

  // Map user-friendly model name to actual Vertex AI model name
  const mappedModel = getVertexModelName(model);

  console.log(
    `[VERTEX] Processing request with ${history.length} history message(s)`
  );

  // Log provider configuration
  logProviderDiagnostics('VERTEX', {
    model,
    maxTokens: generationConfig?.maxOutputTokens || 1000,
    temperature: generationConfig?.temperature || 0.7,
    toolCount: functionDeclarations.length,
    historyLength: history.length,
  });

  // Check token limits (Gemini 2.5/3 models have 1M context window)
  checkTokenLimit(history, 'VERTEX', 1000000, 800000);

  // Build contents array for the new SDK
  const contents: Content[] = [...history] as Content[];

  // Add new message or tool results
  if (toolResults && toolResults.length > 0) {
    // Continuing conversation with tool results
    console.log(`[AI API] 🔧 Sending ${toolResults.length} tool result(s)`);

    // Analyze tool results for potential issues
    analyzeToolResults(toolResults, 'VERTEX');

    // Format function responses for new SDK
    // Use wrapToolResult to ensure response is always an object (Gemini API requirement)
    const functionResponseParts: Part[] = toolResults.map(tr => ({
      functionResponse: {
        name: tr.name,
        response: wrapToolResult(tr.result),
      },
    }));

    contents.push({
      role: 'user',
      parts: functionResponseParts,
    });
  } else if (input) {
    // New user message
    console.log(`[AI API] 💬 Sending user message (${input.length} chars)`);

    contents.push({
      role: 'user',
      parts: [{ text: input }],
    });
  } else {
    throw new Error('Either input or toolResults must be provided');
  }

  // Check if this is a Gemini 3 model for thinking config
  const isGemini3 = mappedModel.includes('gemini-3');

  // Build the generation config
  const config: any = {
    temperature: generationConfig?.temperature ?? 0.7,
    maxOutputTokens: generationConfig?.maxOutputTokens ?? 1000,
  };

  // Add system instruction if provided
  if (system) {
    config.systemInstruction = system;
  }

  // Add tools if provided
  if (functionDeclarations.length > 0) {
    config.tools = [{ functionDeclarations }];
  }

  // Add thinking config for Gemini 3 models (use thinking_level, not legacy thinkingBudget)
  if (isGemini3) {
    config.thinkingConfig = {
      thinkingLevel: thinkingLevel || 'low', // 'low' for fast responses, 'high' for complex reasoning
    };
  }

  // Call the API with retry logic using REST API
  let response;
  let lastError: Error | null = null;
  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await callVertexAIRest({
        accessToken,
        project,
        location,
        model: mappedModel,
        contents,
        config: {
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
          systemInstruction: system,
          tools: config.tools,
          thinkingConfig: config.thinkingConfig,
        },
      });
      break; // Success, exit retry loop
    } catch (error: any) {
      lastError = error;
      const statusCode = error?.status || error?.code || 0;

      // Check if retryable
      const retryableStatusCodes = [429, 500, 503];
      const isRetryable = retryableStatusCodes.includes(statusCode) ||
        error?.message?.includes('timeout') ||
        error?.message?.includes('ECONNRESET');

      if (!isRetryable || attempt === maxRetries) {
        console.error(`[AI API] ❌ Request failed after ${attempt + 1} attempt(s):`, error?.message);
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(`[AI API] ⚠️ Attempt ${attempt + 1} failed (${statusCode}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (!response) {
    throw lastError || new Error('No response from Vertex AI');
  }

  // Parse response - new SDK returns response directly
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const textParts = parts
    .filter((p: any) => p.text && !p.thought) // Exclude thinking text
    .map((p: any) => p.text as string);
  const functionCalls = parts
    .filter((p: any) => p.functionCall)
    .map((p: any) => p.functionCall);

  const text = textParts.join('');
  const toolCalls = functionCalls.map((fc: any) => ({
    name: fc.name,
    args: fc.args || {},
  }));

  // Extract usage stats
  const usageMetadata = response?.usageMetadata;
  const tokenStats = usageMetadata
    ? {
        promptTokenCount: usageMetadata.promptTokenCount,
        candidatesTokenCount: usageMetadata.candidatesTokenCount,
        totalTokenCount: usageMetadata.totalTokenCount,
      }
    : undefined;

  if (toolCalls.length > 0) {
    console.log(
      `[AI API] 🛠️ Model requested ${toolCalls.length} tool call(s): [${toolCalls.map((tc: any) => tc.name).join(', ')}]`
    );
  }

  return {
    text,
    toolCalls,
    rawParts: parts, // Preserve raw parts including thought_signature for Gemini 3
    finishReason:
      toolCalls.length > 0 ? ('tool_calls' as const) : ('stop' as const),
    metrics: {
      elapsedMs: Date.now() - t0,
      ...(tokenStats && { tokens: tokenStats }),
    },
  };
}

// OPTIONS (CORS)
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

// POST (SSE streaming for server-side tool visibility)
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Early validation - these return JSON errors before streaming starts
  let authResult;
  let body;
  try {
    authResult = await authenticate(request);
    if (!authResult.authenticated) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400, headers: corsHeaders }
    );
  }

  // Extract user context for authorization checks
  const authenticatedUserId = authResult.userId;
  const orgId = authResult.orgId;
  const userEmail = authResult.email;

  const sessionId = body.sessionId as string | undefined;
  const requestedModel = (body.model as string) || 'gemini-2.5-flash';
  const input = body.input as string | undefined;
  let history = (body.history as VertexMessage[]) || [];
  const system = (body.system as string) || undefined;
  const workflowId = body.workflowId as number | undefined; // For server-side workflow editing
  const generationConfig = body.generationConfig as
    | { temperature?: number; maxOutputTokens?: number }
    | undefined;
  const thinkingLevel = body.thinkingLevel as 'low' | 'high' | undefined;
  const mode = (body.mode as 'ask' | 'act') || 'act'; // Ask mode: AI can discuss tools but not execute
  console.log(`[AI API] Mode received: '${mode}' (body.mode was: ${body.mode === undefined ? 'undefined' : `'${body.mode}'`})`);
  const tools = body.tools as
    | Array<{ name: string; description?: string; parameters?: JSONSchema }>
    | undefined;
  const toolResults = body.toolResults as
    | Array<{ id: string; name: string; result: any }>
    | undefined;

  // Validate requested model first (before mapping to actual Vertex AI name)
  if (!validateModel(requestedModel)) {
    return NextResponse.json(
      { error: `Invalid model. Allowed: ${ALLOWED_MODELS.join(', ')}` },
      { status: 400, headers: corsHeaders }
    );
  }
  if (!input && !toolResults) {
    return NextResponse.json(
      { error: 'Either input or toolResults must be provided' },
      { status: 400, headers: corsHeaders }
    );
  }

  // Determine provider based on requested model (before mapping)
  const provider: 'vertex' | 'anthropic' = isAnthropicModel(requestedModel)
    ? 'anthropic'
    : 'vertex';
  console.log(`[AI API] Using provider: ${provider} for model: ${requestedModel}`);

  // Track server tools executed for streaming visibility
  const serverToolsExecuted: Array<{ name: string; args: any; result?: any; elapsedMs?: number; error?: string }> = [];

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const { emit, close, error: emitError } = createSSEEmitter(controller);

      try {
    // Load session from KV if sessionId provided
    let actualSessionId = sessionId;
    let sessionSystem = system;
    let sessionModel: AllowedModel = requestedModel as AllowedModel;
    let cachedTools: FunctionDeclaration[] | undefined = undefined;
    let cachedOriginalClientTools: Array<{ name: string; description?: string; parameters?: any }> | undefined = undefined;

    if (sessionId) {
      const sessionData = await loadSession(sessionId);
      if (sessionData) {
        // Use history from KV, override client-provided history
        history = sessionData.history;
        sessionSystem = sessionData.system || system;

        // CRITICAL: Allow model switching mid-session (e.g., Gemini → Claude)
        // Client's requested model takes precedence over stored model
        const requestedProvider = isAnthropicModel(requestedModel)
          ? 'anthropic'
          : 'vertex';
        const storedProvider = sessionData.provider || 'vertex';

        if (requestedProvider !== storedProvider) {
          // Provider switch detected - use client's requested model
          console.log(
            `[AI API] 🔄 Provider switch detected: ${storedProvider} → ${requestedProvider}`
          );
          console.log(
            `[AI API] Switching model from ${sessionData.model} → ${requestedModel}`
          );
          sessionModel = requestedModel as AllowedModel; // Use client's requested model

          // When switching providers, we'll convert history format on-demand in provider-specific code
          // The vertexToAnthropicHistory function will handle Vertex → Anthropic conversion
        } else if (requestedModel !== sessionData.model) {
          // Same provider but different model - allow model switching within provider
          console.log(
            `[AI API] 🔄 Model switch within ${storedProvider}: ${sessionData.model} → ${requestedModel}`
          );
          sessionModel = requestedModel as AllowedModel;
        } else {
          // Same provider and same model - use stored model
          sessionModel = sessionData.model;
        }

        cachedTools = sessionData.tools; // Retrieve cached tools from Turn 1 (stripped)
        cachedOriginalClientTools = sessionData.originalClientTools; // Retrieve original client tools for get_tool_details
        console.log(
          `[AI API] Using KV session ${sessionId} with ${history.length} history message(s)${cachedTools ? `, ${cachedTools.length} cached tools` : ''}${cachedOriginalClientTools ? `, ${cachedOriginalClientTools.length} original client tools` : ''}`
        );
      } else {
        console.log(
          `[AI API] Session ${sessionId} not found in KV, starting fresh`
        );
      }
    } else {
      // No sessionId provided, create new session for KV storage
      actualSessionId = createSessionId();
      console.log(`[AI API] Created new session ${actualSessionId}`);
    }

    // Route to appropriate provider
    if (provider === 'anthropic') {
      // Use Anthropic provider
      console.log(`[AI API] 🤖 Calling Anthropic with model ${sessionModel}`);

      // Merge client tools with server-side tools (same as Vertex)
      // Use cached tools if available (Turn 2+), otherwise merge fresh (Turn 1)
      let allTools: Array<{
        name: string;
        description?: string;
        parameters?: JSONSchema;
      }>;

      if (cachedTools && cachedTools.length > 0) {
        // Turn 2+: Use cached tools from session
        allTools = cachedTools as any;
        console.log(`🔄 Using ${cachedTools.length} cached tools from session`);
      } else {
        // Turn 1: Merge client tools with server-side knowledge tools
        const clientTools = tools || [];
        const serverToolDeclarations = getKnowledgeToolDeclarations();
        allTools = [...clientTools, ...serverToolDeclarations];
        // Debug: Show description lengths
        const clientDescLen = clientTools.reduce((sum, t) => sum + (t.description?.length || 0), 0);
        const serverDescLen = serverToolDeclarations.reduce((sum, t) => sum + (t.description?.length || 0), 0);
        console.log(
          `🛠️ Tools available: ${clientTools.length} client (${clientDescLen} desc chars), ${serverToolDeclarations.length} server (${serverDescLen} desc chars)`
        );
      }

      // Strategy for tool results:
      // - Pass FULL results via toolResults parameter for current turn accuracy
      // - After AI responds, add TRUNCATED results to persistent history (to save tokens)
      // - handleAnthropicChat will add full results to its internal Anthropic history

      const anthropicRequest: AIProviderRequest = {
        model: sessionModel,
        input,
        history, // Don't add tool results here - they'll be added after the call (truncated)
        system: sessionSystem,
        tools: allTools, // Pass all tools so AI has context
        toolResults, // Pass FULL results for current turn (handleAnthropicChat will add them)
        generationConfig,
        sessionId: actualSessionId,
      };

      const result = await handleAnthropicChat(anthropicRequest);

      // Log response stats
      console.log('📊 Anthropic response:', {
        textLen: result.text.length,
        toolCallsCount: result.toolCalls.length,
        finishReason: result.finishReason,
        elapsedMs: result.metrics.elapsedMs,
      });

      // In ask mode, filter out action tools but allow read-only tools
      if (mode === 'ask' && result.toolCalls.length > 0) {
        const allowedCalls = result.toolCalls.filter(tc => ASK_MODE_ALLOWED_TOOLS.has(tc.name));
        const blockedCalls = result.toolCalls.filter(tc => !ASK_MODE_ALLOWED_TOOLS.has(tc.name));

        if (blockedCalls.length > 0) {
          const blockedNamesList = blockedCalls.map(tc => tc.name);
          const blockedNames = blockedNamesList.join(', ');
          console.log(`🔒 [AI API] Ask mode: Blocking ${blockedCalls.length} action tool(s): ${blockedNames}`);
          // Append message about blocked tools
          const blockedMsg = `\n\n> **Blocked in Ask mode:** ${blockedNames}`;
          result.text = (result.text || '') + blockedMsg;
          // Add render_action_button to allowed calls so it gets emitted
          allowedCalls.push({
            id: `toolu_render_action_${Date.now()}`,
            name: 'render_action_button',
            args: { action: 'switch_to_act_mode', blocked_tools: blockedNamesList }
          });
        }

        if (allowedCalls.length > 0) {
          console.log(`✅ [AI API] Ask mode: Allowing ${allowedCalls.length} read-only tool(s): ${allowedCalls.map(tc => tc.name).join(', ')}`);
        }

        result.toolCalls = allowedCalls;
        if (allowedCalls.length === 0 || (allowedCalls.length === 1 && allowedCalls[0].name === 'render_action_button')) {
          result.finishReason = 'stop';
        }
      }

      let workflowData = null; // Track workflow modifications across all tool executions

      // Check if any tool calls are server-side and execute them
      if (result.toolCalls.length > 0) {
        const serverToolResults = [];
        const clientToolCalls = [];

        // Separate server and client tools
        for (const toolCall of result.toolCalls) {
          // Check if this is a server-side tool and emit start event
          const isServerTool = isKnowledgeTool(toolCall.name);
          if (isServerTool) {
            emit({ type: 'server_tool_start', name: toolCall.name, args: toolCall.args || {} });
          }
          const startTime = Date.now();

          const executed = await executeServerTool(
            toolCall,
            {
              authenticatedUserId,
              orgId,
              workflowId,
              clientTools: cachedOriginalClientTools || tools, // Use cached on Turn 2+, original on Turn 1
            },
            { preserveId: true } // Anthropic needs IDs
          );

          if (executed) {
            // Server-side tool - emit completion
            const elapsedMs = Date.now() - startTime;
            emit({
              type: 'server_tool_complete',
              name: executed.name,
              result: executed.result,
              elapsedMs,
              ...(executed.result?.error && { error: executed.result.error }),
            });
            if (executed.workflowData) {
              workflowData = executed.workflowData;
            }
            serverToolResults.push({
              name: executed.name,
              result: executed.result,
              ...(executed.id && { id: executed.id }),
            });
          } else {
            // Client-side tool - pass to client
            // Validate execute_sequence doesn't contain server-side tools
            if (toolCall.name === 'execute_sequence' && toolCall.args?.steps) {
              const steps = toolCall.args.steps as Array<{ tool_name?: string }>;
              const invalidTools = steps
                .filter(s => s.tool_name && isKnowledgeTool(s.tool_name))
                .map(s => s.tool_name);

              if (invalidTools.length > 0) {
                // Return error as a tool result so AI learns the pattern
                serverToolResults.push({
                  name: toolCall.name,
                  result: {
                    error: `execute_sequence can only contain desktop automation tools (MCP tools). The following server-side tools are NOT valid inside execute_sequence: ${invalidTools.join(', ')}. Call these tools as separate top-level tool calls instead.`,
                    invalid_tools: invalidTools,
                  },
                  ...(toolCall.id && { id: toolCall.id }),
                });
                serverToolsExecuted.push({
                  name: toolCall.name,
                  args: toolCall.args,
                  error: `Invalid tools in execute_sequence: ${invalidTools.join(', ')}`,
                });
                continue; // Skip adding to clientToolCalls
              }
            }
            clientToolCalls.push(toolCall);
          }
        }

        // If we executed server tools, continue conversation automatically
        if (serverToolResults.length > 0) {
          console.log(
            `🔄 Auto-continuing with ${serverToolResults.length} server tool results`
          );

          // Update history with user input and tool calls
          const updatedHistoryWithCalls = [...history];
          if (input) {
            updatedHistoryWithCalls.push({
              role: 'user',
              parts: [{ text: input }],
            });
          }

          // Add client tool results (TRUNCATED) if any
          if (toolResults && toolResults.length > 0) {
            updatedHistoryWithCalls.push({
              role: 'user',
              parts: toolResults.map(tr => ({
                functionResponse: {
                  name: tr.name,
                  response: wrapToolResult(tr.result),
                  ...(tr.id && { id: tr.id }),
                },
              })),
            });
          }

          // Add model's tool calls to history
          const toolCallParts = result.toolCalls.map(tc => ({
            functionCall: {
              name: tc.name,
              args: tc.args,
              ...(tc.id && { id: tc.id }),
            },
          }));

          updatedHistoryWithCalls.push({
            role: 'model',
            parts: toolCallParts,
          });

          // Call Anthropic with FULL server tool results via toolResults parameter
          // (Truncated results will be added to history AFTER continuation completes)
          const continuationResult = await handleAnthropicChat({
            model: sessionModel,
            history: updatedHistoryWithCalls,
            system: sessionSystem,
            tools: allTools,
            toolResults: serverToolResults, // Pass FULL results for current turn accuracy
            generationConfig,
            sessionId: actualSessionId,
          });

          console.log('🎯 Continuation result:', {
            textLen: continuationResult.text.length,
            toolCallsCount: continuationResult.toolCalls.length,
            finishReason: continuationResult.finishReason,
          });

          // Add TRUNCATED server tool results to persistent history (saves tokens for future turns)
          // This is done AFTER the continuation so handleAnthropicChat received FULL results
          updatedHistoryWithCalls.push({
            role: 'user',
            parts: serverToolResults.map(tr => ({
              functionResponse: {
                name: tr.name,
                response: wrapToolResult(tr.result), // Full result (no truncation)
                ...(tr.id && { id: tr.id }),
              },
            })),
          });

          // Check if continuation has more server-side tools to execute
          let finalResult = continuationResult;
          const finalHistory = [...updatedHistoryWithCalls];

          // Keep executing server tools until there are none left
          while (finalResult.toolCalls.length > 0) {
            const moreServerTools = [];
            const remainingClientTools = [];
            const blockedInAskMode: string[] = [];

            // Check each tool call from continuation
            for (const toolCall of finalResult.toolCalls) {
              // In ask mode, block tools not in the allowed list
              if (mode === 'ask' && !ASK_MODE_ALLOWED_TOOLS.has(toolCall.name)) {
                console.log(`🔒 [Anthropic continuation] Ask mode: Blocking action tool: ${toolCall.name}`);
                blockedInAskMode.push(toolCall.name);
                continue; // Skip this tool call
              }

              // Check if this is a server-side tool and emit start event
              const isServerTool = isKnowledgeTool(toolCall.name);
              if (isServerTool) {
                emit({ type: 'server_tool_start', name: toolCall.name, args: toolCall.args || {} });
              }
              const startTime = Date.now();

              const executed = await executeServerTool(
                toolCall,
                {
                  authenticatedUserId,
                  orgId,
                  workflowId,
                  clientTools: cachedOriginalClientTools || tools, // Use cached on Turn 2+, original on Turn 1
                },
                { preserveId: true, isAdditional: true } // Anthropic needs IDs
              );

              if (executed) {
                // Server-side tool - emit completion
                const elapsedMs = Date.now() - startTime;
                emit({
                  type: 'server_tool_complete',
                  name: executed.name,
                  result: executed.result,
                  elapsedMs,
                  ...(executed.result?.error && { error: executed.result.error }),
                });
                if (executed.workflowData) {
                  workflowData = executed.workflowData;
                }
                moreServerTools.push({
                  name: executed.name,
                  result: executed.result,
                  ...(executed.id && { id: executed.id }),
                });
              } else {
                // Client-side tool
                // Validate execute_sequence doesn't contain server-side tools
                if (toolCall.name === 'execute_sequence' && toolCall.args?.steps) {
                  const steps = toolCall.args.steps as Array<{ tool_name?: string }>;
                  const invalidTools = steps
                    .filter(s => s.tool_name && isKnowledgeTool(s.tool_name))
                    .map(s => s.tool_name);

                  if (invalidTools.length > 0) {
                    // Return error as a tool result so AI learns the pattern
                    moreServerTools.push({
                      name: toolCall.name,
                      result: {
                        error: `execute_sequence can only contain desktop automation tools (MCP tools). The following server-side tools are NOT valid inside execute_sequence: ${invalidTools.join(', ')}. Call these tools as separate top-level tool calls instead.`,
                        invalid_tools: invalidTools,
                      },
                      ...(toolCall.id && { id: toolCall.id }),
                    });
                    continue; // Skip adding to remainingClientTools
                  }
                }
                remainingClientTools.push(toolCall);
              }
            }

            // Emit action button when tools are blocked in ask mode
            if (blockedInAskMode.length > 0) {
              const uniqueBlocked = [...new Set(blockedInAskMode)];
              const blockedMsg = `\n\n> **Blocked in Ask mode:** ${uniqueBlocked.join(', ')}`;
              emit({ type: 'text', content: blockedMsg });
              // Add render_action_button to remaining client tools
              remainingClientTools.push({
                id: `toolu_render_action_${Date.now()}`,
                name: 'render_action_button',
                args: { action: 'switch_to_act_mode', blocked_tools: uniqueBlocked }
              });
            }

            // If no more server tools, break the loop
            if (moreServerTools.length === 0) {
              clientToolCalls.push(...remainingClientTools);
              break;
            }

            // Add the model's response with tool calls to history
            if (finalResult.text || finalResult.toolCalls.length > 0) {
              const modelParts: Array<{ text?: string; functionCall?: any }> =
                [];
              if (finalResult.text) {
                modelParts.push({ text: finalResult.text });
              }
              finalResult.toolCalls.forEach(tc => {
                modelParts.push({
                  functionCall: {
                    name: tc.name,
                    args: tc.args,
                    ...(tc.id && { id: tc.id }),
                  },
                });
              });
              finalHistory.push({
                role: 'model',
                parts: modelParts,
              });
            }

            // Continue conversation with FULL server tool results via toolResults parameter
            // (Truncated results will be added to history AFTER continuation completes)
            console.log(
              `🔄 Auto-continuing with ${moreServerTools.length} more server tool results`
            );
            finalResult = await handleAnthropicChat({
              model: sessionModel,
              history: finalHistory,
              system: sessionSystem,
              tools: allTools,
              toolResults: moreServerTools, // Pass FULL results for current turn accuracy
              generationConfig,
              sessionId: actualSessionId,
            });

            console.log('🎯 Additional continuation result:', {
              textLen: finalResult.text.length,
              toolCallsCount: finalResult.toolCalls.length,
              finishReason: finalResult.finishReason,
            });

            // Add TRUNCATED server tool results to persistent history (saves tokens for future turns)
            // This is done AFTER the continuation so handleAnthropicChat received FULL results
            finalHistory.push({
              role: 'user',
              parts: moreServerTools.map(tr => ({
                functionResponse: {
                  name: tr.name,
                  response: wrapToolResult(tr.result), // Full result (no truncation)
                  ...(tr.id && { id: tr.id }),
                },
              })),
            });
          }

          // Add final model response to history
          if (finalResult.text || finalResult.toolCalls.length > 0) {
            const modelParts: Array<{ text?: string; functionCall?: any }> = [];
            if (finalResult.text) {
              modelParts.push({ text: finalResult.text });
            }
            finalResult.toolCalls.forEach(tc => {
              modelParts.push({
                functionCall: {
                  name: tc.name,
                  args: tc.args,
                  ...(tc.id && { id: tc.id }),
                },
              });
            });
            finalHistory.push({
              role: 'model',
              parts: modelParts,
            });
          }

          // Save updated session to KV
          if (actualSessionId) {
            const sessionData: SessionData = {
              history: finalHistory,
              provider,
              system: sessionSystem,
              tools: cachedTools || (allTools as any), // Cache tools on Turn 1, keep cached tools on Turn 2+
              originalClientTools: cachedOriginalClientTools || tools, // Cache original client tools for get_tool_details
              model: sessionModel,
              createdAt: sessionId
                ? (await loadSession(sessionId))?.createdAt ||
                  new Date().toISOString()
                : new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await saveSession(actualSessionId, sessionData);
          }

          // Emit text if present
          if (finalResult.text) {
            emit({ type: 'text', content: finalResult.text });
          }
          // Emit client tools if any remain
          if (clientToolCalls.length > 0) {
            emit({ type: 'client_tools', toolCalls: clientToolCalls });
          }
          // Track LLM usage
          if (finalResult.metrics?.tokens && authenticatedUserId && orgId) {
            trackLLMUsage({
              userId: authenticatedUserId,
              orgId,
              model: sessionModel,
              inputTokens: finalResult.metrics.tokens.promptTokenCount || 0,
              outputTokens: finalResult.metrics.tokens.candidatesTokenCount || 0,
            });
          }
          // Emit done and close
          emit({
            type: 'done',
            finishReason: clientToolCalls.length > 0 ? 'tool_calls' : 'stop',
            sessionId: actualSessionId || '',
            model: sessionModel,
            ...(workflowData && { workflowData }),
            metrics: finalResult.metrics,
          });
          close();
          return;
        }
      }

      // No server tools executed - standard response path
      const updatedHistory = [...history];

      // Add user message to history
      if (input) {
        updatedHistory.push({
          role: 'user',
          parts: [{ text: input }],
        });
      }

      // CRITICAL: Add client tool results to persistent history (TRUNCATED to save tokens)
      // This ensures every tool_use has a corresponding tool_result (required by Anthropic API)
      if (toolResults && toolResults.length > 0) {
        updatedHistory.push({
          role: 'user',
          parts: toolResults.map(tr => ({
            functionResponse: {
              name: tr.name,
              response: wrapToolResult(tr.result), // Full result (no truncation)
              ...(tr.id && { id: tr.id }),
            },
          })),
        });
      }

      // Add model response to history
      const modelParts: Array<{ text?: string; functionCall?: any }> = [];
      if (result.text) {
        modelParts.push({ text: result.text });
      }
      if (result.toolCalls.length > 0) {
        result.toolCalls.forEach(tc => {
          modelParts.push({
            functionCall: {
              name: tc.name,
              args: tc.args,
              ...(tc.id && { id: tc.id }), // Store ID if present
            },
          });
        });
      }

      if (modelParts.length > 0) {
        updatedHistory.push({
          role: 'model',
          parts: modelParts,
        });
      }

      // Save updated session to KV
      if (actualSessionId) {
        const sessionData: SessionData = {
          history: updatedHistory,
          provider,
          system: sessionSystem,
          tools: cachedTools || (allTools as any), // Cache tools on Turn 1, keep cached tools on Turn 2+
          originalClientTools: cachedOriginalClientTools || tools, // Cache original client tools for get_tool_details
          model: sessionModel,
          createdAt: sessionId
            ? (await loadSession(sessionId))?.createdAt ||
              new Date().toISOString()
            : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await saveSession(actualSessionId, sessionData);
      }

      // Emit text if present
      if (result.text) {
        emit({ type: 'text', content: result.text });
      }
      // Emit client tools if any
      if (result.toolCalls && result.toolCalls.length > 0) {
        emit({ type: 'client_tools', toolCalls: result.toolCalls });
      }
      // Track LLM usage
      if (result.metrics?.tokens && authenticatedUserId && orgId) {
        trackLLMUsage({
          userId: authenticatedUserId,
          orgId,
          model: sessionModel,
          inputTokens: result.metrics.tokens.promptTokenCount || 0,
          outputTokens: result.metrics.tokens.candidatesTokenCount || 0,
        });
      }
      // Emit done and close
      emit({
        type: 'done',
        finishReason: result.finishReason || 'stop',
        sessionId: actualSessionId || '',
        model: sessionModel,
        ...(workflowData && { workflowData }),
        metrics: result.metrics,
      });
      close();
      return;
    }

    // Vertex AI provider path
    // Merge client tools with server-side tools
    // Use cached tools if available (Turn 2+), otherwise merge fresh (Turn 1)
    let functionDeclarations: FunctionDeclaration[];

    if (cachedTools && cachedTools.length > 0) {
      // Turn 2+: Use cached tools from session
      functionDeclarations = cachedTools;
      console.log(`🔄 Using ${cachedTools.length} cached tools from session`);
    } else {
      // Turn 1: Merge client tools with server-side knowledge tools
      const clientFunctionDeclarations = toFunctionDeclarations(tools);
      const serverFunctionDeclarations = getKnowledgeToolDeclarations();
      functionDeclarations = [
        ...clientFunctionDeclarations,
        ...serverFunctionDeclarations,
      ];
      // Debug: Show description lengths to verify stripping is working
      const clientDescLen = clientFunctionDeclarations.reduce((sum, t) => sum + (t.description?.length || 0), 0);
      const serverDescLen = serverFunctionDeclarations.reduce((sum, t) => sum + (t.description?.length || 0), 0);
      console.log(
        `🛠️ Tools available: ${clientFunctionDeclarations.length} client (${clientDescLen} desc chars), ${serverFunctionDeclarations.length} server (${serverDescLen} desc chars)`
      );

    }

    // Generate OAuth access token for Vertex AI REST API
    const accessToken = await generateVertexAccessToken();
    const project = process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022';

    // Gemini 3 requires global endpoint
    const mappedModel = getVertexModelName(sessionModel);
    const isGemini3 = mappedModel.includes('gemini-3');
    const location = isGemini3 ? 'global' : (process.env.VERTEX_AI_LOCATION || 'us-central1');

    console.log(`[AI API] Using Vertex AI REST API (location: ${location}) for model: ${mappedModel}`);

    // Logs for debugging
    const systemLen = system?.length || 0;
    const toolsCount = functionDeclarations.length;
    const inputLen = input?.length || 0;
    const toolResultsCount = toolResults?.length || 0;
    const historyLen = history.length;

    console.log('🤖 Vertex request', {
      model: sessionModel,
      sessionId: actualSessionId,
      mode,
      systemLen,
      inputLen,
      toolsCount,
      toolResultsCount,
      historyLen,
      generationConfig,
    });

    const result = await handleVertexChat({
      accessToken,
      project,
      location,
      model: sessionModel as VertexModel,
      system: sessionSystem,
      history,
      functionDeclarations, // Pass all tools so AI has context
      input,
      toolResults,
      generationConfig,
      thinkingLevel,
    });

    // Log response stats
    const responseStats: Record<string, any> = {
      textLen: result.text.length,
      toolCallsCount: result.toolCalls.length,
      finishReason: result.finishReason,
      elapsedMs: result.metrics.elapsedMs,
    };

    if (result.metrics.tokens) {
      responseStats.tokens = result.metrics.tokens;
    }

    console.log('📊 Response stats', responseStats);

    // In ask mode, filter out action tools but allow read-only tools
    if (mode === 'ask' && result.toolCalls.length > 0) {
      const allowedCalls = result.toolCalls.filter(tc => ASK_MODE_ALLOWED_TOOLS.has(tc.name));
      const blockedCalls = result.toolCalls.filter(tc => !ASK_MODE_ALLOWED_TOOLS.has(tc.name));
      const blockedNamesList = [...new Set(blockedCalls.map(tc => tc.name))];

      if (blockedCalls.length > 0) {
        console.log(`🔒 [AI API] Ask mode: Blocking ${blockedCalls.length} action tool(s): ${blockedNamesList.join(', ')}`);
        // Append message about blocked tools
        const blockedMsg = `\n\n> **Blocked in Ask mode:** ${blockedNamesList.join(', ')}`;
        result.text = (result.text || '') + blockedMsg;
        // Add render_action_button to allowed calls so it gets emitted
        allowedCalls.push({
          id: `toolu_render_action_${Date.now()}`,
          name: 'render_action_button',
          args: { action: 'switch_to_act_mode', blocked_tools: blockedNamesList }
        });
      }

      if (allowedCalls.length > 0) {
        console.log(`✅ [AI API] Ask mode: Allowing ${allowedCalls.length} read-only tool(s): ${allowedCalls.map(tc => tc.name).join(', ')}`);
      }

      result.toolCalls = allowedCalls;

      // Strip blocked functionCalls from rawParts to prevent saving them to session history
      // This fixes the "function response parts ≠ function call parts" error when switching from ask to act mode
      if (result.rawParts && blockedCalls.length > 0) {
        const blockedNamesSet = new Set(blockedNamesList);
        result.rawParts = result.rawParts.filter((part: any) => {
          if (!part.functionCall) return true; // Keep non-functionCall parts
          return !blockedNamesSet.has(part.functionCall.name); // Keep allowed functionCalls
        });
        // Ensure we have at least the text part if rawParts is now empty
        if (result.rawParts.length === 0 && result.text) {
          result.rawParts = [{ text: result.text }];
        }
      }

      // Only render_action_button means we should stop (no real tools to execute)
      if (allowedCalls.length === 0 || (allowedCalls.length === 1 && allowedCalls[0].name === 'render_action_button')) {
        result.finishReason = 'stop';
      }
    }

    let workflowData = null; // Track workflow modifications across all tool executions

    // DEBUG: Log rawParts to understand ordering
    console.log('📋 Initial rawParts:', JSON.stringify(result.rawParts?.map((p: any) => ({
      type: p.text ? 'text' : p.functionCall ? 'functionCall' : p.thought ? 'thought' : 'unknown',
      ...(p.text && { textPreview: p.text.substring(0, 50) + '...' }),
      ...(p.functionCall && { name: p.functionCall.name }),
    })), null, 2));

    // Process raw parts in order - emits text and tool events in the correct sequence
    const {
      serverToolResults,
      clientToolCalls,
      workflowData: initialWorkflowData,
    } = await processRawPartsInOrder(
      result.rawParts,
      emit,
      {
        authenticatedUserId,
        orgId,
        email: userEmail,
        workflowId,
        clientTools: cachedOriginalClientTools || tools,
      },
      { preserveId: false, mode } // Vertex doesn't need IDs
    );
    if (initialWorkflowData) {
      workflowData = initialWorkflowData;
    }

    // If we have tool calls (either executed server tools or pending client tools)
    if (serverToolResults.length > 0 || clientToolCalls.length > 0) {
      // If we executed server tools, continue conversation automatically
      if (serverToolResults.length > 0) {
        console.log(
          `🔄 Auto-continuing with ${serverToolResults.length} server tool results`
        );

        // Update history with the tool calls - use rawParts to preserve thought_signature for Gemini 3
        const updatedHistoryWithCalls = [...history];
        if (input) {
          updatedHistoryWithCalls.push({
            role: 'user',
            parts: [{ text: input }],
          });
        }
        // Use raw parts from response to preserve thought_signature (required for Gemini 3)
        updatedHistoryWithCalls.push({
          role: 'model',
          parts: result.rawParts || serverToolResults.map(tr => ({
            functionCall: {
              name: tr.name,
              args: result.toolCalls.find(tc => tc.name === tr.name)?.args || {},
            },
          })),
        });

        // Don't add tool results to history yet - they'll be sent via toolResults parameter
        // and added to history after the continuation call

        // Call Vertex again with tool results
        const continuationResult = await handleVertexChat({
          accessToken,
          project,
          location,
          model: sessionModel as VertexModel,
          system: sessionSystem,
          history: updatedHistoryWithCalls,
          functionDeclarations,
          toolResults: serverToolResults,
          generationConfig,
          thinkingLevel,
        });

        console.log('🎯 Continuation result:', {
          textLen: continuationResult.text.length,
          toolCallsCount: continuationResult.toolCalls.length,
          finishReason: continuationResult.finishReason,
        });

        // Process continuation result parts in order
        let finalResult = continuationResult;
        const finalHistory = [...updatedHistoryWithCalls];

        // NOTE: Server tool results are NOT added to persistent history
        // They were sent via toolResults parameter for immediate processing only

        // DEBUG: Log continuation rawParts
        console.log('📋 Continuation rawParts:', JSON.stringify(finalResult.rawParts?.map((p: any) => ({
          type: p.text ? 'text' : p.functionCall ? 'functionCall' : p.thought ? 'thought' : 'unknown',
          ...(p.text && { textPreview: p.text.substring(0, 50) + '...' }),
          ...(p.functionCall && { name: p.functionCall.name }),
        })), null, 2));

        // Process first continuation result in order
        let continuationProcessed = await processRawPartsInOrder(
          finalResult.rawParts,
          emit,
          {
            authenticatedUserId,
            orgId,
            workflowId,
            clientTools: cachedOriginalClientTools || tools,
          },
          { preserveId: false, isAdditional: true, mode }
        );
        let moreServerTools = continuationProcessed.serverToolResults;
        clientToolCalls.push(...continuationProcessed.clientToolCalls);
        if (continuationProcessed.workflowData) {
          workflowData = continuationProcessed.workflowData;
        }

        // Keep executing server tools until there are none left
        while (moreServerTools.length > 0) {
          // Add the model's response with tool calls to history - use rawParts to preserve thought_signature
          if (finalResult.rawParts && finalResult.rawParts.length > 0) {
            finalHistory.push({
              role: 'model',
              parts: finalResult.rawParts,
            });
          } else if (finalResult.text || finalResult.toolCalls.length > 0) {
            // Fallback: reconstruct parts (for non-Gemini 3 or missing rawParts)
            const modelParts: Array<{ text?: string; functionCall?: any }> = [];
            if (finalResult.text) {
              modelParts.push({ text: finalResult.text });
            }
            finalResult.toolCalls.forEach(tc => {
              modelParts.push({
                functionCall: {
                  name: tc.name,
                  args: tc.args,
                },
              });
            });
            finalHistory.push({
              role: 'model',
              parts: modelParts,
            });
          }

          // Continue conversation with server tool results
          console.log(
            `🔄 Auto-continuing with ${moreServerTools.length} more server tool results`
          );
          finalResult = await handleVertexChat({
            accessToken,
            project,
            location,
            model: sessionModel as VertexModel,
            system: sessionSystem,
            history: finalHistory,
            functionDeclarations,
            toolResults: moreServerTools,
            generationConfig,
            thinkingLevel,
          });

          console.log('🎯 Additional continuation result:', {
            textLen: finalResult.text.length,
            toolCallsCount: finalResult.toolCalls.length,
            finishReason: finalResult.finishReason,
          });

          // Process this result in order
          continuationProcessed = await processRawPartsInOrder(
            finalResult.rawParts,
            emit,
            {
              authenticatedUserId,
              orgId,
              workflowId,
              clientTools: cachedOriginalClientTools || tools,
            },
            { preserveId: false, isAdditional: true, mode }
          );
          moreServerTools = continuationProcessed.serverToolResults;
          clientToolCalls.push(...continuationProcessed.clientToolCalls);
          if (continuationProcessed.workflowData) {
            workflowData = continuationProcessed.workflowData;
          }
        }

        // Add final model response to history - use rawParts to preserve thought_signature for Gemini 3
        if (finalResult.rawParts && finalResult.rawParts.length > 0) {
          // Use raw parts from response (preserves thought_signature)
          finalHistory.push({
            role: 'model',
            parts: finalResult.rawParts,
          });
        } else if (finalResult.text || finalResult.toolCalls.length > 0) {
          // Fallback: reconstruct parts (for non-Gemini 3 or missing rawParts)
          const modelParts: Array<{ text?: string; functionCall?: any }> = [];
          if (finalResult.text) {
            modelParts.push({ text: finalResult.text });
          }
          finalResult.toolCalls.forEach(tc => {
            modelParts.push({
              functionCall: {
                name: tc.name,
                args: tc.args,
              },
            });
          });
          finalHistory.push({
            role: 'model',
            parts: modelParts,
          });
        }

        // Save updated session to KV
        if (actualSessionId) {
          const sessionData: SessionData = {
            history: finalHistory,
            provider,
            system: sessionSystem,
            tools: cachedTools || functionDeclarations, // Cache tools on Turn 1, keep cached tools on Turn 2+
            originalClientTools: cachedOriginalClientTools || tools, // Cache original client tools for get_tool_details
            model: sessionModel,
            createdAt: sessionId
              ? (await loadSession(sessionId))?.createdAt ||
                new Date().toISOString()
              : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await saveSession(actualSessionId, sessionData);
        }

        // Text was already emitted in order by processRawPartsInOrder
        // Emit client tools if any remain
        if (clientToolCalls.length > 0) {
          emit({ type: 'client_tools', toolCalls: clientToolCalls });
        }
        // Track LLM usage
        if (finalResult.metrics?.tokens && authenticatedUserId && orgId) {
          trackLLMUsage({
            userId: authenticatedUserId,
            orgId,
            model: sessionModel,
            inputTokens: finalResult.metrics.tokens.promptTokenCount || 0,
            outputTokens: finalResult.metrics.tokens.candidatesTokenCount || 0,
          });
        }
        // Emit done and close
        emit({
          type: 'done',
          finishReason: clientToolCalls.length > 0 ? 'tool_calls' : 'stop',
          sessionId: actualSessionId || '',
          model: sessionModel,
          ...(workflowData && { workflowData }),
          metrics: finalResult.metrics,
        });
        close();
        return;
      }

      // If only client tools, continue normal flow
      result.toolCalls = clientToolCalls;
    }

    // Update history with new turn and save to KV (normal flow for no server tools)
    const updatedHistory = [...history];

    // Add user message to history
    if (input) {
      updatedHistory.push({
        role: 'user',
        parts: [{ text: input }],
      });
    }

    // CRITICAL: Add tool results to persistent history (TRUNCATED to save tokens)
    // This ensures every functionCall has a corresponding functionResponse (required by Gemini API)
    // Without this, chained tool calls fail with: "function response parts is equal to function call parts"
    if (toolResults && toolResults.length > 0) {
      updatedHistory.push({
        role: 'user',
        parts: toolResults.map(tr => ({
          functionResponse: {
            name: tr.name,
            response: wrapToolResult(tr.result), // Full result (no truncation) to save tokens
          },
        })),
      });
    }

    // Add model response to history - use rawParts to preserve thought_signature for Gemini 3
    if (result.rawParts && result.rawParts.length > 0) {
      // Use raw parts from response (preserves thought_signature)
      updatedHistory.push({
        role: 'model',
        parts: result.rawParts,
      });
    } else {
      // Fallback: reconstruct parts (for non-Gemini 3 or missing rawParts)
      const modelParts: Array<{ text?: string; functionCall?: any }> = [];
      if (result.text) {
        modelParts.push({ text: result.text });
      }
      if (result.toolCalls.length > 0) {
        result.toolCalls.forEach(tc => {
          modelParts.push({
            functionCall: {
              name: tc.name,
              args: tc.args,
              ...(tc.id && { id: tc.id }), // Preserve ID for Anthropic multi-turn support
            },
          });
        });
      }

      if (modelParts.length > 0) {
        updatedHistory.push({
          role: 'model',
          parts: modelParts,
        });
      }
    }

    // Save updated session to KV
    if (actualSessionId) {
      const sessionData: SessionData = {
        history: updatedHistory,
        provider,
        system: sessionSystem,
        tools: cachedTools || functionDeclarations, // Cache tools on Turn 1, keep cached tools on Turn 2+
        originalClientTools: cachedOriginalClientTools || tools, // Cache original client tools for get_tool_details
        model: sessionModel,
        createdAt: sessionId
          ? (await loadSession(sessionId))?.createdAt ||
            new Date().toISOString()
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveSession(actualSessionId, sessionData);
    }

    // Text was already emitted in order by processRawPartsInOrder above
    // Emit client tools if any (for client-only tool calls with no server tools)
    if (result.toolCalls && result.toolCalls.length > 0) {
      emit({ type: 'client_tools', toolCalls: result.toolCalls });
    }

    // Track LLM usage
    if (result.metrics?.tokens && authenticatedUserId && orgId) {
      trackLLMUsage({
        userId: authenticatedUserId,
        orgId,
        model: sessionModel,
        inputTokens: result.metrics.tokens.promptTokenCount || 0,
        outputTokens: result.metrics.tokens.candidatesTokenCount || 0,
      });
    }

    // Emit final done event with all data
    emit({
      type: 'done',
      finishReason: result.toolCalls?.length > 0 ? 'tool_calls' : (result.finishReason || 'stop'),
      sessionId: actualSessionId || '',
      model: sessionModel,
      ...(workflowData && { workflowData }),
      metrics: result.metrics,
    });
    close();
      } catch (error: unknown) {
        const err = error as Error;
        console.error('🚨 Vertex AI request failed:', err?.message);
        emitError(err);
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// GET (health)
export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    if (!(await authenticate(request))) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        format: 'multi-provider',
        streaming: false,
        stateless: true, // No Redis - pass history in each request
        sessionStorage: 'none',
        sessionTTL: 0,
        availableModels: ALLOWED_MODELS,
        providers: {
          vertex: {
            models: VERTEX_MODELS,
            toolExecution: 'hybrid',
            serverSideTools: [
              ...Object.keys(knowledgeTools),
            ],
          },
          anthropic: {
            models: ANTHROPIC_MODELS,
            toolExecution: 'client-only',
          },
        },
        note: 'Multi-provider endpoint supporting both Vertex AI (Gemini) and Anthropic (Claude). Provider selected based on model name. Redis-backed sessions with format conversion.',
        authentication: 'Authorization: Bearer|Basic',
      },
      { headers: corsHeaders }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Health check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
