import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Initialize Supabase client with service role for webhook processing
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Cal.com webhook secret for verification (set in Cal.com webhook settings)
const CAL_WEBHOOK_SECRET = process.env.CAL_WEBHOOK_SECRET;

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

    console.log('[Cal Webhook] Processing booking for email:', bookerEmail);

    // Find ALL users by email in mediar_users (handles Clerk dev/prod user ID differences)
    const { data: users, error: findError } = await supabase
      .from('mediar_users')
      .select('user_id, email')
      .ilike('email', bookerEmail);

    if (findError) {
      console.error('[Cal Webhook] Error finding users:', findError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!users || users.length === 0) {
      console.warn('[Cal Webhook] No users found for email:', bookerEmail);
      // Still return 200 - booking is valid, user just not in our system yet
      return NextResponse.json({ received: true, userFound: false });
    }

    console.log('[Cal Webhook] Found', users.length, 'user(s) with email:', bookerEmail);

    // Update ALL users with matching email (handles Clerk dev/prod duplicates)
    const { error: updateError, count } = await supabase
      .from('mediar_users')
      .update({
        booked_cal_call: true,
        booked_cal_call_at: new Date().toISOString(),
      })
      .ilike('email', bookerEmail);

    if (updateError) {
      console.error('[Cal Webhook] Failed to update users:', updateError);
      return NextResponse.json({ error: 'Failed to update users' }, { status: 500 });
    }

    const userIds = users.map(u => u.user_id);
    console.log('[Cal Webhook] Successfully marked', users.length, 'user(s) as booked:', userIds.join(', '));

    return NextResponse.json({
      received: true,
      userFound: true,
      usersUpdated: users.length,
      userIds,
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
