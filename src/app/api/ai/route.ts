// Force Vercel rebuild - clear cache issue
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import {
  executeServerTool as executeKnowledgeTool,
  getServerToolDeclarations as getKnowledgeToolDeclarations,
  isServerSideTool as isKnowledgeTool,
  serverSideTools as knowledgeTools,
} from '@/lib/server-tools/knowledge-tools';
import {
  executeWorkflowTool,
  getWorkflowToolDeclarations,
  isWorkflowEditingTool,
  serverSideWorkflowTools,
} from '@/lib/server-tools/workflow-editing-tools';
import {
  executeDevLogTool,
  getDevLogToolDeclarations,
  isDevLogTool,
} from '@/lib/server-tools/dev-log-tools';
import { GoogleGenAI, FunctionDeclaration, Content, Part } from '@google/genai';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';
import { handleAnthropicChat } from './providers/anthropic';
import type { AIProviderRequest } from './providers/types';
import { analyzeToolResults, checkTokenLimit, logProviderDiagnostics } from './providers/utils';
import { getVertexModelName, getVertexGenAI as _getVertexGenAI } from '@/lib/vertexai';

// Redis client initialization
const getRedisClient = async () => {
  const client = createClient({
    url: process.env.REDIS_URL,
  });

  if (!client.isOpen) {
    await client.connect();
  }

  return client;
};

// =================================================================
// Multi-Provider AI endpoint (Vertex AI + Anthropic)
// Supports both stateless (client-side history) and stateful (KV-backed)
// architectures with native function calling
// =================================================================

// CORS (using shared helper)
import { getCorsHeaders } from '@/lib/cors';

// Allowed models (per workspace rule)
const VERTEX_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-pro-preview'] as const;
const ANTHROPIC_MODELS = ['claude-sonnet-4-5-20250929'] as const;
const ALLOWED_MODELS = [...VERTEX_MODELS, ...ANTHROPIC_MODELS] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];
type VertexModel = (typeof VERTEX_MODELS)[number];
type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];

// Client-side tools: server accepts any tools from client and returns tool calls
type JSONSchema = Record<string, unknown>;

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

const KV_SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const KV_SESSION_PREFIX = 'ai-session:';

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

// Redis session management --------------------------------------------
async function loadSession(sessionId: string): Promise<SessionData | null> {
  try {
    const redis = await getRedisClient();
    const key = `${KV_SESSION_PREFIX}${sessionId}`;
    const data = await redis.get(key);

    if (data) {
      const parsed = JSON.parse(data) as SessionData;
      console.log(
        `[REDIS] Loaded session ${sessionId} with ${parsed.history.length} messages`
      );
      return parsed;
    }
    return null;
  } catch (error) {
    console.error('[REDIS] Failed to load session:', error);
    return null;
  }
}

async function saveSession(
  sessionId: string,
  data: SessionData
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `${KV_SESSION_PREFIX}${sessionId}`;
    await redis.set(key, JSON.stringify(data), { EX: KV_SESSION_TTL });
    console.log(
      `[REDIS] Saved session ${sessionId} with ${data.history.length} messages (TTL: ${KV_SESSION_TTL}s)`
    );
  } catch (error) {
    console.error('[REDIS] Failed to save session:', error);
    throw error;
  }
}

function createSessionId(): string {
  return randomUUID();
}

/**
 * Truncate tool result content to reduce token consumption in persistent history
 * Anthropic API requires tool_result blocks to exist, but content can be truncated
 *
 * @param result - The tool result to truncate
 * @param maxChars - Maximum characters to keep (default: 500)
 * @returns Truncated result with metadata
 */
