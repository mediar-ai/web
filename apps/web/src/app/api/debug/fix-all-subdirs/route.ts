import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(_request: NextRequest) {
  const supabase = getSupabaseAdmin();
  try {
    // Get all workflows that have files but no subdirectory
    const { data: workflows, error: listError } = await supabase
      .from('deployed_workflows')
      .select('id, name, files_config')
      .eq('requires_files', true);

    if (listError) {
      return NextResponse.json({ error: listError }, { status: 500 });
    }

    const needsFix = workflows?.filter(w =>
      !w.files_config?.subdirectory
    ) || [];

    const results = [];

    for (const workflow of needsFix) {
      // Get workflow files from database
      const { data: files, error: filesError } = await supabase
        .from('workflow_files')
        .select('storage_path')
        .eq('workflow_id', workflow.id)
        .limit(1);

      if (filesError || !files || files.length === 0) {
        results.push({
          id: workflow.id,
          name: workflow.name,
          status: 'skipped',
          reason: 'No files found'
        });
        continue;
      }

      // Analyze storage paths to detect subdirectory
      let detectedSubdir: string | null = null;
      const firstPath = files[0].storage_path;

      // Normalize path separators (handle both / and \)
      const normalizedPath = firstPath.replace(/\\/g, '/');

      // Pattern: workflows/{id}/{subdirectory}/{file}
      const parts = normalizedPath.split('/');
      if (parts.length >= 4 && parts[0] === 'workflows') {
        const potentialSubdir = parts[2];
        if (potentialSubdir && !potentialSubdir.includes('.')) {
          detectedSubdir = potentialSubdir;
        }
      }

      if (detectedSubdir) {
        // Update the workflow
        const updatedConfig = {
          ...(workflow.files_config || {}),
          subdirectory: detectedSubdir,
          auto_fixed: new Date().toISOString()
        };

        const { error: updateError } = await supabase
          .from('deployed_workflows')
          .update({
            files_config: updatedConfig
          })
          .eq('id', workflow.id);

        if (updateError) {
          results.push({
            id: workflow.id,
            name: workflow.name,
            status: 'error',
            error: updateError.message
          });
        } else {
          results.push({
            id: workflow.id,
            name: workflow.name,
            status: 'fixed',
            subdirectory: detectedSubdir
          });
        }
      } else {
        results.push({
          id: workflow.id,
          name: workflow.name,
          status: 'skipped',
          reason: 'No subdirectory detected'
        });
      }
    }

    const summary = {
      total_processed: results.length,
      fixed: results.filter(r => r.status === 'fixed').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length
    };

    return NextResponse.json({
      success: true,
      summary,
      results
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}