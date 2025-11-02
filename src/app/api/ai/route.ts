import type { FunctionDeclaration } from '@google-cloud/vertexai';
import { VertexAI } from '@google-cloud/vertexai';
import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { createClient } from 'redis';
import { randomUUID } from 'crypto';

// Redis client initialization
const getRedisClient = async () => {
  const client = createClient({
    url: process.env.REDIS_URL
  });

  if (!client.isOpen) {
    await client.connect();
  }

  return client;
};

// =================================================================
// Native Vertex AI (non-streaming) endpoint with optional tools
// Supports both stateless (client-side history) and stateful (KV-backed)
// architectures with native function calling
// =================================================================

// Auth
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

// CORS (using shared helper)
import { getCorsHeaders } from '@/lib/cors';

// Allowed models (per workspace rule)
const ALLOWED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];

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
  system?: string;
  model: AllowedModel;
  createdAt: string;
  updatedAt: string;
}

const KV_SESSION_TTL = 60 * 60 * 24; // 24 hours
const KV_SESSION_PREFIX = 'ai-session:';

// Helpers ------------------------------------------------------------
async function authenticate(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // First, check if it's the API password
    if (token === API_PASSWORD) {
      console.log('[AI API] Authenticated with API password');
      return true;
    }

    // Otherwise, try to validate as desktop token
    try {
      const validation = await validateDesktopToken(token);
      if (validation.valid) {
        console.log(`[AI API] Authenticated with desktop token for user: ${validation.email}`);
        return true;
      }
    } catch (error) {
      console.error('[AI API] Desktop token validation error:', error);
    }

    // Token didn't match password or desktop validation failed
    return false;
  }

  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [, password] = decoded.split(':');
    return password === API_PASSWORD;
  }

  return false;
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
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description || `Execute ${tool.name}`,
    parameters: cleanSchema(tool.parameters || {}) as any,
  }));
}

function validateModel(model: string | undefined): model is AllowedModel {
  return !!model && (ALLOWED_MODELS as readonly string[]).includes(model);
}

// Redis session management --------------------------------------------
async function loadSession(sessionId: string): Promise<SessionData | null> {
  try {
    const redis = await getRedisClient();
    const key = `${KV_SESSION_PREFIX}${sessionId}`;
    const data = await redis.get(key);

    if (data) {
      const parsed = JSON.parse(data) as SessionData;
      console.log(`[REDIS] Loaded session ${sessionId} with ${parsed.history.length} messages`);
      return parsed;
    }
    return null;
  } catch (error) {
    console.error('[REDIS] Failed to load session:', error);
    return null;
  }
}

async function saveSession(sessionId: string, data: SessionData): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `${KV_SESSION_PREFIX}${sessionId}`;
    await redis.set(key, JSON.stringify(data), { EX: KV_SESSION_TTL });
    console.log(`[REDIS] Saved session ${sessionId} with ${data.history.length} messages (TTL: ${KV_SESSION_TTL}s)`);
  } catch (error) {
    console.error('[REDIS] Failed to save session:', error);
    throw error;
  }
}

function createSessionId(): string {
  return randomUUID();
}

// Stateless chat handling with history reconstruction ----
async function handleVertexChat(params: {
  vertexAI: VertexAI;
  model: AllowedModel;
  system?: string;
  history: VertexMessage[];
  functionDeclarations: FunctionDeclaration[];
  input?: string;
  toolResults?: Array<{ name: string; result: any }>;
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
}): Promise<{
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  finishReason: 'stop' | 'tool_calls';
  metrics: { elapsedMs: number; tokens?: any };
}> {
  const {
    vertexAI,
    model,
    system,
    history,
    functionDeclarations,
    input,
    toolResults,
    generationConfig,
  } = params;

  const t0 = Date.now();

  // Create fresh chat instance with provided history
  const gm = vertexAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: generationConfig?.temperature ?? 0.7,
      maxOutputTokens: generationConfig?.maxOutputTokens ?? 1000,
    },
    tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
    systemInstruction: system
      ? ({ parts: [{ text: system }] } as any)
      : undefined,
  });

  // Start chat with provided history
  const chat = gm.startChat({ history: history as any });

  console.log(`[AI API] Created chat with ${history.length} history message(s)`);

  // Send message to chat
  let response;
  if (toolResults && toolResults.length > 0) {
    // Continuing conversation with tool results
    console.log(`[AI API] 🔧 Sending ${toolResults.length} tool result(s)`);

    // Format function responses for Vertex AI
    const functionResponseParts = toolResults.map(tr => ({
      functionResponse: {
        name: tr.name,
        response: tr.result
      }
    }));

    response = await chat.sendMessage(functionResponseParts as any);
  } else if (input) {
    // New user message
    console.log(`[AI API] 💬 Sending user message (${input.length} chars)`);
    response = await chat.sendMessage(input);
  } else {
    throw new Error('Either input or toolResults must be provided');
  }

  // Parse response
  const candidate = (response as any)?.response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const textParts = parts
    .filter((p: any) => p.text)
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
  const usageMetadata = (response as any)?.response?.usageMetadata;
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

