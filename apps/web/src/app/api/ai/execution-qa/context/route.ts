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

    // Get github_folder from deployed_workflows table (it's not in deployed_workflow_versions)
    const { data: workflowInfo } = await supabase
      .from('deployed_workflows')
      .select('github_folder')
      .eq('id', workflowId)
      .single();

    const githubFolder = workflowInfo?.github_folder || null;

    if (versionError || !workflowVersionData) {
      console.log(`[Q&A Context API] Workflow version ${version} not found, will use workflow from execution`);

      // Use the workflow from the execution instead (though unlikely to exist)
      workflowVersionData = {
        automation_sequence: execution.automation_sequence || null
      };
    }

    // Get the workflow structure - use automation_sequence (the actual column name in DB)
    const workflow = workflowVersionData.automation_sequence || null;

    // Load JS files from GitHub
    const jsFiles: Record<string, string> = {};
    let jsFilesError: string | null = null;

    if (workflow && githubFolder) {
      console.log(`[Q&A Context API] Loading JS files from GitHub folder: ${githubFolder}`);

      const fileNames = new Set<string>();

      // Helper function to extract script_file from a step
      const extractScriptFile = (step: any) => {
        // Check step.script_file (old format)
        if (step.script_file?.endsWith('.js')) {
          fileNames.add(step.script_file);
        }
        // Check step.arguments.script_file (new format)
        if (step.arguments?.script_file?.endsWith('.js')) {
          fileNames.add(step.arguments.script_file);
        }
      };

      // Extract JS file names from different workflow structures
      if (Array.isArray(workflow)) {
        // workflow is directly an array of steps
        workflow.forEach(extractScriptFile);
      } else if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence)) {
        // workflow has automation_sequence array
        workflow.automation_sequence.forEach(extractScriptFile);
      } else if (workflow.steps && Array.isArray(workflow.steps)) {
        // workflow has steps array
        workflow.steps.forEach(extractScriptFile);
      }

      console.log(`[Q&A Context API] Found ${fileNames.size} JS files referenced in workflow`);

      // Fetch files from GitHub
      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken && fileNames.size > 0) {
        const fetchPromises = Array.from(fileNames).map(async (fileName) => {
          try {
            const url = `https://api.github.com/repos/mediar-ai/workflows/contents/${githubFolder}/${fileName}`;
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
    const workflowStepCount = Array.isArray(workflow)
      ? workflow.length
      : (workflow?.steps?.length || workflow?.automation_sequence?.length || 0);

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
        workflowSteps: workflowStepCount
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