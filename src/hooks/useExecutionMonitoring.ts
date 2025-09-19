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
      ...executions,
      ...liveExecutions.map(le => ({
        id: le.id,
        workflow_id: le.workflow_id,
        status: le.status,
        error_message: le.error_message,
        started_at: le.started_at,
        workflow_name: le.workflow_name,
      })),
    ];

    allExecutions.forEach(execution => {
      currentExecutions.set(execution.id, execution.status);

      const previousStatus = previousExecutions.current.get(execution.id);

      // Check if status changed to error/failed
      if (previousStatus && previousStatus !== execution.status) {
        if (execution.status === 'error' || execution.status === 'failed') {
          // Send monitoring update
          monitorExecution(execution);
        }
      }

      // Also monitor new executions that start in error state
      if (!previousStatus && (execution.status === 'error' || execution.status === 'failed')) {
        monitorExecution(execution);
      }
    });

    previousExecutions.current = currentExecutions;
  }, [executions, liveExecutions]);
}

async function monitorExecution(execution: ExecutionUpdate) {
  try {
    // Skip if execution is undefined or null
    if (!execution || !execution.id) {
      console.warn('Skipping monitoring for invalid execution:', execution);
      return;
    }

    const response = await fetch('/api/remote-workflows/executions/monitor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ execution }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Monitoring endpoint error:', error);
    }
  } catch (error) {
    console.error('Failed to send monitoring update:', error);
  }
}