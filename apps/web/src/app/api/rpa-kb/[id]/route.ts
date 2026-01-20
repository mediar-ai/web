/**
 * RPA Knowledgebase Single Step API
 * GET: Get step details by ID
 * PATCH: Update step details
 * DELETE: Delete a step
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateStepEmbeddings } from '@/lib/vertex-embeddings';
import { getCorsHeaders, corsJsonResponse } from '@/lib/cors';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * OPTIONS /api/rpa-kb/[id]
 * CORS preflight handler
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

/**
 * GET /api/rpa-kb/[id]
 * Get a single step by ID and increment read count
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');

  try {
    const { id } = await params;

    // Fetch step
    const { data, error } = await supabase
      .from('rpa_knowledgebase')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return corsJsonResponse(
          { error: 'Step not found' },
          { status: 404 },
          origin
        );
      }
      console.error('❌ Database error:', error);
      return corsJsonResponse(
        { error: 'Failed to fetch step', details: error.message },
        { status: 500 },
        origin
      );
    }

    // Increment read count (fire and forget)
    void (async () => {
      try {
        await supabase.rpc('increment_rpa_kb_stats', {
          step_id: id,
          increment_read: true,
        });
      } catch (err) {
        console.error('Failed to increment read count:', err);
      }
    })();

    return corsJsonResponse({
      success: true,
      data,
    }, undefined, origin);
  } catch (error: any) {
    console.error('❌ Failed to fetch step:', error);
    return corsJsonResponse(
      {
        error: 'Failed to fetch step',
        details: error.message || String(error),
      },
      { status: 500 },
      origin
    );
  }
}

/**
 * PATCH /api/rpa-kb/[id]
 * Update a step's details (regenerates embeddings if relevant fields change)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');

  try {
    const { id } = await params;
    const body = await request.json();

    // Fields that can be updated
    const {
      app_name,
      window_title,
      element_path,
      step_name,
      definition,
      current_state,
      expected_outcome,
      workflow_name,
      workflow_description,
      terminator_version,
      environment,
      author,
      regenerate_embeddings = false,
    } = body;

    // Check if step exists
    const { data: existingStep, error: fetchError } = await supabase
      .from('rpa_knowledgebase')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return corsJsonResponse(
          { error: 'Step not found' },
          { status: 404 },
          origin
        );
      }
      return corsJsonResponse(
        { error: 'Failed to fetch step', details: fetchError.message },
        { status: 500 },
        origin
      );
    }

    // Build update object
    const updates: any = {};
    if (app_name !== undefined) updates.app_name = app_name;
    if (window_title !== undefined) updates.window_title = window_title;
    if (element_path !== undefined) updates.element_path = element_path;
    if (step_name !== undefined) updates.step_name = step_name;
    if (definition !== undefined) updates.definition = definition;
    if (current_state !== undefined) updates.current_state = current_state;
    if (expected_outcome !== undefined) updates.expected_outcome = expected_outcome;
    if (workflow_name !== undefined) updates.workflow_name = workflow_name;
    if (workflow_description !== undefined)
      updates.workflow_description = workflow_description;
    if (terminator_version !== undefined) updates.terminator_version = terminator_version;
    if (environment !== undefined) updates.environment = environment;
    if (author !== undefined) updates.author = author;

    // Regenerate embeddings if requested or if key fields changed
    const needsEmbeddingUpdate =
      regenerate_embeddings ||
      step_name !== undefined ||
      definition !== undefined ||
      workflow_name !== undefined ||
      workflow_description !== undefined ||
      expected_outcome !== undefined;

    if (needsEmbeddingUpdate) {
      console.log('🔄 Regenerating embeddings...');

      const embeddings = await generateStepEmbeddings({
        step_name: step_name || existingStep.step_name,
        definition: definition !== undefined ? definition : existingStep.definition,
        workflow_name: workflow_name || existingStep.workflow_name,
        workflow_description:
          workflow_description !== undefined
            ? workflow_description
            : existingStep.workflow_description,
        expected_outcome:
          expected_outcome !== undefined
            ? expected_outcome
            : existingStep.expected_outcome,
      });

      updates.definition_embedding = embeddings.definition_embedding;
      updates.workflow_embedding = embeddings.workflow_embedding;
      updates.outcome_embedding = embeddings.outcome_embedding;

      console.log('✅ Embeddings regenerated');
    }

    // Update in database
    const { data, error } = await supabase
      .from('rpa_knowledgebase')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ Update error:', error);
      return corsJsonResponse(
        { error: 'Failed to update step', details: error.message },
        { status: 500 },
        origin
      );
    }

    console.log('✅ Step updated:', id);

    return corsJsonResponse({
      success: true,
      data,
      embeddings_regenerated: needsEmbeddingUpdate,
    }, undefined, origin);
  } catch (error: any) {
    console.error('❌ Failed to update step:', error);
    return corsJsonResponse(
      {
        error: 'Failed to update step',
        details: error.message || String(error),
      },
      { status: 500 },
      origin
    );
  }
}

/**
 * DELETE /api/rpa-kb/[id]
 * Delete a step from the knowledgebase
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');

  try {
    const { id } = await params;

    const { error } = await supabase
      .from('rpa_knowledgebase')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('❌ Delete error:', error);
      return corsJsonResponse(
        { error: 'Failed to delete step', details: error.message },
        { status: 500 },
        origin
      );
    }

    console.log('✅ Step deleted:', id);

    return corsJsonResponse({
      success: true,
      message: 'Step deleted successfully',
    }, undefined, origin);
  } catch (error: any) {
    console.error('❌ Failed to delete step:', error);
    return corsJsonResponse(
      {
        error: 'Failed to delete step',
        details: error.message || String(error),
      },
      { status: 500 },
      origin
    );
  }
}

