/**
 * Sandbox Management API
 *
 * GET /api/sandbox - Get or create sandbox for authenticated user
 * DELETE /api/sandbox - Stop and delete user's sandbox
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateSandbox, stopSandbox, deleteSandbox } from '@/lib/daytona';
import { auth } from '@clerk/nextjs/server';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * GET /api/sandbox
 * Get or create a Daytona sandbox for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    // Get user from Clerk auth
    const { userId } = await auth();

    if (!userId) {
      // Try bearer token auth (for desktop app)
      const authHeader = request.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401, headers: corsHeaders }
        );
      }

      // Validate desktop token
      const token = authHeader.slice(7);
      const validatedUserId = await validateDesktopToken(token);

      if (!validatedUserId) {
        return NextResponse.json(
          { error: 'Invalid token' },
          { status: 401, headers: corsHeaders }
        );
      }

      // Get or create sandbox
      const sandboxInfo = await getOrCreateSandbox(validatedUserId);

      return NextResponse.json({
        sandboxId: sandboxInfo.sandboxId,
        url: sandboxInfo.previewUrl,
        token: sandboxInfo.previewToken,
        state: sandboxInfo.state,
      }, { headers: corsHeaders });
    }

    // Clerk authenticated user
    const sandboxInfo = await getOrCreateSandbox(userId);

    return NextResponse.json({
      sandboxId: sandboxInfo.sandboxId,
      url: sandboxInfo.previewUrl,
      token: sandboxInfo.previewToken,
      state: sandboxInfo.state,
    }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[SANDBOX API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get sandbox', details: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * DELETE /api/sandbox
 * Stop and delete the user's sandbox
 */
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      const authHeader = request.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401, headers: corsHeaders }
        );
      }

      const token = authHeader.slice(7);
      const validatedUserId = await validateDesktopToken(token);

      if (!validatedUserId) {
        return NextResponse.json(
          { error: 'Invalid token' },
          { status: 401, headers: corsHeaders }
        );
      }

      await deleteSandbox(validatedUserId);
      return NextResponse.json({ deleted: true }, { headers: corsHeaders });
    }

    await deleteSandbox(userId);
    return NextResponse.json({ deleted: true }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[SANDBOX API] Delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete sandbox', details: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Validate desktop app token
 */
async function validateDesktopToken(token: string): Promise<string | null> {
  try {
    // Import the existing validation logic
    const { createClient } = await import('@supabase/supabase-js');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if token exists and is valid
    const { data: session } = await supabase
      .from('mediar_desktop_sessions')
      .select('clerk_user_id, expires_at')
      .eq('token', token)
      .single();

    if (!session) {
      return null;
    }

    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      return null;
    }

    return session.clerk_user_id;
  } catch {
    return null;
  }
}
