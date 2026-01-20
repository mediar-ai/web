import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getCorsHeaders } from '@/lib/cors';

/**
 * Authenticate request - supports both Clerk auth and desktop token
 */
async function authenticateRequest(request: NextRequest): Promise<{ userId: string | null; email?: string; error?: string }> {
  // Try Clerk auth first
  const { userId } = await auth();
  if (userId) {
    return { userId };
  }

  // Try desktop token
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);
    if (validation.valid && validation.userId) {
      return { userId: validation.userId, email: validation.email };
    }
    return { userId: null, error: validation.error || 'Invalid token' };
  }

  return { userId: null, error: 'Unauthorized' };
}

/**
 * OPTIONS (CORS preflight)
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/**
 * GET /api/user/cal-booking
 * Check if current user has booked their onboarding call
 * Used by desktop app for polling after opening Cal.com
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId, email, error } = await authenticateRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: error || 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    console.log('[Cal Booking Check] Checking for user:', userId);

    // Look up user in mediar_users by user_id (which is the clerk user id)
    const { data: user, error: fetchError } = await supabase
      .from('mediar_users')
      .select('user_id, email, booked_cal_call, booked_cal_call_at')
      .eq('user_id', userId)
      .single();

    if (fetchError) {
      // User not in mediar_users table yet
      if (fetchError.code === 'PGRST116') {
        console.log('[Cal Booking Check] User not found in mediar_users:', userId);
        return NextResponse.json(
          { bookedCalCall: false, userExists: false },
          { headers: corsHeaders }
        );
      }
      console.error('[Cal Booking Check] Error fetching user:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch user' },
        { status: 500, headers: corsHeaders }
      );
    }

    console.log('[Cal Booking Check] User found:', {
      userId,
      bookedCalCall: user.booked_cal_call,
      bookedAt: user.booked_cal_call_at,
    });

    return NextResponse.json(
      {
        bookedCalCall: user.booked_cal_call || false,
        bookedCalCallAt: user.booked_cal_call_at,
        userExists: true,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[Cal Booking Check] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
