import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const TOKEN_EXPIRY_DAYS = 30;
const SESSION_EXPIRY_MINUTES = 5;

// Generate cryptographically secure random token
function generateSecureToken(): string {
  return randomBytes(32).toString('base64url');
}

// POST: Store token for desktop session (polling approach)
export async function POST(request: NextRequest) {
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

    // Get session ID from request
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required' },
        { status: 400 }
      );
    }

    // Ensure user has organization context - critical for workflow permissions
    let effectiveOrgId = clerkOrgId;
    let effectiveOrgRole = clerkOrgRole;
    let orgName: string | null = null;

    // If no org context from auth(), fetch user's organizations and use their primary one
    if (!effectiveOrgId) {
      console.log(`[Desktop Auth] No org context for ${email}, fetching user organizations...`);
      
      const { clerkClient } = await import('@clerk/nextjs/server');
      const client = await clerkClient();
      
      // Get user's organization memberships
      const memberships = await client.users.getOrganizationMembershipList({ userId });
      
      if (!memberships.data || memberships.data.length === 0) {
        console.error(`[Desktop Auth] User ${email} has no organizations - cannot create desktop session`);
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
      
      console.log(`[Desktop Auth] ✓ Using primary organization for ${email}: ${orgName} (${effectiveOrgId})`);
    } else {
      // Get org name if we have org context
      try {
        const { clerkClient } = await import('@clerk/nextjs/server');
        const client = await clerkClient();
        const org = await client.organizations.getOrganization({ organizationId: effectiveOrgId });
        orgName = org.name;
      } catch (err) {
        console.warn(`[Desktop Auth] Could not fetch org name for ${effectiveOrgId}:`, err);
      }
    }

    // Generate secure token
    const token = generateSecureToken();
    const tokenExpiresAt = new Date();
    tokenExpiresAt.setDate(tokenExpiresAt.getDate() + TOKEN_EXPIRY_DAYS);

    // Store token in Supabase desktop_sessions table
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, create the desktop session token
    const { error: tokenError } = await supabase
      .from('mediar_desktop_sessions')
      .insert({
        token,
        clerk_user_id: userId,
        email,
        org_id: effectiveOrgId, // Now guaranteed to have a value
        org_role: effectiveOrgRole || null,
        org_name: orgName,
        expires_at: tokenExpiresAt.toISOString(),
      });

    if (tokenError) {
      console.error('Failed to store desktop token:', tokenError);
      throw new Error('Failed to create desktop session token');
    }

    // Store session for polling (temporary, expires in 5 minutes)
    const sessionExpiresAt = new Date();
    sessionExpiresAt.setMinutes(
      sessionExpiresAt.getMinutes() + SESSION_EXPIRY_MINUTES
    );

    const { error: sessionError } = await supabase
      .from('mediar_desktop_polling_sessions')
      .upsert({
        session_id: sessionId,
        token,
        clerk_user_id: userId,
        email,
        org_id: effectiveOrgId, // Now guaranteed to have a value
        org_role: effectiveOrgRole || null,
        org_name: orgName,
        status: 'completed',
        expires_at: sessionExpiresAt.toISOString(),
      }, {
        onConflict: 'session_id'
      });

    if (sessionError) {
      console.error('Failed to store polling session:', sessionError);
      throw new Error('Failed to create polling session');
    }

    console.log(
      `[Desktop Auth] Session ${sessionId} completed for user ${userId} (${email})`
    );

    return NextResponse.json({
      success: true,
      sessionId,
      token,
    });
  } catch (error) {
    console.error('Desktop session storage error:', error);
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

// GET: Poll for desktop session status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query the polling session
    const { data, error } = await supabase
      .from('mediar_desktop_polling_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !data) {
      // Session not found or expired
      return NextResponse.json({
        status: 'pending',
      });
    }

    // Check if session expired
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      // Clean up expired session
      await supabase
        .from('mediar_desktop_polling_sessions')
        .delete()
        .eq('session_id', sessionId);

      return NextResponse.json({
        status: 'expired',
      });
    }

    if (data.status === 'completed') {
      return NextResponse.json({
        status: 'completed',
        token: data.token,
        user: {
          user_id: data.clerk_user_id,
          email: data.email,
          org_id: data.org_id,
          org_role: data.org_role,
          org_name: data.org_name,
        },
      });
    }

    return NextResponse.json({
      status: 'pending',
    });
  } catch (error) {
    console.error('Desktop session polling error:', error);
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
