import { NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.NEXT_PUBLIC_CLICKHOUSE_URL || 'https://g2g4mz36xc.us-east-1.aws.clickhouse.cloud:8443',
  username: process.env.NEXT_PUBLIC_CLICKHOUSE_USERNAME || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE || 'default'
});

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify this is a cron job request (optional security)
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all remote machines
    const query = `
      SELECT id, url, name, health_status, health_details
      FROM remote_machines
      WHERE url IS NOT NULL AND url != ''
      FORMAT JSON
    `;

    const result = await clickhouse.query({ query });
    const data = await result.json();
    const machines = data.data || [];

    console.log(`Checking health for ${machines.length} machines using MCP endpoint`);

    // Check health for each machine
    const healthChecks = await Promise.allSettled(
      machines.map(async (machine: any) => {
        const checkStartTime = Date.now();
        try {
          // Construct MCP endpoint URL
          const baseUrl = machine.url.replace(/\/$/, '');
          const mcpUrl = `${baseUrl}/mcp`;

          // Set a timeout for the health check
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

          // Call MCP get_applications to verify UI automation is working
          const response = await fetch(mcpUrl, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'mcp_terminator-mcp-agent_get_applications',
              params: {}
            })
          });

          clearTimeout(timeoutId);
          const responseTime = Date.now() - checkStartTime;

          // Try to parse response body
          let healthData: any = {};
          let hasTaskbar = false;
          try {
            const text = await response.text();
            if (text) {
              const mcpResponse = JSON.parse(text);

              // Check if we got a valid MCP response with applications
              if (mcpResponse.result && Array.isArray(mcpResponse.result.applications)) {
                // Look for taskbar in the applications list
                hasTaskbar = mcpResponse.result.applications.some((app: any) =>
                  app.name?.toLowerCase().includes('taskbar') ||
                  app.name?.toLowerCase().includes('shell_traywnd')
                );

                console.log(`[${machine.name}] MCP response: ${mcpResponse.result.applications.length} apps, taskbar: ${hasTaskbar}`);

                healthData = {
                  method: 'mcp_get_applications',
                  applicationCount: mcpResponse.result.applications.length,
                  hasTaskbar,
                  applications: mcpResponse.result.applications.slice(0, 5).map((app: any) => app.name)
                };
              } else if (mcpResponse.error) {
                console.log(`[${machine.name}] MCP error: ${mcpResponse.error.message}`);
                healthData = {
                  method: 'mcp_get_applications',
                  error: mcpResponse.error.message || 'MCP method error'
                };
              }
            }
          } catch {
            // If parsing fails, continue without health data
          }

          // Determine health status - healthy if we got a valid response with taskbar
          const isHealthy = response.ok && response.status === 200 && hasTaskbar;
          const newStatus = isHealthy ? 'healthy' : 'unhealthy';

          // Create detailed health info
          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            statusCode: response.status,
            responseTime: responseTime,
            ...healthData
          };

          // Insert into health check history
          const historyQuery = `
            INSERT INTO health_check_history (
              machine_id,
              machine_name,
              status,
              response_time_ms,
              http_status,
              endpoint_type,
              has_taskbar,
              application_count,
              health_details
            ) VALUES (
              '${machine.id}',
              '${machine.name.replace(/'/g, "\\'")}',
              '${newStatus}',
              ${responseTime},
              ${response.status},
              'mcp',
              ${hasTaskbar},
              ${healthData.applicationCount || 0},
              '${JSON.stringify(healthDetails).replace(/'/g, "\\\'")}'
            )
          `;
          await clickhouse.command({ query: historyQuery });

          // Update the machine's health status and details with uptime tracking
          const updateQuery = `
            ALTER TABLE remote_machines
            UPDATE
              health_status = '${newStatus}',
              health_details = '${JSON.stringify(healthDetails).replace(/'/g, "\\'")}',
              total_checks = total_checks + 1,
              successful_checks = successful_checks + ${newStatus === 'healthy' ? 1 : 0},
              consecutive_failures = ${newStatus === 'healthy' ? 0 : 'consecutive_failures + 1'},
              uptime_percentage = (successful_checks + ${newStatus === 'healthy' ? 1 : 0}) * 100.0 / (total_checks + 1),
              ${newStatus === 'healthy' ? `last_healthy_at = now(),` : `last_unhealthy_at = now(),`}
            WHERE id = '${machine.id}'
          `;
          await clickhouse.command({ query: updateQuery });

          return {
            id: machine.id,
            name: machine.name,
            url: machine.url,
            previousStatus: machine.health_status,
            newStatus,
            healthDetails,
            changed: machine.health_status !== newStatus
          };
        } catch (error: any) {
          // Machine is unreachable or errored
          const newStatus = 'unknown';
          const responseTime = Date.now() - checkStartTime;

          console.log(`[${machine.name}] Health check failed: ${error.message}`);

          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            error: error.message || 'MCP health check failed',
            endpoint: 'mcp',
            responseTime: responseTime
          };

          // Insert into health check history
          const historyQuery = `
            INSERT INTO health_check_history (
              machine_id,
              machine_name,
              status,
              response_time_ms,
              endpoint_type,
              error_message,
              health_details
            ) VALUES (
              '${machine.id}',
              '${machine.name.replace(/'/g, "\\'")}',
              '${newStatus}',
              ${responseTime},
              'mcp',
              '${(error.message || 'MCP health check failed').replace(/'/g, "\\'")}',
              '${JSON.stringify(healthDetails).replace(/'/g, "\\\'")}'
            )
          `;
          await clickhouse.command({ query: historyQuery });

          const updateQuery = `
            ALTER TABLE remote_machines
            UPDATE
              health_status = '${newStatus}',
              health_details = '${JSON.stringify(healthDetails).replace(/'/g, "\\'")}',
              total_checks = total_checks + 1,
              consecutive_failures = consecutive_failures + 1,
              uptime_percentage = successful_checks * 100.0 / (total_checks + 1),
              last_unhealthy_at = now()
            WHERE id = '${machine.id}'
          `;
          await clickhouse.command({ query: updateQuery });

          return {
            id: machine.id,
            name: machine.name,
            url: machine.url,
            previousStatus: machine.health_status,
            newStatus,
            healthDetails,
            changed: machine.health_status !== newStatus,
            error: error.message || 'Health check failed'
          };
        }
      })
    );

    // Collect results
    const results = healthChecks.map(result =>
      result.status === 'fulfilled' ? result.value : result.reason
    );

    const summary = {
      totalMachines: machines.length,
      healthy: results.filter(r => r.newStatus === 'healthy').length,
      unhealthy: results.filter(r => r.newStatus === 'unhealthy').length,
      unknown: results.filter(r => r.newStatus === 'unknown').length,
      changed: results.filter(r => r.changed).length,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json({
      success: true,
      summary,
      details: results
    });
  } catch (error: any) {
    console.error('Health check cron job error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Health check failed',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}