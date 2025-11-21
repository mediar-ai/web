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
    const serviceFilter = searchParams.get('service') || '';
    const severityFilter = searchParams.get('severity') || '';
    const traceIdFilter = searchParams.get('traceId') || '';
    const searchQuery = searchParams.get('search') || '';
    const getFilters = searchParams.get('getFilters') === 'true';

    // Create ClickHouse client with environment variables
    const clickhouseHost = process.env.CLICKHOUSE_HOST;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD;
    const clickhouseDatabase = process.env.CLICKHOUSE_DATABASE || 'default';

    if (!clickhouseHost || !clickhousePassword) {
      console.error('[Logs API] Missing ClickHouse configuration');
      return NextResponse.json(
        {
          error: 'ClickHouse configuration missing',
          details: 'CLICKHOUSE_HOST and CLICKHOUSE_PASSWORD required',
        },
        { status: 500 }
      );
    }

    const client = createClient({
      url: `https://${clickhouseHost}:8443`,
      username: clickhouseUser,
      password: clickhousePassword,
      database: clickhouseDatabase,
    });

    // If getFilters is true, return available filter values
    if (getFilters) {
      const filtersQuery = `
        SELECT
          groupArray(DISTINCT if(mapContains(ResourceAttributes, 'host.name'), ResourceAttributes['host.name'], '')) as hosts,
          groupArray(DISTINCT ServiceName) as services,
          groupArray(DISTINCT ScopeName) as scopes,
          groupArray(DISTINCT SeverityText) as severities
        FROM otel_logs_filtered
        WHERE Timestamp > now() - INTERVAL ${hours} HOUR
      `;

      const filtersResult = await client.query({
        query: filtersQuery,
        format: 'JSONEachRow',
      });

      const filtersText = await filtersResult.text();
      const filtersData = JSON.parse(filtersText.trim().split('\n')[0]);

      // Prefer ServiceName over host.name because Modal generates ugly SandboxHost-* names
      // Only include actual meaningful hostnames (like mcp-vm2, container names)
      const hosts = (filtersData.hosts || [])
        .filter((s: string) => s && s !== '')
        .filter((s: string) => !s.startsWith('SandboxHost-')); // Filter out Modal sandbox names

      const services = (filtersData.services || []).filter((s: string) => s && s !== '');

      // Combine services and meaningful hosts, prefer services
      const hostOptions = Array.from(new Set([...services, ...hosts]));

      return NextResponse.json({
        success: true,
        filters: {
          hosts: hostOptions.sort(),
          scopes: filtersData.scopes.filter((s: string) => s).sort(),
          severities: filtersData.severities.filter((s: string) => s).sort(),
        },
      });
    }

    // Build dynamic filters
    const conditions: string[] = [];

    if (scopeFilter) {
      conditions.push(`ScopeName LIKE '%${scopeFilter}%'`);
    }
    if (serviceFilter) {
      // Service filter checks both host.name and ServiceName
      conditions.push(
        `((mapContains(ResourceAttributes, 'host.name') AND ResourceAttributes['host.name'] = '${serviceFilter}') OR ServiceName = '${serviceFilter}')`
      );
    }
    if (severityFilter) {
      conditions.push(`SeverityText = '${severityFilter}'`);
    }
    if (traceIdFilter) {
      conditions.push(`TraceId = '${traceIdFilter}'`);
    }
    if (searchQuery) {
      conditions.push(
        `(Body LIKE '%${searchQuery}%' OR ScopeName LIKE '%${searchQuery}%')`
      );
    }

    const whereClause =
      conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    // Query filtered logs (excludes hyper* HTTP client noise)
    const query = `
      SELECT
        Timestamp,
        ScopeName,
        Body,
        SeverityText,
        ServiceName,
        TraceId,
        SpanId,
        if(mapContains(ResourceAttributes, 'host.name') AND ResourceAttributes['host.name'] != '', ResourceAttributes['host.name'], ServiceName) as HostName
      FROM otel_logs_filtered
      WHERE Timestamp > now() - INTERVAL ${hours} HOUR
      ${whereClause}
      ORDER BY Timestamp DESC
      LIMIT 1000
    `;

    console.log(
      `[Logs API] Querying logs for last ${hours} hours with filters:`,
      {
        scope: scopeFilter || 'all',
        service: serviceFilter || 'all',
        severity: severityFilter || 'all',
        traceId: traceIdFilter || 'none',
        search: searchQuery || 'none',
      }
    );

    const result = await client.query({
      query,
      format: 'JSONEachRow',
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
          console.error(
            '[Logs API] Failed to parse log line:',
            line,
            parseError
          );
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
      filters: {
        scope: scopeFilter || null,
        service: serviceFilter || null,
        severity: severityFilter || null,
        traceId: traceIdFilter || null,
        search: searchQuery || null,
      },
    });
  } catch (error) {
    console.error('Failed to fetch logs:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch logs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
