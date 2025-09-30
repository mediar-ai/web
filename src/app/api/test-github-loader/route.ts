import { NextRequest, NextResponse } from 'next/server';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';

export async function GET(request: NextRequest) {
  try {
    console.log('Testing GitHub workflow loader...');

    // Test 1: List workflows
    const workflows = await githubWorkflowManager.listWorkflows('production');

    // Test 2: Load a specific workflow
    let bestplanpro = null;
    try {
      bestplanpro = await githubWorkflowManager.getWorkflow('production/bestplanpro/workflow.yaml');
    } catch (error) {
      console.error('Error loading BestPlanPro:', error);
    }

    // Test 3: Load workflow with files
    let sapWorkflow = null;
    try {
      const result = await githubWorkflowManager.getWorkflowWithFiles('production/sap_with_login');
      sapWorkflow = {
        hasWorkflow: !!result.workflow,
        fileCount: Object.keys(result.files).length,
        files: Object.keys(result.files).slice(0, 5)
      };
    } catch (error) {
      console.error('Error loading SAP workflow:', error);
    }

    return NextResponse.json({
      success: true,
      githubIntegration: {
        connected: workflows.length > 0 || !!bestplanpro,
        productionWorkflows: workflows.map(w => w.name),
        bestplanpro: bestplanpro ? {
          loaded: true,
          size: bestplanpro.yaml.length,
          sha: bestplanpro.metadata.sha
        } : { loaded: false },
        sapWorkflow: sapWorkflow || { loaded: false }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error testing GitHub loader:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      githubIntegration: {
        connected: false,
        message: 'GitHub integration not configured. Set GITHUB_WORKFLOW_TOKEN in environment.'
      }
    }, { status: 500 });
  }
}