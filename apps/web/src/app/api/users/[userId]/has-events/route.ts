import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface Params {
  params: Promise<{
    userId: string;
  }>;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { userId } = await params;
    
    console.log(`[API] Checking if user ${userId} has raw events`);
    
    // For now, since there's a schema mismatch between Clerk user IDs (text) and database UUIDs,
    // let's check if this user exists in mediar_users. If they don't, they definitely don't have events.
    const { data: userCheck, error: userCheckError } = await supabaseAdmin
      .from('mediar_users')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    if (userCheckError) {
      // If user doesn't exist in mediar_users, they don't have events
      if (userCheckError.code === 'PGRST116') { // No rows returned
        console.log(`[API] User ${userId} not found in mediar_users, no events`);
        return NextResponse.json({
          hasEvents: false,
          totalEventCount: 0
        });
      }
      console.error('[API/has-events] Error checking user existence:', userCheckError);
      return NextResponse.json({ error: 'Failed to check user', details: userCheckError.message }, { status: 500 });
    }

    if (!userCheck) {
      // User doesn't exist, no events
      console.log(`[API] User ${userId} data is null, no events`);
      return NextResponse.json({
        hasEvents: false,
        totalEventCount: 0
      });
    }

    // For now, assume no events since we can't query session_metadata due to schema mismatch
    // TODO: Fix the schema mismatch between Clerk IDs and database UUIDs
    console.log(`[API] User ${userId} exists but schema mismatch prevents event checking`);
    return NextResponse.json({
      hasEvents: false,
      totalEventCount: 0
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API/has-events] Critical error:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
}