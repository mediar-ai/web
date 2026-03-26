import { NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * GET /api/llm-usage/cumulative-cost
 *
 * Returns lifetime cumulative cost for builtin Claude Code usage.
 * Used by desktop app to seed the cost tracker on startup.
 */
export async function GET(request: Request) {
  try {
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

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[cumulative-cost] Supabase not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query lifetime cumulative cost for builtin mode
    const { data, error } = await supabase.rpc('get_cumulative_cost', {
      p_user_id: validation.userId,
    });

    if (error) {
      // Fallback: direct query if RPC doesn't exist yet
      console.warn('[cumulative-cost] RPC failed, using direct query:', error.message);
      const { data: rows, error: queryError } = await supabase
        .from('mediar_llm_traces')
        .select('cost_usd')
        .eq('user_id', validation.userId)
        .eq('source', 'claude_code')
        .eq('claude_code_mode', 'builtin')
        .not('cost_usd', 'is', null);

      if (queryError) {
        console.error('[cumulative-cost] Query failed:', queryError);
        return NextResponse.json({ costUsd: 0 });
      }

      const totalCost = (rows || []).reduce(
        (sum: number, row: { cost_usd: number | null }) => sum + (row.cost_usd || 0),
        0
      );

      console.log(`[cumulative-cost] user=${validation.userId} costUsd=${totalCost.toFixed(4)}`);
      return NextResponse.json({ costUsd: totalCost });
    }

    const costUsd = typeof data === 'number' ? data : 0;
    console.log(`[cumulative-cost] user=${validation.userId} costUsd=${costUsd.toFixed(4)}`);
    return NextResponse.json({ costUsd });
  } catch (error) {
    console.error('[cumulative-cost] Error:', error);
    return NextResponse.json({ costUsd: 0 });
  }
}
