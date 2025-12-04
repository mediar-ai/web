// Load .env for local development
import { config } from 'dotenv';
config();

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createRedisClient } from 'redis';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '3000');

// Model constants
const VERTEX_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-pro-preview'];
const ANTHROPIC_MODELS = ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514'];

function isAnthropicModel(model) {
  return ANTHROPIC_MODELS.some(m => model.includes(m) || m.includes(model));
}

function isVertexModel(model) {
  return VERTEX_MODELS.some(m => model.includes(m) || m.includes(model));
}

// Model name mapping for Vertex AI
function getVertexModelName(inputModelName) {
  const modelMap = {
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.0-flash': 'gemini-2.5-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro',
    'gemini-1.5-flash': 'gemini-2.5-flash',
  };
  return modelMap[inputModelName] || inputModelName;
}

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Redis client (lazy init, optional for local dev)
let redisClient = null;
let redisAvailable = true;

async function getRedisClient() {
  if (!process.env.REDIS_URL) {
    redisAvailable = false;
    return null;
  }
  if (!redisClient) {
    try {
      redisClient = createRedisClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
      console.log('[SANDBOX] Redis connected');
    } catch (e) {
      console.warn('[SANDBOX] Redis not available:', e.message);
      redisAvailable = false;
      return null;
    }
  }
  return redisClient;
}

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Vertex AI / Google GenAI client
let genAI = null;
try {
  // Get credentials - either from base64 or individual env vars
  let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';

  // Try base64 credentials if individual vars not set
  if ((!clientEmail || !privateKey) && process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    console.log('[SANDBOX] Decoding GOOGLE_APPLICATION_CREDENTIALS_BASE64...');
    const decoded = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf-8');
    const creds = JSON.parse(decoded);
    clientEmail = creds.client_email;
    privateKey = creds.private_key;
    console.log('[SANDBOX] Decoded credentials for:', clientEmail);
  }

  // Handle private key newlines - env vars may have literal \\n or escaped \\\\n
  if (privateKey.includes('\\\\n')) {
    privateKey = privateKey.replace(/\\\\n/g, '\\n');
  } else if (privateKey.includes('\\n') && !privateKey.includes('\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  console.log('[SANDBOX] Initializing Vertex AI with:', {
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    clientEmail: clientEmail,
    hasPrivateKey: !!privateKey,
    privateKeyLength: privateKey?.length || 0,
  });

  if (!clientEmail || !privateKey) {
    throw new Error('Missing Google credentials (GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY)');
  }

  genAI = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    googleAuthOptions: {
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    }
  });
  console.log('[SANDBOX] Vertex AI client initialized successfully');
} catch (e) {
  console.error('[SANDBOX] Failed to initialize Vertex AI:', e.message);
}

// ============================================================================
// Vertex AI Chat Handler
// ============================================================================

async function handleVertexChat(params) {
  const { model, system, history, tools, input, toolResults } = params;

  if (!genAI) {
    throw new Error('Vertex AI client not initialized');
  }

  const mappedModel = getVertexModelName(model);
  console.log('[VERTEX] Processing with model:', mappedModel, 'history:', history.length);

  // Build contents array
  const contents = [...history];

  // Add tool results or new input
  if (toolResults && toolResults.length > 0) {
    const functionResponseParts = toolResults.map(tr => ({
      functionResponse: {
        name: tr.name,
        response: typeof tr.result === 'object' ? tr.result : { result: tr.result },
      },
    }));
    contents.push({ role: 'user', parts: functionResponseParts });
  } else if (input) {
    contents.push({ role: 'user', parts: [{ text: input }] });
  }

  // Build generation config
  const config = {
    temperature: 0.7,
    maxOutputTokens: 8192,
  };

  if (system) {
    config.systemInstruction = system;
  }

  // Convert tools to function declarations for Vertex AI
  if (tools && tools.length > 0) {
    const functionDeclarations = tools.map(t => ({
      name: t.name,
      description: t.description || t.name,
      parameters: t.input_schema || { type: 'object', properties: {} },
    }));
    config.tools = [{ functionDeclarations }];
  }

  // Add thinking config for Gemini 3 models
  if (mappedModel.includes('gemini-3')) {
    config.thinkingConfig = { thinkingLevel: 'low' };
  }

  // Call Vertex AI
  const response = await genAI.models.generateContent({
    model: mappedModel,
    contents,
    config,
  });

  // Parse response
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const textParts = parts.filter(p => p.text && !p.thought).map(p => p.text);
  const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);

  const text = textParts.join('');
  const toolCalls = functionCalls.map(fc => ({
    name: fc.name,
    args: fc.args || {},
    id: randomUUID(), // Generate ID for tool call
  }));

  return {
    text,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    // For history tracking - format as Vertex message
    rawContent: { role: 'model', parts },
  };
}

