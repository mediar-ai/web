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
  total_ui_steps: number;
  total_workflow_analyses: number;
  distinct_workflows_created: number;
  human_labeled_steps: number;
  llm_labeled_steps: number;
  human_annotated_steps: number;
  status: 'live' | 'offline';
  duration_seconds?: number;
}

interface UserSessionData {
  name: string | null;
  sessions: Session[];
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

    // Get annotation counts for each session
    const { data: annotationData, error: annotationError } = await supabase
      .from('low_level_datasets')
      .select('low_level_workflow_analysis_id, feedback')
      .eq('dataset_type', 'workflow_event_feedback');

    if (annotationError) {
      console.error('[api/sessions] Error fetching annotation data:', annotationError);
    }

    // Get workflow analyses to map analysis IDs to sessions
    const { data: analysesData, error: analysesError } = await supabase
      .from('low_level_workflow_analyses')
      .select('id, session_id');

    if (analysesError) {
      console.error('[api/sessions] Error fetching analyses data:', analysesError);
    }

    // Create mapping from analysis ID to session ID
    const analysisToSession = new Map<string, string>();
    if (analysesData) {
      for (const analysis of analysesData) {
        analysisToSession.set(analysis.id.toString(), analysis.session_id);
      }
    }

    // Group annotation data by session
    const annotationsBySession = new Map<string, { llm_labeled: number; human_annotated: number }>();
    
    if (annotationData) {
      for (const annotation of annotationData) {
        const sessionId = analysisToSession.get(annotation.low_level_workflow_analysis_id.toString());
        if (!sessionId) continue;
        
        if (!annotationsBySession.has(sessionId)) {
          annotationsBySession.set(sessionId, { llm_labeled: 0, human_annotated: 0 });
        }
        
        const counts = annotationsBySession.get(sessionId)!;
        counts.llm_labeled++; // Has LLM generated event summary
        
        if (annotation.feedback) {
          counts.human_annotated++; // Has human feedback
        }
      }
    }

    const processedSessions: Session[] = sessions.map(session => {
      const lastEventTimestamp = new Date(session.last_event_timestamp).getTime();
      const now = Date.now();
      const isLive = (now - lastEventTimestamp) < 60000;

      const annotationCounts = annotationsBySession.get(session.session_id) || { llm_labeled: 0, human_annotated: 0 };

      return {
        id: session.session_id,
        userId: session.user_id || 'unknown_user',
        type: session.session_type,
        timestamp: session.last_event_timestamp,
        eventCount: session.event_count,
        processed_event_count: session.processed_event_count || 0,
        total_ui_steps: session.total_ui_steps || 0,
        total_workflow_analyses: session.total_workflow_analyses || 0,
        distinct_workflows_created: session.distinct_workflows_created || 0,
        human_labeled_steps: session.human_labeled_steps || 0,
        llm_labeled_steps: annotationCounts.llm_labeled,
        human_annotated_steps: annotationCounts.human_annotated,
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