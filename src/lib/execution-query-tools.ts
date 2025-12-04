/**
 * Query tools for intelligently searching and analyzing execution data
 * These tools allow the AI to query specific parts of the execution rather than loading everything
 */

export interface StepExecution {
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

export interface StepSummary {
  index: number;
  name: string;
  status: string;
  duration_ms?: number;
  hasLogs: boolean;
  hasError: boolean;
  logCount: number;
}

export interface LogEntry {
  stepIndex: number;
  stepName: string;
  timestamp?: string;
  message: string;
  level?: string;
}

export interface ErrorDetail {
  stepIndex: number;
  stepName: string;
  error: string;
  logs?: string[];
  timestamp?: string;
}

export interface TimelineEntry {
  index: number;
  name: string;
  startTime?: string;
  duration_ms?: number;
  status: string;
}

export interface PerformanceMetrics {
  totalDuration: number;
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  skippedSteps: number;
  slowestStep: { name: string; duration: number };
  fastestStep: { name: string; duration: number };
  averageDuration: number;
}

/**
 * Extract execution log data from the results field
 * The results field contains the parsed execution data with execution_log array
 */
export function extractExecutionData(results: any): any {
  try {
    // The results field should have execution_log array with step details
    if (results?.execution_log && Array.isArray(results.execution_log)) {
      return {
        results: results.execution_log,
        // Include other metadata from results
        workflow_name: results.workflow_name,
        status: results.workflow_result?.state || 'unknown',
        total_duration_ms: results.workflow_result?.duration_ms,
        action: results.action || 'execute_sequence'
      };
    }

    // Fallback: if execution_log is not there, treat results as the array directly
    if (Array.isArray(results)) {
      return { results };
    }

    // Another fallback: check if results.output has execution data
    if (results?.output?.execution_log) {
      return {
        results: results.output.execution_log,
        status: results.output.status,
        total_duration_ms: results.performance_metrics?.duration_ms
      };
    }

    return null;
  } catch (error) {
    console.error('Failed to extract execution data:', error);
    return null;
  }
}

/**
 * Search for patterns in all execution logs
 */
export function searchLogs(
  data: any,
  pattern: string,
  limit: number = 100
): LogEntry[] {
  if (!data?.results) return [];

  const matches: LogEntry[] = [];
  const searchPattern = pattern.toLowerCase();

  for (const result of data.results) {
    if (matches.length >= limit) break;

    // Search in regular logs
    if (result.logs && Array.isArray(result.logs)) {
      for (const log of result.logs) {
        if (matches.length >= limit) break;

        const logStr = typeof log === 'string' ? log : JSON.stringify(log);
        if (logStr.toLowerCase().includes(searchPattern)) {
          matches.push({
            stepIndex: result.index || 0,
            stepName: result.tool_name || result.step_id || 'unknown',
            timestamp: result.timestamp,
            message: logStr,
            level: log.level || 'info'
          });
        }
      }
    }

    // Search in server logs
    if (result.server_logs && Array.isArray(result.server_logs)) {
      for (const log of result.server_logs) {
        if (matches.length >= limit) break;

        const logStr = typeof log === 'string' ? log : JSON.stringify(log);
        if (logStr.toLowerCase().includes(searchPattern)) {
          matches.push({
            stepIndex: result.index || 0,
            stepName: result.tool_name || result.step_id || 'unknown',
            timestamp: log.timestamp || result.timestamp,
            message: logStr,
            level: log.level || 'server'
          });
        }
      }
    }

    // Search in error messages
    if (result.error && typeof result.error === 'string') {
      if (result.error.toLowerCase().includes(searchPattern)) {
        matches.push({
          stepIndex: result.index || 0,
          stepName: result.tool_name || result.step_id || 'unknown',
          timestamp: result.timestamp,
          message: result.error,
          level: 'error'
        });
      }
    }
  }

  return matches;
}

/**
 * Get detailed information for a specific step
 */
export function getStepDetails(data: any, stepId: string | number): StepExecution | null {
  if (!data?.results) return null;

  // Try to find by index first (if stepId is a number)
  if (typeof stepId === 'number' || !isNaN(Number(stepId))) {
    const index = typeof stepId === 'number' ? stepId : parseInt(stepId);
    const result = data.results[index];
    if (result) return result;
  }

  // Try to find by step_id or tool_name
  const stepIdStr = String(stepId).toLowerCase();
  return data.results.find((r: any) =>
    r.step_id?.toLowerCase() === stepIdStr ||
    r.tool_name?.toLowerCase() === stepIdStr ||
    String(r.index) === stepIdStr
  ) || null;
}

/**
 * Get a summary list of all steps
 */
export function listSteps(data: any): StepSummary[] {
  if (!data?.results) return [];

  return data.results.map((r: any, index: number) => ({
    index: r.index ?? index,
    name: r.tool_name || r.step_id || `Step ${index}`,
    status: r.status || 'unknown',
    duration_ms: r.duration_ms || 0,
    hasLogs: !!(r.logs && r.logs.length > 0),
    hasError: r.status === 'failed' || !!r.error,
    logCount: (r.logs?.length || 0) + (r.server_logs?.length || 0)
  }));
}

/**
 * Get all errors from the execution
 */
export function getErrors(data: any, limit: number = 50): ErrorDetail[] {
  if (!data?.results) return [];

  const errors: ErrorDetail[] = [];

  for (const result of data.results) {
    if (errors.length >= limit) break;

    if (result.status === 'failed' || result.error) {
      errors.push({
        stepIndex: result.index || 0,
        stepName: result.tool_name || result.step_id || 'unknown',
        error: result.error || 'Step failed without error message',
        logs: result.logs?.slice(-10), // Last 10 logs before error
        timestamp: result.timestamp
      });
    }
  }

  return errors;
}

/**
 * Search in step results/outputs
 */
export function searchInResults(data: any, pattern: string, limit: number = 50): any[] {
  if (!data?.results) return [];

  const matches: any[] = [];
  const searchPattern = pattern.toLowerCase();

  for (const result of data.results) {
    if (matches.length >= limit) break;

    if (result.result) {
      const resultStr = typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result);

      if (resultStr.toLowerCase().includes(searchPattern)) {
        matches.push({
          stepIndex: result.index || 0,
          stepName: result.tool_name || result.step_id || 'unknown',
          match: resultStr.substring(
            Math.max(0, resultStr.toLowerCase().indexOf(searchPattern) - 100),
            Math.min(resultStr.length, resultStr.toLowerCase().indexOf(searchPattern) + pattern.length + 100)
          ),
          fullResult: result.result
        });
      }
    }
  }