// ============================================================================
// Auth - Daytona proxy validates x-daytona-preview-token, we use USER_ID env var
// ============================================================================

// Each sandbox has USER_ID baked in at creation time
const SANDBOX_USER_ID = process.env.USER_ID;

function getUserId() {
  if (!SANDBOX_USER_ID) {
    throw new Error('USER_ID environment variable not set');
  }
  return SANDBOX_USER_ID;
}

// ============================================================================
// Session Management (Redis)
// ============================================================================

const SESSION_PREFIX = 'ai-session:';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

// In-memory session storage (fallback when Redis not available)
const inMemorySessions = new Map();

async function loadSession(sessionId) {
  try {
    const redis = await getRedisClient();
    if (redis) {
      const data = await redis.get(SESSION_PREFIX + sessionId);
      return data ? JSON.parse(data) : null;
    }
    // Fallback to in-memory
    return inMemorySessions.get(sessionId) || null;
  } catch (e) {
    console.error('[Redis] Failed to load session:', e);
    return inMemorySessions.get(sessionId) || null;
  }
}

async function saveSession(sessionId, data) {
  try {
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(SESSION_PREFIX + sessionId, JSON.stringify(data), { EX: SESSION_TTL });
    } else {
      // Fallback to in-memory
      inMemorySessions.set(sessionId, data);
    }
  } catch (e) {
    console.error('[Redis] Failed to save session:', e);
    inMemorySessions.set(sessionId, data);
  }
}

// ============================================================================
// File Tools (local to sandbox)
// ============================================================================

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_files',
    description: 'List files in a directory',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' }
      },
      required: ['path']
    }
  }
];

async function executeTool(name, input) {
  const workspaceRoot = process.cwd();

  switch (name) {
    case 'read_file': {
      const filePath = path.join(workspaceRoot, input.path);
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (e) {
        return 'Error reading file: ' + e.message;
      }
    }
    case 'write_file': {
      const filePath = path.join(workspaceRoot, input.path);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, input.content);
        return 'File written successfully: ' + input.path;
      } catch (e) {
        return 'Error writing file: ' + e.message;
      }
    }
    case 'list_files': {
      const dirPath = path.join(workspaceRoot, input.path);
      try {
        const files = fs.readdirSync(dirPath);
        return files.join('\\n');
      } catch (e) {
        return 'Error listing files: ' + e.message;
      }
    }
    default:
      return 'Unknown tool: ' + name;
  }
}

// ============================================================================
// Hono App
// ============================================================================

const app = new Hono();

// Enable CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-daytona-preview-token'],
}));

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
});

// AI Config endpoint
app.get('/api/ai/config', (c) => {
  return c.json({
    askModeAllowedTools: [
      'get_window_tree',
      'get_applications_and_windows_list',
      'validate_element',
      'capture_screenshot',
      'read_file',
      'list_files',
    ],
    askModeBlockedTools: [
      'click_element',
      'type_into_element',
      'write_file',
    ],
  });
});

