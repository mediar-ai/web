import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { getPostHogClient } from '@/lib/posthog-server';
import { createClient } from '@supabase/supabase-js';

const MEDIAR_ADMINS = ['louis@mediar.ai', 'matt@mediar.ai'];

// Initialize Supabase client for querying survey submissions
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error('CLERK_WEBHOOK_SECRET is not set');
  }

  // Get headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new NextResponse('Error: Missing svix headers', { status: 400 });
  }

  // Get body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Verify webhook
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: any;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err) {
    console.error('Error verifying webhook:', err);
    return new NextResponse('Error: Verification failed', { status: 400 });
  }

  const posthog = getPostHogClient();

  // Handle user.created event
  if (evt.type === 'user.created') {
    const { id: userId, email_addresses, first_name, last_name, created_at } = evt.data;
    const primaryEmail = email_addresses?.[0]?.email_address || 'unknown';

    console.log(`[Clerk Webhook] User created: ${primaryEmail} (${userId})`);

    // Query Supabase for survey submission by email
    let submissionId: string | null = null;
    try {
      const { data: surveyData, error } = await supabase
        .from('mediar_surveys')
        .select('submission_id, created_at')
        .eq('user_email', primaryEmail)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!error && surveyData && surveyData.length > 0) {
        submissionId = surveyData[0].submission_id;
        console.log(`[Clerk Webhook] Found survey submission for ${primaryEmail}: ${submissionId}`);
      } else {
        console.log(`[Clerk Webhook] No survey submission found for ${primaryEmail}`);
      }
    } catch (err) {
      console.error(`[Clerk Webhook] Error querying survey submissions:`, err);
    }

    // Track user signup in PostHog
    posthog.capture({
      distinctId: userId,
      event: 'user_created',
      properties: {
        email: primaryEmail,
        first_name: first_name || '',
        last_name: last_name || '',
        created_at: created_at,
        submission_id: submissionId, // Link to survey submission if found
        came_from_survey: !!submissionId,
        $set: {
          email: primaryEmail,
          name: [first_name, last_name].filter(Boolean).join(' ') || primaryEmail,
          survey_submission_id: submissionId, // Store as person property
        },
      },
    });

    console.log(`[Clerk Webhook] ✓ Tracked user_created in PostHog: ${primaryEmail}${submissionId ? ` (linked to survey: ${submissionId})` : ''}`);
  }

  // Handle session.created event
  if (evt.type === 'session.created') {
    const { user_id, created_at } = evt.data;

    console.log(`[Clerk Webhook] Session created for user: ${user_id}`);

    // Track user login/activity in PostHog
    posthog.capture({
      distinctId: user_id,
      event: 'session_created',
      properties: {
        created_at: created_at,
      },
    });

    console.log(`[Clerk Webhook] ✓ Tracked session_created in PostHog: ${user_id}`);
  }

  // Handle organization.created event
  if (evt.type === 'organization.created') {
    const { id: orgId, name } = evt.data;

    console.log(`[Clerk Webhook] Organization created: ${name} (${orgId})`);
    console.log(`[Clerk Webhook] Auto-inviting Mediar admins: ${MEDIAR_ADMINS.join(', ')}`);

    // Invite Mediar admins to the new organization
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();

    for (const email of MEDIAR_ADMINS) {
      try {
        await client.organizations.createOrganizationInvitation({
          organizationId: orgId,
          emailAddress: email,
          role: 'org:admin',
        });
        console.log(`[Clerk Webhook] ✓ Invited ${email} to ${name}`);
      } catch (error) {
        console.error(`[Clerk Webhook] ✗ Failed to invite ${email}:`, error);
      }
    }
  }

  return new NextResponse('Webhook processed', { status: 200 });
}