// POST (native, non-streaming)
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  
  try {
    if (!(await authenticate(request))) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const sessionId = body.sessionId as string | undefined;
    const model = (body.model as string) || 'gemini-2.5-flash';
    const input = body.input as string | undefined;
    let history = (body.history as VertexMessage[]) || [];
    const system = (body.system as string) || undefined;
    const generationConfig = body.generationConfig as
      | { temperature?: number; maxOutputTokens?: number }
      | undefined;
    const tools = body.tools as
      | Array<{ name: string; description?: string; parameters?: JSONSchema }>
      | undefined;
    const toolResults = body.toolResults as
      | Array<{ name: string; result: any }>
      | undefined;

    // Load session from KV if sessionId provided
    let actualSessionId = sessionId;
    let sessionSystem = system;
    let sessionModel = validateModel(model) ? model : 'gemini-2.5-flash';

    if (sessionId) {
      const sessionData = await loadSession(sessionId);
      if (sessionData) {
        // Use history from KV, override client-provided history
        history = sessionData.history;
        sessionSystem = sessionData.system || system;
        sessionModel = sessionData.model;
        console.log(`[AI API] Using KV session ${sessionId} with ${history.length} history message(s)`);
      } else {
        console.log(`[AI API] Session ${sessionId} not found in KV, starting fresh`);
      }
    } else {
      // No sessionId provided, create new session for KV storage
      actualSessionId = createSessionId();
      console.log(`[AI API] Created new session ${actualSessionId}`);
    }

    if (!validateModel(model)) {
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

    const functionDeclarations = toFunctionDeclarations(tools);

    // Initialize Vertex client
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      return NextResponse.json(
        {
          error:
            'Server misconfiguration: missing GOOGLE_APPLICATION_CREDENTIALS_BASE64',
        },
        { status: 500, headers: corsHeaders }
      );
    }

    const credentialsJson = Buffer.from(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
      'base64'
    ).toString('utf-8');
    const credentials = JSON.parse(credentialsJson);

    const vertexAI = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      location: process.env.VERTEX_AI_LOCATION || 'us-central1',
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
      systemLen,
      inputLen,
      toolsCount,
      toolResultsCount,
      historyLen,
      generationConfig,
    });

    const result = await handleVertexChat({
      vertexAI,
      model: sessionModel,
      system: sessionSystem,
      history,
      functionDeclarations,
      input,
      toolResults,
      generationConfig,
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

    // Update history with new turn and save to KV
    const updatedHistory = [...history];

    // Add user message to history
    if (input) {
      updatedHistory.push({
        role: 'user',
        parts: [{ text: input }],
      });
    }

    // Add tool results to history if present
    if (toolResults && toolResults.length > 0) {
      updatedHistory.push({
        role: 'user',
        parts: toolResults.map(tr => ({
          functionResponse: {
            name: tr.name,
            response: tr.result,
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
        system: sessionSystem,
        model: sessionModel,
        createdAt: sessionId
          ? (await loadSession(sessionId))?.createdAt || new Date().toISOString()
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveSession(actualSessionId, sessionData);
    }

    return NextResponse.json(
      { model: sessionModel, sessionId: actualSessionId, ...result },
      { headers: corsHeaders }
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error('🚨 Vertex AI request failed:', err?.message);
    return NextResponse.json(
      {
        error: 'Failed to generate response',
        details: err?.message || String(error),
        errorType: err?.constructor?.name || 'Unknown',
        timestamp: new Date().toISOString(),
      },
      { status: 500, headers: corsHeaders }
    );
  }
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
        format: 'vertex-native',
        streaming: false,
        stateless: false,
        sessionStorage: 'redis',
        sessionTTL: KV_SESSION_TTL,
        availableModels: ALLOWED_MODELS,
        toolExecution: 'client-side',
        note: 'Redis-backed sessions: server stores conversation history with native functionCall/functionResponse. Pass sessionId for multi-turn conversations. Client still executes tools.',
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
