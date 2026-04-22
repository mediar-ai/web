import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { createPrivateKey, createSign } from 'crypto';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const PROJECT_ID = 'mediar-394022';

const VERTEX_TRACED_SOURCES = new Set([
  'vertex_chat',
  'execution_qa',
  'web_ai',
]);

const ANALYTICS_TRACED_SOURCE_PREFIXES = [
  'agentic_reply.',
  'crm.',
  'fazm_',
  'firestore_tasks.',
  'gemini.',
  'orchestrator.',
  'posthog.',
  'session_recording.',
];

function isTrackedSource(source: string | null): boolean {
  if (!source) {
    return false;
  }

  if (VERTEX_TRACED_SOURCES.has(source)) {
    return true;
  }

  return ANALYTICS_TRACED_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix));
}

function labelUser(userId: string, emailMap: Map<string, string>): string {
  const sessionEmail = emailMap.get(userId);
  if (sessionEmail) {
    return sessionEmail;
  }

  if (userId === 'analytics') {
    return 'Analytics / Gemini';
  }

  if (userId.startsWith('fazm:')) {
    return `Fazm / ${userId.slice('fazm:'.length)}`;
  }

  if (userId.startsWith('fazm_uid:')) {
    const uid = userId.slice('fazm_uid:'.length);
    return `Fazm / ${uid.slice(0, 8)}...`;
  }

  return userId.slice(0, 8) + '...';
}

// Google Cloud auth helpers
function base64url(input: string | Buffer): string {
  const base64 = typeof input === 'string'
    ? Buffer.from(input).toString('base64')
    : input.toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGoogleAccessToken(): Promise<string> {
  const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  if (!credentialsBase64) throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64');

  const credentials = JSON.parse(Buffer.from(credentialsBase64, 'base64').toString('utf-8'));
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/monitoring.read',
    aud: credentials.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const privateKey = createPrivateKey({ key: credentials.private_key, format: 'pem' });
  const sign = createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = base64url(sign.sign(privateKey));

  const tokenResponse = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsignedToken}.${signature}`,
  });

  if (!tokenResponse.ok) throw new Error('Token exchange failed');
  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

async function getVertexDailyTokens(accessToken: string, days: number): Promise<Map<string, number>> {
  const now = new Date();
  const endTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const startTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, 0, 0, 0));
  console.log('[user-tokens] Vertex query range:', startTime.toISOString(), 'to', endTime.toISOString());

  const filter = 'metric.type="aiplatform.googleapis.com/publisher/online_serving/token_count"';
  const url =
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries?` +
    `filter=${encodeURIComponent(filter)}` +
    `&interval.startTime=${startTime.toISOString()}` +
    `&interval.endTime=${endTime.toISOString()}` +
    `&aggregation.alignmentPeriod=86400s` +
    `&aggregation.perSeriesAligner=ALIGN_SUM`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    console.error('[user-tokens] Vertex API error:', await response.text());
    return new Map();
  }

  const data = await response.json();
  const dailyTotals = new Map<string, number>();

  if (data.timeSeries) {
    for (const series of data.timeSeries) {
      for (const point of series.points || []) {
        const timestamp = point.interval?.startTime || point.interval?.endTime;
        if (timestamp) {
          const dateStr = timestamp.split('T')[0];
          const tokens = parseInt(point.value?.int64Value || '0');
          dailyTotals.set(dateStr, (dailyTotals.get(dateStr) || 0) + tokens);
        }
      }
    }
  }

  return dailyTotals;
}