// Main AI Chat endpoint with SSE streaming (supports both Anthropic and Vertex AI)
// Auth: Daytona proxy validates x-daytona-preview-token before request reaches here
app.post('/api/ai', async (c) => {
  // Parse request
  const body = await c.req.json();
  const {
    input,
    sessionId = randomUUID(),
    model = 'claude-sonnet-4-20250514',
    system,
    tools: clientTools,
    toolResults,
  } = body;

  // Determine provider
  const provider = isAnthropicModel(model) ? 'anthropic' : 'vertex';
  console.log('[AI] Provider:', provider, 'Model:', model);

  // Load or create session
  let session = await loadSession(sessionId);
  if (!session) {
    session = {
      history: [],        // Anthropic format
      vertexHistory: [],  // Vertex format
      provider,
      model,
      system,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Merge tools
  const allTools = [...TOOLS];
  if (clientTools) {
    for (const tool of clientTools) {
      if (!allTools.find(t => t.name === tool.name)) {
        allTools.push({
          name: tool.name,
          description: tool.description || tool.name,
          input_schema: tool.parameters || { type: 'object', properties: {} },
        });
      }
    }
  }

  // Stream response
  return streamSSE(c, async (stream) => {
    try {
      if (provider === 'vertex') {
        // ==== VERTEX AI PATH ====
        console.log('[AI] Using Vertex AI for model:', model);

        // Format tool results for Vertex
        let vertexToolResults = null;
        if (toolResults && toolResults.length > 0) {
          vertexToolResults = toolResults.map(tr => ({
            name: tr.name,
            result: typeof tr.result === 'string' ? { result: tr.result } : tr.result,
          }));
        }

        // Call Vertex AI
        const vertexResponse = await handleVertexChat({
          model,
          system: system || session.system || 'You are a helpful AI assistant for desktop automation.',
          history: session.vertexHistory || [],
          tools: allTools,
          input: input || null,
          toolResults: vertexToolResults,
        });

        // Update history
        if (input && !toolResults) {
          session.vertexHistory.push({ role: 'user', parts: [{ text: input }] });
        } else if (vertexToolResults) {
          session.vertexHistory.push({
            role: 'user',
            parts: vertexToolResults.map(tr => ({
              functionResponse: { name: tr.name, response: tr.result }
            })),
          });
        }

        // Add model response to history
        if (vertexResponse.rawContent) {
          session.vertexHistory.push(vertexResponse.rawContent);
        }

        // Emit text
        if (vertexResponse.text) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: vertexResponse.text }) });
        }

        // Process tool calls
        if (vertexResponse.toolCalls && vertexResponse.toolCalls.length > 0) {
          const localToolResults = [];
          const clientToolCalls = [];

          for (const tc of vertexResponse.toolCalls) {
            const isLocalTool = TOOLS.find(t => t.name === tc.name);

            if (isLocalTool) {
              await stream.writeSSE({
                data: JSON.stringify({ type: 'tool_call', name: tc.name, args: tc.args })
              });

              const result = await executeTool(tc.name, tc.args);

              await stream.writeSSE({
                data: JSON.stringify({ type: 'tool_result', name: tc.name, result })
              });

              localToolResults.push({ name: tc.name, result });
            } else {
              clientToolCalls.push({
                id: tc.id,
                name: tc.name,
                args: tc.args,
              });
            }
          }

          // Handle client-side tools
          if (clientToolCalls.length > 0) {
            await stream.writeSSE({
              data: JSON.stringify({ type: 'client_tools', toolCalls: clientToolCalls })
            });

            session.updatedAt = new Date().toISOString();
            await saveSession(sessionId, session);

            await stream.writeSSE({
              data: JSON.stringify({ type: 'done', sessionId, finishReason: 'tool_calls' })
            });
            return;
          }

          // Continue with local tool results if any
          if (localToolResults.length > 0) {
            const continueResponse = await handleVertexChat({
              model,
              system: system || session.system || 'You are a helpful AI assistant for desktop automation.',
              history: session.vertexHistory,
              tools: allTools,
              toolResults: localToolResults,
            });

            // Update history with tool response
            session.vertexHistory.push({
              role: 'user',
              parts: localToolResults.map(tr => ({
                functionResponse: { name: tr.name, response: typeof tr.result === 'object' ? tr.result : { result: tr.result } }
              })),
            });

            if (continueResponse.rawContent) {
              session.vertexHistory.push(continueResponse.rawContent);
            }

            if (continueResponse.text) {
              await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: continueResponse.text }) });
            }
          }
        }

        // Save session
        session.updatedAt = new Date().toISOString();
        await saveSession(sessionId, session);

        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', sessionId, finishReason: 'stop' })
        });

      } else {
        // ==== ANTHROPIC PATH ====
        console.log('[AI] Using Anthropic for model:', model);

        // Add tool results or input to Anthropic history
        if (toolResults && toolResults.length > 0) {
          const toolResultContent = toolResults.map((tr) => ({
            type: 'tool_result',
            tool_use_id: tr.id,
            content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
          }));
          session.history.push({ role: 'user', content: toolResultContent });
        } else if (input) {
          session.history.push({ role: 'user', content: input });
        }

        let response = await anthropic.messages.create({
          model,
          max_tokens: 8192,
          system: system || session.system || 'You are a helpful AI assistant for desktop automation.',
          messages: session.history,
          tools: allTools,
        });

        // Process response loop
        while (response.stop_reason === 'tool_use') {
          const assistantMessage = { role: 'assistant', content: response.content };
          session.history.push(assistantMessage);

          // Emit text
          for (const block of response.content) {
            if (block.type === 'text') {
              await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: block.text }) });
            }
          }

          // Process tool calls
          const toolResultsArr = [];
          const clientToolCalls = [];

          for (const block of response.content) {
            if (block.type === 'tool_use') {
              const isLocalTool = TOOLS.find(t => t.name === block.name);

              if (isLocalTool) {
                await stream.writeSSE({
                  data: JSON.stringify({ type: 'tool_call', name: block.name, args: block.input })
                });

                const result = await executeTool(block.name, block.input);

                await stream.writeSSE({
                  data: JSON.stringify({ type: 'tool_result', name: block.name, result })
                });

                toolResultsArr.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: result,
                });
              } else {
                clientToolCalls.push({
                  id: block.id,
                  name: block.name,
                  args: block.input,
                });
              }
            }
          }

          // If there are client-side tools, emit them and stop
          if (clientToolCalls.length > 0) {
            await stream.writeSSE({
              data: JSON.stringify({ type: 'client_tools', toolCalls: clientToolCalls })
            });

            session.updatedAt = new Date().toISOString();
            await saveSession(sessionId, session);

            await stream.writeSSE({
              data: JSON.stringify({ type: 'done', sessionId, finishReason: 'tool_calls' })
            });
            return;
          }

          // Continue with local tool results
          if (toolResultsArr.length > 0) {
            session.history.push({ role: 'user', content: toolResultsArr });

            response = await anthropic.messages.create({
              model,
              max_tokens: 8192,
              system: system || session.system || 'You are a helpful AI assistant.',
              messages: session.history,
              tools: allTools,
            });
          }
        }

        // Final response
        const finalMessage = { role: 'assistant', content: response.content };
        session.history.push(finalMessage);

        for (const block of response.content) {
          if (block.type === 'text') {
            await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: block.text }) });
          }
        }

        // Save session
        session.updatedAt = new Date().toISOString();
        await saveSession(sessionId, session);

        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', sessionId, finishReason: 'stop' })
        });
      }

    } catch (error) {
      console.error('[AI] Error:', error);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: error.message })
      });
    }
  });
});

