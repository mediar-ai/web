import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase environment variables are not set');
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify this is a Vercel cron job request using bypass token
  const url = new URL(request.url);
  const bypassTokenFromQuery = url.searchParams.get('x-vercel-protection-bypass');
  const bypassTokenFromHeader = request.headers.get('x-vercel-protection-bypass');
  const expectedBypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  // Check bypass token if configured
  if (expectedBypassToken) {
    const providedToken = bypassTokenFromQuery || bypassTokenFromHeader;
    if (providedToken !== expectedBypassToken) {
      console.warn('[SECURITY] Invalid or missing Vercel bypass token for health-check cron');
      return NextResponse.json(
        { error: 'Unauthorized - Invalid Vercel bypass token' },
        { status: 401 }
      );
    }
  }

  // Also support legacy CRON_SECRET for backward compatibility
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  try {
    // Fetch only active/null status machines with MCP endpoints (skip inactive machines)
    const { data: machines, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .not('mcp_endpoint', 'is', null)
      .or('status.eq.active,status.is.null');

    if (fetchError) {
      throw new Error(`Failed to fetch machines: ${fetchError.message}`);
    }

    if (!machines || machines.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active machines to check',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`Checking health for ${machines.length} machines using MCP endpoint`);

    // Check health for each machine
    const healthChecks = await Promise.allSettled(
      machines.map(async (machine) => {
        const checkStartTime = Date.now();
        let hasTaskbar = false;
        let healthData: any = {};

        try {
          // Use the simple health endpoint instead of complex MCP endpoint
          const baseUrl = machine.mcp_endpoint?.replace('/mcp', '') || machine.management_endpoint;

          if (!baseUrl) {
            throw new Error('No endpoint configured');
          }

          const healthUrl = `${baseUrl}/health`;
          console.log(`[${machine.name}] Checking health at: ${healthUrl}`);

          // Set a timeout for the health check
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          // Simple GET request to health endpoint
          const response = await fetch(healthUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer ***REMOVED***'
            }
          });

          clearTimeout(timeoutId);
          const responseTime = Date.now() - checkStartTime;

          // Simple health check - if we get a 200 response, it's healthy
          let healthResponse: any = {};
          try {
            const text = await response.text();
            if (text) {
              try {
                healthResponse = JSON.parse(text);
              } catch {
                // Plain text response is fine too
                healthResponse = { message: text };
              }
            }
          } catch (_parseError) {
            console.log(`[${machine.name}] Could not parse response, but that's OK`);
          }

          healthData = {
            method: 'health_endpoint',
            statusCode: response.status,
            response: healthResponse
          };

          // Simple logic: if we got a 200 response, it's healthy
          hasTaskbar = response.ok;

          // Determine health status based on response
          let newStatus: string;
          if (response.ok && response.status === 200) {
            newStatus = 'healthy';
            console.log(`[${machine.name}] Status: HEALTHY - HTTP 200`);
          } else {
            newStatus = 'unhealthy';
            console.log(`[${machine.name}] Status: UNHEALTHY - HTTP ${response.status}`);
          }

          // Create detailed health info
          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            statusCode: response.status,
            responseTime: responseTime,
            ...healthData
          };

          // Update machine health status - only update fields that exist
          const currentTime = new Date().toISOString();
          const isHealthy = newStatus === 'healthy';

          // Simple update with just the essential fields
          const updateData: any = {
            health_status: newStatus,
            updated_at: currentTime,
            last_health_check: currentTime
          };

          // Update uptime_seconds if the health response includes it
          if (healthResponse.uptime_seconds !== undefined) {
            updateData.uptime_seconds = healthResponse.uptime_seconds;
          }

          // Only add optional fields if they exist on the machine
          if ('health_details' in machine) {
            updateData.health_details = JSON.stringify(healthDetails);
          }

          if ('total_checks' in machine) {
            updateData.total_checks = (machine.total_checks || 0) + 1;
            updateData.successful_checks = (machine.successful_checks || 0) + (isHealthy ? 1 : 0);
            updateData.consecutive_failures = isHealthy ? 0 : (machine.consecutive_failures || 0) + 1;
          }

          if ('last_response_time_ms' in machine) {
            updateData.last_response_time_ms = responseTime;
          }

          if ('last_check_had_taskbar' in machine) {
            updateData.last_check_had_taskbar = hasTaskbar;
          }

          if ('uptime_percentage' in machine && updateData.total_checks) {
            updateData.uptime_percentage =
              ((updateData.successful_checks / updateData.total_checks) * 100).toFixed(2);
          }

          if ('avg_response_time_ms' in machine && updateData.total_checks) {
            updateData.avg_response_time_ms = Math.round(
              ((machine.avg_response_time_ms || 0) * (machine.total_checks || 0) + responseTime) / updateData.total_checks
            );
          }

          if ('last_healthy_at' in machine && isHealthy) {
            updateData.last_healthy_at = currentTime;
          }

          if ('last_unhealthy_at' in machine && !isHealthy) {
            updateData.last_unhealthy_at = currentTime;
          }

          const { error: updateError } = await supabase
            .from('remote_machines')
            .update(updateData)
            .eq('id', machine.id);

          if (updateError) {
            console.error(`Failed to update machine ${machine.name}:`, updateError);
          }

          return {
            id: machine.id,
            name: machine.name,
            previousStatus: machine.health_status,
            newStatus,
            healthDetails,
            changed: machine.health_status !== newStatus,
            responseTime,
            hasTaskbar
          };

        } catch (error: any) {
          // Machine is unreachable or errored - should be UNHEALTHY not UNKNOWN
          const responseTime = Date.now() - checkStartTime;
          const newStatus = 'unhealthy';

          console.log(`[${machine.name}] Health check failed: ${error.message}`);

          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            error: error.message || 'MCP health check failed',
            endpoint: 'mcp',
            responseTime: responseTime
          };

          // Update machine with error status - only update fields that exist
          const currentTime = new Date().toISOString();
          const updateData: any = {
            health_status: newStatus,
            updated_at: currentTime,
            last_health_check: currentTime
          };

          // Only add optional fields if they exist
          if ('health_details' in machine) {
            updateData.health_details = JSON.stringify(healthDetails);
          }

          if ('total_checks' in machine) {
            updateData.total_checks = (machine.total_checks || 0) + 1;
            updateData.consecutive_failures = (machine.consecutive_failures || 0) + 1;

            if ('uptime_percentage' in machine) {
              updateData.uptime_percentage = (((machine.successful_checks || 0) / updateData.total_checks) * 100).toFixed(2);
            }
          }

          if ('last_unhealthy_at' in machine) {
            updateData.last_unhealthy_at = currentTime;
          }

          if ('last_response_time_ms' in machine) {
            updateData.last_response_time_ms = responseTime;
          }

          if ('last_check_had_taskbar' in machine) {
            updateData.last_check_had_taskbar = false;
          }

          const { error: updateError } = await supabase
            .from('remote_machines')
            .update(updateData)
            .eq('id', machine.id);

          if (updateError) {
            console.error(`Failed to update machine ${machine.name}:`, updateError);
          }

          return {
            id: machine.id,
            name: machine.name,
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

    console.log(`Health check complete: ${summary.healthy}/${summary.totalMachines} healthy`);

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