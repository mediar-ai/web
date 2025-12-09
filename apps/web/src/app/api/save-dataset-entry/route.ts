import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { 
    userId, 
    datasetType, 
    low_level_workflow_analysis_id,
    generated_output,
    feedback,
    feedback_reason
  } = await req.json();

  if (!userId || !datasetType || !low_level_workflow_analysis_id) {
    return NextResponse.json({ error: 'Missing required parameters: userId, datasetType, and low_level_workflow_analysis_id' }, { status: 400 });
  }

  try {
    // Upsert logic: Check if a record for this analysisId and datasetType already exists
    const { data: existing, error: selectError } = await supabase
      .from('low_level_datasets')
      .select('id')
      .eq('low_level_workflow_analysis_id', low_level_workflow_analysis_id)
      .eq('dataset_type', datasetType)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // Ignore 'No rows found' error
        throw selectError;
    }

    const upsertData = {
        user_id: userId,
        dataset_type: datasetType,
        low_level_workflow_analysis_id: low_level_workflow_analysis_id,
        generated_output: generated_output,
        feedback: feedback,
        feedback_reason: feedback_reason,
    };

    if (existing) {
        // Update
        const { data, error } = await supabase
            .from('low_level_datasets')
            .update(upsertData)
            .eq('id', existing.id)
            .select()
            .single();
        if (error) throw error;
        return NextResponse.json({ success: true, data });
    } else {
        // Insert
        const { data, error } = await supabase
            .from('low_level_datasets')
            .insert(upsertData)
            .select()
            .single();
        if (error) throw error;
        return NextResponse.json({ success: true, data });
    }

  } catch (error) {
    console.error('Error saving dataset entry:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 