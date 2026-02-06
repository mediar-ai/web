import { NextRequest, NextResponse } from 'next/server';
import { sendTransactionalEmail } from '@/lib/loops';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const POSTHOG_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const POSTHOG_PROJECT_ID = '98541';

/**
 * Query PostHog for users who signed up but never opened desktop app
 */
async function getInactiveUsers(daysAgo: number = 2): Promise<{ email: string; userId: string; signupDate: string }[]> {
  if (!POSTHOG_API_KEY) {
    throw new Error('POSTHOG_PERSONAL_API_KEY not set');
  }

  const query = `
    SELECT
      person.properties.email as email,
      person.id as person_id,
      min(timestamp) as signup_date
    FROM events
    WHERE event = 'user_created'
      AND timestamp < now() - INTERVAL ${daysAgo} DAY
      AND timestamp > now() - INTERVAL 14 DAY
      AND person.id NOT IN (
        SELECT DISTINCT person.id
        FROM events
        WHERE event = 'desktop_app_started'
      )
    GROUP BY person.properties.email, person.id
    HAVING email IS NOT NULL AND email != ''
    ORDER BY signup_date DESC
    LIMIT 50
  `;

  const response = await fetch(`https://eu.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${POSTHOG_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: { kind: 'HogQLQuery', query },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PostHog query failed: ${error}`);
  }

  const data = await response.json();
  const results = data.results || [];

  return results.map((row: any[]) => ({
    email: row[0],
    userId: row[1],
    signupDate: row[2],
  }));
}

/**
 * Reactivation Emails Cron Job
 * Runs daily to email users who signed up but never opened the desktop app
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();

  /**
   * Check if we already sent a reactivation email to this user
   */
  async function hasBeenEmailed(email: string): Promise<boolean> {
    const { data } = await supabase
      .from('reactivation_emails')
      .select('id')
      .eq('email', email)
      .single();

    return !!data;
  }

  /**
   * Record that we sent a reactivation email
   */
  async function recordEmailSent(email: string, odUserId: string) {
    await supabase.from('reactivation_emails').insert({
      email,
      user_id: odUserId,
      sent_at: new Date().toISOString(),
      email_type: 'desktop_not_opened',
    });
  }

  const userAgent = request.headers.get('user-agent') || '';
  const isVercelCron = userAgent.includes('vercel-cron');

  if (!isVercelCron) {
    const url = new URL(request.url);
    const bypassToken = url.searchParams.get('x-vercel-protection-bypass') ||
      request.headers.get('x-vercel-protection-bypass');
    const expectedToken = process.env.CRON_SECRET;

    if (!expectedToken || bypassToken !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('[Reactivation] Starting reactivation email job...');

  try {
    const inactiveUsers = await getInactiveUsers(2);
    console.log(`[Reactivation] Found ${inactiveUsers.length} inactive users`);

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const user of inactiveUsers) {
      if (await hasBeenEmailed(user.email)) {
        console.log(`[Reactivation] Skipping ${user.email} - already emailed`);
        skipped++;
        continue;
      }

      if (user.email.includes('@mediar.ai')) {
        skipped++;
        continue;
      }

      const result = await sendTransactionalEmail({
        to: user.email,
        subject: "Your automation is waiting",
        body: `Hey,

I noticed you signed up for Mediar but haven't downloaded the desktop app yet.

The magic happens on your desktop - that's where you can record and automate any workflow on your computer.

Download directly: https://cdn.crabnebula.app/download/mediarai/mediar/latest/platform/windows-x86_64

If you're stuck or have questions, just reply to this email. I read every one.

- Matt, Co-founder`,
        senderName: "Matt from Mediar",
        replyTo: "matt@mediar.ai",
      });

      if (result.success) {
        await recordEmailSent(user.email, user.userId);
        sent++;
        console.log(`[Reactivation] Sent email to ${user.email}`);
      } else {
        errors.push(`${user.email}: ${result.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[Reactivation] Complete: ${sent} sent, ${skipped} skipped, ${errors.length} errors`);

    return NextResponse.json({
      success: true,
      stats: { found: inactiveUsers.length, sent, skipped, errors: errors.length },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[Reactivation] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process reactivation emails', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
