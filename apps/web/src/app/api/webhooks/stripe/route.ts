import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@/lib/supabase-server';
import { getPostHogClient } from '@/lib/posthog-server';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-11-17.clover',
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    console.error('stripe webhook: missing signature');
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('stripe webhook: STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'server configuration error' }, { status: 500 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('stripe webhook: signature verification failed', err.message);
    return NextResponse.json(
      { error: `webhook error: ${err.message}` },
      { status: 400 }
    );
  }

  console.log('stripe webhook: received event', {
    type: event.type,
    id: event.id,
  });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    const { purchaseToken, price, userId, email } = session.metadata || {};

    console.log('stripe webhook: checkout completed', {
      sessionId: session.id,
      purchaseToken,
      price,
      userId,
      email,
      paymentStatus: session.payment_status,
    });

    if (session.payment_status === 'paid') {
      try {
        const supabase = createServerClient();

        // Insert purchase record
        const { error } = await supabase.from('mediar_app_credits_purchase').insert({
          user_id: userId,
          email: email,
          price: parseFloat(price || '0'),
          stripe_session_id: session.id,
          stripe_payment_intent:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id,
          purchase_token: purchaseToken,
          paid_at: new Date().toISOString(),
        });

        if (error) {
          console.error('stripe webhook: failed to insert purchase', error);
        } else {
          console.log('stripe webhook: purchase recorded', { purchaseToken });

          // Track successful purchase in PostHog
          try {
            const posthog = getPostHogClient();
            posthog.capture({
              distinctId: userId || email || session.id,
              event: 'credits_purchase_success',
              properties: {
                user_id: userId,
                email: email,
                price: parseFloat(price || '0'),
                purchase_token: purchaseToken,
                stripe_session_id: session.id,
                stripe_payment_intent:
                  typeof session.payment_intent === 'string'
                    ? session.payment_intent
                    : session.payment_intent?.id,
              },
            });
            await posthog.flush();
          } catch (posthogErr) {
            console.error('stripe webhook: posthog tracking error', posthogErr);
          }
        }
      } catch (err) {
        console.error('stripe webhook: database error', err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
