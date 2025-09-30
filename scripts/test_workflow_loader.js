#!/usr/bin/env node

/**
 * Test the workflow loader to verify GitHub integration works
 */

import dotenv from 'dotenv';
import { GitHubWorkflowManager } from '../dist/lib/github-workflow-manager.js';

// Load environment
dotenv.config({ path: '.env.local' });

async function testWorkflowLoader() {
  console.log('🧪 Testing Workflow Loader with GitHub Integration\n');

  const manager = new GitHubWorkflowManager();

  // Test 1: List workflows
  console.log('1. Listing workflows in GitHub repository:\n');

  const categories = ['production', 'development'];

  for (const category of categories) {
    console.log(`📁 ${category}/`);
    try {
      const workflows = await manager.listWorkflows(category);
      if (workflows.length > 0) {
        workflows.forEach(w => {
          console.log(`   - ${w.name}/`);
        });
      } else {
        console.log(`   (empty)`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  // Test 2: Load a specific workflow
  console.log('\n2. Loading a specific workflow:\n');

  const testPath = 'production/bestplanpro/workflow.yaml';
  console.log(`Loading: ${testPath}`);

  try {
    const workflow = await manager.getWorkflow(testPath);

    if (workflow) {
      console.log(`✅ Successfully loaded workflow`);
      console.log(`   Path: ${workflow.metadata.path}`);
      console.log(`   SHA: ${workflow.metadata.sha}`);
      console.log(`   Size: ${workflow.yaml.length} bytes`);

      // Show first few lines
      const lines = workflow.yaml.split('\n').slice(0, 10);
      console.log(`\n   Preview:`);
      lines.forEach(line => console.log(`   ${line}`));
      if (workflow.yaml.split('\n').length > 10) {
        console.log(`   ... (${workflow.yaml.split('\n').length - 10} more lines)`);
      }
    } else {
      console.log(`❌ Could not load workflow`);
    }
  } catch (error) {
    console.log(`❌ Error loading workflow: ${error.message}`);
  }

  // Test 3: Load workflow with files
  console.log('\n3. Loading workflow with associated files:\n');

  const sapPath = 'production/sap_with_login';
  console.log(`Loading: ${sapPath}`);

  try {
    const result = await manager.getWorkflowWithFiles(sapPath);

    if (result.workflow) {
      console.log(`✅ Loaded workflow with files`);
      console.log(`   Workflow: ${result.workflow.metadata.path}`);

      const fileCount = Object.keys(result.files).length;
      console.log(`   Associated files: ${fileCount}`);

      if (fileCount > 0) {
        console.log(`\n   Files:`);
        Object.keys(result.files).slice(0, 5).forEach(name => {
          const size = result.files[name].length;
          console.log(`   - ${name} (${size} bytes)`);
        });
        if (fileCount > 5) {
          console.log(`   ... and ${fileCount - 5} more files`);
        }
      }
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log('\n✨ Test complete!');
}

// Run the test
testWorkflowLoader().catch(console.error);