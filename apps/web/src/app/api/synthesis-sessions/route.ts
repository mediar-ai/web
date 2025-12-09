import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// GET a user's synthesis session
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('synthesis_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No synthesis session found for this user' }, { status: 404 });
    }

    // Return the most recent session
    const session = data[0];

    return NextResponse.json({ data: session });

  } catch (error) {
    console.error(`Error fetching synthesis session for user ${userId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

// POST a new synthesis session
export async function POST(req: NextRequest) {
  const { userId, session_state } = await req.json();

  if (!userId || !session_state) {
    return NextResponse.json({ error: 'Missing userId or session_state' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('synthesis_sessions')
      .insert({
        user_id: userId,
        session_state: session_state,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('Error creating synthesis session:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 