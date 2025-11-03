/**
 * Test endpoint for Anthropic Claude AI
 * Completely separate from main /api/ai to test safely
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleAnthropicChat } from '../ai/providers/anthropic';
import { getCorsHeaders } from '@/lib/cors';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

// Auth
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

async function authenticate(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // Check if it's the API password
    if (token === API_PASSWORD) {
      console.log('[AI-ANTHROPIC] Authenticated with API password');
      return true;
    }

    // Try to validate as desktop token
    try {
      const validation = await validateDesktopToken(token);
      if (validation.valid) {
        console.log(`[AI-ANTHROPIC] Authenticated with desktop token for user: ${validation.email}`);
        return true;
      }
    } catch (error) {
      console.error('[AI-ANTHROPIC] Desktop token validation error:', error);
    }

    return false;
  }

  return false;
}

// OPTIONS (CORS)
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

// POST - Test Anthropic integration
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    // Authenticate
    if (!(await authenticate(request))) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();

    // Log request details
    console.log('[AI-ANTHROPIC] Request:', {
      model: body.model || 'claude-sonnet-4-5-20250929',
      inputLength: body.input?.length || 0,
      historyLength: body.history?.length || 0,
      toolsCount: body.tools?.length || 0,
      toolResultsCount: body.toolResults?.length || 0,
      hasSystem: !!body.system,
    });

    // Check if Anthropic API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Server misconfiguration: ANTHROPIC_API_KEY not set' },
        { status: 500, headers: corsHeaders }
      );
    }

    // Call Anthropic provider
    const result = await handleAnthropicChat({
      model: body.model || 'claude-sonnet-4-5-20250929',
      input: body.input,
      history: body.history || [],
      system: body.system,
      tools: body.tools,
      toolResults: body.toolResults,
      generationConfig: body.generationConfig,
      sessionId: body.sessionId, // Not used yet in test endpoint
    });

    // Log response details
    console.log('[AI-ANTHROPIC] Response:', {
      textLength: result.text?.length || 0,
      toolCallsCount: result.toolCalls?.length || 0,
      finishReason: result.finishReason,
      elapsedMs: result.metrics?.elapsedMs,
      tokens: result.metrics?.tokens,
    });

    // Return response in same format as main /api/ai
    return NextResponse.json(
      {
        model: body.model || 'claude-sonnet-4-5-20250929',
        sessionId: body.sessionId || 'test-session',
        text: result.text,
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        metrics: result.metrics,
      },
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('[AI-ANTHROPIC] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}