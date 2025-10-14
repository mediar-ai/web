import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check for test-webhook workflow
  const { data: workflow, error } = await supabase
    .from('deployed_workflows')
    .select('id, name, github_folder, version, total_versions, created_at, github_sync_status')
    .ilike('github_folder', 'test-webhook%')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!workflow || workflow.length === 0) {
    return NextResponse.json({
      found: false,
      message: 'No test-webhook workflow found in database'
    });
  }

  const wf = workflow[0];

  // Check versions
  const { data: versions, error: vError } = await supabase
    .from('deployed_workflow_versions')
    .select('id, version_number, is_active, created_at, change_notes')
    .eq('workflow_id', wf.id)
    .order('created_at', { ascending: false });

  if (vError) {
    return NextResponse.json({
      workflow: wf,
      versions_error: vError.message
    }, { status: 500 });
  }

  return NextResponse.json({
    found: true,
    workflow: wf,
    versions: versions || [],
    version_count: versions?.length || 0
  });
}
