import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  getExecutionLogs,
  getLogsByTraceId,
  getTraceIdForExecution,
  getMcpAgentLogsByExecutionId,
} from '@/lib/clickhouse';

// Transform execution_logs to the format expected by the UI
const transformExecutionLogs = (logs: any): any[] => {
  if (!logs) return [];

  // If logs is already in the correct format (array of objects with timestamp, level, message)
  if (
    Array.isArray(logs) &&
    logs.length > 0 &&
    typeof logs[0] === 'object' &&
    'message' in logs[0]
  ) {
    return logs;
  }

  // If logs is an array of strings, transform to expected format
  if (Array.isArray(logs)) {
    return logs.map((log: any) => {
      // Try to parse timestamp and level from string format like "[2025-09-23T00:11:42.828574] Starting workflow..."
      const timestampMatch = String(log).match(/^\[([^\]]+)\]/);
      const timestamp = timestampMatch
        ? timestampMatch[1]
        : new Date().toISOString();
      const messageWithoutTimestamp = String(log).replace(/^\[[^\]]+\]\s*/, '');

      // Try to detect log level from message content
      let level = 'info';
      if (
        messageWithoutTimestamp.toLowerCase().includes('error') ||
        messageWithoutTimestamp.toLowerCase().includes('fail')
      ) {
        level = 'error';
      } else if (messageWithoutTimestamp.toLowerCase().includes('warn')) {
        level = 'warn';
      } else if (
        messageWithoutTimestamp.toLowerCase().includes('success') ||
        messageWithoutTimestamp.toLowerCase().includes('complet')
      ) {
        level = 'success';
      }

      return {
        timestamp,
        level,
        message: messageWithoutTimestamp,
      };
    });
  }

  return [];
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to execution logs');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get execution WITH workflow info for authorization check
    // Try with trace_id first, but if that fails (migration not run), try without it
    let execution: any = null;
    let error: any = null;

    // First attempt: with trace_id (for new schema after migration)
    const result = await supabase
      .from('workflow_executions')
      .select(
        `
        id,
        execution_logs,
        workflow_id,
        executor_type,
        trace_id,
        mcp_endpoint,
        started_at,
        completed_at,
        deployed_workflows!inner(
          id,
          name,
          created_by,
          organization_id
        )
      `
      )
      .eq('id', executionIdNum)
      .single();

    execution = result.data;
    error = result.error;

    // If query failed with column error, retry without trace_id (backward compatible)
    if (
      error &&
      (error.message?.includes('trace_id') ||
        error.message?.includes('column') ||
        error.code === '42703')
    ) {
      console.log(
        '[LOGS] trace_id column not found, falling back to query without it'
      );
      const fallbackResult = await supabase
        .from('workflow_executions')
        .select(
          `
        id,
        execution_logs,
        workflow_id,
        executor_type,
        mcp_endpoint,
        started_at,
        completed_at,
        deployed_workflows!inner(
          id,
          name,
          created_by,
          organization_id
        )
      `
        )
        .eq('id', executionIdNum)
        .single();

      execution = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error || !execution) {
      return NextResponse.json(
        {
          success: false,
          error: `Execution ${executionIdNum} not found`,
        },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const workflow = Array.isArray(execution.deployed_workflows)
      ? execution.deployed_workflows[0]
      : execution.deployed_workflows;
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg =
      workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', execution.workflow_id)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can view any execution logs)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (
      !isMediarOrg &&
      !isMediarAdmin &&
      !isOwner &&
      !(isOrgAdmin && isSameOrg) &&
      !hasOrgAccess
    ) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized access to execution ${executionIdNum} logs`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this execution' },
        { status: 403 }
      );
    }

    // Check if this is a Rust executor run
    // The Rust executor streams logs to OpenTelemetry -> ClickHouse
    // This provides real-time logs without waiting for DB updates
    const executorType = (execution as any).executor_type;
    // trace_id might not exist if migration hasn't been run yet
    const storedTraceId = (execution as any).trace_id || null;
    const mcpEndpoint = (execution as any).mcp_endpoint || null;
    const startedAt = (execution as any).started_at
      ? new Date((execution as any).started_at)
      : null;
    const completedAt = (execution as any).completed_at
      ? new Date((execution as any).completed_at)
      : null;

    // Helper function to normalize ClickHouse timestamps
    const normalizeTimestamp = (timestamp: string): string => {
      if (!timestamp || typeof timestamp !== 'string') return timestamp;
      // Replace space with T for ISO format
      let normalized = timestamp.replace(' ', 'T');
      // Truncate nanoseconds to milliseconds (keep up to 3 decimal places)
      normalized = normalized.replace(/(\.\d{3})\d+/, '$1');
      // If no timezone, assume UTC (append Z)
      if (
        !normalized.endsWith('Z') &&
        !normalized.includes('+') &&
        !normalized.match(/-\d{2}:\d{2}$/)
      ) {
        normalized += 'Z';
      }
      return normalized;
    };

    if (executorType === 'rust') {
      try {
        let executorLogs: any[] = [];

        // PRIORITY 1: Use stored trace_id if available (most reliable)
        if (storedTraceId) {
          executorLogs = await getLogsByTraceId(storedTraceId);
          if (executorLogs.length > 0) {
            console.log(
              `[LOGS] Found ${executorLogs.length} executor logs in ClickHouse using stored trace_id for execution ${executionIdNum}`
            );
          }
        }

        // PRIORITY 2: Search by execution_id in log body/attributes (fallback for old executions)
        if (executorLogs.length === 0) {
          executorLogs = await getExecutionLogs(executionIdNum);
          if (executorLogs.length > 0) {
            console.log(
              `[LOGS] Found ${executorLogs.length} executor logs in ClickHouse using execution_id search for execution ${executionIdNum}`
            );
          }
        }

        // PRIORITY 3: Try finding trace_id from ClickHouse (last resort)
        if (executorLogs.length === 0) {
          const traceId = await getTraceIdForExecution(executionIdNum);
          if (traceId) {
            executorLogs = await getLogsByTraceId(traceId);
            if (executorLogs.length > 0) {
              console.log(
                `[LOGS] Found ${executorLogs.length} executor logs in ClickHouse using discovered trace_id for execution ${executionIdNum}`
              );
            }
          }
        }

        // Also fetch MCP agent logs if we have a time window
        let mcpLogs: any[] = [];
        if (startedAt) {
          try {
            // Expand time window slightly to capture logs before/after execution bounds
            const expandedStart = new Date(startedAt.getTime() - 5000); // 5 seconds before
            const expandedEnd = completedAt
              ? new Date(completedAt.getTime() + 5000) // 5 seconds after
              : new Date(); // Now if still running

            // Search by execution_id in log body (accurate per-execution filtering)
            mcpLogs = await getMcpAgentLogsByExecutionId(
              executionIdNum,
              expandedStart,
              expandedEnd
            );

            if (mcpLogs.length > 0) {
              console.log(
                `[LOGS] Found ${mcpLogs.length} MCP agent logs for execution ${executionIdNum}`
              );

              // If we only found the start log (1-2 logs), try to get all logs from that host
              // during the execution window. This handles TypeScript workflows where nested logs
              // don't have execution_id in the message body yet.
              if (mcpLogs.length <= 2) {
                const startLog = mcpLogs[0];
                const hostname = startLog.host_name;
                if (hostname) {
                  console.log(
                    `[LOGS] Only found ${mcpLogs.length} MCP logs with execution_id, fetching all logs from host ${hostname} during execution window`
                  );
                  const { getMcpAgentLogs } = await import('@/lib/clickhouse');
                  const allHostLogs = await getMcpAgentLogs(
                    expandedStart,
                    expandedEnd,
                    hostname,
                    1000 // higher limit for full workflow logs
                  );
                  if (allHostLogs.length > mcpLogs.length) {
                    console.log(
                      `[LOGS] Found ${allHostLogs.length} total MCP agent logs from host ${hostname}`
                    );
                    mcpLogs = allHostLogs;
                  }
                }
              }
            }
          } catch (mcpError) {
            console.error('[LOGS] Failed to fetch MCP agent logs:', mcpError);
            // Continue without MCP logs
          }
        }

        // Combine and sort all logs by timestamp
        const allLogs = [...executorLogs, ...mcpLogs];

        if (allLogs.length > 0) {
          // Transform and sort logs
          const transformedLogs = allLogs
            .map((log: any) => ({
              timestamp: normalizeTimestamp(log.timestamp),
              level: (log.level || 'INFO').toLowerCase(),
              message: log.message,
              service: log.service, // Include service to distinguish executor vs MCP agent
              scope_name: log.scope_name, // Rust module name (e.g., "terminator_mcp_agent::server")
              host_name: log.host_name, // VM hostname (e.g., "mcp-vm2")
              span_id: log.span_id,
              trace_id: log.trace_id,
            }))
            .sort(
              (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime()
            );

          return NextResponse.json({
            success: true,
            logs: transformedLogs,
            count: transformedLogs.length,
            source: 'clickhouse',
            sources: {
              executor: executorLogs.length,
              mcp_agent: mcpLogs.length,
            },
          });
        } else {
          // If ClickHouse logs are empty, fall back to DB logs
          // This handles cases where ClickHouse ingestion might be delayed or failed
          // but the database has been updated by the executor
          console.log(
            `[LOGS] No logs found in ClickHouse for execution ${executionIdNum}, falling back to DB`
          );
        }
      } catch (e) {
        console.error('[LOGS] Failed to fetch from ClickHouse:', e);
        // Fall through to DB logs if ClickHouse fails
      }
    }

    // Transform logs to expected format
    const transformedLogs = transformExecutionLogs(
      (execution as any).execution_logs
    );

    return NextResponse.json({
      success: true,
      logs: transformedLogs,
      count: transformedLogs.length,
      source: 'database',
    });
  } catch (error) {
    console.error('[ERROR] Error fetching execution logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve execution logs',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
