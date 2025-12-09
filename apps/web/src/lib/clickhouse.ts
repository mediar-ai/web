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
  scope_name?: string; // Rust module name (e.g., "terminator_mcp_agent::server")
  host_name?: string; // VM hostname (e.g., "mcp-vm2")
}

/**
 * Query logs from ClickHouse for a specific execution (FALLBACK METHOD - SLOW)
 * ⚠️ WARNING: This function performs a full table scan using ILIKE on the Body column.
 * It's kept for backward compatibility with old executions that don't have trace_id stored.
 *
 * For new executions, use getLogsByTraceId() instead, which is much faster.
 *
 * Performance characteristics:
 * - Body ILIKE '%123%': Full table scan, gets slower as otel_logs grows
 * - LogAttributes['execution_id']: May not be indexed efficiently
 * - Typical query time: 100-500ms+ depending on table size
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
    // OR have execution_id in LogAttributes
    // This is a fallback for old executions without stored trace_id
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
          Body ILIKE {execIdPattern: String}
          OR
          LogAttributes['execution_id'] = {execIdExact: String}
        )
      ORDER BY Timestamp ASC
      LIMIT {limit: UInt32}
    `;

    const resultSet = await clickhouse.query({
      query,
      query_params: {
        execIdPattern: `%${execIdStr}%`,  // For ILIKE wildcard search
        execIdExact: execIdStr,            // For exact attribute match
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
 * Get logs by trace ID (FAST and RELIABLE - uses TraceId index or LogAttributes)
 * This is the preferred method for fetching logs when trace_id is stored in the database.
 *
 * Note: The Rust executor's OpenTelemetryTracingBridge doesn't automatically set the root TraceId
 * on logs, so we also check LogAttributes['trace_id'] which is set by our tracing spans.
 */
export async function getLogsByTraceId(
  traceId: string,
  limit = 1000
): Promise<LogEntry[]> {
  if (!clickhouse) return [];

  try {
    // Check both TraceId column (standard OTLP) and LogAttributes['trace_id'] (our spans)
    // The Rust executor sets trace_id as a span attribute, which appears in LogAttributes
    const query = `
      SELECT
        Timestamp as timestamp,
        SeverityText as level,
        Body as message,
        ServiceName as service,
        SpanId as span_id,
        TraceId as trace_id,
        LogAttributes as attributes,
        ScopeName as scope_name,
        ResourceAttributes['host.name'] as host_name
      FROM otel_logs
      WHERE
        TraceId = {traceId: String}
        OR LogAttributes['trace_id'] = {traceId: String}
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
      scope_name: row.scope_name || row.ScopeName,
      host_name: row.host_name,
    }));
  } catch (error) {
    console.error('[ClickHouse] Failed to query logs by trace ID:', error);
    return [];
  }
}

/**
 * Get MCP agent logs by time window, hostname, or traceId
 * Used to correlate MCP agent logs with executor logs for a specific execution.
 *
 * @param startTime - Start of execution window
 * @param endTime - End of execution window (optional, defaults to now)
 * @param hostname - Optional hostname to filter by (e.g., "mcp-vm2")
 * @param limit - Max logs to return
 * @param traceId - Optional traceId to filter by (if MCP agent has same trace)
 */
export async function getMcpAgentLogs(
  startTime: Date,
  endTime?: Date,
  hostname?: string,
  limit = 500,
  traceId?: string
): Promise<LogEntry[]> {
  if (!clickhouse) return [];

  try {
    // Build filters
    const hostnameFilter = hostname
      ? `AND ResourceAttributes['host.name'] = {hostname: String}`
      : '';

    // If traceId provided, use it (most accurate); otherwise fall back to time window
    const traceFilter = traceId
      ? `AND (TraceId = {traceId: String} OR LogAttributes['trace_id'] = {traceId: String})`
      : '';

    const query = `
      SELECT
        Timestamp as timestamp,
        SeverityText as level,
        Body as message,
        ServiceName as service,
        SpanId as span_id,
        TraceId as trace_id,
        LogAttributes as attributes,
        ScopeName as scope_name,
        ResourceAttributes['host.name'] as host_name
      FROM otel_logs_filtered
      WHERE
        ServiceName = 'terminator-mcp-agent'
        AND Timestamp >= {startTime: DateTime64(9)}
        AND Timestamp <= {endTime: DateTime64(9)}
        ${hostnameFilter}
        ${traceFilter}
      ORDER BY Timestamp ASC
      LIMIT {limit: UInt32}
    `;

    const queryParams: Record<string, any> = {
      startTime: startTime.toISOString().replace('T', ' ').replace('Z', ''),
      endTime: (endTime || new Date()).toISOString().replace('T', ' ').replace('Z', ''),
      limit,
    };
    if (hostname) {
      queryParams.hostname = hostname;
    }
    if (traceId) {
      queryParams.traceId = traceId;
    }

    const resultSet = await clickhouse.query({
      query,
      query_params: queryParams,
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
      scope_name: row.scope_name || row.ScopeName,
      host_name: row.host_name,
    }));
  } catch (error) {
    console.error('[ClickHouse] Failed to query MCP agent logs:', error);
    return [];
  }
}

/**
 * Get MCP agent logs by execution_id (searches in log body)
 * This is the preferred method once MCP agents include execution_id in log messages.
 * Falls back to time window if no logs found with execution_id.
 *
 * @param executionId - The execution ID to filter by
 * @param startTime - Start of execution window (used as additional filter)
 * @param endTime - End of execution window (used as additional filter)
 * @param limit - Max logs to return
 */
export async function getMcpAgentLogsByExecutionId(
  executionId: string | number,
  startTime: Date,
  endTime?: Date,
  limit = 500
): Promise<LogEntry[]> {
  if (!clickhouse) return [];

  const execIdStr = String(executionId);

  try {
    // Search for execution_id in log body (format: "execution_id=12345")
    const query = `
      SELECT
        Timestamp as timestamp,
        SeverityText as level,
        Body as message,
        ServiceName as service,
        SpanId as span_id,
        TraceId as trace_id,
        LogAttributes as attributes,
        ScopeName as scope_name,
        ResourceAttributes['host.name'] as host_name
      FROM otel_logs_filtered
      WHERE
        ServiceName = 'terminator-mcp-agent'
        AND Timestamp >= {startTime: DateTime64(9)}
        AND Timestamp <= {endTime: DateTime64(9)}
        AND Body LIKE {execIdPattern: String}
      ORDER BY Timestamp ASC
      LIMIT {limit: UInt32}
    `;

    const queryParams: Record<string, string | number> = {
      startTime: startTime.toISOString().replace('T', ' ').replace('Z', ''),
      endTime: (endTime || new Date()).toISOString().replace('T', ' ').replace('Z', ''),
      execIdPattern: `%execution_id=${execIdStr}%`,
      limit,
    };

    const resultSet = await clickhouse.query({
      query,
      query_params: queryParams,
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
      scope_name: row.scope_name || row.ScopeName,
      host_name: row.host_name,
    }));
  } catch (error) {
    console.error('[ClickHouse] Failed to query MCP agent logs by execution_id:', error);
    return [];
  }
}
