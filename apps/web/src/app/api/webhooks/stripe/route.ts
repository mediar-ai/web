import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@/lib/supabase-server';
import { getPostHogClient } from '@/lib/posthog-server';
import { CREDIT_PACKAGES } from '@/lib/credits';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-11-17.clover',
  });
}

/**
 * Calculate credits from purchase amount
 * Uses credit package rates or best rate for custom amounts
 */
function calculateCredits(amountUsd: number, packageId?: string): number {
  // If a specific package was purchased, use its credits
  if (packageId) {
    const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
    if (pkg) return pkg.credits;
  }

  // For custom amounts, find best rate
  const rates = CREDIT_PACKAGES.map(p => p.credits / p.price);
  const bestRate = Math.max(...rates);
  return Math.floor(amountUsd * bestRate);
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

    const { purchaseToken, price, userId, email, creditPackageId, purchaseType } = session.metadata || {};

    console.log('stripe webhook: checkout completed', {
      sessionId: session.id,
      purchaseToken,
      price,
      userId,
      email,
      purchaseType,
      creditPackageId,
      paymentStatus: session.payment_status,
    });

    // Skip if this isn't a mediar-web-app purchase (e.g., screenpipe credits)
    // Mediar purchases always have userId set; screenpipe purchases have 'credits' in metadata
    if (!userId && !purchaseType) {
      console.log('stripe webhook: skipping non-mediar purchase (no userId or purchaseType)', {
        sessionId: session.id,
        email,
        metadata: session.metadata,
      });
      return NextResponse.json({ received: true, skipped: 'not-mediar-purchase' });
    }

    if (session.payment_status === 'paid') {
      try {
        const supabase = createServerClient();
        const priceAmount = parseFloat(price || '0');

        // Insert purchase record
        const { error } = await supabase.from('mediar_app_credits_purchase').insert({
          user_id: userId,
          email: email,
          price: priceAmount,
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

          // Add credits to user balance
          // For vm_credits purchases OR desktop app purchases (any purchase gives credits)
          if (userId && priceAmount > 0) {
            const creditsToAdd = calculateCredits(priceAmount, creditPackageId);
            const isVmCredits = purchaseType === 'vm_credits';
            const description = isVmCredits
              ? (creditPackageId ? `Purchased ${creditPackageId} credit package` : `Purchased $${priceAmount} credits`)
              : `Desktop app purchase ($${priceAmount})`;

            console.log('stripe webhook: adding credits', { userId, creditsToAdd, priceAmount, creditPackageId, purchaseType });

            const { data: creditResult, error: creditError } = await supabase.rpc('add_credits', {
              p_user_id: userId,
              p_amount: creditsToAdd,
              p_type: isVmCredits ? 'purchase' : 'app_purchase',
              p_description: description,
              p_reference_id: session.id,
            });

            if (creditError) {
              console.error('stripe webhook: failed to add credits', creditError);
            } else {
              console.log('stripe webhook: credits added', {
                userId,
                creditsAdded: creditsToAdd,
                newBalance: creditResult?.[0]?.new_balance
              });
            }
          }

          // Track successful purchase in PostHog
          try {
            const posthog = getPostHogClient();
            posthog.capture({
              distinctId: userId || email || session.id,
              event: 'credits_purchase_success',
              properties: {
                user_id: userId,
                email: email,
                price: priceAmount,
                purchase_token: purchaseToken,
                purchase_type: purchaseType,
                credit_package_id: creditPackageId,
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