  return matches;
}

/**
 * Get execution timeline
 */
export function getTimeline(data: any): TimelineEntry[] {
  if (!data?.results) return [];

  return data.results.map((r: any, index: number) => ({
    index: r.index ?? index,
    name: r.tool_name || r.step_id || `Step ${index}`,
    startTime: r.timestamp,
    duration_ms: r.duration_ms || 0,
    status: r.status || 'unknown'
  }));
}

/**
 * Get performance metrics
 */
export function getPerformanceMetrics(data: any): PerformanceMetrics | null {
  if (!data?.results || data.results.length === 0) return null;

  const durations = data.results
    .filter((r: any) => r.duration_ms)
    .map((r: any) => ({ name: r.tool_name || r.step_id, duration: r.duration_ms }));

  const statusCounts = data.results.reduce((acc: any, r: any) => {
    acc[r.status || 'unknown'] = (acc[r.status || 'unknown'] || 0) + 1;
    return acc;
  }, {});

  const totalDuration = data.total_duration_ms ||
    durations.reduce((sum: number, d: any) => sum + d.duration, 0);

  const sortedByDuration = durations.sort((a: any, b: any) => b.duration - a.duration);

  return {
    totalDuration,
    totalSteps: data.results.length,
    successfulSteps: statusCounts.success || 0,
    failedSteps: statusCounts.failed || 0,
    skippedSteps: statusCounts.skipped || 0,
    slowestStep: sortedByDuration[0] || { name: 'N/A', duration: 0 },
    fastestStep: sortedByDuration[sortedByDuration.length - 1] || { name: 'N/A', duration: 0 },
    averageDuration: durations.length > 0
      ? durations.reduce((sum: number, d: any) => sum + d.duration, 0) / durations.length
      : 0
  };
}

/**
 * Get logs for a specific time range
 */
export function getLogsByTimeRange(
  data: any,
  startTime: string,
  endTime: string
): LogEntry[] {
  if (!data?.results) return [];

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const logs: LogEntry[] = [];

  for (const result of data.results) {
    if (result.timestamp) {
      const stepTime = new Date(result.timestamp).getTime();
      if (stepTime >= start && stepTime <= end) {
        // Add all logs from this step
        if (result.logs) {
          for (const log of result.logs) {
            logs.push({
              stepIndex: result.index || 0,
              stepName: result.tool_name || result.step_id || 'unknown',
              timestamp: result.timestamp,
              message: typeof log === 'string' ? log : JSON.stringify(log),
              level: log.level || 'info'
            });
          }
        }
      }
    }
  }

  return logs;
}

/**
 * Extract a specific section/path from the data
 */
export function extractSection(data: any, path: string): any {
  if (!data) return null;

  const parts = path.split('.');
  let current = data;

  for (const part of parts) {
    if (current && typeof current === 'object') {
      // Handle array indices
      if (part.match(/^\d+$/)) {
        current = current[parseInt(part)];
      } else {
        current = current[part];
      }
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Get a summary of what the workflow did
 */
export function getExecutionSummary(data: any): string {
  if (!data) return 'No execution data available';

  const metrics = getPerformanceMetrics(data);
  const errors = getErrors(data);
  const steps = listSteps(data);

  let summary = `Workflow executed ${steps.length} steps in ${metrics?.totalDuration || 0}ms.\n`;
  summary += `Status: ${data.status || 'unknown'}\n`;

  if (metrics) {
    summary += `Results: ${metrics.successfulSteps} successful, ${metrics.failedSteps} failed, ${metrics.skippedSteps} skipped\n`;
  }

  if (errors.length > 0) {
    summary += `\nErrors found:\n`;
    errors.forEach(e => {
      summary += `- Step '${e.stepName}': ${e.error}\n`;
    });
  }

  if (data.action) {
    summary += `\nAction: ${data.action}`;
  }

  return summary;
}