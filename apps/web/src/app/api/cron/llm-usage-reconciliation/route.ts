import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROJECT_ID = 'mediar-394022';
const DISCREPANCY_THRESHOLD_PERCENT = 10; // Alert if difference > 10%

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

async function getGoogleAccessToken(): Promise<string> {
  const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  if (!credentialsBase64) {
    throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64');
  }

  const credentials: ServiceAccountCredentials = JSON.parse(
    Buffer.from(credentialsBase64, 'base64').toString('utf-8')
  );

  const privateKey = await importPKCS8(credentials.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/monitoring.read',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.client_email)
    .setAudience(credentials.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const tokenResponse = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`,
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

async function queryGoogleTokens(accessToken: string, periodMs: number): Promise<number> {
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - periodMs).toISOString();

  const filter = `metric.type="aiplatform.googleapis.com/publisher/online_serving/token_count"`;
  const url =
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries?` +
    `filter=${encodeURIComponent(filter)}` +
    `&interval.startTime=${startTime}` +
    `&interval.endTime=${endTime}` +
    `&aggregation.alignmentPeriod=${Math.floor(periodMs / 1000)}s` +
    `&aggregation.perSeriesAligner=ALIGN_SUM`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Monitoring API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  let total = 0;
  if (data.timeSeries) {
    for (const series of data.timeSeries) {
      total += parseInt(series.points?.[0]?.value?.int64Value || '0');
    }
  }
  return total;
}

async function sendDiscrepancyAlert(details: {
  googleTokens: number;
  dbTokens: number;
  discrepancyPercent: number;
  periodHours: number;
}) {
  const LOOPS_API_KEY = process.env.LOOPS_API_KEY;
  const LOOPS_TRANSACTIONAL_ID = 'cma8lnpvba4zgzstitn3kgrrf';

  if (!LOOPS_API_KEY) {
    console.error('[Reconciliation] LOOPS_API_KEY not configured, cannot send alert');
    return;
  }

  const recipients = ['matt@mediar.ai', 'louis@mediar.ai'];
  const subject = `LLM Token Discrepancy: API ${(details.googleTokens/1e6).toFixed(1)}M vs Traced ${(details.dbTokens/1e6).toFixed(1)}M (${details.discrepancyPercent.toFixed(1)}% diff)`;
  const body = `
LLM token usage reconciliation detected a significant discrepancy:

**Period:** Last ${details.periodHours} hour(s)

**Google Cloud Monitoring:** ${details.googleTokens.toLocaleString()} tokens
**Our Database (mediar_llm_traces):** ${details.dbTokens.toLocaleString()} tokens
**Discrepancy:** ${details.discrepancyPercent.toFixed(2)}%

${details.googleTokens > details.dbTokens
  ? '⚠️ We are UNDER-COUNTING tokens (missing some usage)'
  : '⚠️ We are OVER-COUNTING tokens (possible duplicate entries)'}

Please investigate the cause of this discrepancy.

---
Automated alert from Mediar LLM Usage Reconciliation
`;

  for (const email of recipients) {
    try {
      const response = await fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LOOPS_API_KEY}`,
        },
        body: JSON.stringify({
          transactionalId: LOOPS_TRANSACTIONAL_ID,
          email,
          dataVariables: {
            subject,
            email_preview: `Token discrepancy: ${details.discrepancyPercent.toFixed(1)}%`,
            body,
            sender_name: 'Mediar Alerts',
            reply_to: 'matt@mediar.ai',
          },
        }),
      });

      if (!response.ok) {
        console.error(`[Reconciliation] Failed to send alert to ${email}: ${response.status}`);
      } else {
        console.log(`[Reconciliation] Alert sent to ${email}`);
      }
    } catch (error) {
      console.error(`[Reconciliation] Error sending alert to ${email}:`, error);
    }
  }
}

export async function GET(request: Request) {
  // Auth check for Vercel Cron
  const userAgent = request.headers.get('user-agent') || '';
  const isVercelCron = userAgent.includes('vercel-cron');

  if (!isVercelCron) {
    const url = new URL(request.url);
    const bypassToken = url.searchParams.get('x-vercel-protection-bypass') ||
                        request.headers.get('x-vercel-protection-bypass');
    const expectedToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

    if (expectedToken && bypassToken !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const periodMs = 60 * 60 * 1000; // 1 hour
    const periodHours = 1;

    // 1. Get tokens from Google Cloud Monitoring
    const accessToken = await getGoogleAccessToken();
    const googleTokens = await queryGoogleTokens(accessToken, periodMs);

    // 2. Get tokens from our database (last hour)
    const oneHourAgo = new Date(Date.now() - periodMs).toISOString();
    const { data: dbRows, error: dbError } = await supabase
      .from('mediar_llm_traces')
      .select('input_tokens, output_tokens')
      .gte('created_at', oneHourAgo);

    if (dbError) {
      throw new Error(`Database query failed: ${dbError.message}`);
    }

    const dbTokens = (dbRows || []).reduce(
      (sum, row) => sum + (row.input_tokens || 0) + (row.output_tokens || 0),
      0
    );

    // 3. Calculate discrepancy
    const discrepancyPercent = googleTokens > 0
      ? Math.abs(googleTokens - dbTokens) / googleTokens * 100
      : (dbTokens > 0 ? 100 : 0);

    console.log(`[Reconciliation] Google: ${googleTokens}, DB: ${dbTokens}, Discrepancy: ${discrepancyPercent.toFixed(2)}%`);

    // 4. Send alert if discrepancy exceeds threshold
    if (discrepancyPercent > DISCREPANCY_THRESHOLD_PERCENT && (googleTokens > 1000 || dbTokens > 1000)) {
      await sendDiscrepancyAlert({
        googleTokens,
        dbTokens,
        discrepancyPercent,
        periodHours,
      });
    }

    // 5. Log reconciliation result to database for auditing (ignore errors if table doesn't exist)
    try {
      await supabase.from('llm_reconciliation_logs').insert({
        google_tokens: googleTokens,
        db_tokens: dbTokens,
        discrepancy_percent: discrepancyPercent,
        period_hours: periodHours,
        alert_sent: discrepancyPercent > DISCREPANCY_THRESHOLD_PERCENT,
      });
    } catch {
      // Table may not exist yet
    }

    return NextResponse.json({
      success: true,
      googleTokens,
      dbTokens,
      discrepancyPercent: discrepancyPercent.toFixed(2),
      alertSent: discrepancyPercent > DISCREPANCY_THRESHOLD_PERCENT,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Reconciliation] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
