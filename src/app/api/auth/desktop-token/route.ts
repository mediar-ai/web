import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const TOKEN_EXPIRY_DAYS = 30;

// Generate cryptographically secure random token
function generateSecureToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function POST() {
  try {
    // Get authenticated user
    const { userId, orgId: clerkOrgId, orgRole: clerkOrgRole } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = await currentUser();

    if (!user || !user.emailAddresses || user.emailAddresses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User email not found' },
        { status: 400 }
      );
    }

    const email = user.emailAddresses[0].emailAddress;

    // Ensure user has organization context - critical for workflow permissions
    let effectiveOrgId = clerkOrgId;
    let effectiveOrgRole = clerkOrgRole;
    let orgName: string | null = null;

    // If no org context from auth(), fetch user's organizations and use their primary one
    if (!effectiveOrgId) {
      console.log(`[Desktop Token] No org context for ${email}, fetching user organizations...`);
      
      const { clerkClient } = await import('@clerk/nextjs/server');
      const client = await clerkClient();
      
      // Get user's organization memberships
      const memberships = await client.users.getOrganizationMembershipList({ userId });
      
      if (!memberships.data || memberships.data.length === 0) {
        console.error(`[Desktop Token] User ${email} has no organizations - cannot create desktop session`);
        return NextResponse.json(
          { 
            success: false, 
            error: 'Organization required. Please create or join an organization before using the desktop app.',
            details: 'Desktop authentication requires organization context for workflow permissions.'
          },
          { status: 400 }
        );
      }

      // Use the first/primary organization
      const primaryMembership = memberships.data[0];
      effectiveOrgId = primaryMembership.organization.id;
      effectiveOrgRole = primaryMembership.role;
      orgName = primaryMembership.organization.name;
      
      console.log(`[Desktop Token] ✓ Using primary organization for ${email}: ${orgName} (${effectiveOrgId})`);
    } else {
      // Get org name if we have org context
      try {
        const { clerkClient } = await import('@clerk/nextjs/server');
        const client = await clerkClient();
        const org = await client.organizations.getOrganization({ organizationId: effectiveOrgId });
        orgName = org.name;
      } catch (err) {
        console.warn(`[Desktop Token] Could not fetch org name for ${effectiveOrgId}:`, err);
      }
    }

    // Generate secure token
    const token = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);

    // Store token in Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: insertError } = await supabase
      .from('mediar_desktop_sessions')
      .insert({
        token,
        clerk_user_id: userId,
        email,
        org_id: effectiveOrgId, // Now guaranteed to have a value
        org_role: effectiveOrgRole || null,
        org_name: orgName,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error('Failed to store desktop token:', insertError);
      throw new Error('Failed to create desktop session');
    }

    console.log(
      `[Desktop Auth] Token generated for user ${userId} (${email})`
    );

    return NextResponse.json({
      success: true,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Desktop token generation error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
