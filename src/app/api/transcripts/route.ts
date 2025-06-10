import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase URL or anon key');
}

if (!INTERNAL_API_KEY) {
  throw new Error('INTERNAL_API_KEY is not set');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface TranscriptionItem {
    id: string;
    type: string;
    role: string;
    content: string[];
    interrupted: boolean;
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${INTERNAL_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { session_id, user_id, items, lead_id } = body;

    if (!session_id || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'session_id and items array are required' }, { status: 400 });
    }

    const recordsToInsert = items.map((item: TranscriptionItem) => ({
      session_id,
      user_id,
      lead_id,
      item_id: item.id,
      type: item.type,
      role: item.role,
      content: item.content,
      interrupted: item.interrupted,
    }));

    const { data, error } = await supabase
      .from('agent_live_transcriptions')
      .insert(recordsToInsert);

    if (error) {
      console.error('Error inserting transcriptions:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Transcriptions ingested successfully', data }, { status: 201 });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 