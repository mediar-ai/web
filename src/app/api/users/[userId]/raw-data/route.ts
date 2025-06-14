import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    let query = supabaseAdmin
      .from('user_activity_data')
      .select('*') // Select all columns for raw data view
      .eq('user_id', userId)
      .order('server_timestamp', { ascending: false });

    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw error;
    }

    return NextResponse.json(data || [], { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({ error: 'Failed to fetch user raw data', details: errorMessage }, { status: 500 });
  }
} 