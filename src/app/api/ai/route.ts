import { createVertex } from '@ai-sdk/google-vertex';
import { generateText, streamText } from 'ai';
import { NextRequest, NextResponse } from 'next/server';

// Simple password authentication - replace with your desired password
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Authentication middleware
function authenticate(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  // Support both Bearer token and basic auth formats
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7) === API_PASSWORD;
  }

  if (authHeader.startsWith('Basic ')) {
    const credentials = Buffer.from(
      authHeader.substring(6),
      'base64'
    ).toString();
    const [username, password] = credentials.split(':');
    return password === API_PASSWORD;
  }

  return false;
}

// Helper function to process tools received from Tauri app
function processMCPTools(toolsFromTauri?: Record<string, any>) {
  if (!toolsFromTauri || Object.keys(toolsFromTauri).length === 0) {
    console.log('🔧 No MCP tools provided');
    return {};
  }

  const toolNames = Object.keys(toolsFromTauri);
  console.log(
    `🛠️  MCP Tools received from Tauri app (${toolNames.length} tools):`,
    toolNames
  );

  // Log each tool's structure for debugging
  toolNames.forEach(toolName => {
    const tool = toolsFromTauri[toolName];
    console.log(`📋 Tool: ${toolName}`, {
      description: tool?.description || 'No description',
      parameters: Object.keys(
        tool?.inputSchema?.properties || tool?.parameters?.properties || {}
      ),
      required: tool?.inputSchema?.required || tool?.parameters?.required || [],
      hasInputSchema: !!tool?.inputSchema,
      hasParameters: !!tool?.parameters,
      toolKeys: Object.keys(tool || {}),
    });

    // Log full tool structure for first few tools to debug
    if (toolNames.indexOf(toolName) < 2) {
      console.log(
        `🔍 Full tool structure for ${toolName}:`,
        JSON.stringify(tool, null, 2)
      );
    }
  });

  // Tools are already in AI SDK format from the Tauri app
  return toolsFromTauri;
}

