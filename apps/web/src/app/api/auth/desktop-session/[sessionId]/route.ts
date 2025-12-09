import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET: Poll for desktop session status by session ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

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
      // Session not found or expired - return pending status
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
