import { NextResponse } from 'next/server';
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
