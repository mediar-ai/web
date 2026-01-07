import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { createPrivateKey, createSign } from 'crypto';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const PROJECT_ID = 'mediar-394022';

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
    const allTraces: Array<{user_id: string; input_tokens: number; output_tokens: number; cached_tokens: number; created_at: string}> = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: traces, error: tracesError } = await supabase
        .from('mediar_llm_traces')
        .select('user_id, input_tokens, output_tokens, cached_tokens, created_at')
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

      cachedDataMap[dateStr] = (cachedDataMap[dateStr] || 0) + (trace.cached_tokens || 0);
    }

    const dates = Array.from(datesSet).sort();

    const users = Object.entries(dataMap).map(([uId, dailyData]) => ({
      id: uId,
      label: emailMap.get(uId) || uId.slice(0, 8) + '...',
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

    const cachedDailyTokens = dates.map(date => cachedDataMap[date] || 0);
    const cachedTotal = cachedDailyTokens.reduce((sum, t) => sum + t, 0);

    // Get chat messages per user (last 3 days) - count only user messages
    const threeDaysAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3, 0, 0, 0));
    console.log('[user-tokens] Chat messages query from:', threeDaysAgo.toISOString());

    const { data: chatSessions, error: chatError } = await supabase
      .from('workflow_chat_sessions')
      .select('user_id, messages')
      .gte('created_at', threeDaysAgo.toISOString());

    if (chatError) {
      console.error('[user-tokens] Chat sessions query error:', chatError);
    }

    // Aggregate user-only chat messages by user
    const chatMessagesMap = new Map<string, number>();
    for (const session of chatSessions || []) {
      if (session.user_id && Array.isArray(session.messages)) {
        const userMsgCount = session.messages.filter(
          (m: { role?: string }) => m.role === 'user'
        ).length;
        chatMessagesMap.set(
          session.user_id,
          (chatMessagesMap.get(session.user_id) || 0) + userMsgCount
        );
      }
    }
    console.log('[user-tokens] User chat messages aggregated for', chatMessagesMap.size, 'users');

    // Get recorded events per user (last 3 days)
    const { data: eventCounts, error: eventsError } = await supabase
      .rpc('get_event_counts_by_user', { start_date: threeDaysAgo.toISOString() });

    const eventsMap = new Map<string, number>();
    if (eventsError) {
      console.error('[user-tokens] Events count query error:', eventsError);
      // Fallback: manual count (slower but works)
      const { data: events, error: fallbackError } = await supabase
        .from('low_level_events')
        .select('user_id')
        .gte('created_at', threeDaysAgo.toISOString());

      if (!fallbackError && events) {
        for (const event of events) {
          if (event.user_id) {
            eventsMap.set(event.user_id, (eventsMap.get(event.user_id) || 0) + 1);
          }
        }
      }
    } else if (eventCounts) {
      for (const row of eventCounts) {
        eventsMap.set(row.user_id, row.count);
      }
    }
    console.log('[user-tokens] Recorded events aggregated for', eventsMap.size, 'users');

    // Add chat messages and events to users array
    const usersWithMetrics = users.map(u => ({
      ...u,
      chatMessages: chatMessagesMap.get(u.id) || 0,
      recordedEvents: eventsMap.get(u.id) || 0,
    }));

    return NextResponse.json({
      dates,
      users: usersWithMetrics,
      vertexDailyTokens,
      vertexTotal,
      tracedDailyTokens,
      tracedTotal,
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
