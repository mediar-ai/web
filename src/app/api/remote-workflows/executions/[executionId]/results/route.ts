import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';

/**
 * GET /api/remote-workflows/executions/[executionId]/results
 * Fetch the results field for a specific execution
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  const { executionId } = await params;

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Missing required environment variables' },
        { status: 500, headers: corsHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch only the results field for this execution
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, results')
      .eq('id', executionId)
      .single();

    if (error || !execution) {
      return NextResponse.json(
        {
          success: false,
          error: error?.message || 'Execution not found'
        },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        execution: {
          id: execution.id,
          workflow_id: execution.workflow_id,
          status: execution.status,
          results: execution.results
        }
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error fetching execution results:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}
