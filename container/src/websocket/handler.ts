/**
 * WebSocket connection handler for AI chat
 * Bidirectional communication for tool execution
 */

import { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
import { getSession, setSession, Session } from '../lib/redis.js';
import { validateToken, AuthenticatedUser } from '../services/auth/validate.js';
import {
  ClientMessage,
  ClientMessageSchema,
  ServerMessage,
} from './messages.js';
import {
  handleChat,
  validateModel,
  AllowedModel,
  Message,
  Tool,
  StreamEvent,
} from '../services/ai/providers.js';

interface ConnectionState {
  authenticated: boolean;
  user: AuthenticatedUser | null;
  session: Session | null;
  pendingToolCalls: Map<
    string,
    { name: string; args: Record<string, unknown> }
  >;
  abortController: AbortController | null;
}

/**
 * Handle a new WebSocket connection
 */
export function handleConnection(ws: WebSocket): void {
  const state: ConnectionState = {
    authenticated: false,
    user: null,
    session: null,
    pendingToolCalls: new Map(),
    abortController: null,
  };

  logger.info('New WebSocket connection');

  ws.on('message', async (data: Buffer) => {
    try {
      const raw = JSON.parse(data.toString());
      const parsed = ClientMessageSchema.safeParse(raw);

      if (!parsed.success) {
        send(ws, {
          type: 'error',
          message: 'Invalid message format',
          code: 'INVALID_MESSAGE',
        });
        return;
      }

      await handleMessage(ws, state, parsed.data);
    } catch (error) {
      logger.error({ error }, 'Error handling WebSocket message');
      send(ws, { type: 'error', message: 'Internal error' });
    }
  });

  ws.on('close', () => {
    logger.info(
      { sessionId: state.session?.id },
      'WebSocket connection closed'
    );
    state.abortController?.abort();
  });

  ws.on('error', error => {
    logger.error({ error }, 'WebSocket error');
  });
}

/**
 * Send a message to the client
 */
function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Handle incoming client messages
 */
async function handleMessage(
  ws: WebSocket,
  state: ConnectionState,
  message: ClientMessage
): Promise<void> {
  switch (message.type) {
    case 'init':
      await handleInit(ws, state, message);
      break;

    case 'message':
      await handleChatMessage(ws, state, message);
      break;

    case 'tool_result':
      await handleToolResult(ws, state, message);
      break;

    case 'cancel':
      handleCancel(state);
      break;
  }
}

/**
 * Handle initialization / authentication
 */
async function handleInit(
  ws: WebSocket,
  state: ConnectionState,
  message: {
    type: 'init';
    token: string;
    workflowId?: number;
    sessionId?: string;
  }
): Promise<void> {
  // Validate token
  const user = await validateToken(message.token);
  if (!user) {
    send(ws, {
      type: 'error',
      message: 'Authentication failed',
      code: 'AUTH_FAILED',
    });
    ws.close(4001, 'Authentication failed');
    return;
  }

  state.authenticated = true;
  state.user = user;

  // Load or create session
  if (message.sessionId) {
    const existing = await getSession(message.sessionId);
    if (existing && existing.organizationId === user.organizationId) {
      state.session = existing;
      logger.info({ sessionId: existing.id }, 'Resumed existing session');
    }
  }

  if (!state.session) {
    state.session = {
      id: crypto.randomUUID(),
      userId: user.userId,
      organizationId: user.organizationId,
      workflowId: message.workflowId,
      messages: [],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    await setSession(state.session);
    logger.info({ sessionId: state.session.id }, 'Created new session');
  }

  send(ws, {
    type: 'ready',
    sessionId: state.session.id,
    userId: user.userId,
    organizationId: user.organizationId,
  });
}

/**
 * Handle chat messages
 */
async function handleChatMessage(
  ws: WebSocket,
  state: ConnectionState,
  message: { type: 'message'; content: string }
): Promise<void> {
  if (!state.authenticated || !state.session || !state.user) {
    send(ws, {
      type: 'error',
      message: 'Not authenticated',
      code: 'NOT_AUTHENTICATED',
    });
    return;
  }

  // Add user message to session
  state.session.messages.push({ role: 'user', content: message.content });
  state.session.lastActiveAt = new Date().toISOString();

  // Create abort controller for cancellation
  state.abortController = new AbortController();

  // TODO: Get tools from client or load from workflow
  const tools: Tool[] = [];

  // TODO: Get system prompt from workflow or default
  const system = 'You are a helpful AI assistant.';

  // Convert session messages to provider format
  const messages: Message[] = state.session.messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Stream response
  let assistantContent = '';
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }> = [];

  const onStream = (event: StreamEvent) => {
    if (state.abortController?.signal.aborted) return;

    switch (event.type) {
      case 'token':
        assistantContent += event.content;
        send(ws, { type: 'token', content: event.content });
        break;

      case 'thinking':
        send(ws, { type: 'thinking', content: event.content });
        break;

      case 'tool_call':
        toolCalls.push({ id: event.id, name: event.name, args: event.args });
        state.pendingToolCalls.set(event.id, {
          name: event.name,
          args: event.args,
        });
        send(ws, {
          type: 'tool_request',
          id: event.id,
          tool: event.name,
          args: event.args,
        });
        break;

      case 'done':
        // Save assistant message to session
        if (assistantContent || toolCalls.length > 0) {
          state.session!.messages.push({
            role: 'assistant',
            content: assistantContent,
          });
          setSession(state.session!);
        }

        // Only send done if no pending tool calls
        if (state.pendingToolCalls.size === 0) {
          send(ws, {
            type: 'done',
            usage: event.usage
              ? {
                  ...event.usage,
                  totalTokens:
                    event.usage.promptTokens + event.usage.completionTokens,
                }
              : undefined,
          });
        }
        break;

      case 'error':
        send(ws, { type: 'error', message: event.message });
        break;
    }
  };

  try {
    await handleChat({
      model: 'gemini-2.5-flash' as AllowedModel, // TODO: Make configurable
      messages,
      tools,
      system,
      onStream,
    });
  } catch (error) {
    logger.error({ error }, 'Chat error');
    send(ws, {
      type: 'error',
      message: error instanceof Error ? error.message : 'Chat failed',
    });
  }
}

/**
 * Handle tool results from client
 */
async function handleToolResult(
  ws: WebSocket,
  state: ConnectionState,
  message: { type: 'tool_result'; id: string; result: Record<string, unknown> }
): Promise<void> {
  if (!state.authenticated || !state.session) {
    send(ws, {
      type: 'error',
      message: 'Not authenticated',
      code: 'NOT_AUTHENTICATED',
    });
    return;
  }

  const pendingTool = state.pendingToolCalls.get(message.id);
  if (!pendingTool) {
    send(ws, {
      type: 'error',
      message: 'Unknown tool call ID',
      code: 'UNKNOWN_TOOL',
    });
    return;
  }

  // Remove from pending
  state.pendingToolCalls.delete(message.id);

  // Add tool result to session as a user message with tool result
  state.session.messages.push({
    role: 'user',
    content: JSON.stringify({
      tool_result: {
        id: message.id,
        name: pendingTool.name,
        result: message.result,
      },
    }),
  });

  // If all tool calls are resolved, continue the conversation
  if (state.pendingToolCalls.size === 0) {
    // Continue with tool results
    const messages: Message[] = state.session.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Add tool results in proper format
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
      try {
        const parsed = JSON.parse(lastMessage.content);
        if (parsed.tool_result) {
          lastMessage.toolResults = [
            {
              id: parsed.tool_result.id,
              name: parsed.tool_result.name,
              result: parsed.tool_result.result,
            },
          ];
          lastMessage.content = '';
        }
      } catch {
        // Not a tool result message
      }
    }

    let assistantContent = '';
    const newToolCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];

    const onStream = (event: StreamEvent) => {
      if (state.abortController?.signal.aborted) return;

      switch (event.type) {
        case 'token':
          assistantContent += event.content;
          send(ws, { type: 'token', content: event.content });
          break;

        case 'tool_call':
          newToolCalls.push({
            id: event.id,
            name: event.name,
            args: event.args,
          });
          state.pendingToolCalls.set(event.id, {
            name: event.name,
            args: event.args,
          });
          send(ws, {
            type: 'tool_request',
            id: event.id,
            tool: event.name,
            args: event.args,
          });
          break;

        case 'done':
          if (assistantContent) {
            state.session!.messages.push({
              role: 'assistant',
              content: assistantContent,
            });
            setSession(state.session!);
          }

          if (state.pendingToolCalls.size === 0) {
            send(ws, {
              type: 'done',
              usage: event.usage
                ? {
                    ...event.usage,
                    totalTokens:
                      event.usage.promptTokens + event.usage.completionTokens,
                  }
                : undefined,
            });
          }
          break;

        case 'error':
          send(ws, { type: 'error', message: event.message });
          break;
      }
    };

    try {
      await handleChat({
        model: 'gemini-2.5-flash' as AllowedModel,
        messages,
        tools: [],
        system: 'You are a helpful AI assistant.',
        onStream,
      });
    } catch (error) {
      logger.error({ error }, 'Continuation error');
      send(ws, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Continuation failed',
      });
    }
  }
}

/**
 * Handle cancellation
 */
function handleCancel(state: ConnectionState): void {
  state.abortController?.abort();
  state.pendingToolCalls.clear();
  logger.info({ sessionId: state.session?.id }, 'Request cancelled');
}
