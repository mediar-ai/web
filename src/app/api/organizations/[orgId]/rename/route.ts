import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getPostHogClient } from '@/lib/posthog-server';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ orgId: string }> }
) {
  try {
    const { userId, has } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await context.params;
    const orgId = params.orgId;
    const { newName } = await req.json();

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      return NextResponse.json({ error: 'New name is required' }, { status: 400 });
    }

    // Check if user is admin or owner of the organization
    const isAdmin = has({ role: 'org:admin' });
    const isOwner = has({ role: 'org:owner' });

    if (!isAdmin && !isOwner) {
      return NextResponse.json(
        { error: 'Only organization admins and owners can rename organizations' },
        { status: 403 }
      );
    }

    // Import Clerk client
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();

    // Get current org name for tracking
    let oldName = 'unknown';
    try {
      const org = await client.organizations.getOrganization({ organizationId: orgId });
      oldName = org.name;
    } catch (err) {
      console.error('[Rename Org] Error fetching current org name:', err);
    }

    // Update organization name
    await client.organizations.updateOrganization(orgId, {
      name: newName.trim(),
    });

    // Track in PostHog
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: userId,
      event: 'organization_renamed',
      properties: {
        organization_id: orgId,
        old_name: oldName,
        new_name: newName.trim(),
        renamed_by: userId,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[Rename Org] ✓ Renamed ${oldName} → ${newName.trim()} by ${userId}`);
    console.log(`[Rename Org] ✓ Tracked organization_renamed in PostHog`);

    return NextResponse.json({
      success: true,
      oldName,
      newName: newName.trim(),
    });
  } catch (error) {
    console.error('[Rename Org] Error renaming organization:', error);
    return NextResponse.json(
      { error: 'Failed to rename organization' },
      { status: 500 }
    );
  }
}
