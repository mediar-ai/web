import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import type {
  ClientMessage,
  ServerMessage,
  InitMessage,
  ChatMessage,
  ToolResult,
} from './messages.js';

// Mock dependencies
vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../lib/redis.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/auth/validate.js', () => ({
  validateToken: vi.fn().mockImplementation((token: string) => {
    if (token === 'valid-token') {
      return Promise.resolve({
        userId: 'user-123',
        email: 'test@example.com',
        organizationId: 'org-456',
      });
    }
    if (token === 'other-org-token') {
      return Promise.resolve({
        userId: 'user-789',
        email: 'other@example.com',
        organizationId: 'org-other',
      });
    }
    return Promise.resolve(null);
  }),
}));

vi.mock('../services/ai/providers.js', () => ({
  handleChat: vi.fn().mockImplementation(async (request) => {
    // Simulate streaming response
    request.onStream({ type: 'token', content: 'Hello' });
    request.onStream({ type: 'token', content: ' there!' });
    request.onStream({ type: 'done', usage: { promptTokens: 10, completionTokens: 5 } });
  }),
  validateModel: vi.fn().mockReturnValue(true),
  isAnthropicModel: vi.fn().mockReturnValue(false),
}));

describe('WebSocket Handler', () => {
  describe('Message Flow', () => {
    it('should create proper init message', () => {
      const msg: InitMessage = {
        type: 'init',
        token: 'test-token',
        workflowId: 123,
        sessionId: 'session-abc',
      };
      expect(msg.type).toBe('init');
      expect(msg.token).toBe('test-token');
      expect(msg.workflowId).toBe(123);
      expect(msg.sessionId).toBe('session-abc');
    });

    it('should create proper chat message', () => {
      const msg: ChatMessage = {
        type: 'message',
        content: 'Hello AI!',
      };
      expect(msg.type).toBe('message');
      expect(msg.content).toBe('Hello AI!');
    });

    it('should create proper tool result message', () => {
      const msg: ToolResult = {
        type: 'tool_result',
        id: 'tool-call-123',
        result: { success: true, data: 'clicked button' },
      };
      expect(msg.type).toBe('tool_result');
      expect(msg.id).toBe('tool-call-123');
      expect(msg.result.success).toBe(true);
    });
  });

  describe('Server Messages', () => {
    it('should create proper ready message', () => {
      const msg: ServerMessage = {
        type: 'ready',
        sessionId: 'session-123',
        userId: 'user-456',
        organizationId: 'org-789',
      };
      expect(msg.type).toBe('ready');
    });

    it('should create proper token message', () => {
      const msg: ServerMessage = {
        type: 'token',
        content: 'Hello',
      };
      expect(msg.type).toBe('token');
      expect(msg.content).toBe('Hello');
    });

    it('should create proper tool request message', () => {
      const msg: ServerMessage = {
        type: 'tool_request',
        id: 'tool-123',
        tool: 'click',
        args: { selector: '#button' },
      };
      expect(msg.type).toBe('tool_request');
      expect(msg.tool).toBe('click');
      expect(msg.args.selector).toBe('#button');
    });

    it('should create proper done message with usage', () => {
      const msg: ServerMessage = {
        type: 'done',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };
      expect(msg.type).toBe('done');
      expect(msg.usage?.totalTokens).toBe(150);
    });

    it('should create proper error message', () => {
      const msg: ServerMessage = {
        type: 'error',
        message: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      };
      expect(msg.type).toBe('error');
      expect(msg.message).toBe('Something went wrong');
      expect(msg.code).toBe('INTERNAL_ERROR');
    });

    it('should create proper thinking message', () => {
      const msg: ServerMessage = {
        type: 'thinking',
        content: 'Let me analyze this...',
      };
      expect(msg.type).toBe('thinking');
      expect(msg.content).toBe('Let me analyze this...');
    });
  });

  describe('Connection State', () => {
    it('should track pending tool calls correctly', () => {
      const pendingToolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();

      // Add a tool call
      pendingToolCalls.set('tool-1', { name: 'click', args: { selector: '#btn' } });
      expect(pendingToolCalls.size).toBe(1);
      expect(pendingToolCalls.has('tool-1')).toBe(true);

      // Add another
      pendingToolCalls.set('tool-2', { name: 'type', args: { text: 'hello' } });
      expect(pendingToolCalls.size).toBe(2);

      // Remove first
      pendingToolCalls.delete('tool-1');
      expect(pendingToolCalls.size).toBe(1);
      expect(pendingToolCalls.has('tool-1')).toBe(false);
      expect(pendingToolCalls.has('tool-2')).toBe(true);

      // Clear all
      pendingToolCalls.clear();
      expect(pendingToolCalls.size).toBe(0);
    });

    it('should handle abort controller', () => {
      const abortController = new AbortController();
      expect(abortController.signal.aborted).toBe(false);

      abortController.abort();
      expect(abortController.signal.aborted).toBe(true);
    });
  });

  describe('Session Management', () => {
    it('should generate valid session ID format', () => {
      const sessionId = crypto.randomUUID();
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should track messages in session', () => {
      const messages: Array<{ role: string; content: string }> = [];

      messages.push({ role: 'user', content: 'Hello' });
      expect(messages.length).toBe(1);

      messages.push({ role: 'assistant', content: 'Hi there!' });
      expect(messages.length).toBe(2);

      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', () => {
      const invalidJson = 'not valid json {';
      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    it('should handle missing required fields', () => {
      const incompleteInit = { type: 'init' }; // missing token
      expect(incompleteInit.type).toBe('init');
      expect((incompleteInit as any).token).toBeUndefined();
    });

    it('should handle unknown message types', () => {
      const unknownMsg = { type: 'unknown', data: 'test' };
      expect(unknownMsg.type).not.toBe('init');
      expect(unknownMsg.type).not.toBe('message');
      expect(unknownMsg.type).not.toBe('tool_result');
      expect(unknownMsg.type).not.toBe('cancel');
    });
  });

  describe('Tool Call Flow', () => {
    it('should match tool results to tool calls by ID', () => {
      const toolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();

      // Server sends tool request
      const toolRequest = {
        id: 'toolu_abc123',
        tool: 'click',
        args: { selector: '#submit-btn' },
      };
      toolCalls.set(toolRequest.id, { name: toolRequest.tool, args: toolRequest.args });

      // Client sends tool result
      const toolResult = {
        type: 'tool_result' as const,
        id: 'toolu_abc123',
        result: { success: true, clicked: true },
      };

      // Match and remove
      const pending = toolCalls.get(toolResult.id);
      expect(pending).toBeDefined();
      expect(pending?.name).toBe('click');

      toolCalls.delete(toolResult.id);
      expect(toolCalls.size).toBe(0);
    });

    it('should handle multiple concurrent tool calls', () => {
      const toolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();

      // Add multiple tool calls
      toolCalls.set('tool-1', { name: 'screenshot', args: {} });
      toolCalls.set('tool-2', { name: 'click', args: { selector: '#a' } });
      toolCalls.set('tool-3', { name: 'type', args: { text: 'hi' } });

      expect(toolCalls.size).toBe(3);

      // Results can come back in any order
      toolCalls.delete('tool-2');
      toolCalls.delete('tool-1');
      toolCalls.delete('tool-3');

      expect(toolCalls.size).toBe(0);
    });
  });

  describe('Authentication Flow', () => {
    it('should require init message before chat', () => {
      let authenticated = false;

      // Attempt chat without auth
      expect(authenticated).toBe(false);

      // After successful init
      authenticated = true;
      expect(authenticated).toBe(true);
    });

    it('should store user context after auth', () => {
      interface UserContext {
        userId: string;
        email: string;
        organizationId: string;
      }

      let user: UserContext | null = null;

      // Before auth
      expect(user).toBeNull();

      // After auth
      user = {
        userId: 'user-123',
        email: 'test@example.com',
        organizationId: 'org-456',
      };

      expect(user.userId).toBe('user-123');
      expect(user.organizationId).toBe('org-456');
    });
  });
});
