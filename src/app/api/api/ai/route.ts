import type { FunctionDeclaration } from '@google-cloud/vertexai';
import { VertexAI } from '@google-cloud/vertexai';
import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

// =================================================================
// Native Vertex AI (non-streaming) endpoint with optional tools
// =================================================================

// Auth
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

// CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Allowed models (per workspace rule)
const ALLOWED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];

// Client-side tools: server accepts any tools from client and returns tool calls
type JSONSchema = Record<string, unknown>;

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

// Simple single-turn Vertex call (client handles tool execution) ----
async function callVertex(params: {
  vertexAI: VertexAI;
  model: AllowedModel;
  system?: string;
  history?: Array<Record<string, unknown>>;
  functionDeclarations: FunctionDeclaration[];
  input: string;
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
}) {
  const {
    vertexAI,
    model,
    system,
    history = [],
    functionDeclarations,
    input,
    generationConfig,
  } = params;

  const t0 = Date.now();

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

  const chat = gm.startChat({ history: history as any });
  const response = await chat.sendMessage(input);

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

  // Extract usage stats if available
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
      `🛠️ Model requested ${toolCalls.length} tool call(s): [${toolCalls.map((tc: any) => tc.name).join(', ')}]`
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
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST (native, non-streaming)
export async function POST(request: NextRequest) {
  try {
    if (!(await authenticate(request))) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const model = (body.model as string) || 'gemini-2.5-flash';
    const input = body.input as string;
    const history = (body.history as Array<Record<string, unknown>>) || [];
    const system = (body.system as string) || undefined;
    const generationConfig = body.generationConfig as
      | { temperature?: number; maxOutputTokens?: number }
      | undefined;
    const tools = body.tools as
      | Array<{ name: string; description?: string; parameters?: JSONSchema }>
      | undefined;

    if (!validateModel(model)) {
      return NextResponse.json(
        { error: `Invalid model. Allowed: ${ALLOWED_MODELS.join(', ')}` },
        { status: 400, headers: corsHeaders }
      );
    }
    if (!input || typeof input !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: input (string)' },
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
    const historyLen = history.length;
    const historyCharLen = JSON.stringify(history).length;
    const toolsCount = functionDeclarations.length;
    const inputLen = input.length;

    console.log('🤖 Vertex request', {
      model,
      systemLen,
      historyLen,
      historyCharLen,
      inputCharLen: inputLen,
      toolsCount,
      generationConfig,
    });

    const result = await callVertex({
      vertexAI,
      model,
      system,
      history,
      functionDeclarations,
      input,
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

    return NextResponse.json({ model, ...result }, { headers: corsHeaders });
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
        availableModels: ALLOWED_MODELS,
        toolExecution: 'client-side',
        note: 'Server accepts any tools from client and returns tool calls for client execution',
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
