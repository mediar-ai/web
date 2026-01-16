import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest';

/**
 * POST /api/admin/cost-alerts/test
 * Send a test cost alert email
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { email, testLevel } = body;

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const validLevels = ['warning', 'critical', 'maximum'];
  if (testLevel && !validLevels.includes(testLevel)) {
    return NextResponse.json({ error: 'Invalid test level' }, { status: 400 });
  }

  try {
    // Send the event to Inngest
    await inngest.send({
      name: 'cost-alert/test.requested',
      data: {
        email,
        testLevel: testLevel || 'warning',
      },
    });

    return NextResponse.json({
      success: true,
      message: `Test ${testLevel || 'warning'} alert queued for ${email}`
    });
  } catch (err) {
    console.error('[Cost Alerts Test] Failed to send event:', err);
    return NextResponse.json({ error: 'Failed to queue test alert' }, { status: 500 });
  }
}
