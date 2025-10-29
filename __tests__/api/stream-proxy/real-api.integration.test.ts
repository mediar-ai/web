/**
 * REAL API Integration Tests for stream-proxy
 *
 * These tests make ACTUAL calls to Vertex AI to ensure schema conversion works
 * Run with: npm test -- real-api.integration.test.ts
 *
 * Set SKIP_REAL_API_TESTS=true to skip (for CI without credentials)
 */

import { POST } from '@/app/api/stream-proxy/route';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

// Load real MCP tool schemas
const mcpToolSchemas = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../fixtures/mcp-tool-schemas.json'),
    'utf-8'
  )
);

const SKIP_TESTS = process.env.SKIP_REAL_API_TESTS === 'true';

describe.skipIf(SKIP_TESTS)('/api/stream-proxy - Real Vertex AI Integration', () => {
  const mockAuth = `Bearer ${process.env.AI_API_PASSWORD || 'test-password'}`;

  beforeAll(() => {
    if (!SKIP_TESTS && !process.env.AI_API_PASSWORD) {
      console.warn('⚠️  AI_API_PASSWORD not set, tests may fail');
    }
  });

  it('should successfully call Vertex AI with real MCP tool schemas', async () => {
    const request = new NextRequest('http://localhost:3000/api/stream-proxy', {
      method: 'POST',
      headers: {
        'Authorization': mockAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gemini-2.0-flash-exp',
        messages: [
          { role: 'user', content: 'What tools do you have available?' }
        ],
        tools: mcpToolSchemas,
        temperature: 0.7,
      }),
    });

    const response = await POST(request);

    // Should NOT return 400 (Invalid JSON payload)
    expect(response.status).not.toBe(400);

    // Should return 200 with streaming response
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    // Verify response is actually streaming
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    if (reader) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      expect(value).toBeDefined();

      // Decode and verify SSE format
      const text = new TextDecoder().decode(value);
      expect(text).toContain('data:');

      reader.releaseLock();
    }
  }, 30000); // 30s timeout for real API call

  it('should handle click_element tool with const and anyOf', async () => {
    const clickTool = mcpToolSchemas.find((t: any) => t.name === 'click_element');
    expect(clickTool).toBeDefined();

    const request = new NextRequest('http://localhost:3000/api/stream-proxy', {
      method: 'POST',
      headers: {
        'Authorization': mockAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Click the submit button' }],
        tools: [clickTool],
      }),
    });

    const response = await POST(request);
    expect(response.status).not.toBe(400);
    expect(response.status).toBe(200);
  }, 30000);

  it('should handle execute_sequence tool with $ref and definitions', async () => {
    const execTool = mcpToolSchemas.find((t: any) => t.name === 'execute_sequence');
    expect(execTool).toBeDefined();

    const request = new NextRequest('http://localhost:3000/api/stream-proxy', {
      method: 'POST',
      headers: {
        'Authorization': mockAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Run a workflow' }],
        tools: [execTool],
      }),
    });

    const response = await POST(request);
    expect(response.status).not.toBe(400);
    expect(response.status).toBe(200);
  }, 30000);

  it('should handle ALL MCP tools at once (stress test)', async () => {
    const request = new NextRequest('http://localhost:3000/api/stream-proxy', {
      method: 'POST',
      headers: {
        'Authorization': mockAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'List all available tools and their purposes' }
        ],
        tools: mcpToolSchemas,
        temperature: 0.5,
      }),
    });

    const response = await POST(request);

    expect(response.status).not.toBe(400);
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    if (reader) {
      const chunks = [];
      let maxChunks = 5;

      while (maxChunks-- > 0) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
      }

      expect(chunks.length).toBeGreaterThan(0);
      reader.releaseLock();
    }
  }, 60000);
});
