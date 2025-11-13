/**
 * API endpoint for storing and retrieving dev execution logs
 * Logs are stored in Redis with 48-hour TTL for short-term debugging
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getRedisClient } from '@/lib/redis-client';

const DEV_LOG_TTL = 60 * 60 * 48; // 48 hours

/**
 * POST: Store dev execution logs from desktop app
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate desktop app
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
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
        { status: 400 }
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

    console.log(`[DEV LOGS] ✓ Stored execution ${execution_id} (TTL: 48h)`);

    return NextResponse.json({
      success: true,
      execution_id,
      ttl_hours: 48,
      message: 'Execution logs stored successfully'
    });

  } catch (error) {
    console.error('[DEV LOGS] Error storing execution:', error);
    return NextResponse.json(
      { error: 'Failed to store execution logs', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET: List recent dev executions for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const userId = validation.userId!;
    const redis = await getRedisClient();

    // 2. Get user's execution list (most recent first)
    const userListKey = `dev-executions:user:${userId}`;
    const executionIds = await redis.zRange(userListKey, 0, 49, { REV: true });

    if (executionIds.length === 0) {
      return NextResponse.json({ executions: [] });
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

    return NextResponse.json({ executions });

  } catch (error) {
    console.error('[DEV LOGS] Error listing executions:', error);
    return NextResponse.json(
      { error: 'Failed to list executions', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
