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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ traceId: string }> }
) {
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

    const { traceId } = await params;
    const client = getClickHouseClient();

    // Fetch all spans for this trace
    const query = `
      SELECT
        TraceId,
        SpanId,
        ParentSpanId,
        SpanName,
        ScopeName as ServiceName,
        formatDateTime(Timestamp, '%Y-%m-%dT%H:%M:%SZ') as start_time,
        formatDateTime(Timestamp + INTERVAL Duration/1e9 SECOND, '%Y-%m-%dT%H:%M:%SZ') as end_time,
        Duration/1e9 as duration_seconds,
        StatusCode,
        SpanAttributes
      FROM otel_traces
      WHERE TraceId = {traceId:String}
      ORDER BY Timestamp
    `;

    const resultSet = await client.query({
      query,
      query_params: { traceId },
      format: 'JSONEachRow'
    });

    const spans = await resultSet.json();

    // Build a tree structure for visualization
    const spanMap = new Map();
    const rootSpans: any[] = [];

    // First pass: create span objects
    spans.forEach((span: any) => {
      spanMap.set(span.SpanId, {
        ...span,
        children: []
      });
    });

    // Second pass: build tree
    spans.forEach((span: any) => {
      if (span.ParentSpanId && spanMap.has(span.ParentSpanId)) {
        spanMap.get(span.ParentSpanId).children.push(spanMap.get(span.SpanId));
      } else {
        rootSpans.push(spanMap.get(span.SpanId));
      }
    });

    return NextResponse.json({
      success: true,
      traceId,
      spans,
      tree: rootSpans,
      totalSpans: spans.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Trace API] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch trace data',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}