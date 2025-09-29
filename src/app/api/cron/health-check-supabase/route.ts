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
  // Verify this is a cron job request (optional security)
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
    // Fetch all active remote machines
    const { data: machines, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .not('mcp_endpoint', 'is', null)
      .eq('status', 'active');

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
          // Construct MCP endpoint URL
          const mcpUrl = machine.mcp_endpoint;

          if (!mcpUrl) {
            throw new Error('No MCP endpoint configured');
          }

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
          try {
            const text = await response.text();
            if (text) {
              const mcpResponse = JSON.parse(text);

              // Check if we got a valid MCP response with applications
              if (mcpResponse.result) {
                // Handle both direct applications array and nested structure
                const applications = mcpResponse.result.applications ||
                                    (mcpResponse.result.content && mcpResponse.result.content[0]?.applications) ||
                                    [];

                // Look for taskbar in the applications list
                hasTaskbar = applications.some((app: any) =>
                  app.name?.toLowerCase().includes('taskbar') ||
                  app.name?.toLowerCase().includes('shell_traywnd')
                );

                // Update healthData with the correct application count
                mcpResponse.result.applications = applications;

                console.log(`[${machine.name}] MCP response: ${mcpResponse.result.applications.length} apps, taskbar: ${hasTaskbar}`);

                // Log warning if no applications detected
                if (mcpResponse.result.applications.length === 0) {
                  console.warn(`[${machine.name}] WARNING: MCP returned 0 applications - possible service/permission issue`);
                }

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
          } catch (parseError) {
            console.log(`[${machine.name}] Failed to parse MCP response`);
          }

          // Determine health status based on response
          let newStatus: string;
          if (!response.ok || response.status !== 200) {
            newStatus = 'unknown'; // Network/connection issue
            console.log(`[${machine.name}] Status: UNKNOWN - HTTP ${response.status}`);
          } else if (hasTaskbar) {
            newStatus = 'healthy'; // Taskbar detected = Windows UI accessible
            console.log(`[${machine.name}] Status: HEALTHY - Taskbar detected`);
          } else if (healthData.applicationCount > 0) {
            newStatus = 'unhealthy'; // Apps detected but no taskbar
            console.log(`[${machine.name}] Status: UNHEALTHY - ${healthData.applicationCount} apps but no taskbar`);
          } else if (healthData.applicationCount === 0) {
            newStatus = 'unhealthy'; // MCP responding but no UI access
            console.log(`[${machine.name}] Status: UNHEALTHY - No applications detected`);
          } else {
            newStatus = 'unknown'; // Couldn't parse response properly
            console.log(`[${machine.name}] Status: UNKNOWN - Parse error`);
          }

          // Create detailed health info
          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            statusCode: response.status,
            responseTime: responseTime,
            ...healthData
          };

          // Update machine health status with uptime tracking
          const currentTime = new Date().toISOString();
          const isHealthy = newStatus === 'healthy';
          const updateData: any = {
            health_status: newStatus,
            health_details: JSON.stringify(healthDetails),
            total_checks: machine.total_checks + 1,
            successful_checks: machine.successful_checks + (isHealthy ? 1 : 0),
            consecutive_failures: isHealthy ? 0 : (machine.consecutive_failures || 0) + 1,
            last_response_time_ms: responseTime,
            last_check_had_taskbar: hasTaskbar,
            updated_at: currentTime
          };

          // Update uptime percentage
          updateData.uptime_percentage =
            ((updateData.successful_checks / updateData.total_checks) * 100).toFixed(2);

          // Update average response time
          if (machine.avg_response_time_ms) {
            updateData.avg_response_time_ms = Math.round(
              (machine.avg_response_time_ms * machine.total_checks + responseTime) / updateData.total_checks
            );
          } else {
            updateData.avg_response_time_ms = responseTime;
          }

          // Set last healthy/unhealthy timestamps
          if (isHealthy) {
            updateData.last_healthy_at = currentTime;
          } else {
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
          // Machine is unreachable or errored
          const responseTime = Date.now() - checkStartTime;
          const newStatus = 'unknown';

          console.log(`[${machine.name}] Health check failed: ${error.message}`);

          const healthDetails = {
            lastCheck: new Date().toISOString(),
            status: newStatus,
            error: error.message || 'MCP health check failed',
            endpoint: 'mcp',
            responseTime: responseTime
          };

          // Update machine with error status
          const currentTime = new Date().toISOString();
          const updateData = {
            health_status: newStatus,
            health_details: JSON.stringify(healthDetails),
            total_checks: machine.total_checks + 1,
            consecutive_failures: (machine.consecutive_failures || 0) + 1,
            last_unhealthy_at: currentTime,
            last_response_time_ms: responseTime,
            last_check_had_taskbar: false,
            uptime_percentage: ((machine.successful_checks / (machine.total_checks + 1)) * 100).toFixed(2),
            updated_at: currentTime
          };

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