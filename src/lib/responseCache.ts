/**
 * Response Cache Utility for Dynamic Documentation Examples
 * 
 * This utility captures successful API responses and stores them in the database
 * for use as dynamic examples in API documentation.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

interface CacheResponseOptions {
  endpointPath: string;
  httpMethod: string;
  statusCode: number;
  responseBody: Record<string, unknown>;
  requestParams?: Record<string, unknown>;
  executionTimeMs?: number;
  userId?: string;
}

/**
 * Cache a successful API response for documentation examples
 */
export async function cacheResponse(options: CacheResponseOptions) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn('[ResponseCache] Supabase environment variables not configured');
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cache all responses (successful and unsuccessful for comprehensive documentation)

    // Insert the response into the cache
    const { error } = await supabase
      .from('api_response_cache')
      .insert({
        endpoint_path: options.endpointPath,
        http_method: options.httpMethod.toUpperCase(),
        status_code: options.statusCode,
        response_body: options.responseBody,
        request_params: options.requestParams || null,
        execution_time_ms: options.executionTimeMs || null,
        user_id: options.userId || null
      });

    if (error) {
      console.error('[ResponseCache] Failed to cache response:', error);
    } else {
      console.log(`[ResponseCache] Cached ${options.httpMethod} ${options.endpointPath} (${options.statusCode})`);
    }
  } catch (error) {
    console.error('[ResponseCache] Error caching response:', error);
  }
}

/**
 * Wrapper function to automatically cache successful responses
 */
export function withResponseCache<T extends unknown[], R>(
  endpointPath: string,
  httpMethod: string,
  handler: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    const startTime = Date.now();
    
    try {
      const result = await handler(...args);
      const executionTime = Date.now() - startTime;
      
      // If it's a NextResponse, extract the data
      if (result instanceof NextResponse) {
        const responseData = await result.clone().json();
        const statusCode = result.status;
        
        // Cache the response
        await cacheResponse({
          endpointPath,
          httpMethod,
          statusCode,
          responseBody: responseData,
          executionTimeMs: executionTime
        });
      }
      
      return result;
    } catch (error) {
      // Cache error responses too for comprehensive documentation
      const executionTime = Date.now() - startTime;
      
      // Try to extract error response if it's a NextResponse
      if (error instanceof Error) {
        await cacheResponse({
          endpointPath,
          httpMethod,
          statusCode: 500,
          responseBody: { 
            success: false, 
            error: error.message, 
            timestamp: new Date().toISOString() 
          },
          executionTimeMs: executionTime
        });
      }
      
      throw error;
    }
  };
}

/**
 * Fetch cached responses for documentation
 */
export async function getCachedResponses(endpointPath: string, httpMethod: string, limit: number = 10, successOnly: boolean = false) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let query = supabase
      .from('api_response_cache')
      .select('*')
      .eq('endpoint_path', endpointPath)
      .eq('http_method', httpMethod.toUpperCase());

    // Filter for successful responses only if requested
    if (successOnly) {
      query = query.eq('status_code', 200);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('[ResponseCache] Error fetching cached responses:', error);
    return [];
  }
}

/**
 * Get the most recent successful response for an endpoint
 */
export async function getLatestCachedResponse(endpointPath: string, httpMethod: string) {
  const responses = await getCachedResponses(endpointPath, httpMethod, 1, true); // Only successful responses
  return responses.length > 0 ? responses[0] : null;
}

/**
 * Helper to extract request parameters from NextRequest
 */
export function extractRequestParams(
  request: Request, 
  pathParams?: Record<string, string>
): Record<string, unknown> {
  const url = new URL(request.url);
  
  return {
    query: Object.fromEntries(url.searchParams.entries()),
    path: pathParams || {},
    headers: {
      'content-type': request.headers.get('content-type'),
      'user-agent': request.headers.get('user-agent'),
    }
  };
}

/**
 * Normalize endpoint paths for consistent caching
 * e.g., "/api/remote-workflows/123/execute" -> "/api/remote-workflows/[workflowId]/execute"
 */
export function normalizeEndpointPath(path: string): string {
  return path
    // Specific patterns for our API
    .replace(/\/remote-workflows\/\d+/g, '/remote-workflows/[workflowId]')
    .replace(/\/executions\/\d+/g, '/executions/[executionId]')
    .replace(/\/users\/[^/]+/g, '/users/[userId]')
    .replace(/\/sessions\/[^/]+/g, '/sessions/[sessionId]')
    // Generic patterns
    .replace(/\/\d+/g, '/[id]')  // Replace remaining numeric IDs
    .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/[uuid]'); // Replace UUIDs
} 