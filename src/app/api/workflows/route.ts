import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { userId, workflows } = await req.json();

  if (!userId || !workflows || !Array.isArray(workflows)) {
    return NextResponse.json({ error: 'Missing userId or workflows array' }, { status: 400 });
  }

  try {
    const recordsToInsert = workflows.map(wf => ({
      ...wf,
      user_id: userId,
    }));

    const { data, error } = await supabase
      .from('low_level_workflows')
      .insert(recordsToInsert)
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('Error creating workflow:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from('low_level_workflows')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('Error fetching workflows:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 