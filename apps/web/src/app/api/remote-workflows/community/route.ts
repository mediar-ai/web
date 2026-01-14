import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/remote-workflows/community
 * 
 * Returns all public/community workflows (is_public = true).
 * This endpoint is used by the desktop app to show community workflows
 * separately from the user's own workflows.
 * 
 * Note: Authentication is optional - public workflows are viewable by anyone.
 * However, if authenticated, we include the user's access level for each workflow.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const versionParam = searchParams.get('version'); // 'latest' for desktop app
    const tagsParam = searchParams.get('tags'); // Comma-separated tags to filter by
    const filterTags = tagsParam
      ? tagsParam.split(',').map(t => t.trim().toLowerCase())
      : [];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query for all public workflows
    const statsViewName =
      versionParam === 'latest'
        ? 'workflow_statistics_summary_latest'
        : 'workflow_statistics_summary';

    let query = supabase
      .from(statsViewName)
      .select(
        `
        id,
        name,
        description,
        current_version,
        status,
        category,
        overall_total_executions,
        overall_successful_runs,
        overall_failed_runs,
        overall_success_rate,
        current_version_total_executions,
        current_version_successful_runs,
        current_version_failed_runs,
        current_version_success_rate,
        current_version_avg_duration,
        total_versions,
        created_at,
        updated_at,
        last_activity_at,
        last_modified_at,
        is_public,
        organization_id
      `
      )
      .eq('is_public', true)
      .order('last_modified_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: workflows, error } = await query;

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Fetch additional metadata for the workflows
    const workflowIds = (workflows || []).map(w => w.id);
    const cronData: Record<number, any> = {};

    if (workflowIds.length > 0) {
      // Fetch workflow metadata
      const { data: cronWorkflows, error: cronError } = await supabase
        .from('deployed_workflows')
        .select(
          `
          id,
          organization_id,
          created_by,
          estimated_duration_seconds,
          preferred_format,
          typescript_metadata,
          tags,
          github_folder,
          uuid,
          step_count
        `
        )
        .in('id', workflowIds);

      // Lookup author names
      const userIdToName: Record<string, string> = {};
      if (!cronError && cronWorkflows) {
        const userIds = cronWorkflows
          .map(cw => cw.created_by)
          .filter((id): id is string => !!id && id.startsWith('user_'));

        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from('mediar_users')
            .select('user_id, email, name')
            .in('user_id', [...new Set(userIds)]);

          if (users) {
            users.forEach(u => {
              if (u.name) userIdToName[u.user_id] = u.name;
              else if (u.email) userIdToName[u.user_id] = u.email;
            });
          }
        }

        cronWorkflows.forEach(cw => {
          const authorDisplay = cw.created_by?.startsWith('user_')
            ? userIdToName[cw.created_by] || 'Community'
            : cw.created_by || 'Community';
          cronData[cw.id] = {
            organization_id: cw.organization_id,
            created_by: authorDisplay,
            estimated_duration_seconds: cw.estimated_duration_seconds,
            preferred_format: cw.preferred_format,
            typescript_metadata: cw.typescript_metadata,
            tags: cw.tags || [],
            github_folder: cw.github_folder,
            uuid: cw.uuid,
            step_count: cw.step_count || 0,
          };
        });
      }
    }

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .eq('is_public', true)
      .is('parent_workflow_id', null);

    // Format workflows
    const formattedWorkflows = (workflows || []).map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      version: workflow.current_version,
      status: workflow.status,
      category: workflow.category,
      is_public: true,
      organization_id: workflow.organization_id,
      // Stats
      successful_runs: workflow.overall_successful_runs,
      failed_runs: workflow.overall_failed_runs,
      total_executions: workflow.overall_total_executions,
      // Metadata
      estimated_duration_seconds: cronData[workflow.id]?.estimated_duration_seconds,
      author_name: cronData[workflow.id]?.created_by || 'Community',
      preferred_format: cronData[workflow.id]?.preferred_format,
      typescript_metadata: cronData[workflow.id]?.typescript_metadata,
      github_folder: cronData[workflow.id]?.github_folder,
      uuid: cronData[workflow.id]?.uuid,
      step_count: cronData[workflow.id]?.step_count || 0,
      tags: cronData[workflow.id]?.tags || [],
      // Version info
      version_info: {
        current_version: workflow.current_version,
        total_versions: workflow.total_versions,
      },
      // Stats details
      current_version_stats: {
        successful_runs: workflow.current_version_successful_runs,
        failed_runs: workflow.current_version_failed_runs,
        total_executions: workflow.current_version_total_executions,
        success_rate: workflow.current_version_success_rate,
        average_duration_seconds: workflow.current_version_avg_duration,
      },
      overall_stats: {
        successful_runs: workflow.overall_successful_runs,
        failed_runs: workflow.overall_failed_runs,
        total_executions: workflow.overall_total_executions,
        success_rate: workflow.overall_success_rate,
      },
      // Timestamps
      created_at: workflow.created_at,
      updated_at: workflow.updated_at,
      last_modified_at: workflow.last_modified_at,
      // Access level for community workflows is always public_read
      user_access_level: 'public_read',
    }));

    // Filter by tags if provided
    const filteredWorkflows =
      filterTags.length > 0
        ? formattedWorkflows.filter(w => {
            const workflowTags = (w.tags || []).map((t: string) =>
              t.toLowerCase()
            );
            return filterTags.some(tag => workflowTags.includes(tag));
          })
        : formattedWorkflows;

    const totalTime = Date.now() - startTime;
    console.log(`[API] Community workflows: ${filteredWorkflows.length} workflows in ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      workflows: filteredWorkflows,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit,
      },
      filters: {
        tags: filterTags,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ERROR] Error listing community workflows:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve community workflows',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
