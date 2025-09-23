import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get a test workflow
    const { data: workflow } = await supabase
      .from('deployed_workflows')
      .select('id, name')
      .limit(1)
      .single();

    if (!workflow) {
      return NextResponse.json({ error: 'No workflows found' }, { status: 404 });
    }

    // Create a new execution
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: workflow.id,
        status: 'queued',
        execution_params: {}
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to create execution' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Test workflow queued',
      workflow: workflow.name,
      execution_id: execution.id,
      status: 'Check deployments page to see it process'
    });

  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}