export async function GET() {
  console.log('[user-tokens] API route called');

  // Auth check
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await currentUser();
  const isMediarAdmin = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;
  const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

  if (!isMediarAdmin && !isMediarOrg) {
    return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
  }

  try {
    const supabase = createServerClient();

    const now = new Date();
    const sevenDaysAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7, 0, 0, 0));
    console.log('[user-tokens] Traces query from:', sevenDaysAgo.toISOString());

    // Fetch all traces using pagination
    const allTraces: Array<{
      user_id: string;
      input_tokens: number;
      output_tokens: number;
      cached_tokens: number;
      created_at: string;
      source: string | null;
    }> = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: traces, error: tracesError } = await supabase
        .from('mediar_llm_traces')
        .select('user_id, input_tokens, output_tokens, cached_tokens, created_at, source')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (tracesError) {
        console.error('[user-tokens] Traces query error:', tracesError);
        throw new Error(tracesError.message);
      }

      if (traces && traces.length > 0) {
        allTraces.push(...traces);
        offset += traces.length;
        hasMore = traces.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    const traces = allTraces;
    console.log('[user-tokens] Got', traces?.length || 0, 'traces via pagination');

    // Get user emails from desktop sessions
    const userIds = [...new Set(traces?.map(t => t.user_id) || [])];
    const { data: sessions, error: sessionsError } = await supabase
      .from('mediar_desktop_sessions')
      .select('clerk_user_id, email')
      .in('clerk_user_id', userIds);

    if (sessionsError) {
      console.error('[user-tokens] Sessions query error:', sessionsError);
    }

    // Build email lookup
    const emailMap = new Map<string, string>();
    for (const s of sessions || []) {
      if (s.email && !emailMap.has(s.clerk_user_id)) {
        emailMap.set(s.clerk_user_id, s.email);
      }
    }

    // Aggregate by user and date
    const dataMap: Record<string, Record<string, number>> = {};
    const vertexTracedDataMap: Record<string, number> = {};
    const nonVertexTracedDataMap: Record<string, number> = {};
    const cachedDataMap: Record<string, number> = {};
    const datesSet = new Set<string>();

    for (const trace of traces || []) {
      const dateStr = trace.created_at.split('T')[0];
      datesSet.add(dateStr);

      if (!dataMap[trace.user_id]) {
        dataMap[trace.user_id] = {};
      }
      const tokens = (trace.input_tokens || 0) + (trace.output_tokens || 0);
      dataMap[trace.user_id][dateStr] = (dataMap[trace.user_id][dateStr] || 0) + tokens;

      if (isTrackedSource(trace.source || null)) {
        vertexTracedDataMap[dateStr] = (vertexTracedDataMap[dateStr] || 0) + tokens;
      } else {
        nonVertexTracedDataMap[dateStr] = (nonVertexTracedDataMap[dateStr] || 0) + tokens;
      }

      cachedDataMap[dateStr] = (cachedDataMap[dateStr] || 0) + (trace.cached_tokens || 0);
    }

    const dates = Array.from(datesSet).sort();

    const users = Object.entries(dataMap).map(([uId, dailyData]) => ({
      id: uId,
      label: labelUser(uId, emailMap),
      dailyTokens: dates.map(date => dailyData[date] || 0),
    }));

    users.sort((a, b) => {
      const totalA = a.dailyTokens.reduce((sum, t) => sum + t, 0);
      const totalB = b.dailyTokens.reduce((sum, t) => sum + t, 0);
      return totalB - totalA;
    });

    // Fetch Vertex AI daily totals
    let vertexDailyTokens: number[] = [];
    let vertexTotal = 0;
    try {
      const googleToken = await getGoogleAccessToken();
      const vertexData = await getVertexDailyTokens(googleToken, 7);
      console.log('[user-tokens] Vertex daily data:', Object.fromEntries(vertexData));

      vertexDailyTokens = dates.map(date => vertexData.get(date) || 0);
      vertexTotal = Array.from(vertexData.values()).reduce((sum, t) => sum + t, 0);
    } catch (err) {
      console.error('[user-tokens] Failed to fetch Vertex data:', err);
    }

    const tracedDailyTokens = dates.map((_, i) =>
      users.reduce((sum, u) => sum + u.dailyTokens[i], 0)
    );
    const tracedTotal = tracedDailyTokens.reduce((sum, t) => sum + t, 0);
    const vertexTracedDailyTokens = dates.map(date => vertexTracedDataMap[date] || 0);
    const vertexTracedTotal = vertexTracedDailyTokens.reduce((sum, t) => sum + t, 0);
    const nonVertexTracedDailyTokens = dates.map(date => nonVertexTracedDataMap[date] || 0);
    const nonVertexTracedTotal = nonVertexTracedDailyTokens.reduce((sum, t) => sum + t, 0);

    const cachedDailyTokens = dates.map(date => cachedDataMap[date] || 0);
    const cachedTotal = cachedDailyTokens.reduce((sum, t) => sum + t, 0);

    return NextResponse.json({
      dates,
      users,
      vertexDailyTokens,
      vertexTotal,
      tracedDailyTokens,
      tracedTotal,
      vertexTracedDailyTokens,
      vertexTracedTotal,
      nonVertexTracedDailyTokens,
      nonVertexTracedTotal,
      cachedDailyTokens,
      cachedTotal,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[user-tokens] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
