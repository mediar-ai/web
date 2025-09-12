import { NextRequest, NextResponse } from 'next/server';
import { 
  createClerkSupabaseClient, 
  createServiceSupabaseClient,
  getClerkUserId 
} from '@/lib/supabase-clerk';

// ... (other imports and helper functions remain the same)

/**
 * Example of updated API route using Clerk authentication
 * This shows two patterns:
 * 1. Using Clerk JWT for user-scoped operations (respects RLS)
 * 2. Using service role for admin operations (bypasses RLS)
 */

export async function POST(req: NextRequest) {
  try {
    const { userId, workflows } = await req.json();

    if (!userId || !workflows || !Array.isArray(workflows)) {
      return NextResponse.json({ error: 'Missing userId or workflows array' }, { status: 400 });
    }

    // PATTERN 1: User-scoped operation with RLS
    // This will automatically filter based on the authenticated user
    try {
      const supabase = await createClerkSupabaseClient();
      
      // This insert will only work if the user is authenticated
      // and the RLS policies allow them to insert
      const { data: savedWorkflows, error } = await supabase
        .from('low_level_workflows')
        .insert(workflows.map(w => ({
          ...w,
          user_id: userId, // Must match the authenticated user
        })))
        .select();

      if (error) throw error;

      return NextResponse.json({ success: true, data: savedWorkflows });
    } catch (clerkError) {
      console.log('Clerk auth failed, falling back to service role');
      
      // PATTERN 2: Service role fallback for backwards compatibility
      // Use this when you need to bypass RLS or support legacy code
      const serviceClient = createServiceSupabaseClient();
      
      const enhancedWorkflows = [];
      for (const workflow of workflows) {
        let enhancedWorkflowData = workflow.detailed_workflow_data;
        if (workflow.detailed_workflow_data) {
          enhancedWorkflowData = generateComponentIds(workflow.detailed_workflow_data);
        }

        const { data: savedWorkflows, error } = await serviceClient
          .from('low_level_workflows')
          .insert([{
            ...workflow,
            user_id: userId,
            detailed_workflow_data: enhancedWorkflowData
          }])
          .select();

        if (error) throw error;
        enhancedWorkflows.push(savedWorkflows[0]);
      }

      return NextResponse.json({ success: true, data: enhancedWorkflows });
    }
  } catch (error) {
    console.error('Error creating workflow:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message }, 
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get('userId');
    const synthesisSessionId = searchParams.get('synthesis_session_id');

    if (!requestedUserId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    // PATTERN 3: Check if user is requesting their own data
    const currentUserId = await getClerkUserId();
    
    if (currentUserId === requestedUserId) {
      // User is requesting their own data - use Clerk auth
      const supabase = await createClerkSupabaseClient();
      
      let query = supabase
        .from('low_level_workflows')
        .select('*');
      
      // RLS will automatically filter to only this user's workflows
      // No need to add .eq('user_id', userId) as RLS handles it
      
      if (synthesisSessionId) {
        const sessionIdNumber = parseInt(synthesisSessionId, 10);
        if (!isNaN(sessionIdNumber)) {
          query = query.eq('synthesis_session_id', sessionIdNumber);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      return NextResponse.json({ success: true, data });
      
    } else {
      // PATTERN 4: Admin checking another user's data
      // First verify if current user is an admin
      const serviceClient = createServiceSupabaseClient();
      
      const { data: currentUser } = await serviceClient
        .from('mediar_users')
        .select('role, organization_id')
        .eq('user_id', currentUserId)
        .single();
      
      if (currentUser?.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden: Admin access required' }, 
          { status: 403 }
        );
      }

      // Admin verified - can access other users' data
      let query = serviceClient
        .from('low_level_workflows')
        .select('*')
        .eq('user_id', requestedUserId);

      if (synthesisSessionId) {
        const sessionIdNumber = parseInt(synthesisSessionId, 10);
        if (!isNaN(sessionIdNumber)) {
          query = query.eq('synthesis_session_id', sessionIdNumber);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      return NextResponse.json({ success: true, data });
    }
  } catch (error) {
    console.error('Error fetching workflows:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message }, 
      { status: 500 }
    );
  }
}

// Helper function (would be imported from original file)
function generateComponentIds(workflow: any) {
  // Implementation remains the same
  return workflow;
}