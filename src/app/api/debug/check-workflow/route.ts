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

    // List actual files in storage - check root level
    const { data: rootFiles, error: rootError } = await supabase.storage
      .from('workflow-files')
      .list(`workflows/${workflowId}`, {
        limit: 100,
        offset: 0
      });

    // Check for subdirectories
    let subdirectories: string[] = [];
    const filesInSubdirs: Record<string, any[]> = {};

    if (rootFiles) {
      // Find directories
      subdirectories = rootFiles
        .filter((item: any) => !item.name && item.id) // Folders don't have name property in some cases
        .map((item: any) => item.name || item.id);

      // Also check if any items look like folders
      const potentialDirs = rootFiles.filter((item: any) =>
        !item.name?.includes('.') && item.name
      ).map((item: any) => item.name);

      subdirectories = [...subdirectories, ...potentialDirs];

      // List files in each subdirectory
      for (const dir of subdirectories) {
        const { data: subFiles } = await supabase.storage
          .from('workflow-files')
          .list(`workflows/${workflowId}/${dir}`, {
            limit: 10
          });
        if (subFiles && subFiles.length > 0) {
          filesInSubdirs[dir] = subFiles;
        }
      }
    }

    // Analyze file paths to detect subdirectory pattern
    let detectedSubdir: string | null = null;
    if (files && files.length > 0) {
      const firstPath = files[0].storage_path;
      const match = firstPath.match(/workflows\/\d+\/([^\/]+)\//);
      if (match) {
        detectedSubdir = match[1];
      }
    }

    return NextResponse.json({
      workflow: workflow,
      workflow_files_table: files || [],
      storage_structure: {
        root_level: rootFiles || [],
        subdirectories: subdirectories,
        files_in_subdirs: filesInSubdirs,
        detected_subdir_from_paths: detectedSubdir
      },
      storage_error: rootError
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}