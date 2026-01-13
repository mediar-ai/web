import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// Simple in-memory cache
interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 55 * 1000; // 55 seconds (matches other admin APIs)

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

interface WeeklyData {
  week: string;
  weekLabel: string;
  count: number;
  change: number | null;
}

export async function GET() {
  const startTime = Date.now();
  console.log('[user-consumption-weekly] API route called');

  // Auth check
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await currentUser();
  const isMediarAdmin = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;
  const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

  if (!isMediarAdmin && !isMediarOrg) {
    return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
  }

  // Check cache first
  const cacheKey = 'user-consumption-weekly-data';
  const cached = getCached<{ weeks: WeeklyData[] }>(cacheKey);

  if (cached) {
    console.log(`[user-consumption-weekly] Returning cached data (${Date.now() - startTime}ms)`);
    return NextResponse.json({
      ...cached,
      timestamp: new Date().toISOString(),
      cached: true,
    });
  }

  try {
    const supabase = createServerClient();

    // Get today's date for rolling periods
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    console.log('[user-consumption-weekly] Fetching rolling 7-day periods from:', today);

    // Emails to exclude from stats (internal users)
    const excludedEmails = [
      'matt@mediar.ai',
      'louis@mediar.ai',
      'redacted@example.com',
      'redacted@example.com'
    ];

    // Call the RPC function for rolling 7-day periods
    const { data, error } = await supabase.rpc('get_rolling_weekly_chat_counts', {
      reference_date: today,
      num_periods: 12,
      excluded_emails: excludedEmails
    });

    if (error) {
      console.error('[user-consumption-weekly] RPC error:', error);
      throw new Error(error.message);
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Transform the data
    const weeks: WeeklyData[] = (data || []).map((row: { period_start: string; period_end: string; count: number }, index: number, arr: { period_start: string; period_end: string; count: number }[]) => {
      const periodStart = new Date(row.period_start);
      const periodEnd = new Date(row.period_end);

      // Format as "Mon D - Mon D" (e.g., "Jan 7 - Jan 13")
      const startLabel = `${monthNames[periodStart.getUTCMonth()]} ${periodStart.getUTCDate()}`;
      const endLabel = `${monthNames[periodEnd.getUTCMonth()]} ${periodEnd.getUTCDate()}`;
      const weekLabel = `${startLabel} - ${endLabel}`;

      // Calculate period-over-period change
      const prevCount = index > 0 ? arr[index - 1].count : null;
      const change = prevCount !== null && prevCount > 0
        ? Math.round(((row.count - prevCount) / prevCount) * 100)
        : null;

      return {
        week: row.period_start,
        weekLabel,
        count: row.count,
        change,
      };
    });

    const result = { weeks };
    setCache(cacheKey, result);

    console.log(`[user-consumption-weekly] Total time: ${Date.now() - startTime}ms, weeks: ${weeks.length}`);

    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
      cached: false,
    });
  } catch (error) {
    console.error('[user-consumption-weekly] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
