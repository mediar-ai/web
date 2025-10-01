import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if execution ID is provided in query params
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('id') || '10404';

    // Try to get the execution with length calculations
    // Note: We can't use pg_column_size directly, but we can get the data and check its length
    const { data: execution, error: execError } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, results, raw_logs, created_at')
      .eq('id', executionId)
      .single();

    if (execError) {
      return NextResponse.json({
        error: 'Failed to fetch execution',
        details: execError.message,
        executionId
      }, { status: 500 });
    }

    // Calculate sizes from the actual data
    const resultsSize = execution?.results ? JSON.stringify(execution.results).length : 0;
    const logsSize = execution?.raw_logs ? execution.raw_logs.length : 0;

    // Get multiple executions to find large ones
    const { data: largeExecutions, error: largeError } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, created_at')
      .not('results', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    // Calculate sizes for recent executions (this is expensive, so we limit it)
    const executionsWithSizes = [];
    if (largeExecutions && largeExecutions.length > 0) {
      // Sample just a few to check sizes
      const sampleIds = largeExecutions.slice(0, 5).map(e => e.id);

      for (const id of sampleIds) {
        const { data: exec } = await supabase
          .from('workflow_executions')
          .select('id, workflow_id, results')
          .eq('id', id)
          .single();

        if (exec?.results) {
          const size = JSON.stringify(exec.results).length;
          executionsWithSizes.push({
            id: exec.id,
            workflow_id: exec.workflow_id,
            size_bytes: size,
            size_mb: (size / 1024 / 1024).toFixed(2)
          });
        }
      }
    }

    return NextResponse.json({
      execution_details: {
        id: execution?.id,
        workflow_id: execution?.workflow_id,
        status: execution?.status,
        created_at: execution?.created_at,
        results_size_bytes: resultsSize,
        results_size_kb: (resultsSize / 1024).toFixed(2),
        results_size_mb: (resultsSize / 1024 / 1024).toFixed(2),
        logs_size_bytes: logsSize,
        logs_size_kb: (logsSize / 1024).toFixed(2),
        has_results: !!execution?.results,
        results_preview: execution?.results ?
          JSON.stringify(execution.results).substring(0, 200) + '...' : null
      },
      sampled_large_executions: executionsWithSizes,
      sql_for_exact_sizes: `
-- Run this in Supabase SQL Editor for exact database sizes:
SELECT
  id,
  workflow_id,
  status,
  pg_column_size(results) as results_bytes,
  pg_column_size(results) / 1024 as results_kb,
  pg_column_size(results) / 1024 / 1024 as results_mb,
  pg_column_size(raw_logs) as logs_bytes,
  pg_column_size(raw_mcp_response) as mcp_bytes,
  created_at
FROM workflow_executions
WHERE id = ${executionId};

-- Find largest results columns:
SELECT
  id,
  workflow_id,
  pg_column_size(results) / 1024 / 1024 as results_mb
FROM workflow_executions
WHERE results IS NOT NULL
ORDER BY pg_column_size(results) DESC
LIMIT 10;
      `
    });

  } catch (error) {
    return NextResponse.json({
      error: 'Failed to check size',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}