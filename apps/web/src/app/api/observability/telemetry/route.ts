import { createClient } from '@clickhouse/client';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isMediarAdmin } from '@/lib/mediarAuth';

// Create ClickHouse client
const getClickHouseClient = () => {
  return createClient({
    url: `https://${process.env.CLICKHOUSE_HOST}:8443`,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
  });
};

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is Mediar admin
    const isAdmin = await isMediarAdmin();
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Access denied - Mediar admin only' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const hours = searchParams.get('hours') || '24';
    const metric = searchParams.get('metric') || 'overview';

    const client = getClickHouseClient();

    let query = '';

    switch (metric) {
      case 'overview':
        // Service health overview - grouped by hostname
        query = `
          SELECT
            if(mapContains(ResourceAttributes, 'host.name') AND ResourceAttributes['host.name'] != '', ResourceAttributes['host.name'], ServiceName) as ServiceName,
            count() as total_spans,
            countIf(StatusCode = 'STATUS_CODE_ERROR') as errors,
            round((errors / total_spans) * 100, 2) as error_rate,
            toString(max(Timestamp)) as last_seen,
            round(avg(Duration)/1e9, 3) as avg_duration_seconds
          FROM otel_traces
          WHERE Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
          GROUP BY ServiceName
          ORDER BY total_spans DESC
        `;
        break;

      case 'executions':
        // Recent workflow executions - show execute_sequence spans with step details
        query = `
          SELECT
            toString(Timestamp) as Timestamp,
            TraceId,
            ServiceName,
            SpanName,
            Duration/1e9 as duration_seconds,
            StatusCode,
            StatusMessage,
            SpanAttributes,
            toString(if(mapContains(SpanAttributes, 'workflow.name'), SpanAttributes['workflow.name'], '')) as workflow_name,
            toString(if(mapContains(SpanAttributes, 'workflow.total_steps'), SpanAttributes['workflow.total_steps'], '')) as total_steps,
            toString(if(mapContains(ResourceAttributes, 'host.name') AND ResourceAttributes['host.name'] != '', ResourceAttributes['host.name'], ServiceName)) as host_name
          FROM otel_traces
          WHERE SpanName = 'execute_sequence'
            AND Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
          ORDER BY Timestamp DESC
          LIMIT 100
        `;
        break;

      case 'tools':
        // Tool usage statistics - step actions from workflow executions
        query = `
          SELECT
            if(mapContains(SpanAttributes, 'tool.name'),
              SpanAttributes['tool.name'],
              replaceRegexpOne(SpanName, '^step\\\\.', '')
            ) as tool,
            count() as executions,
            round(avg(Duration)/1e9, 3) as avg_seconds,
            round(max(Duration)/1e9, 3) as max_seconds,
            countIf(StatusCode = 'STATUS_CODE_ERROR') as failures,
            round((failures / executions) * 100, 2) as failure_rate
          FROM otel_traces
          WHERE Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
            AND (SpanName LIKE 'step.%' OR mapContains(SpanAttributes, 'tool.name'))
          GROUP BY tool
          HAVING tool != ''
          ORDER BY executions DESC
          LIMIT 100
        `;
        break;

      case 'timeline':
        // Performance over time
        query = `
          SELECT
            toString(toStartOfMinute(Timestamp)) as time,
            ScopeName as ServiceName,
            count() as span_count,
            round(avg(Duration)/1e9, 3) as avg_duration_seconds,
            round(max(Duration)/1e9, 3) as max_duration_seconds,
            countIf(StatusCode = 'STATUS_CODE_ERROR') as errors
          FROM otel_traces
          WHERE Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
          GROUP BY toStartOfMinute(Timestamp), ScopeName
          ORDER BY toStartOfMinute(Timestamp) DESC
          LIMIT 1000
        `;
        break;

      case 'errors':
        // Recent errors with detailed context
        query = `
          SELECT
            toString(Timestamp) as Timestamp,
            TraceId,
            SpanId,
            ServiceName,
            SpanName as operation,
            Duration/1e9 as duration_seconds,
            SpanAttributes,
            toString(if(mapContains(SpanAttributes, 'error.message'), SpanAttributes['error.message'], if(StatusMessage != '', StatusMessage, ''))) as error_message,
            toString(if(mapContains(SpanAttributes, 'error.type'), SpanAttributes['error.type'], '')) as error_type,
            toString(if(mapContains(SpanAttributes, 'workflow.name'), SpanAttributes['workflow.name'], '')) as workflow_name,
            toString(if(mapContains(SpanAttributes, 'step.number'), SpanAttributes['step.number'], '')) as workflow_step,
            toString(if(mapContains(SpanAttributes, 'step.total'), SpanAttributes['step.total'], '')) as total_steps,
            toString(if(mapContains(SpanAttributes, 'tool.name'), SpanAttributes['tool.name'], replaceRegexpOne(SpanName, '^step\\\\.', ''))) as tool_name,
            toString(if(mapContains(ResourceAttributes, 'host.name') AND ResourceAttributes['host.name'] != '', ResourceAttributes['host.name'], ServiceName)) as host_name,
            toString(StatusMessage) as StatusMessage
          FROM otel_traces
          WHERE StatusCode = 'STATUS_CODE_ERROR'
            AND Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
          ORDER BY Timestamp DESC
          LIMIT 200
        `;
        break;

      case 'metrics':
        // Workflow metrics from materialized view (pre-aggregated for performance)
        query = `
          SELECT
            minute,
            workflow_name,
            sum(executions) as total_executions,
            round(sum(total_duration_ns) / sum(executions) / 1e9, 3) as avg_duration_seconds,
            round(max(p95_duration_ns) / 1e9, 3) as p95_duration_seconds,
            round(max(max_duration_ns) / 1e9, 3) as max_duration_seconds,
            round(min(min_duration_ns) / 1e9, 3) as min_duration_seconds,
            sum(errors) as total_errors,
            round((sum(errors) / sum(executions)) * 100, 2) as error_rate
          FROM workflow_metrics
          WHERE minute > now() - INTERVAL ${parseInt(hours)} HOUR
          GROUP BY minute, workflow_name
          ORDER BY minute DESC
          LIMIT 500
        `;
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid metric type' },
          { status: 400 }
        );
    }

    const resultSet = await client.query({
      query,
      format: 'JSONEachRow',
    });

    const data = await resultSet.json();

    return NextResponse.json({
      success: true,
      metric,
      hours: parseInt(hours),
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Telemetry API] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch telemetry data',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
