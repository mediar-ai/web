import { NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VERTEX_PROJECT = 'mediar-394022';
const VERTEX_LOCATION = 'us-east5'; // Claude models available here

interface LLMTraceRequest {
  userId: string;
  orgId: string;
  model: string;
  source: 'claude_code' | 'vertex_chat' | 'execution_qa' | 'web_ai';
  sessionId?: string;
  turnNumber?: number;
  inputText: string;
  outputText: string;
  toolCalls?: Array<{
    name: string;
    input?: unknown;
    output?: unknown;
    status?: string;
  }>;
  latencyMs?: number;
  stopReason?: string;
  /** Real cost from ACP meta (patched entry) - when provided, skip Vertex token counting */
  costUsd?: number;
  /** Real input tokens from ACP meta */
  inputTokens?: number;
  /** Real output tokens from ACP meta */
  outputTokens?: number;
  /** Bridge mode: 'builtin' or 'personal' */
  claudeCodeMode?: string;
}

// Generate Google OAuth access token for Vertex AI
async function generateVertexAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  let credentials: { client_email: string; private_key: string; token_uri: string };

  if (clientEmail && privateKey) {
    credentials = {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri: 'https://oauth2.googleapis.com/token',
    };
  } else {
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) {
      throw new Error('Missing Google credentials configuration');
    }
    credentials = JSON.parse(Buffer.from(credentialsBase64, 'base64').toString('utf-8'));
    credentials.token_uri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtKey = await importPKCS8(credentials.private_key, 'RS256');

  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.client_email)
    .setSubject(credentials.client_email)
    .setAudience(credentials.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(jwtKey);

  const tokenResponse = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Count tokens using Vertex AI Claude countTokens API
async function countTokens(
  accessToken: string,
  model: string,
  text: string
): Promise<number> {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  // Vertex AI countTokens endpoint for Claude
  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/anthropic/models/count-tokens:rawPredict`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[LLM Trace] countTokens failed: ${response.status} - ${error}`);
    // Fallback to rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  const data = await response.json();
  return data.input_tokens || 0;
}

/**
 * POST /api/llm-usage/trace
 *
 * Records detailed LLM call trace with accurate token counting via Vertex AI.
 * Used by Claude Code and other desktop app LLM features.
 *
 * Request:
 * - Header: Authorization: Bearer <desktop_session_token>
 * - Body: LLMTraceRequest
 */
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // Validate desktop token
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 }
      );
    }

    const desktopToken = authHeader.slice(7);
    const validation = await validateDesktopToken(desktopToken);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid desktop session' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: LLMTraceRequest = await request.json();
    const {
      userId,
      orgId,
      model,
      source,
      sessionId,
      turnNumber,
      inputText,
      outputText,
      toolCalls,
      latencyMs,
      stopReason,
      costUsd: clientCostUsd,
      inputTokens: clientInputTokens,
      outputTokens: clientOutputTokens,
      claudeCodeMode,
    } = body;

    // Validate required fields
    if (!userId || !orgId || !model || !source) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, orgId, model, source' },
        { status: 400 }
      );
    }

    // Security: verify the reporting user matches the authenticated user
    if (userId !== validation.userId) {
      console.warn(
        `[LLM Trace] User mismatch: token=${validation.userId}, reported=${userId}`
      );
      return NextResponse.json(
        { error: 'User ID mismatch' },
        { status: 403 }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[LLM Trace] Supabase not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Use client-provided token counts if available (from ACP meta), otherwise count via Vertex AI
    let inputTokens: number;
    let outputTokens: number;

    if (clientInputTokens != null && clientOutputTokens != null) {
      inputTokens = clientInputTokens;
      outputTokens = clientOutputTokens;
      console.log(`[LLM Trace] Using client token counts - input: ${inputTokens}, output: ${outputTokens}, cost: $${clientCostUsd ?? 'n/a'}`);
    } else if (source === 'claude_code') {
      // Claude Code traces come via ACP, not Vertex - don't attempt Vertex token counting
      inputTokens = 0;
      outputTokens = 0;
      console.log(`[LLM Trace] Claude Code source without client tokens - storing 0 (cost: $${clientCostUsd ?? 'n/a'})`);
    } else {
      console.log(`[LLM Trace] Counting tokens via Vertex for ${source} session=${sessionId} turn=${turnNumber}`);
      const accessToken = await generateVertexAccessToken();
      [inputTokens, outputTokens] = await Promise.all([
        countTokens(accessToken, model, inputText || ''),
        countTokens(accessToken, model, outputText || ''),
      ]);
      console.log(`[LLM Trace] Vertex token counts - input: ${inputTokens}, output: ${outputTokens}`);
    }

    // Insert into mediar_llm_traces with extended fields
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error: insertError } = await supabase.from('mediar_llm_traces').insert({
      user_id: userId,
      org_id: orgId,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      source,
      session_id: sessionId,
      turn_number: turnNumber,
      input_text: inputText,
      output_text: outputText,
      tool_calls: toolCalls ? JSON.stringify(toolCalls) : null,
      latency_ms: latencyMs,
      stop_reason: stopReason,
      cost_usd: clientCostUsd ?? null,
      claude_code_mode: claudeCodeMode ?? null,
    });

    if (insertError) {
      console.error('[LLM Trace] Insert failed:', insertError);
      return NextResponse.json(
        { error: 'Failed to record trace' },
        { status: 500 }
      );
    }

    const processingTime = Date.now() - startTime;
    console.log(`[LLM Trace] Recorded successfully in ${processingTime}ms`);

    return NextResponse.json({
      success: true,
      inputTokens,
      outputTokens,
      costUsd: clientCostUsd ?? null,
      processingTimeMs: processingTime,
    });
  } catch (error) {
    console.error('[LLM Trace] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
