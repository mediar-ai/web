import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';
import { supabase } from '@/lib/supabase';

const notificationService = NotificationService.getInstance();

// Monitor execution updates and trigger alerts if needed
export async function POST(request: NextRequest) {
  try {
    // Handle empty request body
    const body = await request.text();
    if (!body) {
      return NextResponse.json({ success: false, error: 'Empty request body' }, { status: 400 });
    }

    let execution;
    try {
      const parsed = JSON.parse(body);
      execution = parsed.execution;
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    if (!execution) {
      return NextResponse.json({ success: false, error: 'No execution data provided' }, { status: 400 });
    }

    // Check if this execution meets any alert conditions
    await notificationService.checkExecutionForAlerts(execution);

    // Also check for critical system-wide issues
    if (execution.status === 'error' || execution.status === 'failed') {
      // Check if this is part of a pattern (multiple failures)
      const tenMinutesAgo = new Date();
      tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

      const { data: recentFailures } = await supabase
        .from('workflow_executions')
        .select('id')
        .eq('workflow_id', execution.workflow_id)
        .in('status', ['error', 'failed'])
        .gte('started_at', tenMinutesAgo.toISOString());

      if (recentFailures && recentFailures.length >= 3) {
        // Multiple failures detected, create a high-severity alert
        await notificationService.createAlert({
          config_id: 1, // Default config, you may want to make this dynamic
          alert_type: 'multiple_failures',
          severity: 'critical',
          title: `Critical: Multiple Workflow Failures Detected`,
          message: `Workflow ${execution.workflow_name || execution.workflow_id} has failed ${recentFailures.length} times in the last 10 minutes`,
          workflow_id: execution.workflow_id,
          details: {
            failure_count: recentFailures.length,
            time_window: '10 minutes',
            latest_error: execution.error_message,
          },
        });
      }
    }

    return NextResponse.json({ success: true, monitored: true });
  } catch (error) {
    console.error('Failed to monitor execution:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to monitor execution' },
      { status: 500 }
    );
  }
}