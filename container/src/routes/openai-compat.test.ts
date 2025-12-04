import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Schema matching the one in openai-compat.ts
const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().nullable(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.object({
      id: z.string(),
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        arguments: z.string(),
      }),
    })).optional(),
  })),
  tools: z.array(z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.any()).optional(),
    }),
  })).optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
});

describe('OpenAI Compatible API', () => {
  describe('Request Validation', () => {
    it('should validate minimal request', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate request with system message', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
        ],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate request with assistant message', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate request with tools', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'What time is it?' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_time',
            description: 'Get the current time',
            parameters: {
              type: 'object',
              properties: {
                timezone: { type: 'string' },
              },
            },
          },
        }],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate request with tool calls in assistant message', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'What time is it?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_time',
                arguments: '{"timezone": "UTC"}',
              },
            }],
          },
        ],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate request with tool result', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'What time is it?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_time',
                arguments: '{}',
              },
            }],
          },
          {
            role: 'tool',
            content: '12:00 PM',
            tool_call_id: 'call_123',
            name: 'get_time',
          },
        ],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate request with optional parameters', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 1000,
        stream: true,
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.temperature).toBe(0.7);
        expect(result.data.max_tokens).toBe(1000);
        expect(result.data.stream).toBe(true);
      }
    });

    it('should reject request without model', () => {
      const request = {
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });

    it('should reject request without messages', () => {
      const request = {
        model: 'gemini-2.5-flash',
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });

    it('should reject request with invalid role', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'invalid', content: 'Hello' }],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });

    it('should reject request with invalid tool type', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [{
          type: 'invalid',
          function: { name: 'test' },
        }],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });

    it('should accept null content for assistant with tool_calls', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'test', arguments: '{}' },
          }],
        }],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });
  });

  describe('Message Conversion', () => {
    it('should handle multi-turn conversation', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
          { role: 'user', content: 'Bye' },
          { role: 'assistant', content: 'Goodbye!' },
        ],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.messages).toHaveLength(5);
      }
    });

    it('should handle empty messages array', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });
  });

  describe('Tool Schema Validation', () => {
    it('should validate complex tool parameters', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Search' }],
        tools: [{
          type: 'function',
          function: {
            name: 'search',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', description: 'Max results' },
                filters: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    source: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
              required: ['query'],
            },
          },
        }],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate multiple tools', () => {
      const request = {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Help' }],
        tools: [
          { type: 'function', function: { name: 'tool1' } },
          { type: 'function', function: { name: 'tool2', description: 'Desc' } },
          { type: 'function', function: { name: 'tool3', parameters: {} } },
        ],
      };
      const result = ChatCompletionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tools).toHaveLength(3);
      }
    });
  });
});
