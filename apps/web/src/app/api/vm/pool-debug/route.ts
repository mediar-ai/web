import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { WARM_POOL_CONFIG } from '@/lib/config/warm-pool';

/**
 * DEBUG endpoint to test warm pool query
 * GET /api/vm/pool-debug
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing env vars' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Test 1: Count available pool VMs
  const { count: availableCount, error: countError } = await supabase
    .from('remote_machines')
    .select('id', { count: 'exact', head: true })
    .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
    .eq('status', 'inactive');

  // Test 2: Get pool VM with .single()
  const { data: poolVm, error: queryError } = await supabase
    .from('remote_machines')
    .select('id, name, tags, mcp_endpoint, status')
    .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
    .eq('status', 'inactive')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  return NextResponse.json({
    config: {
      poolWarm: WARM_POOL_CONFIG.tags.poolWarm,
      poolStatusAvailable: WARM_POOL_CONFIG.tags.poolStatusAvailable,
    },
    countQuery: {
      availableCount,
      error: countError ? { code: countError.code, message: countError.message } : null,
    },
    singleQuery: {
      poolVm: poolVm ? { id: poolVm.id, name: poolVm.name, status: poolVm.status } : null,
      error: queryError ? { code: queryError.code, message: queryError.message } : null,
    },
  });
}

/**
 * POST /api/vm/pool-debug
 * Simulate the full pool claim flow without actually claiming
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing env vars' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const isTrial = body.isTrial === true;

  const result: Record<string, unknown> = {
    step1_parsing: {
      'body.isTrial': body.isTrial,
      'typeof body.isTrial': typeof body.isTrial,
      isTrial,
    },
    deploymentVersion: 'v3-full-simulation',
  };

  if (!isTrial) {
    result.outcome = 'SKIP: isTrial is false, would not attempt pool claim';
    return NextResponse.json(result);
  }

  result.step2_wouldEnterTrialBlock = true;

  // Simulate the pool query
  try {
    const { count: availableCount } = await supabase
      .from('remote_machines')
      .select('id', { count: 'exact', head: true })
      .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
      .eq('status', 'inactive');

    result.step3_poolCount = availableCount;

    const { data: poolVm, error } = await supabase
      .from('remote_machines')
      .select('id, name, tags, mcp_endpoint, status')
      .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
      .eq('status', 'inactive')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error) {
      result.step4_queryError = { code: error.code, message: error.message };
      result.outcome = 'WOULD FALLBACK: Query returned error';
    } else if (!poolVm) {
      result.step4_poolVm = null;
      result.outcome = 'WOULD FALLBACK: No pool VM found';
    } else {
      result.step4_poolVm = { id: poolVm.id, name: poolVm.name, status: poolVm.status };
      result.outcome = 'WOULD CLAIM: Pool VM found and would be claimed';
    }
  } catch (err) {
    result.step3_exception = err instanceof Error ? err.message : String(err);
    result.outcome = 'WOULD FALLBACK: Exception thrown';
  }

  return NextResponse.json(result);
}
