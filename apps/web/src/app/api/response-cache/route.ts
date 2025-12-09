import { NextRequest, NextResponse } from 'next/server';
import { getCachedResponses, getLatestCachedResponse } from '@/lib/responseCache';

/**
 * API endpoint to fetch cached responses for documentation examples
 * 
 * Query parameters:
 * - endpoint: The endpoint path (e.g., '/api/remote-workflows/executions/[executionId]')
 * - method: HTTP method (GET, POST, etc.)
 * - limit: Number of responses to return (default: 10, max: 50)
 * - latest: If true, returns only the most recent response
 * - success_only: If true, returns only successful responses (status 200)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint');
    const method = searchParams.get('method');
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);
    const latestOnly = searchParams.get('latest') === 'true';
    const successOnly = searchParams.get('success_only') === 'true';

    if (!endpoint || !method) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Missing required parameters: endpoint and method' 
        },
        { status: 400 }
      );
    }

    console.log(`🔍 Fetching cached responses for ${method} ${endpoint}${successOnly ? ' (success only)' : ''}`);

    let responses;
    if (latestOnly) {
      const latest = await getLatestCachedResponse(endpoint, method);
      responses = latest ? [latest] : [];
    } else {
      responses = await getCachedResponses(endpoint, method, limit, successOnly);
    }

    return NextResponse.json({
      success: true,
      endpoint,
      method: method.toUpperCase(),
      count: responses.length,
      responses: responses.map(response => ({
        id: response.id,
        status_code: response.status_code,
        response_body: response.response_body,
        request_params: response.request_params,
        execution_time_ms: response.execution_time_ms,
        created_at: response.created_at,
        user_id: response.user_id
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] Error fetching cached responses:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch cached responses',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * Get available cached endpoint patterns for documentation discovery
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'list_endpoints') {
      // This would list all available cached endpoints
      // For now, return the main endpoints we're caching
      const knownEndpoints = [
        {
          endpoint_path: '/api/remote-workflows/executions/[executionId]',
          methods: ['GET'],
          description: 'Get execution details with optional full response'
        },
        {
          endpoint_path: '/api/remote-workflows/[workflowId]/execute-sync',
          methods: ['POST'],
          description: 'Execute workflow synchronously and return results'
        },
        {
          endpoint_path: '/api/remote-workflows/executions',
          methods: ['GET'],
          description: 'List workflow executions with pagination'
        }
      ];

      return NextResponse.json({
        success: true,
        endpoints: knownEndpoints,
        timestamp: new Date().toISOString()
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action' },
      { status: 400 }
    );

  } catch (error) {
    console.error('[ERROR] Error in response cache API:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process request',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
} 