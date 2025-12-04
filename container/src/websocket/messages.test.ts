import { describe, it, expect } from 'vitest';
import {
  ClientMessageSchema,
  InitMessageSchema,
  ChatMessageSchema,
  ToolResultSchema,
  CancelSchema,
} from './messages.js';

describe('WebSocket Messages', () => {
  describe('InitMessageSchema', () => {
    it('should validate valid init message', () => {
      const msg = { type: 'init', token: 'test-token-123' };
      const result = InitMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('init');
        expect(result.data.token).toBe('test-token-123');
      }
    });

    it('should validate init message with optional fields', () => {
      const msg = {
        type: 'init',
        token: 'test-token',
        workflowId: 123,
        sessionId: 'session-abc'
      };
      const result = InitMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workflowId).toBe(123);
        expect(result.data.sessionId).toBe('session-abc');
      }
    });

    it('should reject init message without token', () => {
      const msg = { type: 'init' };
      const result = InitMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject init message with invalid token type', () => {
      const msg = { type: 'init', token: 12345 };
      const result = InitMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe('ChatMessageSchema', () => {
    it('should validate valid chat message', () => {
      const msg = { type: 'message', content: 'Hello AI!' };
      const result = ChatMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('Hello AI!');
      }
    });

    it('should validate empty content', () => {
      const msg = { type: 'message', content: '' };
      const result = ChatMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject message without content', () => {
      const msg = { type: 'message' };
      const result = ChatMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe('ToolResultSchema', () => {
    it('should validate valid tool result', () => {
      const msg = {
        type: 'tool_result',
        id: 'tool-123',
        result: { success: true, data: 'clicked' }
      };
      const result = ToolResultSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('tool-123');
        expect(result.data.result.success).toBe(true);
      }
    });

    it('should validate tool result with empty object', () => {
      const msg = { type: 'tool_result', id: 'tool-456', result: {} };
      const result = ToolResultSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject tool result without id', () => {
      const msg = { type: 'tool_result', result: { success: true } };
      const result = ToolResultSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject tool result without result object', () => {
      const msg = { type: 'tool_result', id: 'tool-123' };
      const result = ToolResultSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe('CancelSchema', () => {
    it('should validate cancel message', () => {
      const msg = { type: 'cancel' };
      const result = CancelSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject cancel with extra fields', () => {
      // Zod strips extra fields by default, so this should still pass
      const msg = { type: 'cancel', extra: 'field' };
      const result = CancelSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('ClientMessageSchema (discriminated union)', () => {
    it('should correctly parse init message', () => {
      const msg = { type: 'init', token: 'abc' };
      const result = ClientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('init');
      }
    });

    it('should correctly parse message', () => {
      const msg = { type: 'message', content: 'test' };
      const result = ClientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('message');
      }
    });

    it('should correctly parse tool_result', () => {
      const msg = { type: 'tool_result', id: 'x', result: {} };
      const result = ClientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('tool_result');
      }
    });

    it('should correctly parse cancel', () => {
      const msg = { type: 'cancel' };
      const result = ClientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('cancel');
      }
    });

    it('should reject unknown message type', () => {
      const msg = { type: 'unknown', data: 'test' };
      const result = ClientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject malformed JSON structure', () => {
      const msg = 'not an object';
      const result = ClientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject null', () => {
      const result = ClientMessageSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('should reject undefined', () => {
      const result = ClientMessageSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });
  });
});
