import { createVertex } from '@ai-sdk/google-vertex';
import { CoreMessage, generateText, streamText } from 'ai';
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
    const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [, password] = credentials.split(':');
    return password === API_PASSWORD;
  }

  return false;
}

// Helper function to process tools received from Tauri app
function processMCPTools(toolsFromTauri?: Record<string, unknown>) {
  if (!toolsFromTauri || Object.keys(toolsFromTauri).length === 0) {
    return {};
  }

  console.log('MCP Tools received from Tauri app:', Object.keys(toolsFromTauri));
  
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
      prompt, 
      model = 'gemini-2.5-pro', 
      stream = false,
      maxTokens = 1000,
      temperature = 0.7,
      systemPrompt,
      mcpTools, // New: MCP tools from Tauri app (already in AI SDK format)
      enableTools = false // New: whether to enable MCP tools
    } = body;

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
      const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf-8');
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
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS_BASE64 environment variable is required');
    }
    
    const vertexModel = vertex(model);
    
    // Get MCP tools if enabled and tools provided from Tauri app
    let tools = {};
    if (enableTools && mcpTools) {
      tools = processMCPTools(mcpTools);
    }
    
    // Prepare messages
    const messages: CoreMessage[] = [];
    
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }
    
    messages.push({
      role: 'user',
      content: prompt
    });

    // Common AI SDK options
    const aiOptions = {
      model: vertexModel,
      messages,
      maxTokens,
      temperature,
      ...(Object.keys(tools).length > 0 && { tools }) // Only add tools if we have them
    };

    // Handle streaming response
    if (stream) {
      const result = streamText(aiOptions);

      // Convert to streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.textStream) {
              const data = encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`);
              controller.enqueue(data);
            }
            
            // Send tool calls if any
            try {
              // Wait for completion - tool calls in streaming are handled differently in AI SDK v5
              await result.text;
              // Note: Tool calls in streaming are handled differently in AI SDK v5
              // They're included in the stream automatically
            } catch (toolError) {
              console.error('Tool execution error:', toolError);
            }
            
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            controller.error(error);
          } finally {
            // No cleanup needed - tools came from Tauri app
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...corsHeaders,
        },
      });
    }

    // Handle non-streaming response
    const result = await generateText(aiOptions);

    return NextResponse.json({
      text: result.text,
      usage: result.usage,
      model: model,
      toolCalls: result.toolCalls || [],
      toolResults: result.toolResults || [],
      mcpToolsUsed: Object.keys(tools).length > 0 ? Object.keys(tools) : undefined
    }, { headers: corsHeaders });

  } catch (error: unknown) {
    console.error('AI API Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to generate response',
        details: error instanceof Error ? error.message : 'Unknown error'
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

    return NextResponse.json({
      status: 'ok',
      message: 'AI API is running',
      availableModels: [
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-2.0-flash-001',
        'gemini-2.0-flash-exp'
      ],
      endpoints: {
        generate: {
          method: 'POST',
          description: 'Generate text using AI with optional MCP tools',
          parameters: {
            prompt: 'string (required) - The input prompt',
            model: 'string (optional) - Model name, default: gemini-2.5-pro',
            stream: 'boolean (optional) - Enable streaming response, default: false',
            maxTokens: 'number (optional) - Maximum tokens to generate, default: 1000',
            temperature: 'number (optional) - Creativity level 0-1, default: 0.7',
            systemPrompt: 'string (optional) - System prompt for the AI',
            enableTools: 'boolean (optional) - Enable MCP tools, default: false',
            mcpTools: 'object (optional) - MCP tools from Tauri app in AI SDK format'
          }
        }
      },
      authentication: {
        method: 'Bearer token or Basic auth',
        note: 'Include Authorization header with your API password'
      }
    }, { headers: corsHeaders });

  } catch (error: unknown) {
    console.error('AI API Health Check Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Health check failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500, headers: corsHeaders }
    );
  }
}