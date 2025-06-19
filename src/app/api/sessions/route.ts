import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Session {
  id: string;
  userId: string;
  type: string;
  timestamp: string;
  eventCount: number;
  processed_event_count: number;
  status: 'live' | 'offline';
  duration_seconds?: number;
}

interface UserSessionData {
  name: string | null;
  sessions: Session[];
  totalUiTreeEvents: number;
}

export const revalidate = 0;

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const { data: sessions, error: sessionsError } = await supabase
      .from('session_metadata')
      .select('*');

    if (sessionsError) {
      return NextResponse.json({ error: sessionsError.message }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({});
    }

    const processedSessions: Session[] = sessions.map(session => {
      const lastEventTimestamp = new Date(session.last_event_timestamp).getTime();
      const now = Date.now();
      const isLive = (now - lastEventTimestamp) < 60000;

      return {
        id: session.session_id,
        userId: session.user_id || 'unknown_user',
        type: session.session_type,
        timestamp: session.last_event_timestamp,
        eventCount: session.event_count,
        processed_event_count: session.processed_event_count || 0,
        duration_seconds: session.duration_seconds,
        status: isLive ? 'live' : 'offline',
      };
    });
    
    const userIds = [...new Set(processedSessions.map(s => s.userId).filter(id => id !== 'unknown_user'))];
    
    const { data: users, error: usersError } = await supabase
      .from('mediar_users')
      .select('user_id, name')
      .in('user_id', userIds);

    if (usersError) {
      console.error('[api/sessions] Error fetching users:', usersError);
    }

    const { data: uiTreeCounts, error: uiTreeCountsError } = await supabase
      .rpc('get_user_ui_tree_counts', { user_ids_array: userIds });

    if (uiTreeCountsError) {
      console.error('[api/sessions] Error fetching ui_tree_counts:', uiTreeCountsError);
    }
    
    const uiTreeCountsMap = new Map<string, number>();
    if (uiTreeCounts) {
      for (const count of uiTreeCounts) {
        uiTreeCountsMap.set(count.user_id, count.ui_tree_count);
      }
    }
    
    const usersMap = new Map<string, string | null>();
    for (const user of users || []) {
      usersMap.set(user.user_id, user.name);
    }

    const userSessions: Record<string, UserSessionData> = {};
    for (const session of processedSessions) {
      if (!userSessions[session.userId]) {
        userSessions[session.userId] = {
          name: usersMap.get(session.userId) || null,
          sessions: [],
          totalUiTreeEvents: uiTreeCountsMap.get(session.userId) || 0,
        };
      }
      userSessions[session.userId].sessions.push(session);
    }
    
    return NextResponse.json(userSessions, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
} 