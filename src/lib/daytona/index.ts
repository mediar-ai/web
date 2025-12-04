/**
 * Daytona Sandbox Management Service
 *
 * Manages per-user Daytona sandboxes for workflow editing and compilation.
 * Each user gets a persistent sandbox with their workflow .ts files.
 */

import { Daytona } from '@daytonaio/sdk';
import { createClient } from '@supabase/supabase-js';

// Types
export interface SandboxInfo {
  sandboxId: string;
  previewUrl: string;
  previewToken: string;
  state: 'running' | 'stopped' | 'archived';
  createdAt: string;
  lastAccessedAt: string;
}

export interface SandboxSession {
  userId: string;
  sandboxInfo: SandboxInfo;
}

// Initialize Daytona client
const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY!,
  target: process.env.DAYTONA_TARGET || 'us',
});

// Supabase client for storing sandbox mappings
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Full server code with Hono framework, AI chat, and Supabase/Redis integration - ES module syntax
 */
const SANDBOX_SERVER_CODE = `import { Hono } from 'hono';
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

// Redis client (lazy init)
let redisClient = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createRedisClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
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
  genAI = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.VERTEX_AI_LOCATION || 'us-central1',
    googleAuthOptions: {
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\\\n/g, '\\n'),
      },
    }
  });
  console.log('[SANDBOX] Vertex AI client initialized');
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

async function loadSession(sessionId) {
  try {
    const redis = await getRedisClient();
    const data = await redis.get(SESSION_PREFIX + sessionId);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('[Redis] Failed to load session:', e);
    return null;
  }
}

async function saveSession(sessionId, data) {
  try {
    const redis = await getRedisClient();
    await redis.set(SESSION_PREFIX + sessionId, JSON.stringify(data), { EX: SESSION_TTL });
  } catch (e) {
    console.error('[Redis] Failed to save session:', e);
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
`;

/**
 * Package.json for the sandbox workspace with all dependencies
 */
const SANDBOX_PACKAGE_JSON = `{
  "name": "mediar-sandbox",
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@google/genai": "^1.0.1",
    "@hono/node-server": "^1.13.0",
    "@supabase/supabase-js": "^2.45.0",
    "hono": "^4.6.0",
    "redis": "^4.7.0"
  }
}`;

/**
 * TypeScript config for the sandbox
 */
const SANDBOX_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}`;

/**
 * Sample workflow file
 */
const SAMPLE_WORKFLOW = `import { createWorkflow, z } from "@mediar-ai/workflow";
import { openApp } from "./steps/01-open-app";

const inputSchema = z.object({
  appName: z.string().default("notepad"),
});

export const workflow = createWorkflow({
  name: "Sample Workflow",
  description: "A sample workflow for testing",
  version: "1.0.0",
  input: inputSchema,
  steps: [openApp],
});

export default workflow;
`;

/**
 * Sample step file
 */
const SAMPLE_STEP = `import { createStep } from "@mediar-ai/workflow";

