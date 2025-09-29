import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

// This endpoint can be called via cron or webhook to analyze recent failures
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();

    // Get recent failed executions without analysis
    const { data: failedExecutions, error: fetchError } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, error, logs, results, created_at')
      .eq('status', 'failed')
      .is('error_analysis', null)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .order('created_at', { ascending: false })
      .limit(10);

    if (fetchError) {
      console.error('Failed to fetch executions:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch executions' }, { status: 500 });
    }

    const analyzed = [];

    for (const execution of failedExecutions || []) {
      try {
        // Call the analyze-error endpoint for each failed execution
        const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/internal/analyze-error`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Add internal auth if needed
          },
          body: JSON.stringify({
            executionId: execution.id,
            workflowId: execution.workflow_id,
            error: execution.error,
            logs: execution.logs,
            results: execution.results,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          analyzed.push({
            executionId: execution.id,
            success: true,
            analysis: result.analysis,
          });

          // If this is an OneDrive to SAP workflow, check for specific issues
          if (execution.logs?.includes('journal') || execution.logs?.includes('SAP')) {
            await checkAndNotifyForSAPErrors(supabase, execution, result.analysis);
          }
        }
      } catch (error) {
        console.error(`Failed to analyze execution ${execution.id}:`, error);
        analyzed.push({
          executionId: execution.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      analyzed: analyzed.length,
      results: analyzed,
    });

  } catch (error) {
    console.error('Batch analysis failed:', error);
    return NextResponse.json(
      { error: 'Batch analysis failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function checkAndNotifyForSAPErrors(supabase: any, execution: any, analysis: string) {
  // Check for critical SAP-related errors that need immediate attention
  const criticalPatterns = [
    { pattern: /MCP connection timeout/i, severity: 'critical', action: 'restart_mcp' },
    { pattern: /SAP session timeout/i, severity: 'high', action: 'relogin_sap' },
    { pattern: /journal entry.*failed/i, severity: 'high', action: 'review_data' },
    { pattern: /element.*not found/i, severity: 'medium', action: 'update_selectors' },
  ];

  for (const { pattern, severity, action } of criticalPatterns) {
    if (pattern.test(analysis) || pattern.test(execution.error?.message || '')) {
      // Log critical issue for monitoring
      await supabase.from('workflow_alerts').insert({
        workflow_id: execution.workflow_id,
        execution_id: execution.id,
        severity,
        action_required: action,
        analysis_summary: analysis.slice(0, 500),
        created_at: new Date().toISOString(),
      });

      // Trigger email notification if critical
      if (severity === 'critical') {
        // You can integrate with your existing email system here
        console.log(`CRITICAL ALERT: ${action} required for execution ${execution.id}`);
      }
      break;
    }
  }
}

// GET endpoint to check analysis status
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerClient();

    const { data: stats } = await supabase
      .from('workflow_executions')
      .select('status, error_analysis')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const total = stats?.length || 0;
    const failed = stats?.filter(s => s.status === 'failed').length || 0;
    const analyzed = stats?.filter(s => s.status === 'failed' && s.error_analysis).length || 0;

    return NextResponse.json({
      total_executions_24h: total,
      failed_executions: failed,
      analyzed_failures: analyzed,
      analysis_coverage: failed > 0 ? ((analyzed / failed) * 100).toFixed(1) + '%' : '0%',
    });

  } catch (error) {
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}