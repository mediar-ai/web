import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';

const MEDIAR_ADMINS = ['louis@mediar.ai', 'matt@mediar.ai'];

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
