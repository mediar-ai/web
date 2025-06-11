import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Session {
  id: string;
  userId: string;
  type: 'lowLevel' | 'web';
  timestamp: string;
  eventCount: number;
  processed_event_count: number;
  status: 'live' | 'offline';
}

interface UserSessionData {
  name: string | null;
  sessions: Session[];
}

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // Fetch all sessions from the new metadata table
    const { data: sessions, error: sessionsError } = await supabase
      .from('session_metadata')
      .select('*');

    if (sessionsError) {
      console.error('[api/sessions] Error fetching session metadata:', sessionsError);
      return NextResponse.json({ error: sessionsError.message }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({});
    }

    // Process sessions to add status
    const processedSessions: Session[] = sessions.map(session => {
      const lastEventTimestamp = new Date(session.last_event_timestamp).getTime();
      const now = Date.now();
      const isLive = (now - lastEventTimestamp) < 60000; // 60 seconds

      return {
        id: session.session_id,
        userId: session.user_id || 'unknown_user',
        type: session.session_type,
        timestamp: session.last_event_timestamp,
        eventCount: session.event_count,
        processed_event_count: session.processed_event_count || 0,
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