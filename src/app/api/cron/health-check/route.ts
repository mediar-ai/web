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

    console.log(`Checking health for ${machines.length} machines`);

    // Check health for each machine
    const healthChecks = await Promise.allSettled(
      machines.map(async (machine: any) => {
        const checkStartTime = Date.now();
        try {
          // Construct health endpoint URL
          const baseUrl = machine.url.replace(/\/$/, '');
          const healthUrl = `${baseUrl}/health`;

          // Set a timeout for the health check
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

          const response = await fetch(healthUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
            }
          });

          clearTimeout(timeoutId);
          const responseTime = Date.now() - checkStartTime;

          // Try to parse response body
          let healthData: any = {};
          try {
            const text = await response.text();
            if (text) {
              healthData = JSON.parse(text);
            }
          } catch {
            // If parsing fails, continue without health data
          }

          // Determine health status
          const isHealthy = response.ok && response.status === 200;
          const newStatus = isHealthy ? 'healthy' : 'unhealthy';

          // Create detailed health info
          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            statusCode: response.status,
            responseTime: responseTime,
            ...healthData
          };

          // Update the machine's health status and details
          const updateQuery = `
            ALTER TABLE remote_machines
            UPDATE
              health_status = '${newStatus}',
              health_details = '${JSON.stringify(healthDetails).replace(/'/g, "\\'")}'
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

          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            error: error.message || 'Health check failed',
            responseTime: responseTime
          };

          const updateQuery = `
            ALTER TABLE remote_machines
            UPDATE
              health_status = '${newStatus}',
              health_details = '${JSON.stringify(healthDetails).replace(/'/g, "\\'")}'
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