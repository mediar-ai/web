import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from './server.js';
import type { FastifyInstance } from 'fastify';

// Mock the auth validation
vi.mock('./services/auth/validate.js', () => ({
  validateToken: vi.fn().mockImplementation((token: string) => {
    if (token === 'valid-token') {
      return Promise.resolve({
        userId: 'user-123',
        email: 'test@example.com',
        organizationId: 'org-456',
      });
    }
    return Promise.resolve(null);
  }),
}));

// Mock AI providers to avoid actual API calls
vi.mock('./services/ai/providers.js', async importOriginal => {
  const original =
    await importOriginal<typeof import('./services/ai/providers.js')>();
  return {
    ...original,
    handleChat: vi.fn().mockImplementation(async request => {
      request.onStream({ type: 'token', content: 'Hello' });
      request.onStream({ type: 'token', content: ' world!' });
      request.onStream({
        type: 'done',
        usage: { promptTokens: 10, completionTokens: 5 },
      });
    }),
  };
});

describe('Server', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
        headers: { Origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(200);
      // CORS plugin adds these headers
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Health endpoints', () => {
    it('should respond to /health', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });

    it('should respond to /ready', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ready',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ready');
    });
  });

  describe('OpenAI Compatible API', () => {
    it('should reject unauthenticated requests to /v1/models', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/models',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should reject unauthenticated requests to /v1/chat/completions', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should accept authenticated requests to /v1/models', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.object).toBe('list');
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should reject invalid model in /v1/chat/completions', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'invalid-model',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Invalid model');
    });

    it('should reject invalid request body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'gemini-2.5-flash',
          // missing messages
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('should process valid non-streaming request', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        payload: {
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.object).toBe('chat.completion');
      expect(body.choices).toBeInstanceOf(Array);
      expect(body.choices[0].message.role).toBe('assistant');
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/unknown-route',
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
