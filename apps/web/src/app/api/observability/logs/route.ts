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

    // New LogAttributes filters
    const executionIdFilter = searchParams.get('executionId') || '';
    const workflowFilter = searchParams.get('workflow') || '';
    const organizationFilter = searchParams.get('organization') || '';
    const errorCategoryFilter = searchParams.get('errorCategory') || '';

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
          groupArray(DISTINCT SeverityText) as severities,
          groupArray(DISTINCT if(mapContains(LogAttributes, 'workflow_name') AND LogAttributes['workflow_name'] != '', LogAttributes['workflow_name'], '')) as workflows,
          groupArray(DISTINCT if(mapContains(LogAttributes, 'organization_id') AND LogAttributes['organization_id'] != '', LogAttributes['organization_id'], '')) as organizations,
          groupArray(DISTINCT if(mapContains(LogAttributes, 'error_category') AND LogAttributes['error_category'] != '', LogAttributes['error_category'], '')) as errorCategories,
          groupArray(DISTINCT if(mapContains(LogAttributes, 'trace_id') AND LogAttributes['trace_id'] != '', LogAttributes['trace_id'], '')) as traceIds,
          groupArray(DISTINCT if(mapContains(LogAttributes, 'execution_id') AND LogAttributes['execution_id'] != '', LogAttributes['execution_id'], '')) as executionIds
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

      const services = (filtersData.services || []).filter(
        (s: string) => s && s !== ''
      );

      // Combine services and meaningful hosts, prefer services
      const hostOptions = Array.from(new Set([...services, ...hosts]));

      return NextResponse.json({
        success: true,
        filters: {
          hosts: hostOptions.sort(),
          scopes: (filtersData.scopes || []).filter((s: string) => s).sort(),
          severities: (filtersData.severities || [])
            .filter((s: string) => s)
            .sort(),
          workflows: (filtersData.workflows || [])
            .filter((s: string) => s)
            .sort(),
          organizations: (filtersData.organizations || [])
            .filter((s: string) => s)
            .sort(),
          errorCategories: (filtersData.errorCategories || [])
            .filter((s: string) => s)
            .sort(),
          traceIds: (filtersData.traceIds || [])
            .filter((s: string) => s)
            .sort()
            .slice(0, 100), // Limit to 100 most recent
          executionIds: (filtersData.executionIds || [])
            .filter((s: string) => s)
            .sort((a: string, b: string) => parseInt(b) - parseInt(a)) // Sort descending (newest first)
            .slice(0, 100), // Limit to 100 most recent
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
      // Hierarchical severity filtering: show selected level AND all higher severities
      // Log level hierarchy: DEBUG (1) < INFO (2) < WARN (3) < ERROR (4) < FATAL (5)
      const severityLevels: Record<string, number> = {
        DEBUG: 1,
        INFO: 2,
        WARN: 3,
        WARNING: 3, // alias for WARN
        ERROR: 4,
        FATAL: 5,
      };

      const selectedLevel = severityLevels[severityFilter.toUpperCase()] || 0;

      if (selectedLevel > 0) {
        // Build list of severity levels >= selected level
        const allowedLevels = Object.keys(severityLevels)
          .filter(level => severityLevels[level] >= selectedLevel)
          .map(level => `'${level}'`)
          .join(', ');

        conditions.push(`SeverityText IN (${allowedLevels})`);
      }
    }
    if (traceIdFilter) {
      // Search in both OTEL TraceId and custom trace_id attribute
      conditions.push(
        `(TraceId = '${traceIdFilter}' OR (mapContains(LogAttributes, 'trace_id') AND LogAttributes['trace_id'] = '${traceIdFilter}'))`
      );
    }
    if (searchQuery) {
      conditions.push(
        `(Body LIKE '%${searchQuery}%' OR ScopeName LIKE '%${searchQuery}%')`
      );
    }

    // New LogAttributes filters
    if (executionIdFilter) {
      conditions.push(
        `(mapContains(LogAttributes, 'execution_id') AND LogAttributes['execution_id'] = '${executionIdFilter}')`
      );
    }
    if (workflowFilter) {
      conditions.push(
        `(mapContains(LogAttributes, 'workflow_name') AND LogAttributes['workflow_name'] = '${workflowFilter}')`
      );
    }
    if (organizationFilter) {
      conditions.push(
        `(mapContains(LogAttributes, 'organization_id') AND LogAttributes['organization_id'] = '${organizationFilter}')`
      );
    }
    if (errorCategoryFilter) {
      conditions.push(
        `(mapContains(LogAttributes, 'error_category') AND LogAttributes['error_category'] = '${errorCategoryFilter}')`
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
        if(mapContains(ResourceAttributes, 'host.name') AND ResourceAttributes['host.name'] != '', ResourceAttributes['host.name'], ServiceName) as HostName,
        if(mapContains(LogAttributes, 'trace_id'), LogAttributes['trace_id'], '') as trace_id,
        if(mapContains(LogAttributes, 'execution_id'), LogAttributes['execution_id'], '') as execution_id,
        if(mapContains(LogAttributes, 'workflow_id'), LogAttributes['workflow_id'], '') as workflow_id,
        if(mapContains(LogAttributes, 'workflow_name'), LogAttributes['workflow_name'], '') as workflow_name,
        if(mapContains(LogAttributes, 'organization_id'), LogAttributes['organization_id'], '') as organization_id,
        if(mapContains(LogAttributes, 'error_category'), LogAttributes['error_category'], '') as error_category,
        if(mapContains(LogAttributes, 'retry_count'), LogAttributes['retry_count'], '') as retry_count,
        if(mapContains(LogAttributes, 'execution_time_ms'), LogAttributes['execution_time_ms'], '') as execution_time_ms,
        if(mapContains(LogAttributes, 'mcp_endpoint'), LogAttributes['mcp_endpoint'], '') as mcp_endpoint,
        LogAttributes
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
        executionId: executionIdFilter || 'none',
        workflow: workflowFilter || 'none',
        organization: organizationFilter || 'none',
        errorCategory: errorCategoryFilter || 'none',
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
        executionId: executionIdFilter || null,
        workflow: workflowFilter || null,
        organization: organizationFilter || null,
        errorCategory: errorCategoryFilter || null,
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
