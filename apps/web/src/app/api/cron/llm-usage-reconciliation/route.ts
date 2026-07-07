import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROJECT_ID = 'mediar-394022';
const DISCREPANCY_THRESHOLD_PERCENT = 10; // Alert if difference > 10%
// Absolute floor: below this token gap the percentage is dominated by low-volume noise
// (countTokens estimates vs actual billed tokens, day-boundary timing, single-request days).
// Vertex traffic is now a low-volume tail (~10-15K tokens/day), so a strict percentage alone
// would page on a harmless 2K difference. Require BOTH the percentage AND a meaningful gap.
const MIN_ABS_TOKEN_GAP = 100_000;

// Google Cloud Monitoring's `aiplatform.googleapis.com/publisher/online_serving/token_count`
// metric ONLY sees traffic that actually runs on Vertex AI publisher models. Our
// mediar_llm_traces table also stores traffic that never touches Vertex: Fazm chat and
// observer run on the Gemini Developer API (generativelanguage.googleapis.com) via
// gemini-cli, and the built-in Claude path runs through ACP. Reconciling the Vertex
// metric against the whole table therefore compares two different populations and always
// reports a huge false discrepancy (e.g. Vertex 0.1M vs traced 362M). We must sum only the
// trace sources whose inference genuinely runs on Vertex so the comparison is like-for-like.
// Keep this list in sync with the routes that call aiplatform.googleapis.com / getVertexGenAI:
//   web_ai            -> api/ai/route.ts (publishers/google models)
//   execution_qa      -> api/ai/execution-qa/route.ts (vertexai: true)
//   activity_analysis -> lib/analysis.ts (getVertexGenAI)
//   error_analysis    -> api/internal/analyze-error/route.ts (getVertexGenAI)
//   vision_parse      -> api/vision/parse/route.ts (vertexai: true)
//   vertex_chat       -> legacy Vertex chat source
const VERTEX_SOURCES = [
  'web_ai',
  'execution_qa',
  'activity_analysis',
  'error_analysis',
  'vision_parse',
  'vertex_chat',
];

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

async function queryGoogleTokens(accessToken: string, days: number): Promise<number> {
  // Use complete UTC day boundaries (same approach as admin dashboard)
  const now = new Date();
  const endTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const startTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, 0, 0, 0));

  console.log(`[Reconciliation] Query range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

  const filter = `metric.type="aiplatform.googleapis.com/publisher/online_serving/token_count"`;
  const url =
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries?` +
    `filter=${encodeURIComponent(filter)}` +
    `&interval.startTime=${startTime.toISOString()}` +
    `&interval.endTime=${endTime.toISOString()}` +
    `&aggregation.alignmentPeriod=86400s` +
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

  const recipients = ['matt@mediar.ai'];
  const subject = `LLM Token Discrepancy: API ${(details.googleTokens/1e6).toFixed(1)}M vs Traced ${(details.dbTokens/1e6).toFixed(1)}M (${details.discrepancyPercent.toFixed(1)}% diff)`;
  const body = `
LLM token usage reconciliation detected a significant discrepancy (Vertex AI traffic only):

**Period:** Last ${details.periodHours} hour(s)

**Google Cloud Monitoring (Vertex publisher):** ${details.googleTokens.toLocaleString()} tokens
**Our Database (mediar_llm_traces, Vertex sources only):** ${details.dbTokens.toLocaleString()} tokens
**Discrepancy:** ${details.discrepancyPercent.toFixed(2)}%

Note: this check covers only Vertex AI traffic. Gemini Developer API traffic (Fazm chat/observer) and ACP Claude traffic are not part of this reconciliation because Cloud Monitoring's Vertex metric cannot measure them.

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
    const days = 1; // 1 complete day (yesterday)
    const periodHours = 24;

    // Use complete UTC day boundaries (yesterday 00:00 to today 00:00)
    const now = new Date();
    const endTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const startTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, 0, 0, 0));
    console.log(`[Reconciliation] Running daily check for complete day: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    // 1. Get tokens from Google Cloud Monitoring
    const accessToken = await getGoogleAccessToken();
    const googleTokens = await queryGoogleTokens(accessToken, days);

    // 2. Get tokens from our database (same UTC day boundaries), scoped to ONLY the
    // sources whose inference actually runs on Vertex AI. Gemini Developer API traffic
    // (fazm_chat_gemini, fazm_observer) and ACP Claude traffic (fazm_chat_builtin,
    // claude_code) are intentionally excluded: the Vertex monitoring metric cannot see
    // them, so including them guarantees a false discrepancy.
    const { data: dbRows, error: dbError } = await supabase
      .from('mediar_llm_traces')
      .select('input_tokens, output_tokens')
      .gte('created_at', startTime.toISOString())
      .lt('created_at', endTime.toISOString())
      .in('source', VERTEX_SOURCES);

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

    // 4. Send alert only when the discrepancy is both proportionally large AND an
    // absolute gap big enough to be actionable (avoids paging on low-volume noise).
    const absTokenGap = Math.abs(googleTokens - dbTokens);
    const shouldAlert =
      discrepancyPercent > DISCREPANCY_THRESHOLD_PERCENT &&
      absTokenGap > MIN_ABS_TOKEN_GAP;
    if (shouldAlert) {
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
        alert_sent: shouldAlert,
      });
    } catch {
      // Table may not exist yet
    }

    return NextResponse.json({
      success: true,
      scope: 'vertex_only',
      vertexSources: VERTEX_SOURCES,
      googleTokens,
      dbTokens,
      discrepancyPercent: discrepancyPercent.toFixed(2),
      alertSent: shouldAlert,
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
