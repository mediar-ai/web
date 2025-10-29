/**
 * Streaming proxy endpoint for Gemini using Vertex AI (not free API)
 *
 * Flow:
 * 1. Client sends message + tool definitions
 * 2. Backend streams Gemini response via Vertex AI
 * 3. On tool_use: client executes locally, sends result back
 * 4. Backend continues conversation with tool results
 */

import { NextRequest, NextResponse } from 'next/server';
import { VertexAI, Content, FunctionDeclaration, Part } from '@google-cloud/vertexai';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

// Vertex AI credentials (embedded, same as other routes)
const VERTEX_CREDENTIALS_BASE64 = 'eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im1lZGlhci0zOTQwMjIiLCJwcml2YXRlX2tleV9pZCI6ImJlNGMxMjA4YjA0YTgzMzA4ZjNlMjVkMjcyYzZjZmUzMjRjOTQwNmIiLCJwcml2YXRlX2tleSI6Ii0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVxuTUlJRXZnSUJBREFOQmdrcWhraUc5dzBCQVFFRkFBU0NCS2d3Z2dTa0FnRUFBb0lCQVFEcmZsWHdtZFM4dXd2VFxuS3NobW5iY2xmMzJ3NXI1eFEzUFZjbFZaNDNlc3dobndGNTdQZTRwMnNDUGVxQUF3Mk45aW1sOWZJbkpqdUs0MVxuR0ZmWWlLRmtNcHI5VkV4UXhnbG00UlcvSlVmV2l2Y1FJYTgyTVhWN1RSV1F5MGtUd3JMbHZuanZSbjU1OW1sN1xueDYzSUdwMmovMEZYMkUvYkIwek9BbTRJb1VsVm1HYzBPN2ViVmNMUy9LSVhRNWxQTi9SeDhNOE8xL0h2V3NLaFxuM2Npa3UrT00vT0pHV2pMeXdCWW8zN1c0Q3JaV0dqa0Q0VEVXdUh2VGJvOVNtZkxhUEtjaGptYkJqbjdteXBzdVxueUxhOWNCbGZFYllrNkVSV3ZlWkRqNy9sVUM1cVJuOFhYT0ZGcnFRZW80WStsTldHSEY4REVkSUJFdEc2Q1NMdFxuZFJ4Vmcv UVZBZ01CQUFFQ2dnRUFDWS9PbzM5TGdRSkRQNmE4RGxhWENpRzhFOE82dGRTY1RtMWZBOUJWbXFFaVxuOW5tdkRCT2pFcUNpUkRja0V0ZXJjbEI4VU51UU0zWmJOSEt4bG13dHlXaTRuRktnNnFLdjNRcUVuSWRCL0hjV1xuQXdTckhaTXlodmdoU1FqSUJkSmcreTBac2ZWMXl6UHpJb0NBRU9Ecng2M2tsRkdISklpT1dNc0dkcms5eGdqZlxuTG82WU1mL25SWm5WS0I5WXZOUjFGcC93WEdScjJsWlF0RThTY1AxRU5pclh6WFZZ clFMV2ZlZUZJUWZmemQ3VFxuY0R6cFNLUVgzaG5oQSt2VWFYOWkzOEVtb3U4aW5DdE83U3AwZnhQV0k0ampUeWtOTUhUY0dhS2RlU1ZWdDNZcVxuZUNVaGhnRnU4eS91RkVHMUN1R1l4aXVRTmlOQW92WkhWUXZ4dS8wQS9RS0JnUUQ2UmFuYVUrd2tpZnRtaU02cFxuYlJoMHVqNEh3Sk5zTWVBQ3FmcFFyUDJJMTM4Uk9sSUtQRm5PVklOeVBEU1M5RmtIMkladUhNUnp4ZWhxZ3BmdFxuNkxHK3dmTi94YW9lUHJwSTJoOFVFaVNpYk96dG1FMEtXaktHc2M2c09HY1FuVGVicGhlbkdkVjdGT0ZCN0wzc1xuOTRDNnUyUmR3QXQ4MlU3cUM2Q2tHMmVXRndLQmdRRHc0aFd3TXJnWVVmRVg5eFFyT1hVNWs1NTdGSGhCdnpIclxuUytXRFVHQS9QN3RqN0JQaUVHWEFUV0pxMytPR3lSMGlRR1BCTVFySWNXaVpDL1ZKeTE1czdmdzVPd1l3YmNXUFxud24zTWQ0RTQyN201RGtGV2dxWVFpYk5QSnh2VVVnWWo5em0yNzIrZzJXRXJ4UVJKdzF6YWR5dUttaXBmSnEwY1xuTHBNU1dsMU9zd0tCZ1FDazdRdUZxUkJROCswTUlOT3Zxd2tXd3pUbGZ1Nm51aVpaR3hLdDM1SWtmMzVwSi9td1xuYlJ6eGI1Zy95NVVKMHFScEd6TmJsUEdSS2JhRG1oUHM0QTlpR2dZUkNYMlYrTmhoOGZ2UkNqUENKZTNzbFJVUFxuNFdpeWdySWpvL2VuWnpPaUNzNURmQzdHc1hmUUxlYnJKaDlhN3VxeExVRmt3UC9VRkYyRVI5cjNlUUtCZ0dsM1xuTTNPLzRTYVV5ZkJxTjZSdE5jd051L2U3a0tPSXFMeVNzRng4Rm9mYXlac0lRL1JZcFpRNnpYcHBxRjdkTXlwSlxuOHVNbEs4bHpEZzdrVTNNSjNiL251dVQ3Mk12ZlkvNTdjMFRRbGYxbEJyM2xaZW9RcmREVDJYUXdkVmpTeU9sNlxuVndTbmRNS0NLcTlWUlhsZVZnczQzaEdEU2tYNjB4Umh0L2J6SmFOTkFvR0JBSzFNZXlKMkpZZnZpODN4WENEbFxuY3UzRTc4MzBJajVtOTZCaDVqZDYxTmNzSmJxekI1YVhQZkZldUJJN3cwM0VCVW9wQnN0OGsyb3RJYWZ5b3VkY1xuTjlqellaSDlOM1g3VlFOMXJYRmo2ZU4yenBLajdZaWdMOTZhcCtCREtTTTVwYWNJaTdVWHpzWTh5N3RxK3ZoMFxuL0U0RlpmRXl5N2dDZHVkOU5DeTVzMDR2XG4tLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tXG4iLCJjbGllbnRfZW1haWwiOiJ2ZXJ0ZXgtYWktc2VydmljZS1hY2NvdW50QG1lZGlhci0zOTQwMjIuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLCJjbGllbnRfaWQiOiIxMTgyNTUxNzM2MjczNDA0NjA4OTEiLCJhdXRoX3VyaSI6Imh0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbS9vL29hdXRoMi9hdXRoIiwidG9rZW5fdXJpIjoiaHR0cHM6Ly9vYXV0aDIuZ29vZ2xlYXBpcy5jb20vdG9rZW4iLCJhdXRoX3Byb3ZpZGVyX3g1MDlfY2VydF91cmwiOiJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9vYXV0aDIvdjEvY2VydHMiLCJjbGllbnRfeDUwOV9jZXJ0X3VybCI6Imh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL3JvYm90L3YxL21ldGFkYXRhL3g1MDkvdmVydGV4LWFpLXNlcnZpY2UtYWNjb3VudCU0MG1lZGlhci0zOTQwMjIuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLCJ1bml2ZXJzZV9kb21haW4iOiJnb29nbGVhcGlzLmNvbSJ9Cg==';
const GOOGLE_CLOUD_PROJECT = 'mediar-394022';
const VERTEX_AI_LOCATION = 'us-central1';

