import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    // Read the actual deployed health check cron code
    const cronPath = path.join(process.cwd(), 'src/app/api/cron/health-check-supabase/route.ts');
    const cronCode = fs.readFileSync(cronPath, 'utf-8');

    // Check if it has the fix
    const hasLastHealthCheckFix = cronCode.includes('last_health_check: currentTime');
    const hasUptimeFix = cronCode.includes('healthResponse.uptime_seconds');

    return NextResponse.json({
      hasLastHealthCheckFix,
      hasUptimeFix,
      deploymentTime: new Date().toISOString(),
      codeSnippet: cronCode.substring(cronCode.indexOf('last_health_check'), cronCode.indexOf('last_health_check') + 200)
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      note: 'Could not read cron file - may be bundled differently'
    });
  }
}
