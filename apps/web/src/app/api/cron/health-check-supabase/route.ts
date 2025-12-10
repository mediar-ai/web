import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPostHogClient } from '@/lib/posthog-server';
import { getVmPublicIp } from '@/lib/azure/vm-operations';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase environment variables are not set');
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Check if request is from Vercel Cron (has vercel-cron user agent)
  const userAgent = request.headers.get('user-agent') || '';
  const isVercelCron = userAgent.includes('vercel-cron');

  // If NOT from Vercel Cron, verify bypass token
  if (!isVercelCron) {
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
  } else {
    console.log('[AUTH] Request authenticated via Vercel Cron user-agent');
  }

  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  try {
    // First, mark all inactive/maintenance/failed machines as having unknown health
    // This prevents misleading "healthy" status on machines that aren't being checked
    const { error: updateInactiveError } = await supabase
      .from('remote_machines')
      .update({
        health_status: 'unknown',
        updated_at: new Date().toISOString()
      })
      .in('status', ['inactive', 'maintenance', 'failed'])
      .neq('health_status', 'unknown');

    if (updateInactiveError) {
      console.error('Failed to update inactive machines:', updateInactiveError);
    } else {
      console.log('Marked inactive/maintenance/failed machines as unknown health');
    }

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
          // Update MCP version if the health response includes it
          if (healthResponse.version !== undefined) {
            updateData.mcp_version = healthResponse.version;
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

          if ('avg_response_time_ms' in machine && updateData.total_checks) {
            updateData.avg_response_time_ms = Math.round(
              ((machine.avg_response_time_ms || 0) * (machine.total_checks || 0) + responseTime) / updateData.total_checks
            );
          }

          if ('last_healthy_at' in machine && isHealthy) {
            updateData.last_healthy_at = currentTime;
          }

          // Track first healthy timestamp for boot time metrics (only set once)
          let bootTimeSeconds: number | null = null;
          if (isHealthy && !machine.first_healthy_at && machine.provisioned_at) {
            updateData.first_healthy_at = currentTime;
            bootTimeSeconds = Math.round((Date.now() - new Date(machine.provisioned_at).getTime()) / 1000);
            console.log(`[${machine.name}] First healthy! Boot time: ${bootTimeSeconds}s (${Math.round(bootTimeSeconds / 60)}min)`);
          }

          if ('last_unhealthy_at' in machine && !isHealthy) {
            updateData.last_unhealthy_at = currentTime;
          }

          // Insert health check history record for rolling window calculation
          const { error: historyError } = await supabase
            .from('health_check_history')
            .insert({
              machine_id: machine.id,
              is_healthy: isHealthy,
              response_time_ms: responseTime,
              status_code: response.status
            });

          if (historyError) {
            console.error(`Failed to insert health history for ${machine.name}:`, historyError);
          }

          // Calculate 24h rolling uptime percentage
          if ('uptime_percentage' in machine) {
            const { data: uptimeData } = await supabase
              .rpc('get_machine_uptime_24h', { p_machine_id: machine.id });
            if (uptimeData !== null) {
              updateData.uptime_percentage = uptimeData;
            }
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
            hasTaskbar,
            bootTimeSeconds
          };

        } catch (error: any) {
          // Machine is unreachable or errored - should be UNHEALTHY not UNKNOWN
          const responseTime = Date.now() - checkStartTime;
          let newStatus = 'unhealthy';
          let syncedIp: string | null = null;

          console.log(`[${machine.name}] Health check failed: ${error.message}`);

          // Auto-sync: If machine has Azure resource ID, try to fetch updated IP and retry
          if (machine.azure_resource_id && (machine.consecutive_failures || 0) >= 2) {
            console.log(`[${machine.name}] Attempting auto-sync from Azure after ${machine.consecutive_failures} failures...`);
            try {
              const publicIp = await getVmPublicIp(machine.azure_resource_id);
              if (publicIp) {
                const currentIp = machine.mcp_endpoint?.match(/http:\/\/([^:]+):/)?.[1];
                if (publicIp !== currentIp) {
                  console.log(`[${machine.name}] IP changed: ${currentIp} -> ${publicIp}, updating endpoints`);
                  syncedIp = publicIp;

                  // Update endpoints in DB
                  await supabase
                    .from('remote_machines')
                    .update({
                      mcp_endpoint: `http://${publicIp}:8080/mcp`,
                      health_endpoint: `http://${publicIp}:8080/health`,
                      management_endpoint: `http://${publicIp}:8080/management`,
                    })
                    .eq('id', machine.id);

                  // Retry health check with new IP
                  const retryUrl = `http://${publicIp}:8080/health`;
                  console.log(`[${machine.name}] Retrying health check at: ${retryUrl}`);
                  const retryController = new AbortController();
                  const retryTimeout = setTimeout(() => retryController.abort(), 10000);

                  try {
                    const retryResponse = await fetch(retryUrl, {
                      method: 'GET',
                      signal: retryController.signal,
                      headers: {
                        'Accept': 'application/json',
                        'Authorization': 'Bearer ***REMOVED***'
                      }
                    });
                    clearTimeout(retryTimeout);

                    if (retryResponse.ok) {
                      console.log(`[${machine.name}] Retry succeeded after IP sync!`);
                      newStatus = 'healthy';
                    }
                  } catch (retryError) {
                    console.log(`[${machine.name}] Retry after sync also failed`);
                    clearTimeout(retryTimeout);
                  }
                } else {
                  console.log(`[${machine.name}] IP unchanged (${publicIp}), sync not needed`);
                }
              }
            } catch (syncError: any) {
              console.log(`[${machine.name}] Auto-sync failed: ${syncError.message}`);
            }
          }

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

          const isHealthy = newStatus === 'healthy';

          if ('total_checks' in machine) {
            updateData.total_checks = (machine.total_checks || 0) + 1;
            updateData.successful_checks = (machine.successful_checks || 0) + (isHealthy ? 1 : 0);
            updateData.consecutive_failures = isHealthy ? 0 : (machine.consecutive_failures || 0) + 1;
          }

          if ('last_healthy_at' in machine && isHealthy) {
            updateData.last_healthy_at = currentTime;
          }

          if ('last_unhealthy_at' in machine && !isHealthy) {
            updateData.last_unhealthy_at = currentTime;
          }

          if ('last_response_time_ms' in machine) {
            updateData.last_response_time_ms = responseTime;
          }

          if ('last_check_had_taskbar' in machine) {
            updateData.last_check_had_taskbar = false;
          }

          // Insert health check history record for rolling window calculation
          const { error: historyError } = await supabase
            .from('health_check_history')
            .insert({
              machine_id: machine.id,
              is_healthy: isHealthy,
              response_time_ms: responseTime,
              error_message: isHealthy ? null : (error.message || 'Health check failed')
            });

          if (historyError) {
            console.error(`Failed to insert health history for ${machine.name}:`, historyError);
          }

          // Calculate 24h rolling uptime percentage
          if ('uptime_percentage' in machine) {
            const { data: uptimeData } = await supabase
              .rpc('get_machine_uptime_24h', { p_machine_id: machine.id });
            if (uptimeData !== null) {
              updateData.uptime_percentage = uptimeData;
            }
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
            error: isHealthy ? null : (error.message || 'Health check failed'),
            syncedIp,
            recoveredViaSync: isHealthy && syncedIp !== null
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

    // Track VM uptime metrics to PostHog
    try {
      const posthog = getPostHogClient();

      // Calculate fleet-wide uptime percentage
      const fleetUptimePercent = summary.totalMachines > 0
        ? Math.round((summary.healthy / summary.totalMachines) * 100)
        : 0;

      // Track aggregate fleet uptime metric (for dashboards/goals)
      posthog.capture({
        distinctId: 'system-health-monitor',
        event: 'vm_fleet_uptime',
        properties: {
          total_machines: summary.totalMachines,
          healthy_count: summary.healthy,
          unhealthy_count: summary.unhealthy,
          unknown_count: summary.unknown,
          uptime_percent: fleetUptimePercent,
          status_changes: summary.changed,
          timestamp: summary.timestamp,
        },
      });

      // Track individual VM health checks for granular analysis
      for (const result of results) {
        if (!result || !result.id) continue;

        posthog.capture({
          distinctId: `vm-${result.id}`,
          event: 'vm_health_check',
          properties: {
            machine_id: result.id,
            machine_name: result.name,
            status: result.newStatus,
            previous_status: result.previousStatus,
            status_changed: result.changed,
            response_time_ms: result.responseTime || result.healthDetails?.responseTime,
            has_taskbar: result.hasTaskbar,
            error: result.error || null,
            boot_time_seconds: result.bootTimeSeconds || null,
          },
        });
      }

      // Flush events to PostHog
      await posthog.flush();
      console.log(`[PostHog] Tracked fleet uptime: ${fleetUptimePercent}% (${summary.healthy}/${summary.totalMachines})`);
    } catch (posthogError) {
      console.error('[PostHog] Failed to track uptime metrics:', posthogError);
      // Don't fail the health check if PostHog tracking fails
    }

    // Cleanup old health check history records (older than 7 days)
    const { data: cleanedCount, error: cleanupError } = await supabase
      .rpc('cleanup_old_health_checks');

    if (cleanupError) {
      console.error('Failed to cleanup old health checks:', cleanupError);
    } else if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old health check records`);
    }

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