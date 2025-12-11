import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import Stripe from 'stripe';
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
 * POST /api/credits/checkout
 * Create a Stripe checkout session for purchasing VM credits
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress;

    if (!email) {
      return NextResponse.json(
        { error: 'No email found for user' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { packageId, customAmount, returnUrl } = body;

    // Determine price and credits
    let price: number;
    let credits: number;
    let productName: string;
    let productDescription: string;

    if (packageId) {
      const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
      if (!pkg) {
        return NextResponse.json(
          { error: 'Invalid package ID' },
          { status: 400 }
        );
      }
      price = pkg.price;
      credits = pkg.credits;
      productName = `${pkg.name} Credit Package`;
      productDescription = `${pkg.credits} VM credits - ${pkg.description}`;
    } else if (customAmount && typeof customAmount === 'number' && customAmount > 0) {
      price = customAmount;
      // Best rate is 15 credits per dollar (Pro package rate)
      credits = Math.floor(customAmount * 15);
      productName = 'VM Credits';
      productDescription = `${credits} VM credits`;
    } else {
      return NextResponse.json(
        { error: 'Must provide packageId or customAmount' },
        { status: 400 }
      );
    }

    // Convert to cents for Stripe
    const amountInCents = Math.round(price * 100);

    console.log('credits checkout: creating session', {
      userId,
      email,
      packageId,
      price,
      credits,
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
              name: productName,
              description: productDescription,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai'}/dashboard?credits_purchase=success&credits=${credits}`,
      cancel_url:
        returnUrl ||
        `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai'}/dashboard?credits_purchase=cancelled`,
      metadata: {
        purchaseToken,
        price: price.toString(),
        userId,
        email,
        purchaseType: 'vm_credits',
        creditPackageId: packageId || '',
        creditsAmount: credits.toString(),
      },
    });

    console.log('credits checkout: session created', {
      sessionId: session.id,
      purchaseToken,
      credits,
    });

    return NextResponse.json({
      url: session.url,
      credits,
      price,
    });
  } catch (error) {
    console.error('credits checkout: error creating session', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
