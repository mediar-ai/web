import { NextRequest } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { mastra } from '@/lib/mastra';

const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

async function authenticate(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    try {
      const validation = await validateDesktopToken(token);
      if (validation.valid) return true;
    } catch (error) {
      console.error('[AGENT-STREAM] Desktop token validation error:', error);
    }
  }

  return false;
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    if (!(await authenticate(request))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { messages, clientTools } = body;

    console.log('[AGENT-STREAM] Request:', { messagesCount: messages?.length, hasClientTools: !!clientTools });

    const agent = mastra.getAgent('workflowAgent');

    // Stream response with clientTools if provided
    const result = await agent.stream(messages, {
      format: 'aisdk', // Use AI SDK v5 compatible format
      clientTools: clientTools || undefined, // Pass MCP tools from client
    });

    // Return Mastra's AI SDK v5 compatible stream
    const response = result.toUIMessageStreamResponse();

    // Add CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[AGENT-STREAM] Error:', err?.message);
    return new Response(
      JSON.stringify({ error: 'Failed to stream', details: err?.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}
