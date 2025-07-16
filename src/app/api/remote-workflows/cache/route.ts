import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Cache endpoint for instant quote retrieval based on parameters
 * 
 * POST /api/remote-workflows/cache
 * Body: { workflow_id: number, parameters: object }
 * 
 * Returns cached execution results if found, enabling instant responses
 * while background executions keep cache fresh.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { workflow_id, parameters } = body;

    if (!workflow_id || !parameters) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: workflow_id and parameters',
          expected_format: {
            workflow_id: 1,
            parameters: { "param1": "value1" }
          }
        },
        { status: 400 }
      );
    }

    const workflowIdNum = parseInt(workflow_id.toString());
    
    console.log(`🔍 Cache lookup for workflow ${workflowIdNum} with parameters:`, parameters);

    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cache lookup query - get latest matching execution
    const { data: cacheResults, error: cacheError } = await supabase
      .from('workflow_executions')
      .select('id, formatted_output, created_at, execution_duration_seconds, results')
      .eq('workflow_id', workflowIdNum)
      .eq('status', 'completed')
      .eq('execution_params', JSON.stringify(parameters))
      .order('id', { ascending: false })
      .limit(1);

    if (cacheError) {
      throw cacheError;
    }

    const queryTime = Date.now() - startTime;

    if (cacheResults && cacheResults.length > 0) {
      const cacheHit = cacheResults[0];
      
      // Parse formatted output for quotes
      let quotes = [];
      try {
        if (cacheHit.formatted_output) {
          quotes = typeof cacheHit.formatted_output === 'string' 
            ? JSON.parse(cacheHit.formatted_output)
            : cacheHit.formatted_output;
        }
      } catch (parseError) {
        console.warn('⚠️ Failed to parse formatted_output:', parseError);
        quotes = [];
      }

      // Extract quote count from results for additional metadata
      let quoteCount = 0;
      if (cacheHit.results && typeof cacheHit.results === 'object' && cacheHit.results.quotes) {
        quoteCount = Array.isArray(cacheHit.results.quotes) ? cacheHit.results.quotes.length : 0;
      }

      const originalDuration = cacheHit.execution_duration_seconds || 0;
      const speedImprovement = originalDuration > 0 ? Math.round((originalDuration * 1000) / queryTime) : 0;

      console.log(`✅ Cache HIT! Execution ${cacheHit.id} (${queryTime}ms vs ${originalDuration}s original)`);

      return NextResponse.json({
        success: true,
        cached: true,
        cache_info: {
          source_execution_id: cacheHit.id,
          cache_timestamp: cacheHit.created_at,
          original_duration_seconds: originalDuration,
          cache_query_time_ms: queryTime,
          speed_improvement: `${speedImprovement}x faster`,
          quote_count: quoteCount
        },
        data: {
          quotes: quotes,
          workflow_id: workflowIdNum,
          execution_id: cacheHit.id,
          // Include full results if needed for advanced use cases
          full_results: cacheHit.results
        },
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`❌ Cache MISS for workflow ${workflowIdNum} (${queryTime}ms query)`);
      
      return NextResponse.json({
        success: true,
        cached: false,
        cache_info: {
          cache_query_time_ms: queryTime,
          message: 'No cached results found for these parameters'
        },
        data: null,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    const queryTime = Date.now() - startTime;
    console.error('❌ Cache lookup error:', error);
    
    return NextResponse.json(
      {
        success: false,
        cached: false,
        error: 'Cache lookup failed',
        details: error instanceof Error ? error.message : String(error),
        cache_info: {
          cache_query_time_ms: queryTime
        },
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for cache statistics and health check
 */
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get cache statistics
    const { data: stats, error: statsError } = await supabase
      .from('workflow_executions')
      .select('workflow_id, execution_params')
      .eq('status', 'completed')
      .not('formatted_output', 'is', null);

    if (statsError) {
      throw statsError;
    }

    // Calculate cache potential
    const parameterCounts: Record<string, number> = {};
    stats?.forEach(execution => {
      const key = `${execution.workflow_id}:${JSON.stringify(execution.execution_params)}`;
      parameterCounts[key] = (parameterCounts[key] || 0) + 1;
    });

    const cacheablePatterns = Object.values(parameterCounts).filter(count => count > 1).length;
    const totalCacheableExecutions = Object.values(parameterCounts).reduce((sum, count) => sum + (count > 1 ? count - 1 : 0), 0);

    return NextResponse.json({
      success: true,
      cache_statistics: {
        total_completed_executions: stats?.length || 0,
        cacheable_parameter_patterns: cacheablePatterns,
        potential_cache_hits: totalCacheableExecutions,
        cache_hit_potential: totalCacheableExecutions > 0 ? `${Math.round((totalCacheableExecutions / (stats?.length || 1)) * 100)}%` : '0%'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get cache statistics',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
} 