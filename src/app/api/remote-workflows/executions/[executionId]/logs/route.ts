import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  getExecutionLogs,
  getLogsByTraceId,
  getTraceIdForExecution,
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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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

    if (executorType === 'rust') {
      try {
        let chLogs: any[] = [];

        // PRIORITY 1: Use stored trace_id if available (most reliable)
        if (storedTraceId) {
          chLogs = await getLogsByTraceId(storedTraceId);
          if (chLogs.length > 0) {
            console.log(
              `[LOGS] Found ${chLogs.length} logs in ClickHouse using stored trace_id for execution ${executionIdNum}`
            );
          }
        }

        // PRIORITY 2: Search by execution_id in log body/attributes (fallback for old executions)
        if (chLogs.length === 0) {
          chLogs = await getExecutionLogs(executionIdNum);
          if (chLogs.length > 0) {
            console.log(
              `[LOGS] Found ${chLogs.length} logs in ClickHouse using execution_id search for execution ${executionIdNum}`
            );
          }
        }

        // PRIORITY 3: Try finding trace_id from ClickHouse (last resort)
        if (chLogs.length === 0) {
          const traceId = await getTraceIdForExecution(executionIdNum);
          if (traceId) {
            chLogs = await getLogsByTraceId(traceId);
            if (chLogs.length > 0) {
              console.log(
                `[LOGS] Found ${chLogs.length} logs in ClickHouse using discovered trace_id for execution ${executionIdNum}`
              );
            }
          }
        }

        if (chLogs.length > 0) {
          return NextResponse.json({
            success: true,
            logs: chLogs.map((log: any) => {
              // Normalize ClickHouse timestamp (replace space with T, truncate nanoseconds)
              let timestamp = log.timestamp;
              if (timestamp && typeof timestamp === 'string') {
                // Replace space with T for ISO format
                timestamp = timestamp.replace(' ', 'T');
                // Truncate nanoseconds to milliseconds (keep up to 3 decimal places)
                // Format: 2025-11-21T02:17:53.886367070 -> 2025-11-21T02:17:53.886
                timestamp = timestamp.replace(/(\.\d{3})\d+/, '$1');
                // If no timezone, assume UTC (append Z)
                if (
                  !timestamp.endsWith('Z') &&
                  !timestamp.includes('+') &&
                  !timestamp.includes('-')
                ) {
                  timestamp += 'Z';
                }
              }

              return {
                timestamp: timestamp,
                level: (log.level || 'INFO').toLowerCase(),
                message: log.message,
              };
            }),
            count: chLogs.length,
            source: 'clickhouse',
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
