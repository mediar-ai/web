import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ annotationId: string }> }
) {
  try {
    const { annotationId } = await params;
    const { userId, annotation } = await request.json();

    if (!userId || !annotation) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, annotation' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Update the specific annotation by ID (not all annotations with same analysis_id)
    const { error } = await supabaseAdmin
      .from('raw_timeline_event_annotations')
      .update({
        workflow_template_id: annotation.workflow_template_id,
        workflow_type_id: annotation.workflow_type_id,
        workflow_instance_id: annotation.workflow_instance_id,
        workflow_step_id: annotation.workflow_step_id,
        workflow_substep_id: annotation.workflow_substep_id,
        is_workflow_related: annotation.is_workflow_related,
        confidence_score: annotation.confidence_score,
        inputs: annotation.inputs,
        outputs: annotation.outputs,
        business_logic: annotation.business_logic,
        unrelated_reason: annotation.unrelated_reason,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', annotationId); // Target specific annotation ID, not analysis_id

    if (error) {
      console.error('Error updating timeline annotation:', error);
      return NextResponse.json(
        { error: 'Failed to update timeline annotation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Timeline annotation updated successfully' 
    });

  } catch (error) {
    console.error('Error in timeline annotation update:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 