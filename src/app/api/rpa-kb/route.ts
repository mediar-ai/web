/**
 * RPA Knowledgebase API - CRUD Operations
 * POST: Create new step with embeddings
 * GET: List steps with pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateStepEmbeddings } from '@/lib/vertex-embeddings';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/rpa-kb
 * Create a new step or update existing step stats
 * Deduplicates based on: app_name, element_path, definition
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

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
      success, // boolean: did this execution succeed?
      duration_ms,
    } = body;

    // Validate required fields
    if (!app_name || !window_title || !element_path || !step_name || !workflow_name) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          required: ['app_name', 'window_title', 'element_path', 'step_name', 'workflow_name'],
        },
        { status: 400 }
      );
    }

    console.log('🔍 Checking for existing step:', { app_name, element_path, has_definition: !!definition });

    // Check if step already exists (match on app_name, element_path, definition)
    const { data: existingStep, error: findError } = await supabase
      .from('rpa_knowledgebase')
      .select('id, succeeded, failed, ranking, last_executed_at')
      .eq('app_name', app_name)
      .eq('element_path', element_path)
      .eq('definition', definition || '')
      .single();

    if (findError && findError.code !== 'PGRST116') {
      // PGRST116 = no rows found, other errors are real problems
      console.error('❌ Database error while checking for existing step:', findError);
      return NextResponse.json(
        { error: 'Failed to check for existing step', details: findError.message },
        { status: 500 }
      );
    }

    // If step exists, increment stats instead of creating new entry
    if (existingStep) {
      console.log('✅ Found existing step:', existingStep.id, '- incrementing stats');

      // Increment stats using atomic function
      const { error: statsError } = await supabase.rpc('increment_rpa_kb_stats', {
        step_id: existingStep.id,
        is_success: success ?? null,
        execution_duration: duration_ms || null,
        increment_appeared: false,
        increment_read: false,
      });

      if (statsError) {
        console.error('❌ Failed to increment stats:', statsError);
        return NextResponse.json(
          { error: 'Failed to update step stats', details: statsError.message },
          { status: 500 }
        );
      }

      // Fetch updated step data
      const { data: updatedStep, error: fetchError } = await supabase
        .from('rpa_knowledgebase')
        .select('*')
        .eq('id', existingStep.id)
        .single();

      if (fetchError) {
        console.error('⚠️ Failed to fetch updated step:', fetchError);
        // Still return success since stats update worked
        return NextResponse.json({
          success: true,
          data: { id: existingStep.id },
          message: 'Step stats updated (existing step)',
          is_new: false,
        });
      }

      console.log('✅ Stats incremented:', {
        succeeded: updatedStep.succeeded,
        failed: updatedStep.failed,
        ranking: updatedStep.ranking,
      });

      return NextResponse.json({
        success: true,
        data: updatedStep,
        message: 'Step stats updated (existing step)',
        is_new: false,
      });
    }

    // Step doesn't exist - create new entry with embeddings
    console.log('📝 Creating new step with embeddings:', step_name);

    // Generate all three embeddings
    const embeddings = await generateStepEmbeddings({
      step_name,
      definition,
      workflow_name,
      workflow_description,
      expected_outcome,
    });

    console.log('✅ Embeddings generated, inserting into database...');

    // Insert into database with initial stats
    const { data, error } = await supabase
      .from('rpa_knowledgebase')
      .insert({
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
        succeeded: success === true ? 1 : 0,
        failed: success === false ? 1 : 0,
        duration_ms,
        definition_embedding: embeddings.definition_embedding,
        workflow_embedding: embeddings.workflow_embedding,
        outcome_embedding: embeddings.outcome_embedding,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Database error:', error);
      return NextResponse.json(
        { error: 'Failed to create step', details: error.message },
        { status: 500 }
      );
    }

    console.log('✅ New step created successfully:', data.id);

    return NextResponse.json({
      success: true,
      data,
      message: 'New step created with embeddings',
      is_new: true,
    });
  } catch (error: any) {
    console.error('❌ Failed to process step:', error);
    return NextResponse.json(
      {
        error: 'Failed to process step',
        details: error.message || String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/rpa-kb
 * List steps with pagination and basic filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const app = searchParams.get('app');
    const workflow = searchParams.get('workflow');
    const author = searchParams.get('author');
    const environment = searchParams.get('environment');
    const sortBy = searchParams.get('sortBy') || 'ranking'; // ranking, created_at, last_executed_at

    // Build query
    let query = supabase
      .from('rpa_knowledgebase')
      .select('*', { count: 'exact' });

    // Apply filters
    if (app) query = query.eq('app_name', app);
    if (workflow) query = query.eq('workflow_name', workflow);
    if (author) query = query.eq('author', author);
    if (environment) query = query.eq('environment', environment);

    // Apply sorting
    if (sortBy === 'ranking') {
      query = query.order('ranking', { ascending: false });
    } else if (sortBy === 'created_at') {
      query = query.order('created_at', { ascending: false });
    } else if (sortBy === 'last_executed_at') {
      query = query.order('last_executed_at', { ascending: false });
    }

    // Apply pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('❌ Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch steps', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error: any) {
    console.error('❌ Failed to fetch steps:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch steps',
        details: error.message || String(error),
      },
      { status: 500 }
    );
  }
}