// CORS headers for desktop app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
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
    parameters: Record<string, any>;
  }>;
  temperature?: number;
  maxTokens?: number;
}

async function authenticate(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token === API_PASSWORD) {
      console.log('[Stream Proxy] Authenticated with API password');
      return true;
    }

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

function initVertexAI(): VertexAI {
  const credentialsJson = Buffer.from(VERTEX_CREDENTIALS_BASE64, 'base64').toString('utf-8');
  const credentials = JSON.parse(credentialsJson);

  return new VertexAI({
    project: GOOGLE_CLOUD_PROJECT,
    location: VERTEX_AI_LOCATION,
    googleAuthOptions: {
      credentials: {
        client_email: credentials.client_email,
n// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders });
}
        private_key: credentials.private_key,
      },
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body: StreamProxyRequest = await req.json();

    const isAuthenticated = await authenticate(req);
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const vertexAI = initVertexAI();
    const model = vertexAI.getGenerativeModel({
      model: body.model || 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: body.temperature ?? 0.7,
        maxOutputTokens: body.maxTokens ?? 8192,
      },
    });

    // Convert messages to Vertex AI Content format
    const contents: Content[] = convertMessagesToVertex(body.messages);

    // Convert tools to Vertex AI function declarations
    const tools = body.tools ? [{
      functionDeclarations: body.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      } as FunctionDeclaration))
    }] : undefined;

    // Start streaming response
    const result = await model.generateContentStream({
      contents,
      tools,
    });

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            // Extract text
            const candidate = chunk.candidates?.[0];
            if (!candidate) continue;

            const textParts = candidate.content.parts.filter(p => 'text' in p);
            if (textParts.length > 0) {
              for (const part of textParts) {
                if ('text' in part && part.text) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'text', content: part.text })}\n\n`)
                  );
                }
              }
            }

            // Check for function calls
            const functionCalls = candidate.content.parts.filter(p => 'functionCall' in p);
            if (functionCalls.length > 0) {
              for (const part of functionCalls) {
                if ('functionCall' in part && part.functionCall) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({
                      type: 'tool_call',
                      id: crypto.randomUUID(),
                      name: part.functionCall.name,
                      args: part.functionCall.args,
                    })}\n\n`)
                  );
                }
              }

              // Signal waiting for tool results
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
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

function convertMessagesToVertex(messages: StreamProxyRequest['messages']): Content[] {
  const contents: Content[] = [];

  for (const msg of messages) {
    // Handle tool results separately
    if (msg.toolResults && msg.toolResults.length > 0) {
      const parts: Part[] = msg.toolResults.map(tr => {
        // Extract value from MCP content array if needed
        let responseValue = tr.result;
        if (Array.isArray(responseValue) && responseValue.length > 0 && responseValue[0].type === 'text') {
          // MCP format: [{ type: 'text', text: '...' }]
          responseValue = { content: responseValue[0].text };
        }

        return {
          functionResponse: {
            name: tr.toolName,
            response: responseValue,
          }
        };
      });
      contents.push({ role: 'user', parts });
      continue;
    }

    // Handle system messages
    if (msg.role === 'system') {
      contents.push({
        role: 'user',
        parts: [{ text: `[SYSTEM]\n${msg.content}` }]
      });
      continue;
    }

    // Regular messages
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  }

  return contents;
}
