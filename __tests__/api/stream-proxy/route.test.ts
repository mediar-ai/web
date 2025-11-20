/**
 * Integration tests for stream-proxy API route
 * Tests edge cases with MCP tool schemas
 */

import { POST, OPTIONS } from '@/app/api/stream-proxy/route';
import { NextRequest } from 'next/server';

// Mock Vertex AI
jest.mock('@google-cloud/vertexai', () => {
  const mockGenerateContentStream = jest.fn().mockResolvedValue({
    stream: (async function* () {
      yield {
        candidates: [
          {
            content: {
              parts: [{ text: 'Test response' }],
            },
          },
        ],
      };
    })(),
  });

  const mockGetGenerativeModel = jest.fn(() => ({
    generateContentStream: mockGenerateContentStream,
  }));

  return {
    VertexAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
  };
});

describe('/api/stream-proxy', () => {
  // Use default password since the module captures process.env at load time
  const mockAuth = 'Bearer your-secret-password-here';

  describe('OPTIONS', () => {
    it('should return CORS headers', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/stream-proxy',
        {
          method: 'OPTIONS',
        }
      );

      const response = await OPTIONS(request);

      expect(response.status).toBe(200);
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
      expect(['*', 'http://localhost:1420']).toContain(allowOrigin);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'POST'
      );
    });
  });

  describe('POST - Schema Conversion', () => {
    it('should handle MCP tools with $schema field', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/stream-proxy',
        {
          method: 'POST',
          headers: {
            Authorization: mockAuth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
            tools: [
              {
                name: 'test_tool',
                description: 'Test',
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  type: 'object',
                  properties: { field: { type: 'string' } },
                },
              },
            ],
          }),
        }
      );

      // This should not throw a 400 error about $schema
      const response = await POST(request);

      expect(response.status).not.toBe(400);
    });

    it('should handle MCP tools with const fields', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/stream-proxy',
        {
          method: 'POST',
          headers: {
            Authorization: mockAuth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
            tools: [
              {
                name: 'test_tool',
                description: 'Test',
                parameters: {
                  type: 'object',
                  properties: {
                    action: { const: 'click' },
                  },
                },
              },
            ],
          }),
        }
      );

      const response = await POST(request);

      expect(response.status).not.toBe(400);
    });

    it('should handle MCP tools with anyOf fields', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/stream-proxy',
        {
          method: 'POST',
          headers: {
            Authorization: mockAuth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
            tools: [
              {
                name: 'test_tool',
                description: 'Test',
                parameters: {
                  type: 'object',
                  properties: {
                    value: {
                      anyOf: [{ type: 'string' }, { type: 'number' }],
                    },
                  },
                },
              },
            ],
          }),
        }
      );

      const response = await POST(request);

      expect(response.status).not.toBe(400);
    });

    it('should handle MCP tools with $ref fields', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/stream-proxy',
        {
          method: 'POST',
          headers: {
            Authorization: mockAuth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
            tools: [
              {
                name: 'test_tool',
                description: 'Test',
                parameters: {
                  type: 'object',
                  properties: {
                    ref_field: { $ref: '#/definitions/SomeType' },
                  },
                  definitions: {
                    SomeType: { type: 'string' },
                  },
                },
              },
            ],
          }),
        }
      );

      const response = await POST(request);

      expect(response.status).not.toBe(400);
    });
  });

  describe('POST - Authentication', () => {
    it('should return 401 without auth', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/stream-proxy',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'test' }],
          }),
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(401);
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
      expect(['*', 'http://localhost:1420']).toContain(allowOrigin);
    });
  });
});
