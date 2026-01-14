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
const CACHE_TTL_MS = 55 * 1000; // 55 seconds (slightly less than 60s refresh interval)

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

export async function GET() {
  const startTime = Date.now();
  console.log('[user-consumption] API route called');

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
  const cacheKey = 'user-consumption-data';
  const cached = getCached<{
    users: Array<{
      id: string;
      email: string;
      chat3d: number;
      chat3m: number;
      events3d: number;
      events3m: number;
    }>;
    totals: {
      chat3d: number;
      chat3m: number;
      events3d: number;
      events3m: number;
    };
  }>(cacheKey);

  if (cached) {
    console.log(`[user-consumption] Returning cached data (${Date.now() - startTime}ms)`);
    return NextResponse.json({
      ...cached,
      timestamp: new Date().toISOString(),
      cached: true,
    });
  }

  try {
    const supabase = createServerClient();
    const now = new Date();

    // Calculate date ranges
    const threeDaysAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3, 0, 0, 0));
    const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate(), 0, 0, 0));

    console.log('[user-consumption] Date ranges:', {
      threeDaysAgo: threeDaysAgo.toISOString(),
      threeMonthsAgo: threeMonthsAgo.toISOString(),
    });

    // Run ALL queries in parallel for maximum performance
    const [
      sessionsResult,
      chat3mResult,
      chat3dResult,
      events3mResult,
      events3dResult,
    ] = await Promise.all([
      // Get all user emails from desktop sessions
      supabase
        .from('mediar_desktop_sessions')
        .select('clerk_user_id, email')
        .not('email', 'is', null),

      // Get chat message counts for 3 months using RPC
      supabase.rpc('get_chat_message_counts_by_user', {
        start_date: threeMonthsAgo.toISOString()
      }),

      // Get chat message counts for 3 days using RPC
      supabase.rpc('get_chat_message_counts_by_user', {
        start_date: threeDaysAgo.toISOString()
      }),

      // Get event counts for 3 months using RPC
      supabase.rpc('get_event_counts_by_user', {
        start_date: threeMonthsAgo.toISOString()
      }),

      // Get event counts for 3 days using RPC
      supabase.rpc('get_event_counts_by_user', {
        start_date: threeDaysAgo.toISOString()
      }),
    ]);

    console.log(`[user-consumption] All queries completed in ${Date.now() - startTime}ms`);

    // Log any errors
    if (sessionsResult.error) {
      console.error('[user-consumption] Sessions query error:', sessionsResult.error);
    }
    if (chat3mResult.error) {
      console.error('[user-consumption] Chat 3m RPC error:', chat3mResult.error);
    }
    if (chat3dResult.error) {
      console.error('[user-consumption] Chat 3d RPC error:', chat3dResult.error);
    }
    if (events3mResult.error) {
      console.error('[user-consumption] Events 3m RPC error:', events3mResult.error);
    }
    if (events3dResult.error) {
      console.error('[user-consumption] Events 3d RPC error:', events3dResult.error);
    }

    // Build email lookup (deduplicate by user_id)
    const emailMap = new Map<string, string>();
    for (const s of sessionsResult.data || []) {
      if (s.email && !emailMap.has(s.clerk_user_id)) {
        emailMap.set(s.clerk_user_id, s.email);
      }
    }

    // Build maps from RPC results
    const chat3mMap = new Map<string, number>();
    const chat3dMap = new Map<string, number>();
    const events3mMap = new Map<string, number>();
    const events3dMap = new Map<string, number>();

    for (const row of chat3mResult.data || []) {
      chat3mMap.set(row.user_id, Number(row.count) || 0);
    }
    for (const row of chat3dResult.data || []) {
      chat3dMap.set(row.user_id, Number(row.count) || 0);
    }
    for (const row of events3mResult.data || []) {
      events3mMap.set(row.user_id, Number(row.count) || 0);
    }
    for (const row of events3dResult.data || []) {
      events3dMap.set(row.user_id, Number(row.count) || 0);
    }

    console.log('[user-consumption] Data aggregated:', {
      chatUsers3m: chat3mMap.size,
      chatUsers3d: chat3dMap.size,
      eventUsers3m: events3mMap.size,
      eventUsers3d: events3dMap.size,
    });

    // Emails to exclude from stats (internal users)
    const excludedEmails = new Set([
      'matt@mediar.ai',
      'louis@mediar.ai',
      'task@benchflow.ai',
      'adrian.z.mei@gmail.com'
    ]);

    // Combine all users from all sources
    const allUserIds = new Set<string>([
      ...chat3dMap.keys(),
      ...chat3mMap.keys(),
      ...events3dMap.keys(),
      ...events3mMap.keys(),
    ]);

    // Build users array (excluding internal users)
    const users = Array.from(allUserIds)
      .filter(userId => {
        const email = emailMap.get(userId);
        return !email || !excludedEmails.has(email.toLowerCase());
      })
      .map(userId => ({
        id: userId,
        email: emailMap.get(userId) || userId.slice(0, 8) + '...',
        chat3d: chat3dMap.get(userId) || 0,
        chat3m: chat3mMap.get(userId) || 0,
        events3d: events3dMap.get(userId) || 0,
        events3m: events3mMap.get(userId) || 0,
      }));

    // Sort by total activity (3 month chat + events) descending
    users.sort((a, b) => (b.chat3m + b.events3m) - (a.chat3m + a.events3m));

    // Calculate totals (from filtered users only)
    const totals = {
      chat3d: users.reduce((sum, u) => sum + u.chat3d, 0),
      chat3m: users.reduce((sum, u) => sum + u.chat3m, 0),
      events3d: users.reduce((sum, u) => sum + u.events3d, 0),
      events3m: users.reduce((sum, u) => sum + u.events3m, 0),
    };

    // Cache the result
    const result = { users, totals };
    setCache(cacheKey, result);

    console.log(`[user-consumption] Total time: ${Date.now() - startTime}ms`);

    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
      cached: false,
    });
  } catch (error) {
    console.error('[user-consumption] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
