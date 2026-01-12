import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
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

    // Get all user emails from desktop sessions
    const { data: sessions, error: sessionsError } = await supabase
      .from('mediar_desktop_sessions')
      .select('clerk_user_id, email')
      .not('email', 'is', null);

    if (sessionsError) {
      console.error('[user-consumption] Sessions query error:', sessionsError);
    }

    // Build email lookup (deduplicate by user_id)
    const emailMap = new Map<string, string>();
    for (const s of sessions || []) {
      if (s.email && !emailMap.has(s.clerk_user_id)) {
        emailMap.set(s.clerk_user_id, s.email);
      }
    }

    // Get chat sessions for last 3 months
    const { data: chatSessions3m, error: chat3mError } = await supabase
      .from('workflow_chat_sessions')
      .select('user_id, messages, created_at')
      .gte('created_at', threeMonthsAgo.toISOString());

    if (chat3mError) {
      console.error('[user-consumption] Chat sessions 3m query error:', chat3mError);
    }

    // Aggregate chat messages by user for 3 days and 3 months
    const chat3dMap = new Map<string, number>();
    const chat3mMap = new Map<string, number>();

    for (const session of chatSessions3m || []) {
      if (session.user_id && Array.isArray(session.messages)) {
        const userMsgCount = session.messages.filter(
          (m: { role?: string }) => m.role === 'user'
        ).length;

        const sessionDate = new Date(session.created_at);

        // Always add to 3 month total
        chat3mMap.set(
          session.user_id,
          (chat3mMap.get(session.user_id) || 0) + userMsgCount
        );

        // Add to 3 day total if within range
        if (sessionDate >= threeDaysAgo) {
          chat3dMap.set(
            session.user_id,
            (chat3dMap.get(session.user_id) || 0) + userMsgCount
          );
        }
      }
    }

    console.log('[user-consumption] Chat aggregated:', {
      users3d: chat3dMap.size,
      users3m: chat3mMap.size,
    });

    // Get events for last 3 months using pagination
    const events3dMap = new Map<string, number>();
    const events3mMap = new Map<string, number>();

    // Try RPC first for efficiency
    const { data: eventCounts3m, error: events3mError } = await supabase
      .rpc('get_event_counts_by_user', { start_date: threeMonthsAgo.toISOString() });

    if (events3mError) {
      console.error('[user-consumption] Events 3m RPC error:', events3mError);
      // Fallback: manual count with pagination
      let offset = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: events, error: fallbackError } = await supabase
          .from('low_level_events')
          .select('user_id, created_at')
          .gte('created_at', threeMonthsAgo.toISOString())
          .range(offset, offset + pageSize - 1);

        if (fallbackError) {
          console.error('[user-consumption] Events fallback error:', fallbackError);
          break;
        }

        if (events && events.length > 0) {
          for (const event of events) {
            if (event.user_id) {
              events3mMap.set(event.user_id, (events3mMap.get(event.user_id) || 0) + 1);

              const eventDate = new Date(event.created_at);
              if (eventDate >= threeDaysAgo) {
                events3dMap.set(event.user_id, (events3dMap.get(event.user_id) || 0) + 1);
              }
            }
          }
          offset += events.length;
          hasMore = events.length === pageSize;
        } else {
          hasMore = false;
        }
      }
    } else if (eventCounts3m) {
      // RPC succeeded - but we need to also get 3 day counts
      for (const row of eventCounts3m) {
        events3mMap.set(row.user_id, row.count);
      }

      // Get 3 day counts separately
      const { data: eventCounts3d, error: events3dError } = await supabase
        .rpc('get_event_counts_by_user', { start_date: threeDaysAgo.toISOString() });

      if (!events3dError && eventCounts3d) {
        for (const row of eventCounts3d) {
          events3dMap.set(row.user_id, row.count);
        }
      }
    }

    console.log('[user-consumption] Events aggregated:', {
      users3d: events3dMap.size,
      users3m: events3mMap.size,
    });

    // Combine all users from all sources
    const allUserIds = new Set<string>([
      ...chat3dMap.keys(),
      ...chat3mMap.keys(),
      ...events3dMap.keys(),
      ...events3mMap.keys(),
    ]);

    // Build users array
    const users = Array.from(allUserIds).map(userId => ({
      id: userId,
      email: emailMap.get(userId) || userId.slice(0, 8) + '...',
      chat3d: chat3dMap.get(userId) || 0,
      chat3m: chat3mMap.get(userId) || 0,
      events3d: events3dMap.get(userId) || 0,
      events3m: events3mMap.get(userId) || 0,
    }));

    // Sort by total activity (3 month chat + events) descending
    users.sort((a, b) => (b.chat3m + b.events3m) - (a.chat3m + a.events3m));

    // Calculate totals
    const totals = {
      chat3d: Array.from(chat3dMap.values()).reduce((sum, v) => sum + v, 0),
      chat3m: Array.from(chat3mMap.values()).reduce((sum, v) => sum + v, 0),
      events3d: Array.from(events3dMap.values()).reduce((sum, v) => sum + v, 0),
      events3m: Array.from(events3mMap.values()).reduce((sum, v) => sum + v, 0),
    };

    return NextResponse.json({
      users,
      totals,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[user-consumption] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
