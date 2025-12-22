import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const POSTHOG_HOST = 'https://eu.posthog.com';
const POSTHOG_PROJECT_ID = '65690'; // mediar-merged project

interface PostHogQueryResult {
  results: unknown[][];
  columns?: string[];
}

async function runHogQLQuery(query: string, personalKey: string): Promise<PostHogQueryResult | null> {
  const response = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${personalKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: {
        kind: 'HogQLQuery',
        query,
      },
    }),
  });

  if (!response.ok) {
    console.error('[posthog-funnel] Query error:', response.status, await response.text());
    return null;
  }

  return response.json();
}

export async function GET() {
  console.log('[posthog-funnel] API route called');

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

  const personalKey = process.env.POSTHOG_PERSONAL_KEY;
  if (!personalKey) {
    return NextResponse.json({ error: 'POSTHOG_PERSONAL_KEY not configured' }, { status: 500 });
  }

  try {
    // Run all queries in parallel
    const [funnelData, brexData, pageviewData] = await Promise.all([
      // Funnel query
      runHogQLQuery(`
        SELECT
          event as Event,
          uniqIf(person_id, timestamp >= today() - 7) as count_last_7d,
          uniqIf(person_id, timestamp >= today() - 14 AND timestamp < today() - 7) as count_prev_7d,
          uniqIf(person_id, timestamp >= today() - 30) as count_last_30d,
          uniqIf(person_id, timestamp >= today() - 60 AND timestamp < today() - 30) as count_prev_30d
        FROM events
        WHERE event IN (
          'survey_completed_redirect_to_app',
          'user_created',
          'desktop_app_download_clicked',
          'desktop_app_started',
          'desktop_user_authenticated'
        )
        AND timestamp >= today() - 60
        GROUP BY event
        ORDER BY count_last_7d DESC
      `, personalKey),

      // Brex query
      runHogQLQuery(`
        WITH brex_daily_deduped AS (
          SELECT
            properties.date as date,
            properties.card_net_usd as card_net_usd,
            row_number() OVER (PARTITION BY properties.date ORDER BY timestamp DESC) as rn
          FROM events
          WHERE event = 'brex_daily_metrics'
            AND properties.date >= toString(today() - interval 90 day)
        )
        SELECT
          abs(sum(if(date >= toString(today() - interval 7 day), card_net_usd, 0))) as expenses_last_7d,
          abs(sum(if(date >= toString(today() - interval 14 day) AND date < toString(today() - interval 7 day), card_net_usd, 0))) as expenses_prev_7d,
          abs(sum(if(date >= toString(today() - interval 30 day), card_net_usd, 0))) as expenses_last_30d,
          abs(sum(if(date >= toString(today() - interval 60 day) AND date < toString(today() - interval 30 day), card_net_usd, 0))) as expenses_prev_30d
        FROM brex_daily_deduped
        WHERE rn = 1
      `, personalKey),

      // Pageviews query
      runHogQLQuery(`
        SELECT
          uniqIf(person_id, timestamp >= today() - 7) as visitors_7d,
          uniqIf(person_id, timestamp >= today() - 14 AND timestamp < today() - 7) as visitors_prev_7d,
          uniqIf(person_id, timestamp >= today() - 30) as visitors_30d,
          uniqIf(person_id, timestamp >= today() - 60 AND timestamp < today() - 30) as visitors_prev_30d
        FROM events
        WHERE event = '$pageview'
          AND properties.$current_url LIKE '%mediar.ai%'
          AND timestamp >= today() - 60
      `, personalKey),
    ]);

    // Transform funnel data
    const funnel = (funnelData?.results || []).map(row => {
      const count7d = Number(row[1]) || 0;
      const countPrev7d = Number(row[2]) || 0;
      const count30d = Number(row[3]) || 0;
      const countPrev30d = Number(row[4]) || 0;
      return {
        event: String(row[0]),
        count7d,
        countPrev7d,
        count30d,
        countPrev30d,
        change7d: countPrev7d > 0 ? ((count7d - countPrev7d) / countPrev7d * 100) : null,
        change30d: countPrev30d > 0 ? ((count30d - countPrev30d) / countPrev30d * 100) : null,
      };
    });

    // Transform brex data
    let brex = null;
    if (brexData?.results?.[0]) {
      const [exp7d, expPrev7d, exp30d, expPrev30d] = brexData.results[0].map(v => Number(v) || 0);
      brex = {
        expenses7d: exp7d,
        expensesPrev7d: expPrev7d,
        expenses30d: exp30d,
        expensesPrev30d: expPrev30d,
        change7d: expPrev7d > 0 ? ((exp7d - expPrev7d) / expPrev7d * 100) : null,
        change30d: expPrev30d > 0 ? ((exp30d - expPrev30d) / expPrev30d * 100) : null,
      };
    }

    // Transform pageview data
    let pageviews = null;
    if (pageviewData?.results?.[0]) {
      const [pv7d, pvPrev7d, pv30d, pvPrev30d] = pageviewData.results[0].map(v => Number(v) || 0);
      pageviews = {
        visitors7d: pv7d,
        visitorsPrev7d: pvPrev7d,
        visitors30d: pv30d,
        visitorsPrev30d: pvPrev30d,
        change7d: pvPrev7d > 0 ? ((pv7d - pvPrev7d) / pvPrev7d * 100) : null,
        change30d: pvPrev30d > 0 ? ((pv30d - pvPrev30d) / pvPrev30d * 100) : null,
      };
    }

    return NextResponse.json({
      funnel,
      brex,
      pageviews,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[posthog-funnel] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
