import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import crypto from 'crypto';

// Cal.com webhook secret for verification (set in Cal.com webhook settings)
const CAL_WEBHOOK_SECRET = process.env.CAL_WEBHOOK_SECRET;

// PostHog config for server-side tracking
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

async function capturePostHogEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>
): Promise<void> {
  if (!POSTHOG_KEY) {
    console.warn('[Cal Webhook] POSTHOG_KEY not set, skipping event');
    return;
  }
  try {
    const response = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: distinctId,
        properties,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.error(`[Cal Webhook] PostHog error: ${response.status}`);
    } else {
      console.log(`[Cal Webhook] PostHog event '${event}' sent for ${distinctId}`);
    }
  } catch (error) {
    console.error('[Cal Webhook] PostHog send error:', error);
  }
}

/**
 * Verify Cal.com webhook signature
 * Cal.com uses HMAC-SHA256 for webhook verification
 */
function verifyCalSignature(payload: string, signature: string | null): boolean {
  if (!CAL_WEBHOOK_SECRET) {
    console.warn('[Cal Webhook] CAL_WEBHOOK_SECRET not set, skipping verification');
    return true; // Allow in dev without secret
  }

  if (!signature) {
    console.error('[Cal Webhook] No signature provided');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', CAL_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Cal.com webhook handler
 * Receives booking notifications and updates mediar_users.booked_cal_call
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-cal-signature-256');

    // Verify webhook signature
    if (!verifyCalSignature(rawBody, signature)) {
      console.error('[Cal Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    console.log('[Cal Webhook] Received event:', payload.triggerEvent);

    // We only care about booking created events
    if (payload.triggerEvent !== 'BOOKING_CREATED') {
      console.log('[Cal Webhook] Ignoring event type:', payload.triggerEvent);
      return NextResponse.json({ received: true });
    }

    // Extract attendee email from booking payload
    const attendees = payload.payload?.attendees || [];
    if (attendees.length === 0) {
      console.error('[Cal Webhook] No attendees in booking');
      return NextResponse.json({ error: 'No attendees' }, { status: 400 });
    }

    const bookerEmail = attendees[0]?.email?.toLowerCase();
    if (!bookerEmail) {
      console.error('[Cal Webhook] No email in attendee');
      return NextResponse.json({ error: 'No attendee email' }, { status: 400 });
    }

    // Extract user_id from booking responses (custom field for 100% reliable matching)
    const responses = payload.payload?.responses || {};
    const userId = responses.user_id?.value || responses.user_id; // Handle both object and string formats

    console.log('[Cal Webhook] Processing booking - email:', bookerEmail, 'user_id:', userId || 'not provided');

    let users = null;
    let findError = null;
    let matchedBy = 'none';

    // STRATEGY 1: Match by user_id (most reliable - prevents email mismatch issues)
    if (userId) {
      const result = await supabase
        .from('mediar_users')
        .select('user_id, email')
        .eq('user_id', userId);

      users = result.data;
      findError = result.error;

      if (users && users.length > 0) {
        matchedBy = 'user_id';
        console.log('[Cal Webhook] ✓ Matched by user_id:', userId, '(', users.length, 'user(s))');
      } else {
        console.warn('[Cal Webhook] No user found for user_id:', userId, '- falling back to email');
      }
    }

    // STRATEGY 2: Fall back to email matching (backward compatibility)
    if (!users || users.length === 0) {
      const result = await supabase
        .from('mediar_users')
        .select('user_id, email')
        .ilike('email', bookerEmail);

      users = result.data;
      findError = result.error;

      if (users && users.length > 0) {
        matchedBy = 'email';
        console.log('[Cal Webhook] ✓ Matched by email:', bookerEmail, '(', users.length, 'user(s))');
      }
    }

    if (findError) {
      console.error('[Cal Webhook] Error finding users:', findError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!users || users.length === 0) {
      console.warn('[Cal Webhook] ✗ No users found - tried user_id:', userId || 'none', 'email:', bookerEmail);
      // Still return 200 - booking is valid, user just not in our system yet
      return NextResponse.json({ received: true, userFound: false });
    }

    // Update ALL matched users (handles Clerk dev/prod duplicates)
    const updateCondition = matchedBy === 'user_id'
      ? { user_id: userId }
      : {}; // Will use ilike below for email

    let updateResult;
    if (matchedBy === 'user_id') {
      updateResult = await supabase
        .from('mediar_users')
        .update({
          booked_cal_call: true,
          booked_cal_call_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } else {
      updateResult = await supabase
        .from('mediar_users')
        .update({
          booked_cal_call: true,
          booked_cal_call_at: new Date().toISOString(),
        })
        .ilike('email', bookerEmail);
    }

    const { error: updateError } = updateResult;

    if (updateError) {
      console.error('[Cal Webhook] Failed to update users:', updateError);
      return NextResponse.json({ error: 'Failed to update users' }, { status: 500 });
    }

    const userIds = users.map(u => u.user_id);
    console.log('[Cal Webhook] ✓ Successfully marked', users.length, 'user(s) as booked (matched by', matchedBy + '):', userIds.join(', '));

    // Send PostHog event for each matched user
    for (const user of users) {
      await capturePostHogEvent(user.user_id, 'cal_booking_completed', {
        email: user.email,
        matched_by: matchedBy,
        booking_title: payload.payload?.title || 'Unknown',
      });
    }

    return NextResponse.json({
      received: true,
      userFound: true,
      usersUpdated: users.length,
      userIds,
      matchedBy, // Include matching strategy for debugging
    });
  } catch (error) {
    console.error('[Cal Webhook] Error processing webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Health check for webhook URL verification
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    webhook: 'cal.com',
    timestamp: new Date().toISOString(),
  });
}
