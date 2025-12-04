import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { mapClerkIdToDbId } from '@/lib/orgIdMapping';

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
  llm_generated_labeled_steps: number;
  llm_labeled_steps: number;
  human_annotated_steps: number;
  status: 'live' | 'offline';
  duration_seconds?: number;
}

interface UserSessionData {
  name: string | null;
  organizationId: string | null;
  organizationName: string | null;
  workflowCount: number;
  sessions: Session[];
}

export const revalidate = 0;

export async function GET(request: Request) {
  // Organization filtering - re-enabled after migration
  const { searchParams } = new URL(request.url);
  const clerkOrgId = searchParams.get('orgId');
  
  // Convert Clerk org ID to database org ID for development environment
  const dbOrgId = clerkOrgId ? mapClerkIdToDbId(clerkOrgId) : null;
  
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // [SUCCESS] REVERTED: Use original lightweight session_metadata table as designed
    // This is the correct approach - lightweight metadata summary table
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
        total_ui_steps: session.total_ui_steps || 0,
        total_workflow_analyses: session.total_workflow_analyses || 0,
        distinct_workflows_created: 0,
        llm_generated_labeled_steps: session.human_labeled_steps || 0,
        llm_labeled_steps: session.total_labeled_steps || 0, // Using total_labeled_steps for llm_labeled_steps
        human_annotated_steps: session.human_labeled_steps || 0, // Keep for backwards compatibility
        duration_seconds: session.duration_seconds,
        status: isLive ? 'live' : 'offline',
      };
    });
    
    const userIds = [...new Set(processedSessions.map((s: Session) => s.userId).filter((id: string) => id !== 'unknown_user'))];
    
    // GET ACTUAL WORKFLOW COUNTS BY USER from low_level_workflows table
    const { data: workflowData, error: workflowError } = await supabase
      .from('low_level_workflows')
      .select('user_id')
      .in('user_id', userIds);

    if (workflowError) {
      console.error('[api/sessions] Error fetching workflow counts:', workflowError);
    }

    // Count workflows by user
    const workflowCountsByUser = new Map<string, number>();
    if (workflowData) {
      for (const workflow of workflowData) {
        const userId = workflow.user_id;
        workflowCountsByUser.set(userId, (workflowCountsByUser.get(userId) || 0) + 1);
      }
    }
    
    // Check if the requesting organization has global access
    let hasGlobalAccess = false;
    if (dbOrgId) {
      const { data: accessData } = await supabase
        .from('organization_data_access')
        .select('data_access_scope')
        .eq('clerk_organization_id', dbOrgId)
        .single();
      
      hasGlobalAccess = accessData?.data_access_scope === 'global';
    }

    // Fetch users with organization filtering if orgId is provided and doesn't have global access
    let usersQuery = supabase
      .from('mediar_users')
      .select('user_id, name, organization_id')
      .in('user_id', userIds);
    
    // Apply organization filtering only if requested AND organization doesn't have global access
    if (dbOrgId && !hasGlobalAccess) {
      usersQuery = usersQuery.eq('organization_id', dbOrgId);
    }

    const { data: users, error: usersError } = await usersQuery;

    if (usersError) {
      console.error('[api/sessions] Error fetching users:', usersError);
    }

    // Fetch organization names for the organization IDs we have
    const orgIds = [...new Set(users?.map(u => u.organization_id).filter(Boolean) || [])];
    const { data: organizations } = await supabase
      .from('organization_data_access')
      .select('clerk_organization_id, organization_name')
      .in('clerk_organization_id', orgIds);

    const orgNamesMap = new Map<string, string>();
    for (const org of organizations || []) {
      orgNamesMap.set(org.clerk_organization_id, org.organization_name);
    }

    const usersMap = new Map<string, { name: string | null; organizationId: string | null; organizationName: string | null }>();
    const filteredUserIds = new Set<string>();
    
    for (const user of users || []) {
      usersMap.set(user.user_id, {
        name: user.name,
        organizationId: user.organization_id,
        organizationName: orgNamesMap.get(user.organization_id) || null
      });
      filteredUserIds.add(user.user_id);
    }

    const userSessions: Record<string, UserSessionData> = {};
    for (const session of processedSessions) {
      // If organization filtering is active and organization doesn't have global access, only include sessions from filtered users
      if (dbOrgId && !hasGlobalAccess && !filteredUserIds.has(session.userId)) {
        continue;
      }
      
      if (!userSessions[session.userId]) {
        const userData = usersMap.get(session.userId);
        userSessions[session.userId] = {
          name: userData?.name || null,
          organizationId: userData?.organizationId || null,
          organizationName: userData?.organizationName || null,
          workflowCount: workflowCountsByUser.get(session.userId) || 0,
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