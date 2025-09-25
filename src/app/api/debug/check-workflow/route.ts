import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workflowId = searchParams.get('id') || '50';

  try {
    // Check deployed_workflows table
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, files_config, requires_files')
      .eq('id', workflowId)
      .single();

    if (workflowError) {
      return NextResponse.json({ error: workflowError }, { status: 500 });
    }

    // Check workflow_files table
    const { data: files, error: filesError } = await supabase
      .from('workflow_files')
      .select('workflow_id, file_path, storage_path')
      .eq('workflow_id', workflowId)
      .limit(5);

    if (filesError) {
      return NextResponse.json({ error: filesError }, { status: 500 });
    }

    // List actual files in storage
    const { data: storageFiles, error: storageError } = await supabase.storage
      .from('workflow-files')
      .list(`workflows/${workflowId}`, {
        limit: 100,
        offset: 0
      });

    return NextResponse.json({
      workflow: workflow,
      workflow_files_table: files || [],
      storage_files: storageFiles || [],
      storage_error: storageError
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}