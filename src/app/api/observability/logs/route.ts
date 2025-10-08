import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const hours = searchParams.get('hours') || '24';
    const scopeFilter = searchParams.get('scope') || '';

    // Create ClickHouse client with environment variables
    const clickhouseHost = process.env.CLICKHOUSE_HOST;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD;
    const clickhouseDatabase = process.env.CLICKHOUSE_DATABASE || 'default';

    if (!clickhouseHost || !clickhousePassword) {
      console.error('[Logs API] Missing ClickHouse configuration');
      return NextResponse.json(
        { error: 'ClickHouse configuration missing', details: 'CLICKHOUSE_HOST and CLICKHOUSE_PASSWORD required' },
        { status: 500 }
      );
    }

    const client = createClient({
      url: `https://${clickhouseHost}:8443`,
      username: clickhouseUser,
      password: clickhousePassword,
      database: clickhouseDatabase
    });

    // Build scope filter if provided
    const scopeCondition = scopeFilter
      ? `AND ScopeName LIKE '%${scopeFilter}%'`
      : '';

    // Query filtered logs (excludes hyper* HTTP client noise)
    const query = `
      SELECT
        Timestamp,
        ScopeName,
        Body,
        SeverityText,
        ServiceName,
        TraceId,
        SpanId
      FROM otel_logs_filtered
      WHERE Timestamp > now() - INTERVAL ${hours} HOUR
      ${scopeCondition}
      ORDER BY Timestamp DESC
      LIMIT 1000
    `;

    console.log(`[Logs API] Querying logs for last ${hours} hours${scopeFilter ? ` with scope filter: ${scopeFilter}` : ''}`);

    const result = await client.query({
      query,
      format: 'JSONEachRow'
    });

    const text = await result.text();
    const logs = text
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (parseError) {
          console.error('[Logs API] Failed to parse log line:', line, parseError);
          return null;
        }
      })
      .filter(log => log !== null);

    console.log(`[Logs API] Successfully retrieved ${logs.length} logs`);

    return NextResponse.json({
      success: true,
      logs,
      count: logs.length,
      hours: parseInt(hours),
      scope_filter: scopeFilter || null
    });

  } catch (error) {
    console.error('Failed to fetch logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
