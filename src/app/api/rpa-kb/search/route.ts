/**
 * RPA Knowledgebase Search API
 * POST: Two-stage search (keyword + vector similarity)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from '@/lib/vertex-embeddings';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/rpa-kb/search
 * Two-stage search: keyword filtering + vector similarity
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      search_query, // Text query for keyword search
      similarity_query, // Text to generate embedding from (optional)
      embedding_type = 'definition', // 'definition', 'workflow', or 'outcome'
      filter_app,
      filter_window,
      filter_workflow,
      filter_author,
      filter_environment,
      date_from: _date_from,
      date_to: _date_to,
      min_succeeded: _min_succeeded = 0,
      stage1_limit = 500,
      stage2_limit = 20,
    } = body;

    // Validate inputs
    if (!search_query && !similarity_query) {
      return NextResponse.json(
        {
          error: 'Either search_query or similarity_query is required',
        },
        { status: 400 }
      );
    }

    if (embedding_type && !['definition', 'workflow', 'outcome'].includes(embedding_type)) {
      return NextResponse.json(
        {
          error: 'Invalid embedding_type. Must be: definition, workflow, or outcome',
        },
        { status: 400 }
      );
    }

    console.log('🔍 Search request:', {
      search_query,
      has_similarity: !!similarity_query,
      embedding_type,
      filters: { filter_app, filter_workflow, filter_author, filter_environment },
    });

    // Generate query embedding if similarity search requested
    let query_embedding = null;
    if (similarity_query) {
      console.log('🔄 Generating query embedding...');
      query_embedding = await generateQueryEmbedding(similarity_query);
      console.log('✅ Query embedding generated');
    }

    // Call two-stage search function
    const { data, error } = await supabase.rpc('search_rpa_kb_two_stage', {
      search_query: search_query || null,
      query_embedding: query_embedding ? `[${query_embedding.join(',')}]` : null,
      embedding_type,
      filter_app: filter_app || null,
      filter_window: filter_window || null,
      filter_workflow: filter_workflow || null,
      filter_author: filter_author || null,
      filter_environment: filter_environment || null,
      stage1_limit,
      stage2_limit,
    });

    if (error) {
      console.error('❌ Search error:', error);
      return NextResponse.json(
        { error: 'Search failed', details: error.message },
        { status: 500 }
      );
    }

    console.log('✅ Search completed, found', data?.length || 0, 'results');

    // Update search appearance counts for returned results (async, no await)
    if (data && data.length > 0) {
      const stepIds = data.map((step: any) => step.step_id);
      updateSearchAppearances(stepIds).catch((err) =>
        console.error('Failed to update search appearances:', err)
      );
    }

    return NextResponse.json({
      success: true,
      results: data || [],
      metadata: {
        search_query,
        has_similarity: !!query_embedding,
        embedding_type,
        stage1_limit,
        stage2_limit,
        result_count: data?.length || 0,
      },
    });
  } catch (error: any) {
    console.error('❌ Search failed:', error);
    return NextResponse.json(
      {
        error: 'Search failed',
        details: error.message || String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Helper: Update search appearance counts for steps
 */
async function updateSearchAppearances(stepIds: string[]): Promise<void> {
  for (const stepId of stepIds) {
    await supabase.rpc('increment_rpa_kb_stats', {
      step_id: stepId,
      increment_appeared: true,
    });
  }
}

