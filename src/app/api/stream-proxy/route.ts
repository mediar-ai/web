/**
 * Streaming proxy endpoint for Gemini that supports tool calling
 *
 * Flow:
 * 1. Client sends message + tool definitions
 * 2. Backend streams Gemini response
 * 3. On tool_use: client executes locally, sends result back
 * 4. Backend continues conversation with tool results
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

interface StreamProxyRequest {
  model?: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolResults?: Array<{
      toolCallId: string;
      toolName: string;
      result: any;
    }>;
  }>;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  }>;
  temperature?: number;
  maxTokens?: number;
}

async function authenticate(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // First, check if it's the API password
    if (token === API_PASSWORD) {
      console.log('[Stream Proxy] Authenticated with API password');
      return true;
    }

    // Otherwise, try to validate as desktop token
    try {
      const validation = await validateDesktopToken(token);
      if (validation.valid) {
        console.log(`[Stream Proxy] Authenticated with desktop token for user: ${validation.email}`);
        return true;
      }
    } catch (error) {
      console.error('[Stream Proxy] Desktop token validation error:', error);
    }

    return false;
  }

  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [, password] = decoded.split(':');
    return password === API_PASSWORD;
  }

  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body: StreamProxyRequest = await req.json();

    // Validate auth (reuse existing validation)
    const isAuthenticated = await authenticate(req);
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const model = genAI.getGenerativeModel({
      model: body.model || 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: body.temperature ?? 0.7,
        maxOutputTokens: body.maxTokens ?? 8192,
      }
    });

    // Convert messages to Gemini format
    const contents = convertMessagesToGemini(body.messages);

    // Convert tools to Gemini function declarations
    const tools = body.tools?.map(tool => ({
      functionDeclarations: [{
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }]
    }));

    // Start streaming response
    const result = await model.generateContentStream({
      contents,
      tools,
    });

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            const functionCalls = chunk.functionCalls();

            if (text) {
              // Stream text chunks
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`)
              );
            }

            if (functionCalls && functionCalls.length > 0) {
              // Signal tool calls to client
              for (const call of functionCalls) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: 'tool_call',
                    id: crypto.randomUUID(),
                    name: call.name,
                    args: call.args,
                  })}\n\n`)
                );
              }

              // Signal that we're waiting for tool results
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'tool_wait' })}\n\n`)
              );
              break; // Stop streaming, wait for tool results
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error'
            })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function convertMessagesToGemini(messages: StreamProxyRequest['messages']) {
  return messages.map(msg => {
    if (msg.role === 'system') {
      // System messages become the first user message
      return {
        role: 'user',
        parts: [{ text: `[SYSTEM]\n${msg.content}` }]
      };
    }

    const parts: any[] = [{ text: msg.content }];

    // Add tool results if present (must be in separate message from text)
    if (msg.toolResults && msg.toolResults.length > 0) {
      // For messages with tool results, don't include text in the same parts array
      // Tool results go in user message, model response was in previous message
      return {
        role: 'user',
        parts: msg.toolResults.map(toolResult => ({
          functionResponse: {
            name: toolResult.toolName,
            response: {
              result: toolResult.result,  // Gemini expects { result: ... }
            },
          }
        }))
      };
    }

    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });
}
