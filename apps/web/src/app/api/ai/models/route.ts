import { NextRequest, NextResponse } from 'next/server';
import { getCorsHeaders } from '@/lib/cors';

// OPTIONS (CORS)
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

// GET handler for OpenAI-compatible models endpoint
export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  
  try {
    // Check authorization
    const authHeader = request.headers.get('authorization');
    const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';
    
    if (authHeader) {
      // Require proper desktop authentication or clerk auth (not implemented here yet)
      // For now, just logging invalid attempts if they try to use the old password
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
      if (token === API_PASSWORD) {
        return NextResponse.json(
          { error: { message: 'API Password authentication is deprecated', type: 'invalid_request_error', code: 'deprecated_auth' }},
          { status: 401, headers: corsHeaders }
        );
      }
    }
    
    // Return OpenAI-compatible models list
    const models = {
      object: 'list',
      data: [
        {
          id: 'gpt-4',
          object: 'model',
          created: Date.now(),
          owned_by: 'openai',
          permission: [],
          root: 'gpt-4',
          parent: null,
        },
        {
          id: 'gpt-4-turbo',
          object: 'model',
          created: Date.now(),
          owned_by: 'openai',
          permission: [],
          root: 'gpt-4-turbo',
          parent: null,
        },
        {
          id: 'gpt-5-high-fast',
          object: 'model',
          created: Date.now(),
          owned_by: 'openai',
          permission: [],
          root: 'gpt-5-high-fast',
          parent: null,
        },
        {
          id: 'gpt-5',
          object: 'model',
          created: Date.now(),
          owned_by: 'openai',
          permission: [],
          root: 'gpt-5',
          parent: null,
        },
        {
          id: 'gpt-3.5-turbo',
          object: 'model',
          created: Date.now(),
          owned_by: 'openai',
          permission: [],
          root: 'gpt-3.5-turbo',
          parent: null,
        },
      ],
    };

    return NextResponse.json(models, { headers: corsHeaders });
  } catch (error: any) {
    console.error('🚨 Models endpoint error:', error);
    return NextResponse.json(
      {
        error: {
          message: error.message || 'Failed to retrieve models',
          type: 'server_error',
          code: 500,
        },
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
