import { NextRequest, NextResponse } from 'next/server';
import { createVertex } from '@ai-sdk/google-vertex';
import { generateText, streamText } from 'ai';

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

// OPTIONS endpoint for CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// POST endpoint for text generation
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
      systemPrompt
    } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Configure Vertex AI using your existing base64 credentials (no file needed!)
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
    
    // Prepare messages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    
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

    // Handle streaming response
    if (stream) {
      const result = streamText({
        model: vertexModel,
        messages,
        maxTokens,
        temperature
      });

      // Convert to streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.textStream) {
              const data = encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`);
              controller.enqueue(data);
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            controller.error(error);
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
    const result = await generateText({
      model: vertexModel,
      messages,
      maxTokens,
      temperature
    });

    return NextResponse.json({
      text: result.text,
      usage: result.usage,
      model: model
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
          description: 'Generate text using AI',
          parameters: {
            prompt: 'string (required) - The input prompt',
            model: 'string (optional) - Model name, default: gemini-1.5-pro',
            stream: 'boolean (optional) - Enable streaming response, default: false',
            maxTokens: 'number (optional) - Maximum tokens to generate, default: 1000',
            temperature: 'number (optional) - Creativity level 0-1, default: 0.7',
            systemPrompt: 'string (optional) - System prompt for the AI'
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