import { useEffect, useRef } from 'react';

interface ExecutionUpdate {
  id: number;
  workflow_id: number;
  workflow_name?: string;
  status: string;
  error_message?: string;
  started_at?: string;
  ended_at?: string;
  execution_time_seconds?: number;
}

export function useExecutionMonitoring(executions: any[], liveExecutions: any[]) {
  const previousExecutions = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    // Monitor for status changes in executions
    const currentExecutions = new Map<number, string>();

    // Combine regular and live executions for monitoring
    const allExecutions = [
      ...executions.map(e => ({
        id: e.execution_id, // Fix: use execution_id field
        execution_id: e.execution_id,
        workflow_id: e.workflow_id,
        workflow_name: e.workflow_name,
        status: e.status,
        error_message: e.error_message || e.error,
        started_at: e.started_at,
        completed_at: e.completed_at,
        execution_time_seconds: e.execution_time_seconds,
      })),
      ...liveExecutions.map(le => ({
        id: le.id || le.execution_id, // Handle both id and execution_id
        execution_id: le.id || le.execution_id,
        workflow_id: le.workflow_id,
        workflow_name: le.workflow_name,
        status: le.status,
        error_message: le.error_message,
        started_at: le.started_at,
      })),
    ];

    allExecutions.forEach(execution => {
      const execId = execution.execution_id || execution.id;
      currentExecutions.set(execId, execution.status);

      const previousStatus = previousExecutions.current.get(execId);

      // Check if status changed to error/failed
      if (previousStatus && previousStatus !== execution.status) {
        if (execution.status === 'error' || execution.status === 'failed') {
          console.log(`Execution ${execId} failed - triggering alert check`);
          // Send monitoring update
          monitorExecution(execution);
        }
      }

      // Also monitor new executions that start in error state
      if (!previousStatus && (execution.status === 'error' || execution.status === 'failed')) {
        console.log(`New failed execution ${execId} detected - triggering alert check`);
        monitorExecution(execution);
      }
    });

    previousExecutions.current = currentExecutions;
  }, [executions, liveExecutions]);
}

async function monitorExecution(execution: any) {
  try {
    // Skip if execution is undefined or null
    const execId = execution?.execution_id || execution?.id;
    if (!execution || !execId) {
      console.warn('Skipping monitoring for invalid execution:', execution);
      return;
    }

    console.log(`Sending alert check for failed execution ${execId}`, execution);

    // Enhance execution data with additional context
    const enhancedExecution = {
      ...execution,
      id: execId, // Ensure we have the ID field
      execution_id: execId,
      // Add request context if available
      request_ip: typeof window !== 'undefined' ? window.location.hostname : undefined,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      trigger_source: 'deployment_dashboard',

      // Add timestamp if not present
      monitored_at: new Date().toISOString(),
    };

    const response = await fetch('/api/remote-workflows/executions/monitor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ execution: enhancedExecution }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Monitoring endpoint error:', error);
    }
  } catch (error) {
    console.error('Failed to send monitoring update:', error);
  }
}