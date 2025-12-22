import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = 'mediar-n5';

export async function GET(request: Request) {
  console.log('[sentry-traces] API route called');

  // Auth check - same as other admin routes
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

  if (!SENTRY_AUTH_TOKEN) {
    console.log('[sentry-traces] Missing SENTRY_AUTH_TOKEN');
    return NextResponse.json(
      { error: 'SENTRY_AUTH_TOKEN not configured' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const statsPeriod = searchParams.get('statsPeriod') || '7d';

  try {
    // Query traces grouped by server_name tag
    const url = `https://sentry.io/api/0/organizations/${SENTRY_ORG}/events/?field=tags[server_name]&field=count()&per_page=100&query=&statsPeriod=${statsPeriod}&sort=-count()`;

    console.log('[sentry-traces] Fetching from Sentry:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log('[sentry-traces] Sentry API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Sentry API error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[sentry-traces] Got', data.data?.length || 0, 'results');

    // Transform data for easier consumption
    const traces = (data.data || []).map((item: Record<string, unknown>) => ({
      hostname: item['tags[server_name]'] || 'unknown',
      count: item['count()'] || 0,
    }));

    return NextResponse.json({
      traces,
      meta: {
        statsPeriod,
        total: traces.length,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[sentry-traces] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Sentry traces', details: String(error) },
      { status: 500 }
    );
  }
}
