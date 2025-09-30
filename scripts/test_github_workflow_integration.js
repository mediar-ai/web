#!/usr/bin/env node

/**
 * Test script for GitHub workflow integration
 * Tests the workflow loader with GitHub fallback
 */

const { githubWorkflowManager } = require('../dist/lib/github-workflow-manager');
const { workflowLoader } = require('../dist/lib/workflow-loader');

async function testGitHubIntegration() {
  console.log('🧪 Testing GitHub Workflow Integration\n');

  // Test 1: List workflows in GitHub repo
  console.log('1. Testing GitHub repository access...');
  try {
    const workflows = await githubWorkflowManager.listWorkflows('production');
    console.log(`   ✅ Found ${workflows.length} workflows in production/`);
    workflows.forEach(w => console.log(`      - ${w.name}`));
  } catch (error) {
    console.log(`   ⚠️ GitHub access not configured: ${error.message}`);
    console.log('   Set GITHUB_WORKFLOW_TOKEN in .env to enable GitHub storage\n');
  }

  // Test 2: Load a workflow (will use Supabase fallback if GitHub not available)
  console.log('\n2. Testing workflow loading with fallback...');
  const testWorkflowId = 1; // BestPlanPro workflow

  try {
    const workflow = await workflowLoader.loadWorkflow(testWorkflowId);

    if (workflow) {
      console.log(`   ✅ Loaded workflow ${workflow.id}: ${workflow.name}`);
      console.log(`      Source: ${workflow.metadata.source}`);

      if (workflow.metadata.github_path) {
        console.log(`      GitHub Path: ${workflow.metadata.github_path}`);
        console.log(`      GitHub SHA: ${workflow.metadata.github_sha}`);
      }

      console.log(`      Has automation_sequence: ${!!workflow.automation_sequence}`);
    } else {
      console.log(`   ❌ Could not load workflow ${testWorkflowId}`);
    }
  } catch (error) {
    console.log(`   ❌ Error loading workflow: ${error.message}`);
  }

  // Test 3: Check sync status
  console.log('\n3. Testing sync status check...');
  try {
    const syncStatus = await workflowLoader.checkSyncStatus(testWorkflowId);
    console.log(`   Needs sync: ${syncStatus.needsSync}`);

    if (syncStatus.localSha) {
      console.log(`   Local SHA: ${syncStatus.localSha}`);
    }
    if (syncStatus.remoteSha) {
      console.log(`   Remote SHA: ${syncStatus.remoteSha}`);
    }
  } catch (error) {
    console.log(`   ⚠️ Could not check sync status: ${error.message}`);
  }

  console.log('\n✨ Integration test complete!');
}

// Run the test
testGitHubIntegration().catch(console.error);