import { cacheResponse } from '@/lib/responseCache';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    // Import the new auth helper
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');

    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status'); // No default - show all by default
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const viewOrgId = searchParams.get('viewOrgId'); // Allow Mediar admins to specify org
    const versionParam = searchParams.get('version'); // 'latest' for desktop app
    const tagsParam = searchParams.get('tags'); // Comma-separated tags to filter by
    const filterTags = tagsParam
      ? tagsParam.split(',').map(t => t.trim().toLowerCase())
      : [];
    // includePublic: when false (default), excludes public workflows from other orgs
    // Desktop app defaults to false to show only owned/shared workflows in main list
    // Community workflows are fetched separately via /api/remote-workflows/community
    const includePublic = searchParams.get('includePublic') === 'true';

    // Get effective organization context
    // Don't override orgId if viewing "All Orgs" - keep the user's actual org
    const authStart = Date.now();
    const {
      orgId,
      isMediarOrg,
      isMediarAdmin,
      actualOrgId: _actualOrgId,
    } = await getEffectiveOrgId(viewOrgId === 'ALL' ? null : viewOrgId);
    console.log(`[API TIMING] Auth/getEffectiveOrgId: ${Date.now() - authStart}ms`);

    if (!orgId) {
      return NextResponse.json(
        {
          success: false,
          error: 'No organization context',
          workflows: [],
        },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, get workflow IDs this organization has access to
    let accessibleWorkflowIds: number[] = [];

    // Show all workflows if:
    // 1. Mediar admin explicitly selected "All Orgs" (viewOrgId === 'ALL')
    const showAllWorkflows = isMediarAdmin && viewOrgId === 'ALL';

    if (showAllWorkflows) {
      // Show all workflows from all organizations
      const { data: allWorkflows, error: allError } = await supabase
        .from('deployed_workflows')
        .select('id')
        .is('parent_workflow_id', null);

      if (allError) {
        console.error(
          '[Workflows List] Error fetching all workflows:',
          allError
        );
      }
      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
    } else {
      // Regular org sees:
      // 1. Workflows they own
      // 2. Workflows explicitly shared with them via workflow_organization_access
      // 3. Globally public workflows (is_public = true) - ONLY if includePublic=true

      // PARALLEL: Run access queries simultaneously
      const accessQueryStart = Date.now();
      
      // Build array of queries to run - conditionally include public query
      const queries: Promise<any>[] = [
        // Get workflows owned by this org
        supabase
          .from('deployed_workflows')
          .select('id, organization_id')
          .eq('organization_id', orgId)
          .is('parent_workflow_id', null),
        // Get workflows explicitly shared with this org
        supabase
          .from('workflow_organization_access')
          .select('workflow_id')
          .eq('organization_id', orgId),
      ];
      
      // Only query for public workflows if includePublic=true
      if (includePublic) {
        queries.push(
          supabase
            .from('deployed_workflows')
            .select('id')
            .eq('is_public', true)
            .is('parent_workflow_id', null)
        );
      }
      
      const results = await Promise.all(queries);
      const [ownedResult, sharedResult, publicResult] = results;

      console.log(`[API TIMING] Access queries (parallel): ${Date.now() - accessQueryStart}ms`);

      if (ownedResult.error) {
        console.error(
          '[Workflows List] Error fetching owned workflows:',
          ownedResult.error
        );
      }
      if (sharedResult.error) {
        console.error(
          '[Workflows List] Error fetching shared workflows:',
          sharedResult.error
        );
      }
      if (includePublic && publicResult?.error) {
        console.error(
          '[Workflows List] Error fetching public workflows:',
          publicResult.error
        );
      }

      const ownedIds = (ownedResult.data || []).map(w => w.id);
      const sharedIds = (sharedResult.data || []).map(a => a.workflow_id);
      const publicIds = includePublic ? (publicResult?.data || []).map(w => w.id) : [];

      // Combine and deduplicate
      accessibleWorkflowIds = [
        ...new Set([...ownedIds, ...sharedIds, ...publicIds]),
      ];
      
      console.log(`[API] includePublic=${includePublic}, owned=${ownedIds.length}, shared=${sharedIds.length}, public=${publicIds.length}, total=${accessibleWorkflowIds.length}`);
    }

    if (accessibleWorkflowIds.length === 0 && !showAllWorkflows) {
      // No workflows accessible
      return NextResponse.json({
        success: true,
        workflows: [],
        pagination: {
          total: 0,
          limit,
          offset,
          has_more: false,
        },
        filters: {
          category: category || 'all',
          status,
          applied_filters: {
            ...(category && { category }),
            status,
          },
        },
        organization: {
          id: orgId,
          isMediar: isMediarOrg,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Build query with filters - using statistics summary view for version-specific stats
    // Desktop app (version=latest) uses latest version, web app uses active version
    // Only fetch workflows this org has access to
    const statsViewName =
      versionParam === 'latest'
        ? 'workflow_statistics_summary_latest' // Desktop: uses latest version by created_at
        : 'workflow_statistics_summary'; // Web: uses active version

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
      .in('id', accessibleWorkflowIds)
      .order('last_modified_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Only filter by status if explicitly provided
    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const statsQueryStart = Date.now();
    const { data: workflows, error } = await query;
    console.log(`[API TIMING] Stats view query: ${Date.now() - statsQueryStart}ms`);

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Fetch automation sequences for the workflows (needed for input parameter detection)
    const workflowIds = (workflows || []).map(w => w.id);
    const automationSequences: Record<number, any> = {};
    const cronData: Record<number, any> = {};

    // Determine which view to use based on version parameter
    const viewName =
      versionParam === 'latest'
        ? 'deployed_workflows_with_sequence_latest'
        : 'deployed_workflows_with_sequence';

    if (versionParam === 'latest') {
      console.log('[API] Using LATEST view for desktop app');
    }

    if (workflowIds.length > 0) {
      // PARALLEL: Fetch cron/config data AND sequences simultaneously
      const dataQueryStart = Date.now();
      const [cronResult, sequencesResult] = await Promise.all([
        // Fetch cron data and other config directly from deployed_workflows table
        supabase
          .from('deployed_workflows')
          .select(
            `
            id,
            organization_id,
            created_by,
            estimated_duration_seconds,
            cron_expression,
            cron_timezone,
            cron_enabled,
            last_scheduled_execution,
            next_scheduled_execution,
            cron_max_concurrent,
            cron_retry_on_failure,
            cron_retry_count,
            cron_auto_paused,
            auto_paused_at,
            auto_pause_reason,
            consecutive_failures,
            last_failure_message,
            preferred_format,
            typescript_metadata,
            tags,
            github_folder,
            uuid,
            step_count
          `
          )
          .in('id', workflowIds),
        // Fetch workflow metadata (no automation_sequence - too large, fetched on-demand)
        supabase
          .from(viewName)
          .select(
            `
            id,
            workflow_type,
            parent_workflow_id,
            display_order,
            latest_version_number
          `
          )
          .in('id', workflowIds),
      ]);

      console.log(`[API TIMING] Cron+sequences queries (parallel): ${Date.now() - dataQueryStart}ms`);

      const { data: cronWorkflows, error: cronError } = cronResult;
      const { data: sequences, error: sequencesError } = sequencesResult;

      // Lookup user emails and names for author display
      // created_by can be either a user_id (e.g., user_2yyb...) or email (for legacy/deleted users)
      const userIdToEmail: Record<string, string> = {};
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
              if (u.email) userIdToEmail[u.user_id] = u.email;
              if (u.name) userIdToName[u.user_id] = u.name;
            });
          }
        }
      }

      if (!cronError && cronWorkflows) {
        console.log(
          '[API] Fetched cron data for',
          cronWorkflows.length,
          'workflows'
        );
        cronWorkflows.forEach(cw => {
          if (cw.cron_expression) {
            console.log(
              `[API] Workflow ${cw.id} has cron:`,
              cw.cron_expression,
              'enabled:',
              cw.cron_enabled
            );
          }
          // Resolve author display: prefer email, fallback to name, then 'Unknown User'
          const authorDisplay = cw.created_by?.startsWith('user_')
            ? userIdToEmail[cw.created_by] || userIdToName[cw.created_by] || 'Unknown User'
            : cw.created_by;
          cronData[cw.id] = {
            organization_id: cw.organization_id,
            created_by: authorDisplay, // Store resolved author for display
            estimated_duration_seconds: cw.estimated_duration_seconds,
            cron_expression: cw.cron_expression,
            cron_timezone: cw.cron_timezone,
            cron_enabled: cw.cron_enabled,
            last_scheduled_execution: cw.last_scheduled_execution,
            next_scheduled_execution: cw.next_scheduled_execution,
            cron_max_concurrent: cw.cron_max_concurrent,
            cron_retry_on_failure: cw.cron_retry_on_failure,
            cron_retry_count: cw.cron_retry_count,
            cron_auto_paused: cw.cron_auto_paused,
            auto_paused_at: cw.auto_paused_at,
            auto_pause_reason: cw.auto_pause_reason,
            consecutive_failures: cw.consecutive_failures,
            last_failure_message: cw.last_failure_message,
            preferred_format: cw.preferred_format,
            typescript_metadata: cw.typescript_metadata,
            tags: cw.tags || [],
            github_folder: cw.github_folder,
            uuid: cw.uuid,
            step_count: cw.step_count || 0,
          };
        });
        console.log(
          '[API] Total workflows with cron data in cronData:',
          Object.keys(cronData).filter(
            id => cronData[parseInt(id)].cron_expression
          ).length
        );
        // Debug: log workflows with tags
        const workflowsWithTags = Object.entries(cronData).filter(
          ([_, data]: [string, any]) => data.tags && data.tags.length > 0
        );
        console.log(
          '[API] Workflows with tags in cronData:',
          workflowsWithTags.map(([id, data]: [string, any]) => ({
            id,
            tags: data.tags,
          }))
        );
      } else if (cronError) {
        console.error('[API] Error fetching cron data:', cronError);
      }

      console.log(
        '[API] Fetched automation sequences:',
        sequences?.length,
        'error:',
        sequencesError?.message
      );

      if (!sequencesError && sequences) {
        sequences.forEach(seq => {
          // Merge cron data with automation sequence data
          automationSequences[seq.id] = {
            ...seq,
            ...(cronData[seq.id] || {}),
          };
        });
        console.log(
          '[API] After merge, workflows with cron in automationSequences:',
          Object.keys(automationSequences).filter(
            id => automationSequences[parseInt(id)]?.cron_expression
          ).length
        );
        // Log specific workflows
        [71, 73, 74, 65, 313, 84].forEach(id => {
          if (automationSequences[id]) {
            console.log(
              `[API] Workflow ${id} cron after merge:`,
              automationSequences[id].cron_expression,
              'enabled:',
              automationSequences[id].cron_enabled
            );
          }
        });
      }
    }

    // Author names are now stored directly in deployed_workflows.created_by field
    // (stores email or user ID when workflow is created)

    // Fetch all settings workflows for the execution workflows we just fetched

    let settingsWorkflows: any[] = [];

    if (workflowIds.length > 0) {
      // NOTE: automation_sequence removed - not needed for list view
      const { data: settings, error: settingsError } = await supabase
        .from(viewName)
        .select(
          `
          id,
          name,
          description,
          version,
          status,
          workflow_type,
          parent_workflow_id,
          display_order,
          category,
          estimated_duration_seconds,
          successful_runs,
          failed_runs,
          cancelled_runs,
          total_executions,
          cron_expression,
          cron_timezone,
          cron_enabled,
          last_scheduled_execution,
          next_scheduled_execution,
          cron_max_concurrent,
          cron_retry_on_failure,
          cron_retry_count,
          created_at,
          updated_at,
          organization_id
        `
        )
        .eq('workflow_type', 'settings')
        .in('parent_workflow_id', workflowIds)
        .order('display_order', { ascending: true });

      if (!settingsError) {
        settingsWorkflows = settings || [];
      }
    }

    // If Mediar org or Mediar admin, also fetch information about which orgs have access to each workflow
    const workflowAccessInfo: Record<number, string[]> = {};
    if ((isMediarOrg || isMediarAdmin) && workflowIds.length > 0) {
      const { data: accessData } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id, organization_id')
        .in('workflow_id', workflowIds);

      if (accessData) {
        accessData.forEach(access => {
          if (!workflowAccessInfo[access.workflow_id]) {
            workflowAccessInfo[access.workflow_id] = [];
          }
          workflowAccessInfo[access.workflow_id].push(access.organization_id);
        });
      }
    }

    // Fetch access levels for current user's org (for all workflows, not just Mediar)
    // This is used to show read-only badges in the desktop app
    const userAccessLevels: Record<number, string> = {};
    if (workflowIds.length > 0 && orgId) {
      const { data: userAccessData } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id, access_level')
        .eq('organization_id', orgId)
        .in('workflow_id', workflowIds);

      if (userAccessData) {
        userAccessData.forEach(access => {
          userAccessLevels[access.workflow_id] = access.access_level;
        });
      }
    }

    // Group settings workflows by parent_workflow_id (no processing needed for list)
    const settingsByParent = settingsWorkflows.reduce(
      (acc: Record<number, any[]>, settings) => {
        const parentId = settings.parent_workflow_id;
        if (parentId && !acc[parentId]) {
          acc[parentId] = [];
        }
        if (parentId) {
          acc[parentId].push(settings);
        }
        return acc;
      },
      {}
    );

    // Get total count for pagination (only accessible workflows)
    let countQuery = supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .in('id', accessibleWorkflowIds)
      .is('parent_workflow_id', null); // Only top-level workflows

    // Apply same filters as main query
    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    if (category) {
      countQuery = countQuery.eq('category', category);
    }

    const { count: totalCount } = await countQuery;

    // Format execution workflows, filtering out child workflows (those with parent_workflow_id)
    const formattedWorkflows = (workflows || [])
      .filter(workflow => {
        // Only include top-level workflows (those without a parent)
        const parentId = automationSequences[workflow.id]?.parent_workflow_id;
        return !parentId; // Include only if no parent_workflow_id
      })
      .map(workflow => {
        // Merge automation sequence and other missing fields
        const workflowWithSequence = {
          ...workflow,
          // Map new field names to expected names for backward compatibility
          version: workflow.current_version,
          successful_runs: workflow.overall_successful_runs,
          failed_runs: workflow.overall_failed_runs,
          total_executions: workflow.overall_total_executions,
          // Add config fields
          estimated_duration_seconds:
            automationSequences[workflow.id]?.estimated_duration_seconds,
          // NOTE: automation_sequence removed - too large for list, fetched on-demand via /overview or /schema
          workflow_type:
            automationSequences[workflow.id]?.workflow_type || 'execution',
          parent_workflow_id:
            automationSequences[workflow.id]?.parent_workflow_id,
          display_order: automationSequences[workflow.id]?.display_order || 0,
          organization_id: automationSequences[workflow.id]?.organization_id,
          author_name: automationSequences[workflow.id]?.created_by || null,
          // Add cron scheduling fields
          cron_expression: automationSequences[workflow.id]?.cron_expression,
          cron_timezone: automationSequences[workflow.id]?.cron_timezone,
          cron_enabled: automationSequences[workflow.id]?.cron_enabled,
          last_scheduled_execution:
            automationSequences[workflow.id]?.last_scheduled_execution,
          next_scheduled_execution:
            automationSequences[workflow.id]?.next_scheduled_execution,
          cron_max_concurrent:
            automationSequences[workflow.id]?.cron_max_concurrent,
          cron_retry_on_failure:
            automationSequences[workflow.id]?.cron_retry_on_failure,
          cron_retry_count: automationSequences[workflow.id]?.cron_retry_count,
          // Add auto-pause fields
          cron_auto_paused: automationSequences[workflow.id]?.cron_auto_paused,
          auto_paused_at: automationSequences[workflow.id]?.auto_paused_at,
          auto_pause_reason:
            automationSequences[workflow.id]?.auto_pause_reason,
          consecutive_failures:
            automationSequences[workflow.id]?.consecutive_failures,
          last_failure_message:
            automationSequences[workflow.id]?.last_failure_message,
          // Add TypeScript workflow fields
          preferred_format: automationSequences[workflow.id]?.preferred_format,
          typescript_metadata:
            automationSequences[workflow.id]?.typescript_metadata,
          // UUID folder name for TypeScript workflows - used to identify cloud-only workflows
          github_folder: automationSequences[workflow.id]?.github_folder,
          // Workflow UUID for zip download endpoint
          uuid: automationSequences[workflow.id]?.uuid,
          // Step count from database (computed from automation_sequence or typescript_metadata)
          step_count: automationSequences[workflow.id]?.step_count || 0,
          // Add version-specific statistics as additional fields
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
          version_info: {
            current_version: workflow.current_version,
            total_versions: workflow.total_versions,
            // Latest version by created_at (from _latest view when version=latest param is used)
            latest_version:
              automationSequences[workflow.id]?.latest_version_number ||
              workflow.current_version,
          },
          // Add tags for filtering
          tags: automationSequences[workflow.id]?.tags || [],
          // User's access level for this workflow (for read-only badges in desktop app)
          // 'owner' = org owns this workflow, 'admin'/'write'/'read' = shared access, 'public_read' = public
          user_access_level: workflow.organization_id === orgId
            ? 'owner'
            : userAccessLevels[workflow.id] || (workflow.is_public ? 'public_read' : null),
          // Add access info for Mediar admins
          ...((isMediarOrg || isMediarAdmin) && {
            shared_with_orgs: workflowAccessInfo[workflow.id] || [],
          }),
        };

        // NOTE: processWorkflowSchema removed - input_parameters/sample_inputs fetched on-demand via /schema
        return {
          ...workflowWithSequence,
          settings_workflows: settingsByParent[workflow.id] || [],
        };
      });

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

    const responseData = {
      success: true,
      workflows: filteredWorkflows,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit,
      },
      filters: {
        category: category || 'all',
        status,
        tags: filterTags,
        applied_filters: {
          ...(category && { category }),
          status,
          ...(filterTags.length > 0 && { tags: filterTags }),
        },
      },
      organization: {
        id: orgId,
        isMediar: isMediarOrg,
      },
      timestamp: new Date().toISOString(),
    };

    const totalTime = Date.now() - startTime;
    console.log(`[API TIMING] Total request time: ${totalTime}ms for ${filteredWorkflows.length} workflows`);

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/list',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: {
        category: category || null,
        status: status || null,
        limit,
        offset,
      },
      executionTimeMs: totalTime,
    });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('[ERROR] Error listing workflows:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflows',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
