import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workflowId = searchParams.get('id');
  const fix = searchParams.get('fix') === 'true';

  if (!workflowId) {
    return NextResponse.json({ error: 'Workflow ID required' }, { status: 400 });
  }

  try {
    // Get workflow files from database
    const { data: files, error: filesError } = await supabase
      .from('workflow_files')
      .select('storage_path')
      .eq('workflow_id', workflowId);

    if (filesError || !files || files.length === 0) {
      return NextResponse.json({
        error: 'No files found for workflow',
        details: filesError
      }, { status: 404 });
    }

    // Analyze storage paths to detect subdirectory
    let detectedSubdir: string | null = null;
    const firstPath = files[0].storage_path;

    // Normalize path separators (handle both / and \)
    const normalizedPath = firstPath.replace(/\\/g, '/');

    // Pattern: workflows/{id}/{subdirectory}/{file}
    const parts = normalizedPath.split('/');
    if (parts.length >= 4 && parts[0] === 'workflows') {
      // parts[1] is workflow ID, parts[2] is potential subdirectory
      const potentialSubdir = parts[2];

      // Check if all files have this subdirectory
      const allMatch = files.every(f => {
        const normalizedF = f.storage_path.replace(/\\/g, '/');
        const fParts = normalizedF.split('/');
        return fParts.length >= 4 && fParts[2] === potentialSubdir;
      });

      if (allMatch && potentialSubdir.includes('.') === false) {
        detectedSubdir = potentialSubdir;
      }
    }

    if (!detectedSubdir) {
      return NextResponse.json({
        message: 'No subdirectory detected in file paths',
        sample_paths: files.slice(0, 5).map(f => f.storage_path)
      }, { status: 200 });
    }

    // If fix=true, update the workflow
    if (fix) {
      // Update deployed_workflows
      const { error: updateError } = await supabase
        .from('deployed_workflows')
        .update({
          files_config: {
            subdirectory: detectedSubdir,
            auto_fixed: new Date().toISOString()
          }
        })
        .eq('id', workflowId);

      if (updateError) {
        return NextResponse.json({
          error: 'Failed to update workflow',
          details: updateError
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Updated workflow ${workflowId} with subdirectory: ${detectedSubdir}`,
        detected_subdirectory: detectedSubdir,
        sample_paths: files.slice(0, 5).map(f => f.storage_path)
      }, { status: 200 });
    } else {
      return NextResponse.json({
        message: 'Subdirectory detected but not fixed (add ?fix=true to apply)',
        detected_subdirectory: detectedSubdir,
        sample_paths: files.slice(0, 5).map(f => f.storage_path)
      }, { status: 200 });
    }
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  try {
    // Get all workflows that have files but no subdirectory
    const { data: workflows, error } = await supabase
      .from('deployed_workflows')
      .select('id, name, files_config')
      .eq('requires_files', true);

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    const needsFix = workflows?.filter(w =>
      !w.files_config?.subdirectory
    ).map(w => ({
      id: w.id,
      name: w.name,
      files_config: w.files_config
    }));

    return NextResponse.json({
      total_with_files: workflows?.length || 0,
      needs_subdirectory_fix: needsFix?.length || 0,
      workflows: needsFix || []
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}