import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: NextRequest) {
  try {
    const { userId, timestamps } = await req.json();

    if (!userId || !timestamps || !Array.isArray(timestamps)) {
      return NextResponse.json({ error: 'User ID and a list of timestamps are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('*')
      .eq('user_id', userId)
      .in('client_timestamp', timestamps);

    if (error) {
      throw error;
    }

    return NextResponse.json({ analyses: data });
  } catch (error) {
    console.error('Error fetching analyses by timestamps:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 