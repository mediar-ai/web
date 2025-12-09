import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const datasetType = searchParams.get('datasetType');

  if (!userId || !datasetType) {
    return NextResponse.json({ error: 'Missing userId and datasetType parameters' }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from('low_level_datasets')
      .select('low_level_workflow_analysis_id, generated_output, feedback, feedback_reason')
      .eq('user_id', userId)
      .eq('dataset_type', datasetType);

    if (error) {
      throw error;
    }

    return NextResponse.json({ entries: data });

  } catch (error) {
    console.error('Error fetching dataset entries:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 