import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { getPostHogClient } from '@/lib/posthog-server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { addToLoops } from '@/lib/loops';
import { encryptSecret } from '@/lib/crypto';
import { randomBytes } from 'crypto';
import { MEDIAR_ORG_IDS } from '@/lib/client-config';

const MEDIAR_ADMINS = ['matt@mediar.ai'];
const ORG_TOKEN_EXPIRY_DAYS = 365; // 1 year expiry for org tokens

/**
 * Create ORG_TOKEN for an organization
 * - Creates a desktop session token for the org admin
 * - Encrypts and stores it in org_secrets as ORG_TOKEN
 */
async function createOrgTokenForOrg(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  orgId: string,
  createdBy: string,
  creatorEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate secure token
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ORG_TOKEN_EXPIRY_DAYS);

    // Create desktop session for this token
    const { error: sessionError } = await supabase
      .from('mediar_desktop_sessions')
      .insert({
        token,
        clerk_user_id: createdBy,
        email: creatorEmail,
        org_id: orgId,
        org_role: 'org:admin',
        expires_at: expiresAt.toISOString(),
      });

    if (sessionError) {
      console.error(`[Clerk Webhook] Failed to create desktop session for ORG_TOKEN:`, sessionError);
      return { success: false, error: `Failed to create desktop session: ${sessionError.message}` };
    }

    // Encrypt the token
    const encryptedToken = await encryptSecret(token);

    // Store in org_secrets
    const { error: secretError } = await supabase
      .from('org_secrets')
      .insert({
        org_id: orgId,
        name: 'ORG_TOKEN',
        description: 'Auto-generated token for org API access (KV, etc.)',
        encrypted_value: encryptedToken,
        created_by: createdBy,
      });

    if (secretError) {
      // If secret already exists, that's fine
      if (secretError.code === '23505') { // unique constraint violation
        console.log(`[Clerk Webhook] ORG_TOKEN already exists for org ${orgId}`);
        return { success: true };
      }
      console.error(`[Clerk Webhook] Failed to store ORG_TOKEN in org_secrets:`, secretError);
      return { success: false, error: `Failed to store secret: ${secretError.message}` };
    }

    console.log(`[Clerk Webhook] ✓ Created ORG_TOKEN for org ${orgId}`);
    return { success: true };
  } catch (err) {
    console.error(`[Clerk Webhook] Error creating ORG_TOKEN:`, err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();
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

    // Add user to Loops and send welcome email
    if (primaryEmail && primaryEmail !== 'unknown') {
      try {
        const loopsResult = await addToLoops(primaryEmail, 'app_signup', {
          sendWelcomeEmail: true,
          firstName: first_name || undefined,
        });

        if (loopsResult.success) {
          console.log(`[Clerk Webhook] Successfully added ${primaryEmail} to Loops`);
        } else {
          console.error(`[Clerk Webhook] Failed to add ${primaryEmail} to Loops: ${loopsResult.error}`);
        }
      } catch (err) {
        console.error(`[Clerk Webhook] Error adding user to Loops:`, err);
      }
    }

    // Import Clerk client for org operations
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();

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

    // Check if user was invited to any organization
    let hasInvitations = false;

    try {
      // Check for pending invitations by email
      const invitations = await client.invitations.getInvitationList();
      const userInvitations = invitations.data.filter(
        (inv: any) => inv.emailAddress === primaryEmail && inv.status === 'pending'
      );
      hasInvitations = userInvitations.length > 0;

      console.log(`[Clerk Webhook] User has ${userInvitations.length} pending invitation(s)`);
    } catch (err) {
      console.error(`[Clerk Webhook] Error checking invitations:`, err);
    }


    // Check if user is Mediar admin
    const isMediarAdmin = primaryEmail.toLowerCase().endsWith('@mediar.ai');

    // Always insert user into mediar_users table (needed for author name lookup)
    // This must happen regardless of invitation status
    const userName = [first_name, last_name].filter(Boolean).join(' ') || primaryEmail;
    const { error: userInsertError } = await supabase
      .from('mediar_users')
      .upsert({
        user_id: userId,
        name: userName,
        email: primaryEmail,
        // organization_id will be set when personal workspace is created or when they join an org
      }, { onConflict: 'user_id' });

    if (userInsertError) {
      console.error('[Clerk Webhook] Failed to insert user into mediar_users:', userInsertError);
    } else {
      console.log('[Clerk Webhook] Inserted user into mediar_users table');
    }

    // Determine if we should create personal workspace
    const shouldCreatePersonalWorkspace = !hasInvitations || isMediarAdmin;

    if (shouldCreatePersonalWorkspace) {
      console.log('[Clerk Webhook] Creating personal workspace for ' + primaryEmail + ' (organic signup)');

      try {
        // Generate personal workspace name
        const workspaceName = first_name
          ? first_name + "'s Workspace"
          : primaryEmail.split('@')[0] + '-workspace';

        // Create personal organization
        const personalOrg = await client.organizations.createOrganization({
          name: workspaceName,
          createdBy: userId,
        });

        console.log('[Clerk Webhook] Created personal workspace: ' + workspaceName + ' (' + personalOrg.id + ')');
        // Note: createdBy automatically adds user as admin, no need for createOrganizationMembership

        // Update mediar_users with organization_id now that we have it
        const { error: userUpdateError } = await supabase
          .from('mediar_users')
          .update({ organization_id: personalOrg.id })
          .eq('user_id', userId);

        if (userUpdateError) {
          console.error('[Clerk Webhook] Failed to update mediar_users organization_id:', userUpdateError);
        }

        // Insert organization into organization_data_access table
        const { error: orgInsertError } = await supabase
          .from('organization_data_access')
          .upsert({
            clerk_organization_id: personalOrg.id,
            organization_name: workspaceName,
            data_access_scope: 'organization'  // Valid values: 'global', 'organization', 'custom'
          }, { onConflict: 'clerk_organization_id' });

        if (orgInsertError) {
          console.error(`[Clerk Webhook] ✗ Failed to insert org into organization_data_access:`, orgInsertError);
        } else {
          console.log(`[Clerk Webhook] ✓ Inserted organization into organization_data_access table`);
        }

        // Track personal workspace creation in PostHog
        posthog.capture({
          distinctId: userId,
          event: 'personal_workspace_created',
          properties: {
            organization_id: personalOrg.id,
            organization_name: workspaceName,
            is_personal: true,
            signup_type: 'organic',
            came_from_survey: !!submissionId,
            is_mediar_admin: isMediarAdmin,
            timestamp: new Date().toISOString(),
          },
        });

        console.log(`[Clerk Webhook] ✓ Tracked personal_workspace_created in PostHog`);

        // If Mediar admin, also add to Mediar organizations
        if (isMediarAdmin) {
          console.log(`[Clerk Webhook] Adding Mediar admin ${primaryEmail} to Mediar organizations`);
          const maxRetries = 3;

          for (const mediarOrgId of MEDIAR_ORG_IDS) {
            let _added = false;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
              try {
                await client.organizations.createOrganizationMembership({
                  organizationId: mediarOrgId,
                  userId: userId,
                  role: 'org:admin'
                });
                console.log(`[Clerk Webhook] ✓ Added ${primaryEmail} to Mediar org: ${mediarOrgId}`);
                _added = true;
                break;
              } catch (err: any) {
                if (err.status === 404 && attempt < maxRetries - 1) {
                  const delay = Math.pow(2, attempt) * 1000;
                  console.log(`[Clerk Webhook] Retrying Mediar org membership in ${delay}ms...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                  console.error(`[Clerk Webhook] ✗ Failed to add ${primaryEmail} to Mediar org ${mediarOrgId} after ${attempt + 1} attempts:`, err);
                  break;
                }
              }
            }
          }
        }

      } catch (err) {
        console.error(`[Clerk Webhook] ✗ Failed to create personal workspace for ${primaryEmail}:`, err);
      }
    } else {
      console.log(`[Clerk Webhook] Skipping personal workspace creation for ${primaryEmail} (has pending invitations)`);
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
        submission_id: submissionId,
        came_from_survey: !!submissionId,
        signup_type: hasInvitations ? 'invited' : 'organic',
        has_pending_invitations: hasInvitations,
        has_personal_workspace: shouldCreatePersonalWorkspace,
        is_mediar_admin: isMediarAdmin,
        $set: {
          email: primaryEmail,
          name: [first_name, last_name].filter(Boolean).join(' ') || primaryEmail,
          survey_submission_id: submissionId,
          is_mediar_admin: isMediarAdmin,
        },
      },
    });

    console.log(`[Clerk Webhook] ✓ Tracked user_created in PostHog: ${primaryEmail}${submissionId ? ` (linked to survey: ${submissionId})` : ''} (signup_type: ${hasInvitations ? 'invited' : 'organic'})`);
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
    const { id: orgId, name, created_by } = evt.data;

    console.log(`[Clerk Webhook] Organization created: ${name} (${orgId})`);

    // Import Clerk client
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();

    // Check if this is a personal workspace (name ends with "'s Workspace" or "-workspace")
    const isPersonalWorkspace = name.endsWith("'s Workspace") || name.endsWith('-workspace');

    // Get creator info for PostHog tracking
    let creatorEmail = 'unknown';
    try {
      if (created_by) {
        const creator = await client.users.getUser(created_by);
        creatorEmail = creator.emailAddresses?.[0]?.emailAddress || 'unknown';
      }
    } catch (err) {
      console.error(`[Clerk Webhook] Error fetching creator info:`, err);
    }

    // Track organization creation in PostHog
    posthog.capture({
      distinctId: created_by || 'system',
      event: 'organization_created',
      properties: {
        organization_id: orgId,
        organization_name: name,
        is_personal: isPersonalWorkspace,
        creator_email: creatorEmail,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[Clerk Webhook] ✓ Tracked organization_created in PostHog: ${name} (is_personal: ${isPersonalWorkspace})`);

    // Create ORG_TOKEN for API access (KV, etc.) - for all orgs
    if (created_by && creatorEmail !== 'unknown') {
      const orgTokenResult = await createOrgTokenForOrg(supabase, orgId, created_by, creatorEmail);
      if (!orgTokenResult.success) {
        console.error(`[Clerk Webhook] ✗ Failed to create ORG_TOKEN for ${name}: ${orgTokenResult.error}`);
      }
    } else {
      console.warn(`[Clerk Webhook] ⚠ Cannot create ORG_TOKEN - missing creator info for ${name}`);
    }

    // Only invite Mediar admins to team organizations (not personal workspaces)
    if (!isPersonalWorkspace) {
      console.log(`[Clerk Webhook] Auto-inviting Mediar admins to team org: ${MEDIAR_ADMINS.join(', ')}`);

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
    } else {
      console.log(`[Clerk Webhook] Skipping Mediar admin invites for personal workspace: ${name}`);
    }
  }

  return new NextResponse('Webhook processed', { status: 200 });
}