// Chat sessions endpoints
// Auth: Daytona proxy validates x-daytona-preview-token before request reaches here
app.get('/api/ai/chat-sessions', async (c) => {
  const userId = getUserId();

  const workflowId = c.req.query('workflowId');
  if (!workflowId) {
    return c.json({ error: 'workflowId required' }, 400);
  }

  const { data: sessions, error } = await supabase
    .from('workflow_chat_sessions')
    .select('id, redis_session_id, title, message_count, created_at, updated_at')
    .eq('workflow_id', parseInt(workflowId))
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true, sessions: sessions || [] });
});

app.post('/api/ai/chat-sessions', async (c) => {
  const userId = getUserId();

  const { workflowId, redisSessionId, messages, title } = await c.req.json();
  if (!workflowId || !redisSessionId) {
    return c.json({ error: 'workflowId and redisSessionId required' }, 400);
  }

  // Upsert session
  const { data: existing } = await supabase
    .from('workflow_chat_sessions')
    .select('id')
    .eq('redis_session_id', redisSessionId)
    .eq('user_id', userId)
    .single();

  let result;
  if (existing) {
    const { data, error } = await supabase
      .from('workflow_chat_sessions')
      .update({
        messages: messages || [],
        message_count: messages?.length || 0,
        title: title || null,
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) return c.json({ error: error.message }, 500);
    result = data;
  } else {
    const { data, error } = await supabase
      .from('workflow_chat_sessions')
      .insert({
        workflow_id: parseInt(workflowId),
        user_id: userId,
        redis_session_id: redisSessionId,
        messages: messages || [],
        message_count: messages?.length || 0,
        title: title || null,
      })
      .select()
      .single();
    if (error) return c.json({ error: error.message }, 500);
    result = data;
  }

  return c.json({ success: true, session: result });
});

// Step pool endpoint
// Auth: Daytona proxy validates x-daytona-preview-token before request reaches here
app.get('/api/step-pool', async (c) => {
  const userId = getUserId();

  const workflowId = c.req.query('workflow_id');
  const status = c.req.query('status') || 'active';
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = supabase
    .from('user_step_pool')
    .select('*')
    .eq('user_id', userId)
    .eq('status', status)
    .order('pool_order', { ascending: true })
    .range(offset, offset + limit - 1);

  if (workflowId) {
    query = query.eq('workflow_id', parseInt(workflowId));
  }

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: error.message }, 500);
  }

  return c.json({ success: true, steps: data || [] });
});

// Start server
console.log('Starting Daytona sandbox server on port ' + PORT + '...');
serve({ fetch: app.fetch, port: PORT });
console.log('Server started on port ' + PORT);