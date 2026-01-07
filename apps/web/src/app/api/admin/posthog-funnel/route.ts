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

interface FunnelRow {
  event: string;
  value7d: string;
  change7d: number | null;
  convRate7d: string;
  value30d: string;
  change30d: number | null;
  convRate30d: string;
  sortOrder: number;
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

function formatMoney(amount: number): string {
  return '$' + Math.round(amount).toLocaleString();
}

function formatChange(change: number | null): string {
  if (change === null) return 'N/A';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
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
      // Funnel query - product events
      runHogQLQuery(`
        SELECT
          event as Event,
          uniqIf(person_id, timestamp >= today() - 7) as count_last_7d,
          uniqIf(person_id, timestamp >= today() - 14 AND timestamp < today() - 7) as count_prev_7d,
          uniqIf(person_id, timestamp >= today() - 30) as count_last_30d,
          uniqIf(person_id, timestamp >= today() - 60 AND timestamp < today() - 30) as count_prev_30d
        FROM events
        WHERE event IN (
          'user_created',
          'desktop_app_download_clicked',
          'desktop_app_started',
          'desktop_user_authenticated',
          'desktop_onboarding_completed',
          'cal_booking_completed'
        )
        AND timestamp >= today() - 60
        GROUP BY event
      `, personalKey),

      // Brex query - card expenses
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

      // Pageviews query - website visitors
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

    // Build unified rows array
    const rows: FunnelRow[] = [];

    // 1. Brex Card Expenses (sort_order: 2)
    if (brexData?.results?.[0]) {
      const [exp7d, expPrev7d, exp30d, expPrev30d] = brexData.results[0].map(v => Number(v) || 0);
      const change7d = expPrev7d > 0 ? ((exp7d - expPrev7d) / expPrev7d * 100) : null;
      const change30d = expPrev30d > 0 ? ((exp30d - expPrev30d) / expPrev30d * 100) : null;
      rows.push({
        event: 'Card Expenses',
        value7d: `${formatMoney(exp7d)} (${formatChange(change7d)})`,
        change7d,
        convRate7d: '',
        value30d: `${formatMoney(exp30d)} (${formatChange(change30d)})`,
        change30d,
        convRate30d: '',
        sortOrder: 2,
      });
    }

    // 2. Pageview - Total (sort_order: 10)
    let pageview7d = 0, pageviewPrev7d = 0, pageview30d = 0, pageviewPrev30d = 0;
    if (pageviewData?.results?.[0]) {
      [pageview7d, pageviewPrev7d, pageview30d, pageviewPrev30d] = pageviewData.results[0].map(v => Number(v) || 0);
      const change7d = pageviewPrev7d > 0 ? ((pageview7d - pageviewPrev7d) / pageviewPrev7d * 100) : null;
      const change30d = pageviewPrev30d > 0 ? ((pageview30d - pageviewPrev30d) / pageviewPrev30d * 100) : null;
      rows.push({
        event: 'Pageview - Total',
        value7d: `${pageview7d} (${formatChange(change7d)})`,
        change7d,
        convRate7d: '',
        value30d: `${pageview30d} (${formatChange(change30d)})`,
        change30d,
        convRate30d: '',
        sortOrder: 10,
      });
    }

    // Process funnel events with conversion rates
    const funnelEvents = new Map<string, { count7d: number; prev7d: number; count30d: number; prev30d: number }>();
    for (const row of (funnelData?.results || [])) {
      const event = String(row[0]);
      funnelEvents.set(event, {
        count7d: Number(row[1]) || 0,
        prev7d: Number(row[2]) || 0,
        count30d: Number(row[3]) || 0,
        prev30d: Number(row[4]) || 0,
      });
    }

    // Get counts for conversion rate calculations
    // Funnel order: Pageview → Download → User Created → App Started → Authenticated → Cal Booking → Onboarding
    const download = funnelEvents.get('desktop_app_download_clicked') || { count7d: 0, prev7d: 0, count30d: 0, prev30d: 0 };
    const userCreated = funnelEvents.get('user_created') || { count7d: 0, prev7d: 0, count30d: 0, prev30d: 0 };
    const appStarted = funnelEvents.get('desktop_app_started') || { count7d: 0, prev7d: 0, count30d: 0, prev30d: 0 };
    const authenticated = funnelEvents.get('desktop_user_authenticated') || { count7d: 0, prev7d: 0, count30d: 0, prev30d: 0 };
    const onboardingCompleted = funnelEvents.get('desktop_onboarding_completed') || { count7d: 0, prev7d: 0, count30d: 0, prev30d: 0 };
    const calBooking = funnelEvents.get('cal_booking_completed') || { count7d: 0, prev7d: 0, count30d: 0, prev30d: 0 };

    // Event definitions with sort order and conversion rate logic
    const eventDefs = [
      {
        event: 'desktop_app_download_clicked',
        label: 'Download Clicked',
        sortOrder: 11,
        convRate7d: pageview7d > 0 ? `${Math.round((download.count7d / pageview7d) * 100)}% vs. Pageview` : '',
        convRate30d: pageview30d > 0 ? `${Math.round((download.count30d / pageview30d) * 100)}% vs. Pageview` : '',
      },
      {
        event: 'user_created',
        label: 'User Created',
        sortOrder: 12,
        convRate7d: download.count7d > 0 ? `${Math.round((userCreated.count7d / download.count7d) * 100)}% vs. Download` : '',
        convRate30d: download.count30d > 0 ? `${Math.round((userCreated.count30d / download.count30d) * 100)}% vs. Download` : '',
      },
      {
        event: 'desktop_app_started',
        label: 'App Started',
        sortOrder: 13,
        convRate7d: userCreated.count7d > 0 ? `${Math.round((appStarted.count7d / userCreated.count7d) * 100)}% vs. User Created` : '',
        convRate30d: userCreated.count30d > 0 ? `${Math.round((appStarted.count30d / userCreated.count30d) * 100)}% vs. User Created` : '',
      },
      {
        event: 'desktop_user_authenticated',
        label: 'User Authenticated',
        sortOrder: 14,
        convRate7d: appStarted.count7d > 0 ? `${Math.round((authenticated.count7d / appStarted.count7d) * 100)}% vs. App Started` : '',
        convRate30d: appStarted.count30d > 0 ? `${Math.round((authenticated.count30d / appStarted.count30d) * 100)}% vs. App Started` : '',
      },
      {
        event: 'cal_booking_completed',
        label: 'Cal Booking',
        sortOrder: 15,
        convRate7d: authenticated.count7d > 0 ? `${Math.round((calBooking.count7d / authenticated.count7d) * 100)}% vs. Authenticated` : '',
        convRate30d: authenticated.count30d > 0 ? `${Math.round((calBooking.count30d / authenticated.count30d) * 100)}% vs. Authenticated` : '',
      },
      {
        event: 'desktop_onboarding_completed',
        label: 'Onboarding Done',
        sortOrder: 16,
        convRate7d: calBooking.count7d > 0 ? `${Math.round((onboardingCompleted.count7d / calBooking.count7d) * 100)}% vs. Cal Booking` : '',
        convRate30d: calBooking.count30d > 0 ? `${Math.round((onboardingCompleted.count30d / calBooking.count30d) * 100)}% vs. Cal Booking` : '',
      },
    ];

    for (const def of eventDefs) {
      const data = funnelEvents.get(def.event) || { count7d: 0, prev7d: 0, count30d: 0, prev30d: 0 };
      const change7d = data.prev7d > 0 ? ((data.count7d - data.prev7d) / data.prev7d * 100) : null;
      const change30d = data.prev30d > 0 ? ((data.count30d - data.prev30d) / data.prev30d * 100) : null;
      rows.push({
        event: def.label,
        value7d: `${data.count7d} (${formatChange(change7d)})`,
        change7d,
        convRate7d: def.convRate7d,
        value30d: `${data.count30d} (${formatChange(change30d)})`,
        change30d,
        convRate30d: def.convRate30d,
        sortOrder: def.sortOrder,
      });
    }

    // Sort by sortOrder
    rows.sort((a, b) => a.sortOrder - b.sortOrder);

    return NextResponse.json({
      rows,
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
