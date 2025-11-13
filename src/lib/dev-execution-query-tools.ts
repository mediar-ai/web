/**
 * Query tools for dev execution logs
 * Thin wrapper that transforms desktop format and reuses production tools
 */

import * as productionTools from './execution-query-tools';
import {
  transformDesktopToProduction,
  type DesktopExecutionLogs
} from './dev-execution-transformer';

// Re-export production types (they're the same after transformation)
export type {
  StepExecution,
  StepSummary,
  LogEntry,
  ErrorDetail,
  TimelineEntry,
  PerformanceMetrics
} from './execution-query-tools';

/**
 * Search logs in dev execution
 */
export function searchLogs(
  desktopLogs: DesktopExecutionLogs,
  pattern: string,
  limit: number = 100
) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.searchLogs(transformed, pattern, limit);
}

/**
 * Get step details from dev execution
 */
export function getStepDetails(
  desktopLogs: DesktopExecutionLogs,
  stepId: string | number
) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.getStepDetails(transformed, stepId);
}

/**
 * List all steps from dev execution
 */
export function listSteps(desktopLogs: DesktopExecutionLogs) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.listSteps(transformed);
}

/**
 * Get errors from dev execution
 */
export function getErrors(
  desktopLogs: DesktopExecutionLogs,
  limit: number = 50
) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.getErrors(transformed, limit);
}

/**
 * Search in step results
 */
export function searchInResults(
  desktopLogs: DesktopExecutionLogs,
  pattern: string,
  limit: number = 50
) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.searchInResults(transformed, pattern, limit);
}

/**
 * Get execution timeline
 */
export function getTimeline(desktopLogs: DesktopExecutionLogs) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.getTimeline(transformed);
}

/**
 * Get performance metrics
 */
export function getPerformanceMetrics(desktopLogs: DesktopExecutionLogs) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.getPerformanceMetrics(transformed);
}

/**
 * Get logs by time range
 */
export function getLogsByTimeRange(
  desktopLogs: DesktopExecutionLogs,
  startTime: string,
  endTime: string
) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.getLogsByTimeRange(transformed, startTime, endTime);
}

/**
 * Get execution summary
 */
export function getExecutionSummary(desktopLogs: DesktopExecutionLogs) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.getExecutionSummary(transformed);
}

/**
 * Extract section from execution data
 */
export function extractSection(desktopLogs: DesktopExecutionLogs, path: string) {
  const transformed = transformDesktopToProduction(desktopLogs);
  return productionTools.extractSection(transformed, path);
}
