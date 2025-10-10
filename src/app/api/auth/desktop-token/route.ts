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
    const { userId, orgId, orgRole } = await auth();

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

    // Generate secure token
    const token = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);

    // Get org name if user has org
    // Note: orgName is optional - we just store the orgId from Clerk auth
    const orgName = null;

    // Store token in Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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
        org_id: orgId || null,
        org_role: orgRole || null,
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
