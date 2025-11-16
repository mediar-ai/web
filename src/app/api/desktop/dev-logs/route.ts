/**
 * API endpoint for storing and retrieving dev execution logs
 * Logs are stored in Redis with 30-day TTL for debugging and historical analysis
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getRedisClient } from '@/lib/redis-client';
import { getCorsHeaders } from '@/lib/cors';

const DEV_LOG_TTL = 60 * 60 * 24 * 30; // 30 days

/**
 * OPTIONS: Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

/**
 * POST: Store dev execution logs from desktop app
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    // 1. Authenticate desktop app
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401, headers: corsHeaders });
    }

    const userId = validation.userId!;
    const body = await request.json();

    const {
      execution_id,
      workflow_id,
      workflow_name,
      workflow_yaml,
      workflowExecutionLogs,
      status,
      started_at,
      completed_at,
      duration_seconds,
      error_message
    } = body;

    if (!execution_id || !workflow_id || !workflowExecutionLogs) {
      return NextResponse.json(
        { error: 'Missing required fields: execution_id, workflow_id, workflowExecutionLogs' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[DEV LOGS] Storing execution ${execution_id} for user ${userId}, workflow ${workflow_id}`);

    const redis = await getRedisClient();

    // 2. Store full execution data
    const executionKey = `dev-execution:${userId}:${workflow_id}:${execution_id}`;
    const executionData = {
      execution_id,
      workflow_id,
      workflow_name,
      workflow_yaml,
      workflowExecutionLogs,
      status,
      started_at,
      completed_at,
      duration_seconds,
      error_message,
      user_id: userId,
      created_at: new Date().toISOString()
    };

    await redis.set(
      executionKey,
      JSON.stringify(executionData),
      { EX: DEV_LOG_TTL }
    );

    // 3. Update "latest" pointer for this workflow
    const latestKey = `dev-execution:${userId}:${workflow_id}:latest`;
    await redis.set(latestKey, execution_id, { EX: DEV_LOG_TTL });

    // 4. Add to user's execution list (sorted set by timestamp)
    const userListKey = `dev-executions:user:${userId}`;
    const timestamp = new Date(started_at || Date.now()).getTime();
    await redis.zAdd(userListKey, { score: timestamp, value: execution_id });
    await redis.expire(userListKey, DEV_LOG_TTL);

    console.log(`[DEV LOGS] ✓ Stored execution ${execution_id} (TTL: 30 days)`);

    return NextResponse.json({
      success: true,
      execution_id,
      ttl_hours: 720, // 30 days
      message: 'Execution logs stored successfully'
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[DEV LOGS] Error storing execution:', error);
    return NextResponse.json(
      { error: 'Failed to store execution logs', details: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * GET: Retrieve execution logs
 * - With ?workflow_id=N: Get latest execution logs for that workflow
 * - Without params: List recent executions (metadata only)
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    // 1. Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401, headers: corsHeaders });
    }

    const userId = validation.userId!;
    const redis = await getRedisClient();

    // Check if requesting specific workflow's latest execution
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflow_id');

    if (workflowId) {
      // Get latest execution for this workflow
      const latestKey = `dev-execution:${userId}:${workflowId}:latest`;
      const latestExecutionId = await redis.get(latestKey);

      if (!latestExecutionId) {
        return NextResponse.json(
          { error: 'No execution logs found for this workflow' },
          { status: 404, headers: corsHeaders }
        );
      }

      // Get full execution data
      const executionKey = `dev-execution:${userId}:${workflowId}:${latestExecutionId}`;
      const executionDataStr = await redis.get(executionKey);

      if (!executionDataStr) {
        return NextResponse.json(
          { error: 'Execution data not found' },
          { status: 404, headers: corsHeaders }
        );
      }

      const executionData = JSON.parse(executionDataStr);

      console.log(`[DEV LOGS] Returning latest execution ${latestExecutionId} for workflow ${workflowId}`);

      return NextResponse.json({
        execution_id: executionData.execution_id,
        workflow_id: executionData.workflow_id,
        workflow_name: executionData.workflow_name,
        workflowExecutionLogs: executionData.workflowExecutionLogs,
        status: executionData.status,
        started_at: executionData.started_at,
        completed_at: executionData.completed_at,
        duration_seconds: executionData.duration_seconds,
        error_message: executionData.error_message
      }, { headers: corsHeaders });
    }

    // 2. Get user's execution list (most recent first)
    const userListKey = `dev-executions:user:${userId}`;
    const executionIds = await redis.zRange(userListKey, 0, 49, { REV: true });

    if (executionIds.length === 0) {
      return NextResponse.json({ executions: [] }, { headers: corsHeaders });
    }

    // 3. Load metadata for each execution
    const executions = [];

    // Get all keys for this user to find which workflow each execution belongs to
    const pattern = `dev-execution:${userId}:*:*`;
    const allKeys = await redis.keys(pattern);

    for (const execId of executionIds) {
      // Find the key that matches this execution ID
      const matchingKey = allKeys.find(key => key.endsWith(`:${execId}`));

      if (matchingKey) {
        const data = await redis.get(matchingKey);
        if (data) {
          const parsed = JSON.parse(data);
          executions.push({
            execution_id: parsed.execution_id,
            workflow_id: parsed.workflow_id,
            workflow_name: parsed.workflow_name,
            status: parsed.status,
            started_at: parsed.started_at,
            completed_at: parsed.completed_at,
            duration_seconds: parsed.duration_seconds,
            error_message: parsed.error_message,
            step_count: Object.keys(parsed.workflowExecutionLogs || {}).length
          });
        }
      }
    }

    console.log(`[DEV LOGS] Returning ${executions.length} recent executions for user ${userId}`);

    return NextResponse.json({ executions }, { headers: corsHeaders });

  } catch (error) {
    console.error('[DEV LOGS] Error listing executions:', error);
    return NextResponse.json(
      { error: 'Failed to list executions', details: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: corsHeaders }
    );
  }
}
