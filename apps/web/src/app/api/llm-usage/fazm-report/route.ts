import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fazmUsageIngestSecret = process.env.FAZM_USAGE_INGEST_SECRET;

interface FazmUsageReport {
  firebase_uid: string;
  email?: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  source: string;
}

function buildFazmUserId(firebaseUid: string, email?: string | null): string {
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) {
    return `fazm:${normalizedEmail}`;
  }
  return `fazm_uid:${firebaseUid}`;
}

export async function POST(request: Request) {
  try {
    const sharedSecret = request.headers.get('x-fazm-shared-secret');
    if (!sharedSecret || !fazmUsageIngestSecret || sharedSecret !== fazmUsageIngestSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: FazmUsageReport = await request.json();
    const {
      firebase_uid: firebaseUid,
      email,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      source,
    } = body;

    if (!firebaseUid || !model || !source) {
      return NextResponse.json(
        { error: 'Missing required fields: firebase_uid, model, source' },
        { status: 400 }
      );
    }

    if (
      typeof inputTokens !== 'number' ||
      typeof outputTokens !== 'number' ||
      typeof totalTokens !== 'number'
    ) {
      return NextResponse.json(
        { error: 'input_tokens, output_tokens, and total_tokens must be numbers' },
        { status: 400 }
      );
    }

    if (inputTokens < 0 || outputTokens < 0 || totalTokens < 0) {
      return NextResponse.json(
        { error: 'Token counts must be non-negative' },
        { status: 400 }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[Fazm Usage] Supabase not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const userId = buildFazmUserId(firebaseUid, email);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error: insertError } = await supabase.from('mediar_llm_traces').insert({
      user_id: userId,
      org_id: 'fazm',
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      source,
      session_id: 'fazm-observer',
      stop_reason: totalTokens === 0 ? 'empty_usage' : null,
    });

    if (insertError) {
      console.error('[Fazm Usage] Insert failed:', insertError);
      return NextResponse.json(
        { error: 'Failed to record usage' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      userId,
      totalTokens,
    });
  } catch (error) {
    console.error('[Fazm Usage] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
