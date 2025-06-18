import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { userId, datasetType, data, notes } = await req.json();

  if (!userId || !datasetType || !data) {
    return NextResponse.json({ error: 'Missing required parameters: userId, datasetType, and data' }, { status: 400 });
  }

  try {
    const { data: insertedData, error } = await supabase
      .from('low_level_datasets')
      .insert([
        {
          user_id: userId,
          dataset_type: datasetType,
          data: data,
          notes: notes,
        },
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data: insertedData });

  } catch (error) {
    console.error('Error saving dataset entry:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 