import { NextResponse } from 'next/server';

export async function GET() {
  // Simulate health responses from the cron output
  const testResponses = [
    {
      name: "With uptime_seconds",
      response: {
        status: "ok",
        uptime_seconds: 86400,
        timestamp: "2025-09-30T20:43:30.601226700+00:00"
      }
    },
    {
      name: "Without uptime_seconds (current actual response)",
      response: {
        status: "healthy",
        extension_bridge: {
          connected: false,
          status: "not_initialized"
        },
        automation: {
          api_available: true,
          desktop_accessible: true
        },
        timestamp: "2025-09-30T20:43:30.621861700+00:00"
      }
    }
  ];

  const results = testResponses.map(test => {
    const healthResponse = test.response;
    const updateData: any = {
      health_status: 'healthy',
      last_health_check: new Date().toISOString()
    };

    // This is the logic from the cron
    if (healthResponse.uptime_seconds !== undefined) {
      updateData.uptime_seconds = healthResponse.uptime_seconds;
    }

    return {
      test: test.name,
      healthResponse,
      updateData,
      hasUptime: updateData.uptime_seconds !== undefined,
      willShowNA: updateData.uptime_seconds === undefined
    };
  });

  return NextResponse.json({
    success: true,
    results,
    conclusion: {
      message: "The cron WILL update last_health_check (so 'LAST CHECK' will work)",
      uptimeIssue: "But uptime_seconds will remain NULL (show as '-') unless VMs report it",
      fix: "VMs need to add 'uptime_seconds' field to their /health response"
    }
  });
}
