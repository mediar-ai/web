/**
 * Daytona Sandbox Server
 * Hono-based server that provides AI chat and workflow editing capabilities
 * This replaces the embedded SANDBOX_SERVER_CODE string
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createRedisClient } from 'redis';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '3000');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Redis client (lazy init)
let redisClient: ReturnType<typeof createRedisClient> | null = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createRedisClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
  }
  return redisClient;
}

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ============================================================================
// Types
// ============================================================================

interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  email?: string;
  orgId?: string;
  error?: string;
}

interface SessionData {
  history: any[];
  system?: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

// SSE Event types
type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: any }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string };

// ============================================================================
// Auth
// ============================================================================

async function validateDesktopToken(token: string): Promise<TokenValidationResult> {
  const { data: session, error } = await supabase
    .from('mediar_desktop_sessions')
    .select('*')
    .eq('token', token)
    .eq('is_active', true)
    .single();

  if (error || !session) {
    return { valid: false, error: 'Invalid or expired token' };
  }

  // Check expiry
  if (new Date() > new Date(session.expires_at)) {
    await supabase
      .from('mediar_desktop_sessions')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', session.id);
    return { valid: false, error: 'Token expired' };
  }

  // Update last used
  await supabase
    .from('mediar_desktop_sessions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', session.id);

  return {
    valid: true,
    userId: session.clerk_user_id,
    email: session.email,
    orgId: session.org_id,
  };
}

// ============================================================================
// Session Management (Redis)
// ============================================================================

const SESSION_PREFIX = 'ai-session:';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

async function loadSession(sessionId: string): Promise<SessionData | null> {
  try {
    const redis = await getRedisClient();
    const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('[Redis] Failed to load session:', e);
    return null;
  }
}

async function saveSession(sessionId: string, data: SessionData): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(data), { EX: SESSION_TTL });
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
      type: 'object' as const,
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
      type: 'object' as const,
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
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path' }
      },
      required: ['path']
    }
  }
];

async function executeTool(name: string, input: any): Promise<string> {
  const workspaceRoot = process.cwd();

  switch (name) {
    case 'read_file': {
      const filePath = path.join(workspaceRoot, input.path);
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (e: any) {
        return `Error reading file: ${e.message}`;
      }
    }
    case 'write_file': {
      const filePath = path.join(workspaceRoot, input.path);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, input.content);
        return `File written successfully: ${input.path}`;
      } catch (e: any) {
        return `Error writing file: ${e.message}`;
      }
    }
    case 'list_files': {
      const dirPath = path.join(workspaceRoot, input.path);
      try {
        const files = fs.readdirSync(dirPath);
        return files.join('\n');
      } catch (e: any) {
        return `Error listing files: ${e.message}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
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

// Main AI Chat endpoint with SSE streaming
app.post('/api/ai', async (c) => {
  // Authenticate
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const auth = await validateDesktopToken(token);
  if (!auth.valid) {
    return c.json({ error: auth.error || 'Unauthorized' }, 401);
  }

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

  // Load or create session
  let session = await loadSession(sessionId);
  if (!session) {
    session = {
      history: [],
      model,
      system,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Add tool results if continuing
  if (toolResults && toolResults.length > 0) {
    const toolResultContent = toolResults.map((tr: any) => ({
      type: 'tool_result' as const,
      tool_use_id: tr.id,
      content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
    }));
    session.history.push({ role: 'user', content: toolResultContent });
  } else if (input) {
    // Add user message
    session.history.push({ role: 'user', content: input });
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
      let response = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        system: system || session.system || 'You are a helpful AI assistant for desktop automation.',
        messages: session.history as any,
        tools: allTools as any,
      });

      // Process response loop
      while (response.stop_reason === 'tool_use') {
        const assistantMessage = { role: 'assistant' as const, content: response.content };
        session.history.push(assistantMessage);

        // Emit text
        for (const block of response.content) {
          if (block.type === 'text') {
            await stream.writeSSE({ data: JSON.stringify({ type: 'text', content: block.text }) });
          }
        }

        // Process tool calls
        const toolResults: any[] = [];
        const clientToolCalls: any[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const isLocalTool = TOOLS.find(t => t.name === block.name);

            if (isLocalTool) {
              // Execute locally
              await stream.writeSSE({
                data: JSON.stringify({ type: 'tool_call', name: block.name, args: block.input })
              });

              const result = await executeTool(block.name, block.input);

              await stream.writeSSE({
                data: JSON.stringify({ type: 'tool_result', name: block.name, result })
              });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result,
              });
            } else {
              // Client-side tool - emit for client to handle
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

          // Save session and wait for client to return results
          session.updatedAt = new Date().toISOString();
          await saveSession(sessionId, session);

          await stream.writeSSE({
            data: JSON.stringify({ type: 'done', sessionId, finishReason: 'tool_calls' })
          });
          return;
        }

        // Continue with local tool results
        if (toolResults.length > 0) {
          session.history.push({ role: 'user', content: toolResults });

          response = await anthropic.messages.create({
            model,
            max_tokens: 8192,
            system: system || session.system || 'You are a helpful AI assistant.',
            messages: session.history as any,
            tools: allTools as any,
          });
        }
      }

      // Final response
      const finalMessage = { role: 'assistant' as const, content: response.content };
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

    } catch (error: any) {
      console.error('[AI] Error:', error);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: error.message })
      });
    }
  });
});

// Chat sessions endpoints
app.get('/api/ai/chat-sessions', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const auth = await validateDesktopToken(token);
  if (!auth.valid || !auth.userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const workflowId = c.req.query('workflowId');
  if (!workflowId) {
    return c.json({ error: 'workflowId required' }, 400);
  }

  const { data: sessions, error } = await supabase
    .from('workflow_chat_sessions')
    .select('id, redis_session_id, title, message_count, created_at, updated_at')
    .eq('workflow_id', parseInt(workflowId))
    .eq('user_id', auth.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true, sessions: sessions || [] });
});

app.post('/api/ai/chat-sessions', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const auth = await validateDesktopToken(token);
  if (!auth.valid || !auth.userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workflowId, redisSessionId, messages, title } = await c.req.json();
  if (!workflowId || !redisSessionId) {
    return c.json({ error: 'workflowId and redisSessionId required' }, 400);
  }

  // Upsert session
  const { data: existing } = await supabase
    .from('workflow_chat_sessions')
    .select('id')
    .eq('redis_session_id', redisSessionId)
    .eq('user_id', auth.userId)
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
        user_id: auth.userId,
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

// Step pool endpoints
app.get('/api/step-pool', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  const auth = await validateDesktopToken(token);
  if (!auth.valid || !auth.userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const workflowId = c.req.query('workflow_id');
  const status = c.req.query('status') || 'active';
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = supabase
    .from('user_step_pool')
    .select('*')
    .eq('user_id', auth.userId)
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
console.log(`Starting Daytona sandbox server on port ${PORT}...`);
serve({ fetch: app.fetch, port: PORT });
console.log(`Server started on port ${PORT}`);
