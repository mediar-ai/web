/**
 * Transform desktop execution logs to production format
 * This allows us to reuse all the existing query tools from execution-query-tools.ts
 */

// Desktop format (from mediar-app workflowExecutionLogs)
export interface ConsoleLogEntry {
  timestamp: number;
  message: string;
  level: 'log' | 'error' | 'warn' | 'info';
}

export interface DesktopStepExecution {
  stepName: string;
  tool: string;
  consoleLogs: ConsoleLogEntry[];
  result?: {
    success: boolean;
    output: string;
    error?: string;
  };
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface DesktopExecutionLogs {
  [stepIndex: number]: DesktopStepExecution;
}

// Production format (for execution-query-tools.ts)
export interface ProductionStepExecution {
  index: number;
  tool_name: string;
  step_id?: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms?: number;
  logs?: string[];
  server_logs?: any[];
  result?: any;
  error?: string;
  timestamp?: string;
}

export interface ProductionExecutionData {
  results: ProductionStepExecution[];
  workflow_name?: string;
  status?: string;
  total_duration_ms?: number;
}

/**
 * Transform desktop logs to production format
 * This allows reusing all existing query tools
 */
export function transformDesktopToProduction(
  desktopLogs: DesktopExecutionLogs
): ProductionExecutionData {
  const steps: ProductionStepExecution[] = [];

  for (const [indexStr, stepLog] of Object.entries(desktopLogs)) {
    const index = parseInt(indexStr);

    // Determine status
    let status: 'success' | 'failed' | 'skipped' = 'success';
    if (stepLog.error || stepLog.result?.error || stepLog.result?.success === false) {
      status = 'failed';
    }

    // Calculate duration
    const duration_ms = stepLog.endTime && stepLog.startTime
      ? stepLog.endTime - stepLog.startTime
      : undefined;

    // Convert consoleLogs to simple string array
    const logs = stepLog.consoleLogs.map((log: ConsoleLogEntry) => log.message);

    // Convert to production format
    steps.push({
      index,
      tool_name: stepLog.tool,
      step_id: stepLog.stepName,
      status,
      duration_ms,
      logs,
      result: stepLog.result?.output,
      error: stepLog.error || stepLog.result?.error,
      timestamp: new Date(stepLog.startTime).toISOString()
    });
  }

  // Sort by index
  steps.sort((a, b) => a.index - b.index);

  return { results: steps };
}