export const openApp = createStep({
  id: "open_app",
  name: "Open Application",
  execute: async ({ desktop, logger }) => {
    logger.info("Opening application...");

    // Open the application
    desktop.openApplication("notepad");

    // Wait for it to load
    await desktop.delay(1500);

    // Verify it opened
    const window = await desktop.locator("role:Window").first(3000);

    logger.info("Application opened successfully");

    return {
      state: {
        appOpened: true,
        timestamp: new Date().toISOString(),
      },
    };
  },
});
`;

/**
 * Get or create a sandbox for a user
 * No in-memory cache - Vercel serverless functions are stateless
 */
export async function getOrCreateSandbox(userId: string): Promise<SandboxInfo> {
  console.log(`[SANDBOX] getOrCreateSandbox called for user: ${userId}`);

  // Check database for existing sandbox
  const { data: existing, error: dbError } = await supabase
    .from('user_sandboxes')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (dbError && dbError.code !== 'PGRST116') {
    // PGRST116 = no rows returned, which is fine
    console.error('[SANDBOX] DB error:', dbError);
  }

  if (existing) {
    console.log(`[SANDBOX] Found existing sandbox in DB: ${existing.sandbox_id}, state: ${existing.state}`);

    try {
      // Try to get existing sandbox from Daytona
      const sandbox = await daytona.get(existing.sandbox_id);
      console.log(`[SANDBOX] Daytona sandbox state: ${sandbox.state}`);

      if (sandbox.state === 'started') {
        const preview = await sandbox.getPreviewLink(3000);
        console.log(`[SANDBOX] Sandbox running, preview token: ${preview.token ? preview.token.substring(0, 8) + '...' : 'MISSING'}`);

        const info: SandboxInfo = {
          sandboxId: existing.sandbox_id,
          previewUrl: preview.url,
          previewToken: preview.token,
          state: 'running',
          createdAt: existing.created_at,
          lastAccessedAt: new Date().toISOString(),
        };

        // Update DB with current token (might have changed)
        const { error: updateError } = await supabase
          .from('user_sandboxes')
          .update({
            preview_url: preview.url,
            preview_token: preview.token,
            last_accessed_at: info.lastAccessedAt,
            state: 'running',
          })
          .eq('user_id', userId);

        if (updateError) {
          console.error('[SANDBOX] Failed to update DB:', updateError);
        }

        return info;
      }

      // Sandbox exists but not running - start it
      console.log(`[SANDBOX] Starting stopped sandbox...`);
      await sandbox.start();
      await waitForSandboxReady(sandbox);

      const preview = await sandbox.getPreviewLink(3000);
      console.log(`[SANDBOX] Sandbox started, new token: ${preview.token ? preview.token.substring(0, 8) + '...' : 'MISSING'}`);

      const info: SandboxInfo = {
        sandboxId: existing.sandbox_id,
        previewUrl: preview.url,
        previewToken: preview.token,
        state: 'running',
        createdAt: existing.created_at,
        lastAccessedAt: new Date().toISOString(),
      };

      // Update database with new preview URL and token
      const { error: updateError } = await supabase
        .from('user_sandboxes')
        .update({
          preview_url: preview.url,
          preview_token: preview.token,
          last_accessed_at: info.lastAccessedAt,
          state: 'running',
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('[SANDBOX] Failed to update DB after restart:', updateError);
      } else {
        console.log('[SANDBOX] DB updated with new token');
      }

      return info;

    } catch (error) {
      console.error('[SANDBOX] Failed to get/start existing sandbox:', error);
      console.log('[SANDBOX] Will create new sandbox...');
      // Fall through to create new sandbox
    }
  } else {
    console.log('[SANDBOX] No existing sandbox in DB, creating new one...');
  }

  // Create new sandbox
  return createNewSandbox(userId);
}

/**
 * Create a new sandbox for a user
 */
async function createNewSandbox(userId: string): Promise<SandboxInfo> {
  console.log(`Creating new sandbox for user: ${userId}`);

  const sandbox = await daytona.create({
    language: 'typescript',
    envVars: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL!,
      GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY!,
      VERTEX_AI_LOCATION: process.env.VERTEX_AI_LOCATION || 'us-central1',
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      REDIS_URL: process.env.REDIS_URL!,
      USER_ID: userId,
    },
    autoStopInterval: 60,      // Stop after 1hr inactive
    autoArchiveInterval: 120,  // Archive after 2hr stopped
  });

  console.log(`Sandbox created: ${sandbox.id}`);

  // Initialize workspace with files
  await initializeSandboxWorkspace(sandbox);

  // Check files were uploaded
  console.log('[SANDBOX] Checking uploaded files...');
  const lsResult = await sandbox.process.executeCommand('ls -la', undefined, undefined, 10);
  console.log('[SANDBOX] Files:\n', lsResult.result);

  // Check package.json content
  const pkgResult = await sandbox.process.executeCommand('cat package.json', undefined, undefined, 10);
  console.log('[SANDBOX] package.json:\n', pkgResult.result);

  // Check server.js content
  const serverJsResult = await sandbox.process.executeCommand('cat server.js', undefined, undefined, 10);
  console.log('[SANDBOX] server.js:\n', serverJsResult.result);

  // Install dependencies using npm (Node.js compatible)
  console.log('[SANDBOX] Installing dependencies...');
  const installResult = await sandbox.process.executeCommand('npm install', undefined, undefined, 180);
  console.log('[SANDBOX] Install exit code:', installResult.exitCode);
  console.log('[SANDBOX] Install stdout:\n', installResult.result);

  // Check node_modules
  const nmResult = await sandbox.process.executeCommand('ls node_modules 2>/dev/null || echo "no node_modules"', undefined, undefined, 10);
  console.log('[SANDBOX] node_modules:', nmResult.result);

  // Check which runtime is available
  console.log('[SANDBOX] Checking available runtimes...');
  const whichResult = await sandbox.process.executeCommand(
    'which node; which bun; node --version; bun --version 2>/dev/null || echo "bun not found"',
    undefined,
    undefined,
    10
  );
  console.log('[SANDBOX] Available runtimes:\n', whichResult.result);

  // Try running server directly (not in background) to see errors
  console.log('[SANDBOX] Testing server startup (5 second test)...');
  const testServerResult = await sandbox.process.executeCommand(
    'cd /home/daytona && timeout 5 node server.js 2>&1 || echo "Exit code: $?"',
    undefined,
    undefined,
    15
  );
  console.log('[SANDBOX] Server test output:\n', testServerResult.result);
  console.log('[SANDBOX] Server test exit code:', testServerResult.exitCode);

  // Start server in background using nohup
  console.log('[SANDBOX] Starting server in background with nohup...');
  const startResult = await sandbox.process.executeCommand(
    'cd /home/daytona && nohup node server.js > /tmp/server.log 2>&1 &',
    undefined,
    undefined,
    10
  );
  console.log('[SANDBOX] Server start result:', startResult);

  // Wait for server to start
  console.log('[SANDBOX] Waiting 5 seconds for server to start...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Check server logs
  const logResult = await sandbox.process.executeCommand('cat /tmp/server.log 2>/dev/null || echo "no log file"', undefined, undefined, 10);
  console.log('[SANDBOX] Server logs:\n', logResult.result);

  // Check if process is running
  const psResult = await sandbox.process.executeCommand('ps aux | grep -E "bun|server" | grep -v grep', undefined, undefined, 10);
  console.log('[SANDBOX] Running processes:\n', psResult.result);

  // Check if server is listening
  const checkPortResult = await sandbox.process.executeCommand(
    'curl -s -w "\\nHTTP: %{http_code}" http://localhost:3000/health 2>&1 || echo "curl failed with exit: $?"',
    undefined,
    undefined,
    10
  );
  console.log('[SANDBOX] Health check inside sandbox:\n', checkPortResult.result);

  // Get preview URL
  const preview = await sandbox.getPreviewLink(3000);
  console.log('[SANDBOX] Preview URL:', preview);

  const info: SandboxInfo = {
    sandboxId: sandbox.id,
    previewUrl: preview.url,
    previewToken: preview.token,
    state: 'running',
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  };

  // Store in database (including preview_token for Daytona proxy auth)
  console.log(`[SANDBOX] Saving to DB: sandbox_id=${sandbox.id}, token=${preview.token ? preview.token.substring(0, 8) + '...' : 'MISSING'}`);
  const { error: upsertError } = await supabase.from('user_sandboxes').upsert({
    user_id: userId,
    sandbox_id: sandbox.id,
    preview_url: preview.url,
    preview_token: preview.token,
    state: 'running',
    created_at: info.createdAt,
    last_accessed_at: info.lastAccessedAt,
  }, {
    onConflict: 'user_id',
  });

  if (upsertError) {
    console.error('[SANDBOX] Failed to save sandbox to DB:', upsertError);
  } else {
    console.log('[SANDBOX] Sandbox saved to DB successfully');
  }

  return info;
}

/**
 * Initialize sandbox workspace with required files
 */
async function initializeSandboxWorkspace(sandbox: any): Promise<void> {
  // Upload package.json
  await sandbox.fs.uploadFile(
    Buffer.from(SANDBOX_PACKAGE_JSON),
    'package.json'
  );

  // Upload tsconfig.json
  await sandbox.fs.uploadFile(
    Buffer.from(SANDBOX_TSCONFIG),
    'tsconfig.json'
  );

  // Upload server.js (using .js for Node.js compatibility)
  await sandbox.fs.uploadFile(
    Buffer.from(SANDBOX_SERVER_CODE),
    'server.js'
  );

  // Create src directory structure
  await sandbox.fs.createFolder('src/steps', '755');

  // Upload sample workflow
  await sandbox.fs.uploadFile(
    Buffer.from(SAMPLE_WORKFLOW),
    'src/workflow.ts'
  );

  // Upload sample step
  await sandbox.fs.uploadFile(
    Buffer.from(SAMPLE_STEP),
    'src/steps/01-open-app.ts'
  );
}

/**
 * Wait for sandbox to be ready
 */
async function waitForSandboxReady(sandbox: any, maxWaitMs = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const info = await sandbox.info();
      if (info.instance.state === 'started') {
        return;
      }
    } catch {
      // Ignore errors while waiting
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('Sandbox failed to start within timeout');
}

/**
 * Wait for server to be ready
 */
async function waitForServerReady(sandbox: any, maxWaitMs = 30000): Promise<void> {
  const startTime = Date.now();
  console.log('[SANDBOX] Waiting for server to be ready...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = await sandbox.process.executeCommand(
        'curl -s http://localhost:3000/health',
        undefined,
        undefined,
        5
      );
      console.log('[SANDBOX] Health check result:', result);
      if (result.exitCode === 0 && result.result?.includes('ok')) {
        console.log('[SANDBOX] Server is ready!');
        return;
      }
    } catch (e) {
      console.log('[SANDBOX] Health check failed, retrying...', e);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('Server failed to start within timeout');
}

/**
 * Stop a user's sandbox
 */
export async function stopSandbox(userId: string): Promise<void> {
  console.log(`[SANDBOX] stopSandbox called for user: ${userId}`);

  // Get from DB
  const { data: existing } = await supabase
    .from('user_sandboxes')
    .select('sandbox_id')
    .eq('user_id', userId)
    .single();

  if (!existing) {
    console.log('[SANDBOX] No sandbox found in DB to stop');
    return;
  }

  try {
    const sandbox = await daytona.get(existing.sandbox_id);
    await sandbox.stop();
    console.log('[SANDBOX] Sandbox stopped');

    // Update DB state
    await supabase
      .from('user_sandboxes')
      .update({ state: 'stopped' })
      .eq('user_id', userId);
  } catch (error) {
    console.error('[SANDBOX] Failed to stop sandbox:', error);
  }
}

/**
 * Delete a user's sandbox
 */
export async function deleteSandbox(userId: string): Promise<void> {
  console.log(`[SANDBOX] deleteSandbox called for user: ${userId}`);

  // Get from DB
  const { data: existing } = await supabase
    .from('user_sandboxes')
    .select('sandbox_id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    try {
      const sandbox = await daytona.get(existing.sandbox_id);
      await sandbox.delete();
      console.log('[SANDBOX] Sandbox deleted from Daytona');
    } catch (error) {
      console.error('[SANDBOX] Failed to delete sandbox from Daytona:', error);
    }
  }

  // Remove from database
  const { error } = await supabase
    .from('user_sandboxes')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('[SANDBOX] Failed to delete sandbox from DB:', error);
  } else {
    console.log('[SANDBOX] Sandbox deleted from DB');
  }
}
