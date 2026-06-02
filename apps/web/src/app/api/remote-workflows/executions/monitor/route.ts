import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';
import { supabase } from '@/lib/supabase';

const notificationService = NotificationService.getInstance();

// Monitor execution updates and trigger alerts if needed
export async function POST(request: NextRequest) {
  try {
    // Verify service authentication
    const authHeader = request.headers.get('authorization');
    const expectedKey = process.env.MODAL_SERVICE_API_KEY;

    if (!expectedKey) {
      console.error('MODAL_SERVICE_API_KEY not configured');
      return NextResponse.json({ error: 'Service misconfigured' }, { status: 500 });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('Monitor API called without authentication');
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

    const providedKey = authHeader.substring(7);
    if (providedKey !== expectedKey) {
      console.warn('Invalid service API key attempt for monitor endpoint');
      return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 });
    }

    // Handle empty request body
    const body = await request.text();
    if (!body) {
      return NextResponse.json({ success: false, error: 'Empty request body' }, { status: 400 });
    }

    let execution;
    try {
      const parsed = JSON.parse(body);
      execution = parsed.execution;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    if (!execution) {
      return NextResponse.json({ success: false, error: 'No execution data provided' }, { status: 400 });
    }

    // Check if this execution meets any alert conditions
    await notificationService.checkExecutionForAlerts(execution);

    // Trigger error analysis for failed executions
    // Also check formatted_output for business logic failures
    let shouldAnalyze = execution.status === 'error' || execution.status === 'failed';

    // Check if formatted_output indicates failure even if technical execution succeeded
    if (execution.formatted_output) {
      try {
        const formatted = typeof execution.formatted_output === 'string'
          ? JSON.parse(execution.formatted_output)
          : execution.formatted_output;
        if (formatted.success === false) {
          shouldAnalyze = true;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    if (shouldAnalyze) {
      console.log(`Triggering error analysis for execution: ${execution.id} (status: ${execution.status}, business success: false)`);
      try {
        // Get execution details from database
        const { data: executionData } = await supabase
          .from('workflow_executions')
          .select('*')
          .eq('id', execution.id || execution.execution_id)
          .single();

        if (executionData) {
          // Call the error analysis endpoint
          const analysisPayload = {
            executionId: executionData.id,
            workflowId: executionData.workflow_id,
            error: executionData.error || { message: execution.error_message },
            logs: executionData.logs || '',
            results: executionData.results || {},
          };

          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          const response = await fetch(`${baseUrl}/api/internal/analyze-error`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
            },
            body: JSON.stringify(analysisPayload),
          });

          if (response.ok) {
            const _result = await response.json();
            console.log(`Error analysis completed for execution ${execution.id}`);
          } else {
            console.error(`Failed to analyze error for execution ${execution.id}: ${response.status}`);
          }
        }
      } catch (analysisError) {
        console.error(`Error triggering analysis for execution ${execution.id}:`, analysisError);
        // Don't fail the whole request if analysis fails
      }
    }

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