// OPTIONS endpoint for CORS preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// POST endpoint for text generation with optional MCP tools
export async function POST(request: NextRequest) {
  let body: any;

  try {
    // Check authentication
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    body = await request.json();
    const {
      prompt,
      model = 'gemini-2.5-pro',
      stream = false,
      maxTokens = 1000,
      temperature = 0.7,
      systemPrompt,
      mcpTools, // New: MCP tools from Tauri app (already in AI SDK format)
      enableTools = false, // New: whether to enable MCP tools
    } = body;

    // Log incoming request details
    console.log('\n🚀 === NEW AI REQUEST ===');
    console.log('📝 Request details:', {
      promptLength: prompt.length,
      model,
      stream,
      maxTokens,
      temperature,
      enableTools,
      hasSystemPrompt: !!systemPrompt,
      hasMCPTools: !!mcpTools,
      mcpToolCount: mcpTools ? Object.keys(mcpTools).length : 0,
      timestamp: new Date().toISOString(),
    });
    console.log(
      '📄 Prompt preview:',
      prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '')
    );
    if (systemPrompt) {
      console.log(
        '🤖 System prompt:',
        systemPrompt.substring(0, 100) +
          (systemPrompt.length > 100 ? '...' : '')
      );
    }

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Configure Vertex AI using your existing base64 credentials
    let vertex;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      // Decode base64 credentials
      const credentialsJson = Buffer.from(
        process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
        'base64'
      ).toString('utf-8');
      const credentials = JSON.parse(credentialsJson);

      vertex = createVertex({
        project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
        location: process.env.VERTEX_AI_LOCATION || 'us-central1',
        googleAuthOptions: {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
        },
      });
    } else {
      throw new Error(
        'GOOGLE_APPLICATION_CREDENTIALS_BASE64 environment variable is required'
      );
    }

    const vertexModel = vertex(model);

    // Get MCP tools if enabled and tools provided from Tauri app
    let tools = {};
    if (enableTools && mcpTools) {
      console.log('🚀 Processing MCP tools for AI request...');
      tools = processMCPTools(mcpTools);

      if (Object.keys(tools).length > 0) {
        console.log(
          `✅ ${Object.keys(tools).length} tools will be available to AI model:`,
          Object.keys(tools)
        );
      } else {
        console.log(
          '⚠️  No valid tools processed - AI will run without tool access'
        );
      }
    } else if (enableTools && !mcpTools) {
      console.log('⚠️  Tools enabled but no mcpTools provided in request');
    } else {
      console.log('🔧 Tools disabled for this request');
    }

    // Prepare messages
    const messages: any[] = [];

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    // Common AI SDK options
    const aiOptions = {
      model: vertexModel as any,
      messages,
      maxTokens,
      temperature,
      ...(Object.keys(tools).length > 0 && { tools }), // Only add tools if we have them
    };

    // Handle streaming response
    if (stream) {
      console.log('🌊 Starting streaming response with AI model:', model);
      console.log('🛠️ AI Options:', {
        hasModel: !!aiOptions.model,
        messageCount: aiOptions.messages.length,
        toolCount: Object.keys(aiOptions.tools || {}).length,
        maxTokens: aiOptions.maxTokens,
        temperature: aiOptions.temperature,
      });

      const result = streamText(aiOptions);

      // Convert to streaming response
      const encoder = new TextEncoder();
      let chunkCount = 0;

      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.textStream) {
              chunkCount++;
              if (chunkCount <= 5) {
                console.log(
                  `📦 Streaming chunk ${chunkCount}:`,
                  chunk.substring(0, 50) + '...'
                );
              }
              const data = encoder.encode(
                `data: ${JSON.stringify({ text: chunk })}\n\n`
              );
              controller.enqueue(data);
            }

            // Get final results and log tool usage
            try {
              const finishResult = await result.text;
              console.log(`✅ Streaming completed - ${chunkCount} chunks sent`);
              console.log(
                `📊 Final response length: ${finishResult.length} characters`
              );

              try {
                const toolCalls = await result.toolCalls;
                console.log('🔍 Raw tool calls structure:', toolCalls);

                if (toolCalls && toolCalls.length > 0) {
                  console.log(
                    `🔨 Tool calls made during streaming (${toolCalls.length}):`
                  );
                  toolCalls.forEach((call: any, index: number) => {
                    try {
                      console.log(`  ${index + 1}. Tool Call:`, {
                        toolName:
                          call?.toolName ||
                          call?.tool?.name ||
                          call?.function?.name ||
                          'unknown',
                        args:
                          call?.args ||
                          call?.arguments ||
                          call?.function?.arguments ||
                          {},
                        callId: call?.toolCallId || call?.id || 'unknown',
                        rawCallKeys: Object.keys(call || {}),
                      });
                    } catch (e) {
                      console.error(`Error logging tool call ${index + 1}:`, e);
                      console.log(`  ${index + 1}. Tool Call (raw):`, call);
                    }
                  });
                } else {
                  console.log('🔧 No tools were called during streaming');
                }
              } catch (toolCallError) {
                console.error('🚨 Error getting tool calls:', toolCallError);
              }

              try {
                const toolResults = await result.toolResults;
                console.log('🔍 Raw tool results structure:', toolResults);

                if (toolResults && toolResults.length > 0) {
                  console.log(
                    `📈 Tool results from streaming (${toolResults.length}):`
                  );
                  toolResults.forEach((result: any, index: number) => {
                    try {
                      console.log(`  ${index + 1}. Tool Result:`, {
                        toolCallId:
                          result?.toolCallId || result?.id || 'unknown',
                        resultLength: result?.result
                          ? JSON.stringify(result.result).length
                          : 0,
                        resultType: typeof result?.result,
                        hasError: !!result?.error,
                        rawResultKeys: Object.keys(result || {}),
                      });
                    } catch (e) {
                      console.error(
                        `Error logging tool result ${index + 1}:`,
                        e
                      );
                      console.log(`  ${index + 1}. Tool Result (raw):`, result);
                    }
                  });
                }
              } catch (toolResultError) {
                console.error(
                  '🚨 Error getting tool results:',
                  toolResultError
                );
              }
            } catch (toolError: unknown) {
              console.error(
                '🚨 Tool execution error during streaming:',
                toolError
              );
              if (toolError instanceof Error) {
                console.error('🚨 Error stack:', toolError.stack);
              }
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            console.error('🚨 Streaming error:', error);
            controller.error(error);
          } finally {
            console.log('🏁 Streaming response completed');
            console.log('🏁 === AI STREAMING REQUEST COMPLETED ===\n');
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...corsHeaders,
        },
      });
    }

    // Handle non-streaming response
    console.log('🎯 Starting non-streaming response with AI model:', model);
    console.log('🛠️ AI Options:', {
      hasModel: !!aiOptions.model,
      messageCount: aiOptions.messages.length,
      toolCount: Object.keys(aiOptions.tools || {}).length,
      maxTokens: aiOptions.maxTokens,
      temperature: aiOptions.temperature,
    });

    const result = await generateText(aiOptions);

    console.log(`✅ Non-streaming response completed`);
    console.log(`📊 Response length: ${result.text.length} characters`);
    console.log(`💰 Token usage:`, result.usage);

    // Log tool usage for non-streaming
    try {
      console.log('🔍 Raw tool calls structure:', result.toolCalls);

      if (result.toolCalls && result.toolCalls.length > 0) {
        console.log(`🔨 Tool calls made (${result.toolCalls.length}):`);
        result.toolCalls.forEach((call: any, index: number) => {
          try {
            console.log(`  ${index + 1}. Tool Call:`, {
              toolName:
                call?.toolName ||
                call?.tool?.name ||
                call?.function?.name ||
                'unknown',
              args:
                call?.args ||
                call?.arguments ||
                call?.function?.arguments ||
                {},
              callId: call?.toolCallId || call?.id || 'unknown',
              rawCallKeys: Object.keys(call || {}),
            });
          } catch (e) {
            console.error(`Error logging tool call ${index + 1}:`, e);
            console.log(`  ${index + 1}. Tool Call (raw):`, call);
          }
        });
      } else {
        console.log('🔧 No tools were called');
      }
    } catch (toolCallError) {
      console.error('🚨 Error getting tool calls:', toolCallError);
    }

    try {
      console.log('🔍 Raw tool results structure:', result.toolResults);

      if (result.toolResults && result.toolResults.length > 0) {
        console.log(`📈 Tool results (${result.toolResults.length}):`);
        result.toolResults.forEach((toolResult: any, index: number) => {
          try {
            console.log(`  ${index + 1}. Tool Result:`, {
              toolCallId: toolResult?.toolCallId || toolResult?.id || 'unknown',
              resultLength: toolResult?.result
                ? JSON.stringify(toolResult.result).length
                : 0,
              resultType: typeof toolResult?.result,
              hasError: !!toolResult?.error,
              rawResultKeys: Object.keys(toolResult || {}),
            });
          } catch (e) {
            console.error(`Error logging tool result ${index + 1}:`, e);
            console.log(`  ${index + 1}. Tool Result (raw):`, toolResult);
          }
        });
      }
    } catch (toolResultError) {
      console.error('🚨 Error getting tool results:', toolResultError);
    }

    const responseData = {
      text: result.text,
      usage: result.usage,
      model: model,
      toolCalls: result.toolCalls || [],
      toolResults: result.toolResults || [],
      mcpToolsUsed:
        Object.keys(tools).length > 0 ? Object.keys(tools) : undefined,
    };

    console.log('🚀 Sending response with keys:', Object.keys(responseData));
    console.log('🏁 === AI REQUEST COMPLETED ===\n');

    return NextResponse.json(responseData, { headers: corsHeaders });
  } catch (error: any) {
    console.error('\n🚨 === AI REQUEST FAILED ===');
    console.error('❌ Error type:', error.constructor.name);
    console.error('❌ Error message:', error.message);
    console.error('❌ Stack trace:', error.stack);
    console.error('❌ Request details that failed:', {
      hasPrompt: !!body?.prompt,
      model: body?.model,
      enableTools: body?.enableTools,
      mcpToolCount: body?.mcpTools ? Object.keys(body.mcpTools).length : 0,
    });

    return NextResponse.json(
      {
        error: 'Failed to generate response',
        details: error.message,
        errorType: error.constructor.name,
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// GET endpoint for health check and available models
export async function GET(request: NextRequest) {
  try {
    // Check authentication for GET requests too
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        message: 'AI API is running',
        availableModels: [
          'gemini-1.5-pro',
          'gemini-1.5-flash',
          'gemini-2.0-flash-001',
          'gemini-2.0-flash-exp',
        ],
        endpoints: {
          generate: {
            method: 'POST',
            description: 'Generate text using AI with optional MCP tools',
            parameters: {
              prompt: 'string (required) - The input prompt',
              model: 'string (optional) - Model name, default: gemini-2.5-pro',
              stream:
                'boolean (optional) - Enable streaming response, default: false',
              maxTokens:
                'number (optional) - Maximum tokens to generate, default: 1000',
              temperature:
                'number (optional) - Creativity level 0-1, default: 0.7',
              systemPrompt: 'string (optional) - System prompt for the AI',
              enableTools:
                'boolean (optional) - Enable MCP tools, default: false',
              mcpTools:
                'object (optional) - MCP tools from Tauri app in AI SDK format',
            },
          },
        },
        authentication: {
          method: 'Bearer token or Basic auth',
          note: 'Include Authorization header with your API password',
        },
      },
      { headers: corsHeaders }
    );
  } catch (error: unknown) {
    console.error('AI API Health Check Error:', error);

    return NextResponse.json(
      {
        error: 'Health check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
