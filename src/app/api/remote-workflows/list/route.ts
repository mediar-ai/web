import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get('category');
    const tags = url.searchParams.get('tags')?.split(',');
    const difficulty = url.searchParams.get('difficulty');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    let query = supabase
      .from('deployed_workflows')
      .select(`
        id,
        name,
        description,
        category,
        tags,
        difficulty_level,
        estimated_duration_seconds,
        successful_runs,
        failed_runs,
        total_executions,
        last_successful_execution,
        deployment_status,
        created_at
      `)
      .eq('status', 'active')
      .eq('deployment_status', 'deployed')
      .range(offset, offset + limit - 1)
      .order('name');

    // Apply filters
    if (category) {
      query = query.eq('category', category);
    }

    if (tags && tags.length > 0) {
      query = query.overlaps('tags', tags);
    }

    if (difficulty) {
      query = query.eq('difficulty_level', difficulty);
    }

    const { data: workflows, error, count } = await query;

    if (error) throw error;

    // Calculate success rates
    const enrichedWorkflows = workflows?.map(workflow => ({
      ...workflow,
      success_rate: workflow.total_executions > 0 
        ? Math.round((workflow.successful_runs / workflow.total_executions) * 100) 
        : null,
      is_reliable: workflow.total_executions >= 5 && 
        (workflow.successful_runs / workflow.total_executions) >= 0.8
    }));

    return NextResponse.json({
      workflows: enrichedWorkflows,
      pagination: {
        limit,
        offset,
        total: count
      }
    });

  } catch (error) {
    console.error('Error fetching workflows:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
