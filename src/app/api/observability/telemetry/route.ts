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
      return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const hours = searchParams.get('hours') || '24';
    const metric = searchParams.get('metric') || 'overview';

    const client = getClickHouseClient();

    let query = '';

    switch (metric) {
      case 'overview':
        // Service health overview
        query = `
          SELECT
            ScopeName as ServiceName,
            count() as total_spans,
            countIf(StatusCode = 'STATUS_CODE_ERROR') as errors,
            round((errors / total_spans) * 100, 2) as error_rate,
            toString(max(Timestamp)) as last_seen,
            round(avg(Duration)/1e9, 3) as avg_duration_seconds
          FROM otel_traces
          WHERE Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
          GROUP BY ScopeName
          ORDER BY total_spans DESC
        `;
        break;

      case 'executions':
        // Recent workflow executions - get all spans grouped by TraceId
        query = `
          WITH trace_summary AS (
            SELECT
              TraceId,
              min(Timestamp) as start_time,
              max(Timestamp) as end_time,
              sum(Duration)/1e9 as total_duration_seconds,
              countIf(StatusCode = 'STATUS_CODE_ERROR') > 0 as has_error,
              if(has_error, 'STATUS_CODE_ERROR', 'STATUS_CODE_OK') as StatusCode,
              any(ScopeName) as ServiceName,
              any(SpanName) as SpanName,
              any(SpanAttributes) as SpanAttributes
            FROM otel_traces
            WHERE Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
            GROUP BY TraceId
          )
          SELECT
            toString(start_time) as Timestamp,
            TraceId,
            ServiceName,
            SpanName,
            total_duration_seconds as duration_seconds,
            StatusCode,
            SpanAttributes
          FROM trace_summary
          ORDER BY start_time DESC
          LIMIT 100
        `;
        break;

      case 'tools':
        // Tool usage statistics - using SpanName as fallback if tool attribute doesn't exist
        query = `
          SELECT
            coalesce(
              if(mapContains(SpanAttributes, 'tool.name'), SpanAttributes['tool.name'], ''),
              if(mapContains(SpanAttributes, 'tool'), SpanAttributes['tool'], ''),
              SpanName
            ) as tool,
            count() as executions,
            round(avg(Duration)/1e9, 3) as avg_seconds,
            round(max(Duration)/1e9, 3) as max_seconds,
            countIf(StatusCode = 'STATUS_CODE_ERROR') as failures,
            round((failures / executions) * 100, 2) as failure_rate
          FROM otel_traces
          WHERE Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
            AND (
              SpanName = 'tool_execution'
              OR SpanName LIKE '%tool%'
              OR mapContains(SpanAttributes, 'tool.name')
              OR mapContains(SpanAttributes, 'tool')
            )
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
            ScopeName as ServiceName,
            SpanName as operation,
            Duration/1e9 as duration_seconds,
            SpanAttributes,
            if(mapContains(SpanAttributes, 'error.message'), SpanAttributes['error.message'], '') as error_message,
            if(mapContains(SpanAttributes, 'workflow.name'), SpanAttributes['workflow.name'], '') as workflow_name,
            if(mapContains(SpanAttributes, 'workflow.step'), SpanAttributes['workflow.step'], '') as workflow_step,
            if(mapContains(SpanAttributes, 'machine.id'), SpanAttributes['machine.id'], '') as machine_id,
            StatusMessage
          FROM otel_traces
          WHERE StatusCode = 'STATUS_CODE_ERROR'
            AND Timestamp > now() - INTERVAL ${parseInt(hours)} HOUR
          ORDER BY Timestamp DESC
          LIMIT 200
        `;
        break;

      default:
        return NextResponse.json({ error: 'Invalid metric type' }, { status: 400 });
    }

    const resultSet = await client.query({
      query,
      format: 'JSONEachRow'
    });

    const data = await resultSet.json();

    return NextResponse.json({
      success: true,
      metric,
      hours: parseInt(hours),
      data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Telemetry API] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch telemetry data',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}