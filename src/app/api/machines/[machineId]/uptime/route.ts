import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.NEXT_PUBLIC_CLICKHOUSE_URL || 'https://g2g4mz36xc.us-east-1.aws.clickhouse.cloud:8443',
  username: process.env.NEXT_PUBLIC_CLICKHOUSE_USERNAME || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE || 'default'
});

export async function GET(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { machineId } = params;
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '24h';

    // Calculate the time window
    let intervalClause = 'INTERVAL 24 HOUR';
    if (period === '7d') intervalClause = 'INTERVAL 7 DAY';
    else if (period === '30d') intervalClause = 'INTERVAL 30 DAY';
    else if (period === '1h') intervalClause = 'INTERVAL 1 HOUR';

    // Get current machine status and uptime stats
    const machineQuery = `
      SELECT
        id,
        name,
        health_status,
        uptime_percentage,
        consecutive_failures,
        total_checks,
        successful_checks,
        last_healthy_at,
        last_unhealthy_at
      FROM remote_machines
      WHERE id = '${machineId}'
      FORMAT JSON
    `;

    const machineResult = await clickhouse.query({ query: machineQuery });
    const machineData = await machineResult.json();
    const machine = machineData.data?.[0];

    if (!machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      );
    }

    // Get historical health checks for the period
    const historyQuery = `
      SELECT
        check_time,
        status,
        response_time_ms,
        has_taskbar,
        application_count,
        error_message
      FROM health_check_history
      WHERE machine_id = '${machineId}'
        AND check_time >= now() - ${intervalClause}
      ORDER BY check_time DESC
      FORMAT JSON
    `;

    const historyResult = await clickhouse.query({ query: historyQuery });
    const historyData = await historyResult.json();
    const history = historyData.data || [];

    // Calculate uptime statistics for the period
    const healthyCount = history.filter((h: any) => h.status === 'healthy').length;
    const totalCount = history.length;
    const uptimePercentage = totalCount > 0 ? (healthyCount / totalCount) * 100 : 0;

    // Calculate average response time
    const responseTimes = history
      .filter((h: any) => h.response_time_ms > 0)
      .map((h: any) => h.response_time_ms);
    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a: number, b: number) => a + b, 0) / responseTimes.length
      : 0;

    // Find downtime periods
    const downtimePeriods = [];
    let currentDowntime = null;

    for (let i = history.length - 1; i >= 0; i--) {
      const check = history[i];

      if (check.status !== 'healthy') {
        if (!currentDowntime) {
          currentDowntime = {
            start: check.check_time,
            end: null,
            duration: 0,
            error: check.error_message
          };
        }
      } else if (currentDowntime) {
        currentDowntime.end = check.check_time;
        currentDowntime.duration = new Date(currentDowntime.end).getTime() -
                                   new Date(currentDowntime.start).getTime();
        downtimePeriods.push(currentDowntime);
        currentDowntime = null;
      }
    }

    // If still in downtime
    if (currentDowntime) {
      currentDowntime.end = new Date().toISOString();
      currentDowntime.duration = Date.now() - new Date(currentDowntime.start).getTime();
      downtimePeriods.push(currentDowntime);
    }

    // Get hourly uptime stats
    const hourlyStatsQuery = `
      SELECT
        toStartOfHour(check_time) as hour,
        count() as total_checks,
        countIf(status = 'healthy') as healthy_checks,
        avg(response_time_ms) as avg_response_time,
        min(response_time_ms) as min_response_time,
        max(response_time_ms) as max_response_time
      FROM health_check_history
      WHERE machine_id = '${machineId}'
        AND check_time >= now() - ${intervalClause}
      GROUP BY hour
      ORDER BY hour DESC
      FORMAT JSON
    `;

    const hourlyResult = await clickhouse.query({ query: hourlyStatsQuery });
    const hourlyData = await hourlyResult.json();
    const hourlyStats = hourlyData.data || [];

    return NextResponse.json({
      success: true,
      machine: {
        id: machine.id,
        name: machine.name,
        currentStatus: machine.health_status,
        overallUptimePercentage: machine.uptime_percentage,
        consecutiveFailures: machine.consecutive_failures,
        totalChecks: machine.total_checks,
        successfulChecks: machine.successful_checks,
        lastHealthyAt: machine.last_healthy_at,
        lastUnhealthyAt: machine.last_unhealthy_at
      },
      periodStats: {
        period,
        uptimePercentage: uptimePercentage.toFixed(2),
        totalChecks: totalCount,
        healthyChecks: healthyCount,
        avgResponseTime: Math.round(avgResponseTime),
        downtimePeriods: downtimePeriods.length,
        totalDowntimeMs: downtimePeriods.reduce((sum, d) => sum + d.duration, 0)
      },
      hourlyStats,
      downtimePeriods,
      recentChecks: history.slice(0, 10) // Last 10 checks
    });

  } catch (error: any) {
    console.error('Error fetching uptime data:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch uptime data' },
      { status: 500 }
    );
  }
}