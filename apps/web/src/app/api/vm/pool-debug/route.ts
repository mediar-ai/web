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
 * Simulate the FULL pool claim flow including what claimFromWarmPool does
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
    deploymentVersion: 'v5-full-claim-simulation',
    step1_parsing: { isTrial, bodyIsTrial: body.isTrial, typeofBodyIsTrial: typeof body.isTrial },
  };

  if (!isTrial) {
    result.outcome = 'SKIP: isTrial is false';
    return NextResponse.json(result);
  }

  result.step2_enterTrialBlock = true;

  // Simulate claimFromWarmPool EXACTLY as it's done in provision route
  try {
    // Step 3: Count available (same as claimFromWarmPool)
    const { count: availableCount, error: countErr } = await supabase
      .from('remote_machines')
      .select('id', { count: 'exact', head: true })
      .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
      .eq('status', 'inactive');

    result.step3_count = { availableCount, error: countErr?.message };

    // Step 4: Query with .single() (same as claimFromWarmPool)
    const { data: poolVm, error: queryErr } = await supabase
      .from('remote_machines')
      .select('id, name, tags, mcp_endpoint')
      .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
      .eq('status', 'inactive')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    result.step4_query = {
      poolVm: poolVm ? { id: poolVm.id, name: poolVm.name, hasMcpEndpoint: !!poolVm.mcp_endpoint } : null,
      error: queryErr ? { code: queryErr.code, message: queryErr.message } : null,
    };

    if (queryErr) {
      result.outcome = `FALLBACK: Query error ${queryErr.code}`;
      return NextResponse.json(result);
    }

    if (!poolVm) {
      result.outcome = 'FALLBACK: No pool VM found';
      return NextResponse.json(result);
    }

    // Step 5: Simulate the update (but don't actually do it)
    result.step5_wouldUpdate = {
      vmId: poolVm.id,
      currentTags: poolVm.tags,
      wouldSetStatus: 'claiming',
    };

    result.outcome = 'SUCCESS: Would claim pool VM ' + poolVm.id;
  } catch (err) {
    result.exception = err instanceof Error ? { message: err.message, stack: err.stack } : String(err);
    result.outcome = 'FALLBACK: Exception thrown';
  }

  return NextResponse.json(result);
}
