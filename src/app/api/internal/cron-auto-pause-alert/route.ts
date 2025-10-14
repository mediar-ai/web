import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NotificationService } from '@/lib/notification-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/internal/cron-auto-pause-alert
 * Called by database trigger when a workflow is auto-paused due to consecutive failures
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflow_id, workflow_name, consecutive_failures, failure_message, execution_id } = body;

    console.log(`🚨 Cron auto-pause alert triggered for workflow ${workflow_id} (${workflow_name})`);
    console.log(`   Consecutive failures: ${consecutive_failures}`);
    console.log(`   Failure message: ${failure_message}`);

    // Get workflow details
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('*')
      .eq('id', workflow_id)
      .single();

    if (workflowError || !workflow) {
      console.error('Failed to fetch workflow details:', workflowError);
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Get last 3 failed executions to include in alert details
    const { data: recentFailures } = await supabase
      .from('workflow_executions')
      .select('id, started_at, completed_at, execution_duration_seconds, formatted_output')
      .eq('workflow_id', workflow_id)
      .eq('status', 'failed')
      .order('completed_at', { ascending: false })
      .limit(3);

    // Send notification alert
    const notificationService = NotificationService.getInstance();

    await notificationService.createAlert({
      config_id: 0, // Will be matched by condition_type in checkExecutionForAlerts
      alert_type: 'cron_auto_paused',
      severity: 'high',
      title: `Workflow Auto-Paused: ${workflow_name}`,
      message: `Workflow automatically paused after ${consecutive_failures} consecutive failures with same error`,
      workflow_id,
      execution_id,
      error_message: failure_message,
      details: {
        workflow_id,
        workflow_name,
        workflow_version: workflow.version,
        consecutive_failures,
        failure_message,
        auto_paused_at: workflow.auto_paused_at,
        auto_pause_reason: workflow.auto_pause_reason,
        cron_expression: workflow.cron_expression,
        cron_timezone: workflow.cron_timezone,
        recent_failures: recentFailures?.map(exec => ({
          execution_id: exec.id,
          started_at: exec.started_at,
          completed_at: exec.completed_at,
          duration: exec.execution_duration_seconds,
          message: (() => {
            try {
              const formatted = typeof exec.formatted_output === 'string'
                ? JSON.parse(exec.formatted_output)
                : exec.formatted_output;
              return formatted?.message || formatted?.error_summary?.error_reason || 'Unknown error';
            } catch {
              return 'Unknown error';
            }
          })()
        })),
        resolution_steps: [
          'Review the failure message and execution logs',
          'Fix the underlying issue causing the failures',
          'Manually re-enable the cron schedule from the workflow settings',
          'Monitor the next few executions to ensure the issue is resolved'
        ]
      }
    });

    // Try to send email notification for all matching cron_auto_pause configs
    try {
      // Get all enabled notification configs for cron_auto_pause
      const { data: configs } = await supabase
        .from('notification_configs')
        .select('*')
        .eq('condition_type', 'cron_auto_pause')
        .eq('enabled', true)
        .or(`organization_id.eq.${workflow.organization_id},organization_id.is.null`);

      if (configs && configs.length > 0) {
        console.log(`Found ${configs.length} notification configs for cron_auto_pause`);

        for (const config of configs) {
          if (config.email_enabled && config.email_recipients?.length > 0) {
            // Send email via internal API
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
              (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://app.mediar.ai');

            await fetch(`${baseUrl}/api/internal/send-notification-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: config.email_recipients,
                subject: `[AUTO-PAUSED] Workflow ${workflow_name}`,
                alert: {
                  severity: 'high',
                  title: `Workflow Auto-Paused: ${workflow_name}`,
                  message: `Workflow automatically paused after ${consecutive_failures} consecutive failures with same error`,
                  details: {
                    workflow_id,
                    workflow_name,
                    consecutive_failures,
                    failure_message,
                    execution_id,
                    auto_paused_at: workflow.auto_paused_at
                  }
                },
                config
              })
            });

            console.log(`✅ Email sent to: ${config.email_recipients.join(', ')}`);
          }
        }
      } else {
        console.log('No enabled notification configs found for cron_auto_pause');
      }
    } catch (emailError) {
      console.error('Failed to send email notifications:', emailError);
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      message: 'Auto-pause alert processed successfully',
      workflow_id,
      workflow_name
    });
  } catch (error) {
    console.error('❌ Error processing auto-pause alert:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
