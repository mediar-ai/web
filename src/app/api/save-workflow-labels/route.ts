import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const {
    userId,
    analysisId,
    suggestedLabels,
    selectedLabels,
  } = await req.json();

  if (!userId || !analysisId) {
    return NextResponse.json({ error: 'Missing required parameters: userId and analysisId' }, { status: 400 });
  }

  try {
    const { data: existing, error: selectError } = await supabase
      .from('low_level_workflow_labeling')
      .select('id')
      .eq('low_level_workflow_analysis_id', analysisId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116: No rows found
      throw selectError;
    }
    
    const upsertData = {
      user_id: userId,
      low_level_workflow_analysis_id: analysisId,
      suggested_labels: suggestedLabels,
      selected_labels: selectedLabels,
    };

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('low_level_workflow_labeling')
        .update(upsertData)
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) throw error;
      return NextResponse.json({ data });

    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('low_level_workflow_labeling')
        .insert(upsertData)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ data });
    }

  } catch (error) {
    console.error('Error saving workflow labels:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let errorDetails = {};
    if (error && typeof error === 'object') {
      errorDetails = { ...error };
    }
    return NextResponse.json({ error: 'Internal server error', details: errorMessage, fullError: errorDetails }, { status: 500 });
  }
} 