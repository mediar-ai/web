// Force Vercel rebuild - clear cache issue
import type { FunctionDeclaration } from '@google-cloud/vertexai';
import { VertexAI } from '@google-cloud/vertexai';
import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { createClient } from 'redis';
import { randomUUID } from 'crypto';
import {
  serverSideTools as knowledgeTools,
  getServerToolDeclarations as getKnowledgeToolDeclarations,
  executeServerTool as executeKnowledgeTool,
  isServerSideTool as isKnowledgeTool
} from '@/lib/server-tools/knowledge-tools';
import {
  serverSideWorkflowTools,
  getWorkflowToolDeclarations,
  executeWorkflowTool,
  isWorkflowEditingTool
} from '@/lib/server-tools/workflow-editing-tools';
import { handleAnthropicChat } from './providers/anthropic';
import type { AIProviderRequest } from './providers/types';

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
// Multi-Provider AI endpoint (Vertex AI + Anthropic)
// Supports both stateless (client-side history) and stateful (KV-backed)
// architectures with native function calling
// =================================================================

// Auth
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

// CORS (using shared helper)
import { getCorsHeaders } from '@/lib/cors';

// Allowed models (per workspace rule)
const VERTEX_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
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

function isVertexModel(model: string): model is VertexModel {
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
  model: VertexModel;
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

  console.log(`[VERTEX] Created chat with ${history.length} history message(s)`);

  // Send message to chat
  let response;
  if (toolResults && toolResults.length > 0) {
    // Continuing conversation with tool results
    console.log(`[AI API] 🔧 Sending ${toolResults.length} tool result(s)`);

    // Format function responses for Vertex AI
    // Important: Ensure the response field is properly formatted
    const functionResponseParts = toolResults.map(tr => ({
      functionResponse: {
        name: tr.name,
        // Ensure response is an object, not nested or array
        response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result }
      }
    }));

    // Send as array of parts
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
      | Array<{ name: string; result: any; id?: string }>
      | undefined;

    // Validate model first
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

    // Determine provider based on model
    const provider: 'vertex' | 'anthropic' = isAnthropicModel(model) ? 'anthropic' : 'vertex';
    console.log(`[AI API] Using provider: ${provider} for model: ${model}`);

    // Load session from KV if sessionId provided
    let actualSessionId = sessionId;
    let sessionSystem = system;
    let sessionModel: AllowedModel = model;

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

    // Route to appropriate provider
    if (provider === 'anthropic') {
      // Use Anthropic provider
      console.log(`[AI API] 🤖 Calling Anthropic with model ${sessionModel}`);

      // Merge client tools with server-side tools (same as Vertex)
      const clientTools = tools || [];
      const knowledgeToolDecls = getKnowledgeToolDeclarations();
      const workflowToolDecls = getWorkflowToolDeclarations();
      const serverToolDeclarations = [...knowledgeToolDecls, ...workflowToolDecls];
      const allTools = [...clientTools, ...serverToolDeclarations];

      console.log(`🛠️ Tools available: ${clientTools.length} client, ${knowledgeToolDecls.length} knowledge, ${workflowToolDecls.length} workflow`);

      const anthropicRequest: AIProviderRequest = {
        model: sessionModel,
        input,
        history,
        system: sessionSystem,
        tools: allTools,  // Pass merged tools to Anthropic
        toolResults,
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

      // Check if any tool calls are server-side and execute them
      if (result.toolCalls.length > 0) {
        const serverToolResults = [];
        const clientToolCalls = [];

        // Separate server and client tools
        for (const toolCall of result.toolCalls) {
          const isKnowledge = isKnowledgeTool(toolCall.name);
          const isWorkflow = isWorkflowEditingTool(toolCall.name);

          if (isKnowledge || isWorkflow) {
            console.log(`🔧 Executing server-side ${isWorkflow ? 'workflow' : 'knowledge'} tool: ${toolCall.name}`);
            try {
              // Add workflow_id to args if it's a workflow tool and we have it in the request
              let toolArgs = toolCall.args;
              if (isWorkflow && body.workflowId && !toolArgs.workflow_id) {
                toolArgs = { ...toolArgs, workflow_id: body.workflowId };
              }

              const toolResult = isWorkflow
                ? await executeWorkflowTool(toolCall.name, toolArgs)
                : await executeKnowledgeTool(toolCall.name, toolArgs);
              serverToolResults.push({
                name: toolCall.name,
                result: toolResult,
                id: toolCall.id  // Preserve ID for Anthropic
              });
              console.log(`✅ Server tool ${toolCall.name} executed successfully`);
            } catch (error) {
              console.error(`❌ Server tool ${toolCall.name} failed:`, error);
              serverToolResults.push({
                name: toolCall.name,
                result: { error: error instanceof Error ? error.message : 'Tool execution failed' },
                id: toolCall.id
              });
            }
          } else {
            // Client-side tool - pass to client
            clientToolCalls.push(toolCall);
          }
        }

        // If we executed server tools, continue conversation automatically
        if (serverToolResults.length > 0) {
          console.log(`🔄 Auto-continuing with ${serverToolResults.length} server tool results`);

          // Update history with the tool calls
          const updatedHistoryWithCalls = [...history];
          if (input) {
            updatedHistoryWithCalls.push({
              role: 'user',
              parts: [{ text: input }],
            });
          }

          // Add model's tool calls to history
          const toolCallParts = result.toolCalls.map(tc => ({
            functionCall: {
              name: tc.name,
              args: tc.args,
              ...(tc.id && { id: tc.id })
            }
          }));

          updatedHistoryWithCalls.push({
            role: 'model',
            parts: toolCallParts,
          });

          // Add server tool results to history
          updatedHistoryWithCalls.push({
            role: 'user',
            parts: serverToolResults.map(tr => ({
              functionResponse: {
                name: tr.name,
                // Ensure response is an object, not nested or array
                response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result },
                ...(tr.id && { id: tr.id })
              },
            })),
          });

          // Call Anthropic again with tool results
          const continuationResult = await handleAnthropicChat({
            model: sessionModel,
            history: updatedHistoryWithCalls,
            system: sessionSystem,
            tools: allTools,
            toolResults: serverToolResults,
            generationConfig,
            sessionId: actualSessionId,
          });

          console.log('🎯 Continuation result:', {
            textLen: continuationResult.text.length,
            toolCallsCount: continuationResult.toolCalls.length,
            finishReason: continuationResult.finishReason
          });

          // Merge results
          const finalHistory = [...updatedHistoryWithCalls];
          if (continuationResult.text || continuationResult.toolCalls.length > 0) {
            const modelParts: Array<{ text?: string; functionCall?: any }> = [];
            if (continuationResult.text) {
              modelParts.push({ text: continuationResult.text });
            }

            // Add any additional tool calls from continuation
            continuationResult.toolCalls.forEach(tc => {
              modelParts.push({
                functionCall: {
                  name: tc.name,
                  args: tc.args,
                  ...(tc.id && { id: tc.id })
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
              model: sessionModel,
              createdAt: sessionId
                ? (await loadSession(sessionId))?.createdAt || new Date().toISOString()
                : new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await saveSession(actualSessionId, sessionData);
          }

          // Return the final response with remaining client tools
          return NextResponse.json(
            {
              model: sessionModel,
              sessionId: actualSessionId,
              text: continuationResult.text,
              toolCalls: [...clientToolCalls, ...continuationResult.toolCalls],
              finishReason: continuationResult.toolCalls.length > 0 ? 'tool_calls' : 'stop',
              metrics: continuationResult.metrics,
            },
            { headers: corsHeaders }
          );
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

      // Add tool results to history if present
      if (toolResults && toolResults.length > 0) {
        updatedHistory.push({
          role: 'user',
          parts: toolResults.map(tr => ({
            functionResponse: {
              name: tr.name,
              // Ensure response is an object, not nested or array
              response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result },
              ...(tr.id && { id: tr.id }), // Include ID if present
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
    }

    // Vertex AI provider path
    // Merge client tools with server-side tools
    const clientFunctionDeclarations = toFunctionDeclarations(tools);
    const knowledgeToolDecls = getKnowledgeToolDeclarations();
    const workflowToolDecls = getWorkflowToolDeclarations();
    const serverFunctionDeclarations = [...knowledgeToolDecls, ...workflowToolDecls];
    const functionDeclarations = [...clientFunctionDeclarations, ...serverFunctionDeclarations];

    console.log(`🛠️ Tools available: ${clientFunctionDeclarations.length} client, ${knowledgeToolDecls.length} knowledge, ${workflowToolDecls.length} workflow`);

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
      model: sessionModel as VertexModel,
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

    let workflowData = null; // Track workflow modifications across all tool executions

    // Check if any tool calls are server-side and execute them
    if (result.toolCalls.length > 0) {
      const serverToolResults = [];
      const clientToolCalls = [];

      // Separate server and client tools
      for (const toolCall of result.toolCalls) {
        const isKnowledge = isKnowledgeTool(toolCall.name);
        const isWorkflow = isWorkflowEditingTool(toolCall.name);

        if (isKnowledge || isWorkflow) {
          console.log(`🔧 Executing server-side ${isWorkflow ? 'workflow' : 'knowledge'} tool: ${toolCall.name}`);
          try {
            // Add workflow_id to args if it's a workflow tool and we have it in the request
            let toolArgs = toolCall.args;
            if (isWorkflow && body.workflowId && !toolArgs.workflow_id) {
              toolArgs = { ...toolArgs, workflow_id: body.workflowId };
            }

            const toolResult = isWorkflow
              ? await executeWorkflowTool(toolCall.name, toolArgs)
              : await executeKnowledgeTool(toolCall.name, toolArgs);

            // Capture workflow data if the workflow was updated
            if (isWorkflow && 'workflow_updated' in toolResult && toolResult.workflow_updated && 'workflow_data' in toolResult && toolResult.workflow_data) {
              workflowData = toolResult.workflow_data;
              console.log(`📦 Captured updated workflow data for workflow ID: ${workflowData.id}`);
            }

            serverToolResults.push({
              name: toolCall.name,
              result: toolResult
            });
            console.log(`✅ Server tool ${toolCall.name} executed successfully`);
          } catch (error) {
            console.error(`❌ Server tool ${toolCall.name} failed:`, error);
            serverToolResults.push({
              name: toolCall.name,
              result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
            });
          }
        } else {
          // Client-side tool - pass to client
          clientToolCalls.push(toolCall);
        }
      }

      // If we executed server tools, continue conversation automatically
      if (serverToolResults.length > 0) {
        console.log(`🔄 Auto-continuing with ${serverToolResults.length} server tool results`);

        // Update history with the tool calls
        const toolCallParts = serverToolResults.map(tr => ({
          functionCall: {
            name: tr.name,
            args: result.toolCalls.find(tc => tc.name === tr.name)?.args || {}
          }
        }));

        const updatedHistoryWithCalls = [...history];
        if (input) {
          updatedHistoryWithCalls.push({
            role: 'user',
            parts: [{ text: input }],
          });
        }
        updatedHistoryWithCalls.push({
          role: 'model',
          parts: toolCallParts,
        });

        // Add tool results to history
        updatedHistoryWithCalls.push({
          role: 'user',
          parts: serverToolResults.map(tr => ({
            functionResponse: {
              name: tr.name,
              // Ensure response is an object, not nested or array
              response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result },
            },
          })),
        });

        // Call Vertex again with tool results
        const continuationResult = await handleVertexChat({
          vertexAI,
          model: sessionModel as VertexModel,
          system: sessionSystem,
          history: updatedHistoryWithCalls,
          functionDeclarations,
          toolResults: serverToolResults,
          generationConfig
        });

        console.log('🎯 Continuation result:', {
          textLen: continuationResult.text.length,
          toolCallsCount: continuationResult.toolCalls.length,
          finishReason: continuationResult.finishReason
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
            const isKnowledge = isKnowledgeTool(toolCall.name);
            const isWorkflow = isWorkflowEditingTool(toolCall.name);

            if (isKnowledge || isWorkflow) {
              console.log(`🔧 Executing additional server-side ${isWorkflow ? 'workflow' : 'knowledge'} tool: ${toolCall.name}`);
              try {
                let toolArgs = toolCall.args;
                if (isWorkflow && body.workflowId && !toolArgs.workflow_id) {
                  toolArgs = { ...toolArgs, workflow_id: body.workflowId };
                }

                const toolResult = isWorkflow
                  ? await executeWorkflowTool(toolCall.name, toolArgs)
                  : await executeKnowledgeTool(toolCall.name, toolArgs);

                // Capture workflow data if the workflow was updated
                if (isWorkflow && 'workflow_updated' in toolResult && toolResult.workflow_updated && 'workflow_data' in toolResult && toolResult.workflow_data) {
                  workflowData = toolResult.workflow_data;
                  console.log(`📦 Captured updated workflow data for workflow ID: ${workflowData.id}`);
                }

                moreServerTools.push({
                  name: toolCall.name,
                  result: toolResult
                });
                console.log(`✅ Additional server tool ${toolCall.name} executed successfully`);
              } catch (error) {
                console.error(`❌ Additional server tool ${toolCall.name} failed:`, error);
                moreServerTools.push({
                  name: toolCall.name,
                  result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
                });
              }
            } else {
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

          // Add server tool results to history
          finalHistory.push({
            role: 'user',
            parts: moreServerTools.map(tr => ({
              functionResponse: {
                name: tr.name,
                // Ensure response is an object, not nested or array
                response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result },
              },
            })),
          });

          // Continue conversation with new server tool results
          console.log(`🔄 Auto-continuing with ${moreServerTools.length} more server tool results`);
          finalResult = await handleVertexChat({
            vertexAI,
            model: sessionModel as VertexModel,
            system: sessionSystem,
            history: finalHistory,
            functionDeclarations,
            toolResults: moreServerTools,
            generationConfig
          });

          console.log('🎯 Additional continuation result:', {
            textLen: finalResult.text.length,
            toolCallsCount: finalResult.toolCalls.length,
            finishReason: finalResult.finishReason
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
            model: sessionModel,
            createdAt: sessionId
              ? (await loadSession(sessionId))?.createdAt || new Date().toISOString()
              : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await saveSession(actualSessionId, sessionData);
        }

        // Return the final response with remaining client tools
        return NextResponse.json(
          {
            model: sessionModel,
            sessionId: actualSessionId,
            text: finalResult.text,
            toolCalls: clientToolCalls,  // Only return client tools that haven't been executed
            finishReason: clientToolCalls.length > 0 ? 'tool_calls' : 'stop',
            metrics: finalResult.metrics,
            ...(workflowData && { workflowData }),  // Include workflow data if present
          },
          { headers: corsHeaders }
        );
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

    // Add tool results to history if present
    if (toolResults && toolResults.length > 0) {
      updatedHistory.push({
        role: 'user',
        parts: toolResults.map(tr => ({
          functionResponse: {
            name: tr.name,
            // Ensure response is an object, not nested or array
            response: typeof tr.result === 'object' && tr.result !== null ? tr.result : { result: tr.result },
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
        provider,
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
      { model: sessionModel, sessionId: actualSessionId, ...result, ...(workflowData && { workflowData }) },
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
            serverSideTools: [...Object.keys(knowledgeTools), ...Object.keys(serverSideWorkflowTools)],
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
