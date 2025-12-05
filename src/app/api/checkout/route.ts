import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import Stripe from 'stripe';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-11-17.clover',
  });
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress;

    if (!email) {
      return NextResponse.json(
        { error: 'no email found for user' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { price, returnUrl } = body;

    if (!price || typeof price !== 'number' || price <= 0) {
      console.log('checkout: invalid price', { price });
      return NextResponse.json({ error: 'invalid price' }, { status: 400 });
    }

    // Convert to cents for Stripe
    const amountInCents = Math.round(price * 100);

    console.log('checkout: creating session', {
      userId,
      email,
      price,
      amountInCents,
    });

    // Create a unique purchase token
    const purchaseToken = crypto.randomUUID();

    // Create Stripe checkout session
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Mediar Desktop App',
              description: `Lifetime license - $${price} credits`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai'}/?purchase=success&token=${purchaseToken}`,
      cancel_url:
        returnUrl ||
        `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai'}/?canceled=true`,
      metadata: {
        purchaseToken,
        price: price.toString(),
        userId,
        email,
      },
    });

    console.log('checkout: session created', {
      sessionId: session.id,
      purchaseToken,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('checkout: error creating session', error);
    return NextResponse.json(
      { error: 'failed to create checkout session' },
      { status: 500 }
    );
  }
}
