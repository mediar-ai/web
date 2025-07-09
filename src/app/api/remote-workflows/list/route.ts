import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    console.log('⚡ Fast workflow list from Vercel...');
    
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query with filters
    let query = supabase
      .from('deployed_workflows')
      .select(`
        id,
        name,
        description,
        version,
        status,
        category,
        tags,
        difficulty_level,
        estimated_duration_seconds,
        successful_runs,
        failed_runs,
        total_executions,
        deployment_status,
        input_parameters,
        sample_inputs,
        automation_sequence,
        created_at,
        updated_at
      `)
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq('category', category);
    }

    const { data: workflows, error } = await query;

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .eq('status', status);

    // Format workflows with computed fields
    const formattedWorkflows = (workflows || []).map(workflow => {
      // --- DYNAMIC PARAMETER EXTRACTION ---
      // The new source of truth for UI parameters is the `variables` block
      // inside the workflow's automation sequence.
      let executionSchema = {};
      try {
        if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0) {
          const mainSequence = workflow.automation_sequence[0];
          if (mainSequence.arguments && mainSequence.arguments.variables) {
            executionSchema = mainSequence.arguments.variables;
          }
        }
      } catch (e) {
        console.error(`Error parsing variables for workflow ${workflow.id}:`, e);
        // Leave executionSchema as {}
      }
      // --- END DYNAMIC PARAMETER EXTRACTION ---

      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        status: workflow.status,
        category: workflow.category,
        tags: workflow.tags || [],
        difficulty_level: workflow.difficulty_level,
        estimated_duration_seconds: workflow.estimated_duration_seconds,
        
        // Parameter configuration - NOW DYNAMICALLY GENERATED
        input_parameters: executionSchema, // Replaces the static DB column
        sample_inputs: workflow.sample_inputs || {},
        
        // Performance metrics (nested format for new code)
        performance_metrics: {
          successful_runs: workflow.successful_runs || 0,
          failed_runs: workflow.failed_runs || 0,
          total_executions: workflow.total_executions || 0,
          success_rate: workflow.total_executions > 0 
            ? Math.round(((workflow.successful_runs || 0) / workflow.total_executions) * 100) 
            : 0
        },
        
        // Performance metrics (flat format for backward compatibility)
        successful_runs: workflow.successful_runs || 0,
        failed_runs: workflow.failed_runs || 0,
        total_executions: workflow.total_executions || 0,
        success_rate: workflow.total_executions > 0 
          ? Math.round(((workflow.successful_runs || 0) / workflow.total_executions) * 100) 
          : null,
        
        // Execution info
        is_executable: workflow.deployment_status === 'deployed' && workflow.status === 'active',
        deployment_status: workflow.deployment_status,
        
        // Timestamps
        created_at: workflow.created_at,
        updated_at: workflow.updated_at,
        
        // Quick access URLs
        endpoints: {
          details: `/api/remote-workflows/${workflow.id}`,
          execute: `/api/remote-workflows/${workflow.id}/execute`
        }
      };
    });

    return NextResponse.json({
      success: true,
      workflows: formattedWorkflows,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit
      },
      filters: {
        category: category || 'all',
        status,
        applied_filters: {
          ...(category && { category }),
          status
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error listing workflows:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflows',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
