import { NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface LLMUsageReport {
  userId: string;
  orgId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * POST /api/llm-usage/report
 *
 * Reports LLM token usage from desktop app (or other external clients)
 * Inserts into mediar_llm_traces table for billing reconciliation
 *
 * Request:
 * - Header: Authorization: Bearer <desktop_session_token>
 * - Body: { userId, orgId, model, inputTokens, outputTokens }
 */
export async function POST(request: Request) {
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
    const body: LLMUsageReport = await request.json();
    const { userId, orgId, model, inputTokens, outputTokens } = body;

    // Validate required fields
    if (!userId || !orgId || !model) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, orgId, model' },
        { status: 400 }
      );
    }

    // Validate token counts
    if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
      return NextResponse.json(
        { error: 'inputTokens and outputTokens must be numbers' },
        { status: 400 }
      );
    }

    // Security: verify the reporting user matches the authenticated user
    if (userId !== validation.userId) {
      console.warn(
        `[LLM Usage] User mismatch: token=${validation.userId}, reported=${userId}`
      );
      return NextResponse.json(
        { error: 'User ID mismatch' },
        { status: 403 }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[LLM Usage] Supabase not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Insert into mediar_llm_traces
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error: insertError } = await supabase.from('mediar_llm_traces').insert({
      user_id: userId,
      org_id: orgId,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });

    if (insertError) {
      console.error('[LLM Usage] Insert failed:', insertError);
      return NextResponse.json(
        { error: 'Failed to record usage' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LLM Usage] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
