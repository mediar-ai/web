import { createClient } from '@clickhouse/client';

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD;
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';

// Only initialize if credentials are present
export const clickhouse =
  CLICKHOUSE_HOST && CLICKHOUSE_PASSWORD
    ? createClient({
        url: CLICKHOUSE_HOST.startsWith('http')
          ? CLICKHOUSE_HOST
          : `https://${CLICKHOUSE_HOST}:8443`,
        username: CLICKHOUSE_USER,
        password: CLICKHOUSE_PASSWORD,
        database: CLICKHOUSE_DATABASE,
        request_timeout: 30000,
      })
    : null;

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  service: string;
  span_id?: string;
  trace_id?: string;
  attributes?: Record<string, any>;
}

/**
 * Query logs from ClickHouse for a specific execution
 * Note: This relies on the rust-executor logs being ingested into the otel_logs table
 */
export async function getExecutionLogs(
  executionId: string | number,
  limit = 1000
): Promise<LogEntry[]> {
  if (!clickhouse) {
    console.warn('[ClickHouse] Client not initialized - missing credentials');
    return [];
  }

  // Convert execution ID to string for text search
  const execIdStr = String(executionId);

  try {
    // We search for logs that contain the execution ID in the body
    // OR are within the time range of the execution (if we had start/end time)
    // For now, text search is the most reliable link until we add structured attributes
    const query = `
      SELECT
        Timestamp as timestamp,
        SeverityText as level,
        Body as message,
        ServiceName as service,
        SpanId as span_id,
        TraceId as trace_id,
        LogAttributes as attributes
      FROM otel_logs
      WHERE
        ServiceName = 'mediar-workflow-executor-rust'
        AND (
          Body ILIKE {execId: String}
          OR
          LogAttributes['execution_id'] = {execId: String}
        )
      ORDER BY Timestamp ASC
      LIMIT {limit: UInt32}
    `;

    const resultSet = await clickhouse.query({
      query,
      query_params: {
        execId: `%${execIdStr}%`,
        limit,
      },
      format: 'JSONEachRow',
    });

    const results = (await resultSet.json()) as any[];
    return results.map(row => ({
      timestamp: row.timestamp || row.Timestamp,
      level: row.level || row.SeverityText,
      message: row.message || row.Body,
      service: row.service || row.ServiceName,
      span_id: row.span_id || row.SpanId,
      trace_id: row.trace_id || row.TraceId,
      attributes: row.attributes || row.LogAttributes,
    }));
  } catch (error) {
    console.error('[ClickHouse] Failed to query logs:', error);
    return [];
  }
}

/**
 * Try to find the TraceId for an execution by searching for logs/spans with the execution_id attribute
 */
export async function getTraceIdForExecution(
  executionId: string | number
): Promise<string | null> {
  if (!clickhouse) return null;

  const execIdStr = String(executionId);

  try {
    // Search in otel_traces first as it's likely to have the attribute on the root span
    const query = `
      SELECT TraceId
      FROM otel_traces
      WHERE
        ServiceName = 'mediar-workflow-executor-rust'
        AND (
          SpanAttributes['execution_id'] = {execId: String}
          OR
          SpanAttributes['execution.id'] = {execId: String}
        )
      LIMIT 1
    `;

    const resultSet = await clickhouse.query({
      query,
      query_params: {
        execId: execIdStr,
      },
      format: 'JSONEachRow',
    });

    const rows = (await resultSet.json()) as any[];
    if (rows && rows.length > 0) {
      return rows[0].TraceId || rows[0].trace_id;
    }

    // Fallback: Search in otel_logs if not found in traces
    // Sometimes the execution ID is logged but not set as a span attribute on the root span yet
    const logsQuery = `
      SELECT TraceId
      FROM otel_logs
      WHERE
        ServiceName = 'mediar-workflow-executor-rust'
        AND (
          LogAttributes['execution_id'] = {execId: String}
          OR
          Body ILIKE {execIdPattern: String}
        )
        AND TraceId != ''
      LIMIT 1
    `;

    const logsResultSet = await clickhouse.query({
      query: logsQuery,
      query_params: {
        execId: execIdStr,
        execIdPattern: `%${execIdStr}%`,
      },
      format: 'JSONEachRow',
    });

    const logRows = (await logsResultSet.json()) as any[];
    if (logRows && logRows.length > 0) {
      return logRows[0].TraceId || logRows[0].trace_id;
    }

    return null;
  } catch (error) {
    console.error('[ClickHouse] Failed to find trace ID for execution:', error);
    return null;
  }
}

/**
 * Get logs by trace ID (more reliable if we have the trace ID from the execution)
 */
export async function getLogsByTraceId(
  traceId: string,
  limit = 1000
): Promise<LogEntry[]> {
  if (!clickhouse) return [];

  try {
    const query = `
      SELECT
        Timestamp as timestamp,
        SeverityText as level,
        Body as message,
        ServiceName as service,
        SpanId as span_id,
        TraceId as trace_id,
        LogAttributes as attributes
      FROM otel_logs
      WHERE
        TraceId = {traceId: String}
      ORDER BY Timestamp ASC
      LIMIT {limit: UInt32}
    `;

    const resultSet = await clickhouse.query({
      query,
      query_params: {
        traceId,
        limit,
      },
      format: 'JSONEachRow',
    });

    const results = (await resultSet.json()) as any[];
    return results.map(row => ({
      timestamp: row.timestamp || row.Timestamp,
      level: row.level || row.SeverityText,
      message: row.message || row.Body,
      service: row.service || row.ServiceName,
      span_id: row.span_id || row.SpanId,
      trace_id: row.trace_id || row.TraceId,
      attributes: row.attributes || row.LogAttributes,
    }));
  } catch (error) {
    console.error('[ClickHouse] Failed to query logs by trace ID:', error);
    return [];
  }
}
