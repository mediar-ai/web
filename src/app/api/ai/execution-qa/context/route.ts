import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('executionId');

    if (!executionId) {
      return NextResponse.json({ error: 'Execution ID required' }, { status: 400 });
    }

    console.log('[Q&A Context API] Loading context for execution:', executionId);

    // Fetch execution data
    const { data: execution, error: executionError } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (executionError || !execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    const workflowId = execution.workflow_id;
    const version = execution.version_number;

    console.log(`[Q&A Context API] Loading workflow ${workflowId} v${version}`);

    // Fetch workflow version - try both 'version' and 'version_number' columns
    let { data: workflowVersionData, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('version_number', version)
      .single();

    // Fallback to version column if version_number doesn't work
    if (versionError || !workflowVersionData) {
      const fallbackResult = await supabase
        .from('deployed_workflow_versions')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('version', version)
        .single();

      if (fallbackResult.data) {
        workflowVersionData = fallbackResult.data;
        versionError = null;
      }
    }

    if (versionError || !workflowVersionData) {
      console.log(`[Q&A Context API] Workflow version ${version} not found, will use workflow from execution`);

      // Get github_folder from deployed_workflows table
      const { data: workflowInfo } = await supabase
        .from('deployed_workflows')
        .select('github_folder')
        .eq('id', workflowId)
        .single();

      // Use the workflow from the execution's automation_sequence instead
      workflowVersionData = {
        workflow: execution.automation_sequence,
        github_folder: workflowInfo?.github_folder || null
      };
    }

    // Get the workflow structure (from JSONB column or automation_sequence)
    const workflow = workflowVersionData.workflow || execution.automation_sequence || null;

    // Load JS files from GitHub
    let jsFiles: Record<string, string> = {};
    let jsFilesError: string | null = null;

    if (workflow?.automation_sequence && workflowVersionData.github_folder) {
      console.log(`[Q&A Context API] Loading JS files from GitHub folder: ${workflowVersionData.github_folder}`);

      const fileNames = new Set<string>();

      // Extract JS file names from automation_sequence
      workflow.automation_sequence.forEach((step: any) => {
        if (step.script_file?.endsWith('.js')) {
          fileNames.add(step.script_file);
        }
      });

      // Also check steps array
      if (workflow.steps) {
        workflow.steps.forEach((step: any) => {
          if (step.script_file?.endsWith('.js')) {
            fileNames.add(step.script_file);
          }
        });
      }

      console.log(`[Q&A Context API] Found ${fileNames.size} JS files referenced in workflow`);

      // Fetch files from GitHub
      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken && fileNames.size > 0) {
        const fetchPromises = Array.from(fileNames).map(async (fileName) => {
          try {
            const url = `https://api.github.com/repos/mediar-ai/workflows/contents/${workflowVersionData.github_folder}/${fileName}`;
            const response = await fetch(url, {
              headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });

            if (response.ok) {
              const data = await response.json();
              const content = Buffer.from(data.content, 'base64').toString('utf-8');
              console.log(`[Q&A Context API] ✓ Loaded ${fileName} from GitHub (${content.length} chars)`);
              return { fileName, content };
            } else {
              console.log(`[Q&A Context API] ✗ Failed to load ${fileName}: ${response.status}`);
              return null;
            }
          } catch (error) {
            console.error(`[Q&A Context API] Error loading ${fileName}:`, error);
            return null;
          }
        });

        const results = await Promise.all(fetchPromises);
        results.forEach(result => {
          if (result) {
            jsFiles[result.fileName] = result.content;
          }
        });

        console.log(`[Q&A Context API] ✓ Loaded ${Object.keys(jsFiles).length}/${fileNames.size} JS files from GitHub`);
      } else if (!githubToken) {
        jsFilesError = 'GitHub token not configured';
      }
    }

    // Load documentation
    const documentationUrl = `https://raw.githubusercontent.com/mediar-ai/terminator/main/TERMINATOR_TOOLS.md`;
    let documentation = '';

    try {
      const docResponse = await fetch(documentationUrl);
      if (docResponse.ok) {
        documentation = await docResponse.text();
        console.log('[Q&A Context API] ✓ Terminator documentation loaded');
      }
    } catch (error) {
      console.log('[Q&A Context API] Failed to load documentation:', error);
    }

    // Return all context data
    return NextResponse.json({
      execution,
      workflow,
      jsFiles,
      jsFilesError,
      documentation,
      metadata: {
        workflowId,
        version,
        jsFileCount: Object.keys(jsFiles).length,
        workflowSteps: workflow?.steps?.length || 0
      }
    });

  } catch (error) {
    console.error('[Q&A Context API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load context' },
      { status: 500 }
    );
  }
}