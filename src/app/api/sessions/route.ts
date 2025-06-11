import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Session {
  id: string;
  userId: string;
  type: 'lowLevel' | 'web';
  timestamp: string;
  eventCount: number;
  status: 'live' | 'offline';
}

interface UserSessionData {
  name: string | null;
  sessions: Session[];
}

// I'll assume session_id is in the format `userId-uuid`
const getUserIdFromSessionId = (sessionId: string) => {
  // a bit more robust
  const parts = sessionId.split('-');
  if (parts.length > 1) {
    return parts.slice(0, -1).join('-');
  }
  return sessionId;
};

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // Fetch all events from both tables
    const { data: lowLevelEvents, error: lowLevelError } = await supabase
      .from('low_level_events')
      .select('session_id, created_at');

    if (lowLevelError) {
      console.error('[api/sessions] Error fetching low level event sessions:', lowLevelError);
      return NextResponse.json({ error: lowLevelError.message }, { status: 500 });
    }

    const { data: webRecorderEvents, error: webRecorderError } = await supabase
      .from('user_activity_data')
      .select('session_id, client_timestamp');

    if (webRecorderError) {
      console.error('[api/sessions] Error fetching web recorder sessions:', webRecorderError);
      return NextResponse.json({ error: webRecorderError.message }, { status: 500 });
    }

    const allEvents = [
      ...(lowLevelEvents || []).map(e => ({ ...e, type: 'lowLevel' })),
      ...(webRecorderEvents || []).map(e => ({ ...e, created_at: e.client_timestamp, type: 'web' })),
    ];

    if (allEvents.length === 0) {
      return NextResponse.json({});
    }

    // Group events by session_id
    const sessionsMap = new Map<string, { type: 'lowLevel' | 'web'; events: { created_at: string }[] }>();
    for (const event of allEvents) {
      if (!sessionsMap.has(event.session_id)) {
        sessionsMap.set(event.session_id, { type: event.type as 'lowLevel' | 'web', events: [] });
      }
      sessionsMap.get(event.session_id)!.events.push({ created_at: event.created_at });
    }

    // Process sessions to get required data
    const processedSessions: Session[] = Array.from(sessionsMap.entries()).map(([sessionId, data]) => {
      const sortedEvents = data.events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const lastEventTimestamp = new Date(sortedEvents[0].created_at).getTime();
      const firstEventTimestamp = new Date(sortedEvents[sortedEvents.length - 1].created_at).getTime();
      const now = Date.now();
      const isLive = (now - lastEventTimestamp) < 60000; // 60 seconds

      return {
        id: sessionId,
        userId: getUserIdFromSessionId(sessionId),
        type: data.type,
        timestamp: new Date(firstEventTimestamp).toISOString(),
        eventCount: data.events.length,
        status: isLive ? 'live' : 'offline',
      };
    });

    // Get all unique user IDs
    const userIds = [...new Set(processedSessions.map(s => s.userId))];

    // Fetch user names
    const { data: users, error: usersError } = await supabase
      .from('mediar_users')
      .select('user_id, name')
      .in('user_id', userIds);

    if (usersError) {
      console.error('[api/sessions] Error fetching users:', usersError);
      // Not fatal, we can proceed without names
    }

    const usersMap = new Map<string, string | null>();
    for (const user of users || []) {
      usersMap.set(user.user_id, user.name);
    }

    // Group sessions by user
    const userSessions: Record<string, UserSessionData> = {};
    for (const session of processedSessions) {
      if (!userSessions[session.userId]) {
        userSessions[session.userId] = {
          name: usersMap.get(session.userId) || null,
          sessions: [],
        };
      }
      userSessions[session.userId].sessions.push(session);
    }

    return NextResponse.json(userSessions);
  } catch (err) {
    console.error('[api/sessions] Failed to get sessions:', err);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
} 