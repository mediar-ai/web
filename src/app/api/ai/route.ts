import { VertexAI } from '@google-cloud/vertexai';
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

// Convert MCP tools format to Vertex AI function declarations
function convertMCPToolsToVertexAI(mcpTools: any) {
  if (!mcpTools || typeof mcpTools !== 'object') {
    return [];
  }

  const functionDeclarations = [];

  for (const [toolName, mcpTool] of Object.entries(mcpTools)) {
    if (typeof mcpTool === 'object' && mcpTool !== null) {
      const tool = mcpTool as any;

      functionDeclarations.push({
        name: toolName,
        description: tool.description,
        parameters: tool.inputSchema?.jsonSchema || {
          type: 'object',
          properties: {},
        },
      });
    }
  }

  console.log('🔧 Converted MCP tools to Vertex AI format:', {
    originalCount: Object.keys(mcpTools).length,
    convertedCount: functionDeclarations.length,
    toolNames: functionDeclarations.map(f => f.name),
  });

  return functionDeclarations;
}

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
    const [, password] = credentials.split(':');
    return password === API_PASSWORD;
  }

  return false;
}

// Create a streaming response with Server-Sent Events format
function createStreamingResponse(
  vertexAI: VertexAI,
  model: string,
  messages: any[],
  functionDeclarations: any[],
  toolResults?: any[],
  temperature: number = 0.7,
  maxTokens: number = 1000
) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        // Send start event
        controller.enqueue(encoder.encode('data: {"type":"start"}\n\n'));

        // Initialize the generative model
        const generativeModel = vertexAI.getGenerativeModel({
          model: model,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
          tools:
            functionDeclarations.length > 0
              ? [{ functionDeclarations }]
              : undefined,
        });

        // Convert messages to Vertex AI format
        const chatHistory = messages.slice(0, -1).map(msg => {
          // Handle different message types
          if (msg.role === 'user') {
            return {
              role: 'user',
              parts: [{ text: msg.content }],
            };
          } else if (msg.role === 'model' || msg.role === 'assistant') {
            const parts = [];

            // Add text content if present
            if (msg.content) {
              parts.push({ text: msg.content });
            }

            // Add function calls if present
            if (msg.functionCalls && Array.isArray(msg.functionCalls)) {
              for (const functionCall of msg.functionCalls) {
                parts.push({
                  functionCall: {
                    name: functionCall.name,
                    args: functionCall.args || {},
                  },
                });
              }
            }

            return {
              role: 'model',
              parts: parts.length > 0 ? parts : [{ text: msg.content || '' }],
            };
          } else if (msg.role === 'function') {
            // Handle function responses
            return {
              role: 'function',
              parts: msg.functionResponses
                ? msg.functionResponses.map((fr: any) => ({
                    functionResponse: {
                      name: fr.name,
                      response: fr.response,
                    },
                  }))
                : [{ text: msg.content || '' }],
            };
          }

          // Default fallback
          return {
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content || '' }],
          };
        });

        const lastMessage = messages[messages.length - 1];

        // Start chat session
        const chat = generativeModel.startChat({
          history: chatHistory,
        });

        console.log('🌊 Starting Vertex AI streaming...');

        let result;

        // If we have tool results, continue with function responses
        if (toolResults && toolResults.length > 0) {
          console.log('🔄 Continuing with tool results:', toolResults.length);

          // For continuation with tool results, we need to add the function calls to the chat history
          // and then send the function responses as a new message

          // First, add the function calls to chat history
          const functionCallParts = toolResults.map(toolResult => ({
            functionCall: {
              name: toolResult.toolName,
              args: toolResult.args || {},
            },
          }));

          // Add the function calls as a model message to the history
          const functionCallMessage = {
            role: 'model' as const,
            parts: functionCallParts,
          };

          // Create a new chat with the updated history
          const updatedHistory = [...chatHistory, functionCallMessage];
          const updatedChat = generativeModel.startChat({
            history: updatedHistory,
          });

          // Create function response parts
          const functionResponseParts = toolResults.map(toolResult => ({
            functionResponse: {
              name: toolResult.toolName,
              response: { result: JSON.stringify(toolResult.result) },
            },
          }));

          // Now send the function responses
          result = await updatedChat.sendMessageStream(functionResponseParts);
        } else {
          // Normal user message
          const userMessage = lastMessage.content;
          result = await chat.sendMessageStream(userMessage);
        }

        let fullText = '';
        let functionCalls: any[] = [];

        // Process streaming chunks
        for await (const chunk of result.stream) {
          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;

          // Extract text from the response
          const textParts =
            candidate.content?.parts?.filter(part => part.text) || [];
          if (textParts.length > 0) {
            const chunkText = textParts.map(part => part.text).join('');
            if (chunkText) {
              fullText += chunkText;

              // Send text delta
              controller.enqueue(
                encoder.encode(
                  `data: {"type":"textDelta","textDelta":"${chunkText.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}\n\n`
                )
              );
            }
          }

          // Check for function calls
          const functionCallParts =
            candidate.content?.parts?.filter(part => part.functionCall) || [];
          if (functionCallParts.length > 0) {
            for (const part of functionCallParts) {
              if (part.functionCall) {
                functionCalls.push(part.functionCall);

                // Send function call event with unique ID
                const toolCallId = `${part.functionCall.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                controller.enqueue(
                  encoder.encode(
                    `data: {"type":"toolCall","toolCallId":"${toolCallId}","toolName":"${part.functionCall.name}","args":${JSON.stringify(part.functionCall.args)}}\n\n`
                  )
                );
              }
            }
          }
        }

        // If we have function calls and no tool results were provided,
        // pause here and wait for frontend to execute tools
        if (
          functionCalls.length > 0 &&
          (!toolResults || toolResults.length === 0)
        ) {
          console.log(
            '⏸️ Pausing stream - waiting for tool execution:',
            functionCalls.length
          );

          // Send finish event indicating tools need to be executed
          controller.enqueue(
            encoder.encode(
              `data: {"type":"finish","finishReason":"tool_calls","usage":{"totalTokens":${fullText.length}}}\n\n`
            )
          );
        } else {
          // Normal completion
          controller.enqueue(
            encoder.encode(
              `data: {"type":"finish","finishReason":"stop","usage":{"totalTokens":${fullText.length}}}\n\n`
            )
          );
        }

        // Send completion marker
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));

        console.log('✅ Streaming completed successfully');
      } catch (error) {
        console.error('❌ Streaming error:', error);

        // Send error event
        controller.enqueue(
          encoder.encode(
            `data: {"type":"error","error":"${(error as Error).message.replace(/"/g, '\\"')}"}\n\n`
          )
        );

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// OPTIONS endpoint for CORS preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// POST endpoint for AI chat with direct Vertex AI
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const {
      messages,
      model = 'gemini-2.5-flash',
      mcpTools,
      toolResults, // New: tool results from frontend
      maxTokens = 1000,
      maxOutputTokens = 1000, // Support both formats
      temperature = 0.7,
    } = body;

    // Use maxOutputTokens if provided, otherwise maxTokens
    const finalMaxTokens = maxOutputTokens || maxTokens;

    console.log('🚀 === NEW AI CHAT REQUEST ===');
    console.log('📝 Request details:', {
      messageCount: messages ? messages.length : 0,
      model,
      maxTokens: finalMaxTokens,
      temperature,
      hasMCPTools: !!mcpTools,
      mcpToolCount: mcpTools ? Object.keys(mcpTools).length : 0,
      hasToolResults: !!toolResults,
      toolResultsCount: toolResults ? toolResults.length : 0,
      isToolContinuation: !!toolResults,
      timestamp: new Date().toISOString(),
    });

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.log('❌ Invalid messages:', { messages, type: typeof messages });
      return NextResponse.json(
        {
          error: 'Messages are required and must be a non-empty array',
          received: { messages, type: typeof messages },
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Convert UI messages to model messages format
    const modelMessages = messages.map((msg: any) => {
      // Handle both old format (content) and new format (parts)
      if (msg.parts && Array.isArray(msg.parts)) {
        // Convert parts array to content string for model
        const textParts = msg.parts
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join('\n');
        return {
          role: msg.role,
          content: textParts || msg.content || '',
        };
      }

      return {
        role: msg.role,
        content: msg.content || '',
      };
    });

    console.log('📨 Converted messages for model:', modelMessages.length);

    // Initialize Vertex AI
    let vertexAI: VertexAI;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      const credentialsJson = Buffer.from(
        process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
        'base64'
      ).toString('utf-8');
      const credentials = JSON.parse(credentialsJson);

      console.log('🔐 Vertex AI credentials loaded:', {
        hasClientEmail: !!credentials.client_email,
        hasPrivateKey: !!credentials.private_key,
        project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
        location: process.env.VERTEX_AI_LOCATION || 'us-central1',
      });

      vertexAI = new VertexAI({
        project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
        location: process.env.VERTEX_AI_LOCATION || 'us-central1',
        googleAuthOptions: {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
        },
      });

      console.log('✅ Vertex AI client created successfully');
    } else {
      throw new Error(
        'GOOGLE_APPLICATION_CREDENTIALS_BASE64 environment variable is required'
      );
    }

    console.log(`🤖 Using model: ${model}`);

    // Convert MCP tools to Vertex AI format if provided
    let functionDeclarations: any[] = [];
    if (mcpTools && Object.keys(mcpTools).length > 0) {
      functionDeclarations = convertMCPToolsToVertexAI(mcpTools);
      console.log(
        '🛠️ Tools enabled with',
        functionDeclarations.length,
        'functions'
      );
    } else {
      console.log('🚫 Tools disabled or not provided');
    }

    // Add system message to encourage tool usage when tools are available
    let enhancedMessages = modelMessages;
    if (
      functionDeclarations.length > 0 &&
      (!toolResults || toolResults.length === 0)
    ) {
      const toolNames = functionDeclarations.map(f => f.name);
      // System prompt to guide behavior
      const systemMessage = {
        role: 'system',
        content: `You are an AI assistant with access to powerful tools for automating desktop workflows and UI interactions. You have access to these tools: ${toolNames.join(', ')}.

**Multi-Step Tool Usage Guidelines:**
- Break complex tasks into logical steps
- Use tools sequentially when needed (e.g., first get applications, then interact with specific windows)
- Always get current UI state before making UI interactions
- For app automation: first get applications → open/focus app → get window tree → perform actions
- For text input: first validate the target element exists and is visible
- Explain your reasoning and next steps clearly

**Examples of Multi-Step Workflows:**
1. "Open Cursor and type text" → get_applications() → open_application() → get_window_tree() → type_into_element()
2. "Take screenshot then analyze UI" → take_screenshot() → get_window_tree() → analyze elements
3. "Find and click button" → get_window_tree() → validate element → click_element()

For screenshot requests, use "desktop" as the selector for full desktop screenshots.`,
      };

      // Add system message at the beginning
      enhancedMessages = [systemMessage, ...modelMessages];
      console.log('💡 Added system message to encourage tool usage');
    }

    console.log('🌊 Creating streaming response...');

    // Determine if this is a tool continuation request
    if (toolResults && toolResults.length > 0) {
      console.log(
        '🔄 Tool continuation request with',
        toolResults.length,
        'results'
      );
    } else {
      console.log('🆕 New conversation request');
    }

    // Create and return streaming response
    return createStreamingResponse(
      vertexAI,
      model,
      enhancedMessages,
      functionDeclarations,
      toolResults, // Pass tool results for continuation
      temperature,
      finalMaxTokens
    );
  } catch (error: any) {
    console.error('\n🚨 === AI CHAT REQUEST FAILED ===');
    console.error('❌ Error type:', error?.constructor?.name || 'Unknown');
    console.error('❌ Error message:', error?.message || String(error));
    console.error('❌ Stack trace:', error?.stack);

    return NextResponse.json(
      {
        error: 'Failed to generate response',
        details: error?.message || String(error),
        errorType: error?.constructor?.name || 'Unknown',
        timestamp: new Date().toISOString(),
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// GET endpoint for health check
export async function GET(request: NextRequest) {
  try {
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        message: 'AI Chat API is running',
        format: 'Direct Vertex AI SDK with MCP Tool Integration',
        availableModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        endpoints: {
          chat: {
            method: 'POST',
            description:
              'Chat with AI using direct Vertex AI SDK with real MCP tool execution',
            parameters: {
              messages:
                'array (required) - Conversation messages in standard format',
              model:
                'string (optional) - Model name, default: gemini-2.5-flash',
              maxTokens: 'number (optional) - Maximum tokens, default: 1000',
              maxOutputTokens: 'number (optional) - Alternative to maxTokens',
              temperature: 'number (optional) - Temperature 0-1, default: 0.7',
              mcpTools: 'object (optional) - MCP tools to convert',
              toolResults:
                'array (optional) - Tool results from frontend MCP execution for continuation',
            },
            flow: {
              initial:
                'Send messages, get streaming response with toolCall events when tools needed',
              continuation:
                'Send same payload plus toolResults array to continue generation with real tool data',
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
    console.error('AI API Error:', error);

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