function truncateToolResult(result: any, maxChars: number = 500): any {
  // Gemini API requires function_response.response to be an object (Struct), not a primitive
  // Wrap strings/primitives in an object
  if (result === null || result === undefined) {
    return { result: null };
  }

  // If result is a string, wrap it in an object
  if (typeof result === 'string') {
    if (result.length <= maxChars) {
      return { result };
    }
    // Truncate long strings
    return {
      _truncated: true,
      _originalLength: result.length,
      result: result.substring(0, maxChars),
      summary: `[Result truncated from ${result.length} to ${maxChars} chars]`
    };
  }

  // If result is a number or boolean, wrap it
  if (typeof result !== 'object') {
    return { result };
  }

  // Result is already an object - check if it needs truncation
  const resultStr = JSON.stringify(result);

  if (resultStr.length <= maxChars) {
    return result;
  }

  // Truncate and add indicator
  const truncated = resultStr.substring(0, maxChars);
  const truncatedObj = {
    _truncated: true,
    _originalLength: resultStr.length,
    content: truncated,
    summary: `[Result truncated from ${resultStr.length} to ${maxChars} chars to save tokens]`
  };

  return truncatedObj;
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
  const isKnowledge = isKnowledgeTool(toolCall.name);
  const isWorkflow = isWorkflowEditingTool(toolCall.name);
  const isDevLog = isDevLogTool(toolCall.name);

  // Not a server-side tool
  if (!isKnowledge && !isWorkflow && !isDevLog) {
    return null;
  }

  const toolType = isWorkflow ? 'workflow' : isDevLog ? 'dev-log' : 'knowledge';
  const prefix = options.isAdditional
    ? 'additional server-side'
    : 'server-side';
  console.log(`🔧 Executing ${prefix} ${toolType} tool: ${toolCall.name}`);

  try {
    // All server-side tools require authenticated user context
    if (!context.authenticatedUserId) {
      throw new Error(
        'Server-side tools require authentication with a user account'
      );
    }

    // SECURITY: Always override workflow_id from request context (never trust AI-provided ID)
    let toolArgs = toolCall.args;
    if (isWorkflow || isDevLog) {
      if (!context.workflowId) {
        throw new Error(
          'workflowId is required in request body for workflow editing and dev log tools'
        );
      }
      toolArgs = { ...toolArgs, workflow_id: context.workflowId };
      console.log(
        `[SECURITY] Overriding workflow_id with authenticated context: ${context.workflowId}`
      );
    }

    // Execute the tool
    const toolResult = isWorkflow
      ? await executeWorkflowTool(toolCall.name, toolArgs, {
          userId: context.authenticatedUserId!,
          orgId: context.orgId || null,
          ...(context.email && { email: context.email }),
        })
      : isDevLog
      ? await executeDevLogTool(toolCall.name, toolArgs, {
          userId: context.authenticatedUserId!,
          orgId: context.orgId || null,
          ...(context.email && { email: context.email }),
        })
      : await executeKnowledgeTool(toolCall.name, toolArgs, {
          clientTools: context.clientTools,
        });

    // Extract workflow data if present
    const workflowData = isWorkflow
      ? captureWorkflowData(toolResult, null)
      : undefined;

    const logPrefix = options.isAdditional ? 'Additional server' : 'Server';
    console.log(`✅ ${logPrefix} tool ${toolCall.name} executed successfully`);

    return {
      name: toolCall.name,
      result: toolResult,
      ...(options.preserveId && toolCall.id && { id: toolCall.id }),
      ...(workflowData && { workflowData }),
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
  genAI: GoogleGenAI;
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
    genAI,
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

  // Check token limits
  checkTokenLimit(history, 'VERTEX', 200000, 150000);

  // Build contents array for the new SDK
  const contents: Content[] = [...history] as Content[];

  // Add new message or tool results
  if (toolResults && toolResults.length > 0) {
    // Continuing conversation with tool results
    console.log(`[AI API] 🔧 Sending ${toolResults.length} tool result(s)`);

    // Analyze tool results for potential issues
    analyzeToolResults(toolResults, 'VERTEX');

    // Format function responses for new SDK
    // Use truncateToolResult to ensure response is always an object (Gemini API requirement)
    const functionResponseParts: Part[] = toolResults.map(tr => ({
      functionResponse: {
        name: tr.name,
        response: truncateToolResult(tr.result, 500),
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

  // Call the API with retry logic
  let response;
  let lastError: Error | null = null;
  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await genAI.models.generateContent({
        model: mappedModel,
        contents,
        config,
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
        // Turn 1: Merge client tools with server-side tools
        const clientTools = tools || [];
        const knowledgeToolDecls = getKnowledgeToolDeclarations();
        const workflowToolDecls = getWorkflowToolDeclarations();
        const devLogToolDecls = getDevLogToolDeclarations();
        const serverToolDeclarations = [
          ...knowledgeToolDecls,
          ...workflowToolDecls,
          ...devLogToolDecls,
        ];
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

      // In ask mode, strip any tool calls - AI can discuss tools but not execute them
      if (mode === 'ask' && result.toolCalls.length > 0) {
        const toolNames = result.toolCalls.map(tc => tc.name).join(', ');
        console.log(`🔒 [AI API] Ask mode: Stripping ${result.toolCalls.length} tool call(s) from response: ${toolNames}`);
        result.text = result.text || `I would use: **${toolNames}**\n\nTo execute, switch to **Act** mode using the toggle in the top-right corner.`;
        result.toolCalls = [];
        result.finishReason = 'stop';
      }

      let workflowData = null; // Track workflow modifications across all tool executions

      // Check if any tool calls are server-side and execute them
      if (result.toolCalls.length > 0) {
        const serverToolResults = [];
        const clientToolCalls = [];

        // Separate server and client tools
        for (const toolCall of result.toolCalls) {
          // Check if this is a server-side tool and emit start event
          const isServerTool = isKnowledgeTool(toolCall.name) || isWorkflowEditingTool(toolCall.name) || isDevLogTool(toolCall.name);
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
                  response: truncateToolResult(tr.result, 500),
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
                response: truncateToolResult(tr.result, 500), // Truncate to 500 chars
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

            // Check each tool call from continuation
            for (const toolCall of finalResult.toolCalls) {
              // Check if this is a server-side tool and emit start event
              const isServerTool = isKnowledgeTool(toolCall.name) || isWorkflowEditingTool(toolCall.name) || isDevLogTool(toolCall.name);
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
                remainingClientTools.push(toolCall);
              }
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
                  response: truncateToolResult(tr.result, 500), // Truncate to 500 chars
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
              response: truncateToolResult(tr.result, 500), // Truncate to 500 chars
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
      // Turn 1: Merge client tools with server-side tools
      const clientFunctionDeclarations = toFunctionDeclarations(tools);
      const knowledgeToolDecls = getKnowledgeToolDeclarations();
      const workflowToolDecls = getWorkflowToolDeclarations();
      const devLogToolDecls = getDevLogToolDeclarations();
      const serverFunctionDeclarations = [
        ...knowledgeToolDecls,
        ...workflowToolDecls,
        ...devLogToolDecls,
      ];
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

    // Initialize Vertex client
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      emit({
        type: 'error',
        error: 'Server misconfiguration: missing GOOGLE_APPLICATION_CREDENTIALS_BASE64',
      });
      close();
      return;
    }

    const credentialsJson = Buffer.from(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
      'base64'
    ).toString('utf-8');
    const credentials = JSON.parse(credentialsJson);

    // Gemini 3 requires global endpoint
    const mappedModel = getVertexModelName(sessionModel);
    const isGemini3 = mappedModel.includes('gemini-3');
    const location = isGemini3 ? 'global' : (process.env.VERTEX_AI_LOCATION || 'us-central1');

    console.log(`[AI API] Using Vertex AI (location: ${location}) for model: ${mappedModel}`);

    const genAI = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      location,
      googleAuthOptions: {
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
      },
    });

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
      genAI,
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

    // In ask mode, strip any tool calls - AI can discuss tools but not execute them
    if (mode === 'ask' && result.toolCalls.length > 0) {
      const toolNames = result.toolCalls.map(tc => tc.name).join(', ');
      console.log(`🔒 [AI API] Ask mode: Stripping ${result.toolCalls.length} tool call(s) from response: ${toolNames}`);
      result.text = result.text || `I would use: **${toolNames}**\n\nTo execute, switch to **Act** mode using the toggle in the top-right corner.`;
      result.toolCalls = [];
      result.finishReason = 'stop';
      // Also strip functionCall from rawParts to prevent saving them to session history
      // This fixes the "function response parts ≠ function call parts" error when switching from ask to act mode
      if (result.rawParts) {
        result.rawParts = result.rawParts.filter((part: any) => !part.functionCall);
        // Ensure we have at least the text part if rawParts is now empty
        if (result.rawParts.length === 0 && result.text) {
          result.rawParts = [{ text: result.text }];
        }
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
        const isServerTool = isKnowledgeTool(toolCall.name) || isWorkflowEditingTool(toolCall.name) || isDevLogTool(toolCall.name);
        if (isServerTool) {
          emit({ type: 'server_tool_start', name: toolCall.name, args: toolCall.args || {} });
        }
        const startTime = Date.now();

        const executed = await executeServerTool(
          toolCall,
          {
            authenticatedUserId,
            orgId,
            email: userEmail,
            workflowId,
            clientTools: cachedOriginalClientTools || tools, // Use cached on Turn 2+, original on Turn 1
          },
          { preserveId: false } // Vertex doesn't need IDs
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
          });
        } else {
          // Client-side tool - pass to client
          clientToolCalls.push(toolCall);
        }
      }

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
          genAI,
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

        // Check if continuation has more server-side tools to execute
        let finalResult = continuationResult;
        const finalHistory = [...updatedHistoryWithCalls];

        // NOTE: Server tool results are NOT added to persistent history
        // They were sent via toolResults parameter for immediate processing only

        // Keep executing server tools until there are none left
        while (finalResult.toolCalls.length > 0) {
          const moreServerTools = [];
          const remainingClientTools = [];

          // Check each tool call from continuation
          for (const toolCall of finalResult.toolCalls) {
            // Check if this is a server-side tool and emit start event
            const isServerTool = isKnowledgeTool(toolCall.name) || isWorkflowEditingTool(toolCall.name) || isDevLogTool(toolCall.name);
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
              { preserveId: false, isAdditional: true } // Vertex doesn't need IDs
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
              });
            } else {
              // Client-side tool
              remainingClientTools.push(toolCall);
            }
          }

          // If no more server tools, break the loop
          if (moreServerTools.length === 0) {
            clientToolCalls.push(...remainingClientTools);
            break;
          }

          // Add the model's response with tool calls to history - use rawParts to preserve thought_signature
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

          // Don't add tool results to history yet - they'll be sent via toolResults parameter

          // Continue conversation with new server tool results
          console.log(
            `🔄 Auto-continuing with ${moreServerTools.length} more server tool results`
          );
          finalResult = await handleVertexChat({
            genAI,
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

          // NOTE: Server tool results are NOT added to persistent history
          // They were sent via toolResults parameter for immediate processing only
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

        // Emit text if present
        if (finalResult.text) {
          emit({ type: 'text', content: finalResult.text });
        }
        // Emit client tools if any remain
        if (clientToolCalls.length > 0) {
          emit({ type: 'client_tools', toolCalls: clientToolCalls });
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
            response: truncateToolResult(tr.result, 500), // Truncate to 500 chars to save tokens
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

    // Emit text if present (for non-tool-call responses)
    if (result.text) {
      emit({ type: 'text', content: result.text });
    }

    // Emit client tools if any (for client-only tool calls with no server tools)
    if (result.toolCalls && result.toolCalls.length > 0) {
      emit({ type: 'client_tools', toolCalls: result.toolCalls });
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
        stateless: false,
        sessionStorage: 'redis',
        sessionTTL: KV_SESSION_TTL,
        availableModels: ALLOWED_MODELS,
        providers: {
          vertex: {
            models: VERTEX_MODELS,
            toolExecution: 'hybrid',
            serverSideTools: [
              ...Object.keys(knowledgeTools),
              ...Object.keys(serverSideWorkflowTools),
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
