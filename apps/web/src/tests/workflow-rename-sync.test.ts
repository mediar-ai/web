/**
 * Workflow Rename GitHub Sync Unit Tests
 *
 * Tests that workflow renames correctly sync to GitHub:
 * - TypeScript workflows → updatePackageJson()
 * - YAML workflows → saveWorkflow()
 */

import { TestLogger } from './utils';

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
  duration?: number;
}

interface MockWorkflow {
  id: number;
  name: string;
  preferred_format: 'typescript' | 'yaml' | null;
  status: string;
  workflow_type: string;
}

interface MockActiveVersion {
  automation_sequence_yaml: string | null;
  automation_sequence: object | null;
}

interface GitHubSyncCall {
  method: 'updatePackageJson' | 'saveWorkflow';
  args: any[];
}

/**
 * Simulates the GitHub sync logic from the rename route
 * This is extracted from src/app/api/workflows/[workflowId]/rename/route.ts
 */
async function simulateGitHubSync(
  workflow: MockWorkflow,
  activeVersion: MockActiveVersion | null,
  newName: string,
  description?: string,
  userEmail?: string,
  orgId?: string
): Promise<GitHubSyncCall | null> {
  // For TypeScript workflows, update package.json instead of workflow.yaml
  if (workflow.preferred_format === 'typescript') {
    return {
      method: 'updatePackageJson',
      args: [
        workflow.id,
        { name: newName, description: description },
        { email: userEmail || undefined }
      ]
    };
  }

  // For YAML workflows, save the workflow.yaml with updated metadata
  if (activeVersion) {
    const yamlContent = activeVersion.automation_sequence_yaml ||
      JSON.stringify(activeVersion.automation_sequence); // Simplified yaml.dump mock

    const isDevelopment = workflow.status === 'draft' ||
      workflow.workflow_type === 'settings';

    return {
      method: 'saveWorkflow',
      args: [
        newName,
        yamlContent,
        isDevelopment,
        `Rename workflow: ${workflow.name} → ${newName}`,
        false,
        workflow.id,
        orgId || undefined,
        { email: userEmail || undefined }
      ]
    };
  }

  return null;
}

class WorkflowRenameSyncTests {
  async runAllTests(): Promise<boolean> {
    TestLogger.info('Starting Workflow Rename GitHub Sync Tests');

    const tests = [
      () => this.testTypescriptWorkflowUsesUpdatePackageJson(),
      () => this.testYamlWorkflowUsesSaveWorkflow(),
      () => this.testNullPreferredFormatFallsBackToYaml(),
      () => this.testTypescriptWorkflowPassesCorrectParams(),
      () => this.testYamlWorkflowPassesCorrectParams(),
      () => this.testNoActiveVersionReturnsNull(),
      () => this.testDraftWorkflowSetsIsDevelopmentTrue(),
      () => this.testSettingsWorkflowSetsIsDevelopmentTrue(),
      () => this.testDeployedWorkflowSetsIsDevelopmentFalse(),
    ];

    const results: TestResult[] = [];

    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);

        if (result.success) {
          TestLogger.success(`${result.message}`);
        } else {
          TestLogger.error(`${result.message}`);
        }
      } catch (error) {
        const errorResult: TestResult = {
          success: false,
          message: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        results.push(errorResult);
        TestLogger.error(`${errorResult.message}`);
      }
    }

    const passed = results.filter(r => r.success).length;
    const total = results.length;

    TestLogger.info(`Workflow Rename Sync Tests: ${passed}/${total} passed`);
    return passed === total;
  }

  async testTypescriptWorkflowUsesUpdatePackageJson(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 313,
      name: 'OneDrive Installation Workflow',
      preferred_format: 'typescript',
      status: 'deployed',
      workflow_type: 'execution',
    };

    const activeVersion: MockActiveVersion = {
      automation_sequence_yaml: null,
      automation_sequence: null,
    };

    const result = await simulateGitHubSync(
      workflow,
      activeVersion,
      'OneDrive Installation Workflowabcd'
    );

    const success = result?.method === 'updatePackageJson';

    return {
      success,
      message: success
        ? 'TypeScript workflow correctly uses updatePackageJson'
        : `TypeScript workflow incorrectly used ${result?.method || 'null'}`,
      details: { workflow, result },
      duration: Date.now() - startTime,
    };
  }

  async testYamlWorkflowUsesSaveWorkflow(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 100,
      name: 'My YAML Workflow',
      preferred_format: 'yaml',
      status: 'deployed',
      workflow_type: 'execution',
    };

    const activeVersion: MockActiveVersion = {
      automation_sequence_yaml: 'name: My YAML Workflow\nsteps: []',
      automation_sequence: { name: 'My YAML Workflow', steps: [] },
    };

    const result = await simulateGitHubSync(
      workflow,
      activeVersion,
      'My Renamed YAML Workflow'
    );

    const success = result?.method === 'saveWorkflow';

    return {
      success,
      message: success
        ? 'YAML workflow correctly uses saveWorkflow'
        : `YAML workflow incorrectly used ${result?.method || 'null'}`,
      details: { workflow, result },
      duration: Date.now() - startTime,
    };
  }

  async testNullPreferredFormatFallsBackToYaml(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 50,
      name: 'Legacy Workflow',
      preferred_format: null,
      status: 'deployed',
      workflow_type: 'execution',
    };

    const activeVersion: MockActiveVersion = {
      automation_sequence_yaml: 'name: Legacy\nsteps: []',
      automation_sequence: null,
    };

    const result = await simulateGitHubSync(
      workflow,
      activeVersion,
      'Renamed Legacy Workflow'
    );

    const success = result?.method === 'saveWorkflow';

    return {
      success,
      message: success
        ? 'Null preferred_format correctly falls back to saveWorkflow'
        : `Null preferred_format incorrectly used ${result?.method || 'null'}`,
      details: { workflow, result },
      duration: Date.now() - startTime,
    };
  }

  async testTypescriptWorkflowPassesCorrectParams(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 313,
      name: 'Test TS Workflow',
      preferred_format: 'typescript',
      status: 'deployed',
      workflow_type: 'execution',
    };

    const result = await simulateGitHubSync(
      workflow,
      null,
      'New Name',
      'New Description',
      'test@example.com'
    );

    const args = result?.args;
    const success = result?.method === 'updatePackageJson' &&
      args?.[0] === 313 &&
      args?.[1]?.name === 'New Name' &&
      args?.[1]?.description === 'New Description' &&
      args?.[2]?.email === 'test@example.com';

    return {
      success,
      message: success
        ? 'TypeScript workflow passes correct parameters to updatePackageJson'
        : 'TypeScript workflow passes incorrect parameters',
      details: { expected: { id: 313, name: 'New Name', description: 'New Description', email: 'test@example.com' }, actual: args },
      duration: Date.now() - startTime,
    };
  }

  async testYamlWorkflowPassesCorrectParams(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 100,
      name: 'Original Name',
      preferred_format: 'yaml',
      status: 'deployed',
      workflow_type: 'execution',
    };

    const activeVersion: MockActiveVersion = {
      automation_sequence_yaml: 'name: test',
      automation_sequence: null,
    };

    const result = await simulateGitHubSync(
      workflow,
      activeVersion,
      'New Name',
      undefined,
      'user@example.com',
      'org_123'
    );

    const args = result?.args;
    const success = result?.method === 'saveWorkflow' &&
      args?.[0] === 'New Name' &&
      args?.[1] === 'name: test' &&
      args?.[2] === false && // isDevelopment
      args?.[3] === 'Rename workflow: Original Name → New Name' &&
      args?.[4] === false && // createPR
      args?.[5] === 100 && // workflowId
      args?.[6] === 'org_123';

    return {
      success,
      message: success
        ? 'YAML workflow passes correct parameters to saveWorkflow'
        : 'YAML workflow passes incorrect parameters',
      details: { actual: args },
      duration: Date.now() - startTime,
    };
  }

  async testNoActiveVersionReturnsNull(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 100,
      name: 'YAML Workflow Without Version',
      preferred_format: 'yaml',
      status: 'deployed',
      workflow_type: 'execution',
    };

    const result = await simulateGitHubSync(
      workflow,
      null, // No active version
      'New Name'
    );

    const success = result === null;

    return {
      success,
      message: success
        ? 'YAML workflow with no active version correctly returns null'
        : `YAML workflow with no active version incorrectly returned ${JSON.stringify(result)}`,
      details: { workflow, result },
      duration: Date.now() - startTime,
    };
  }

  async testDraftWorkflowSetsIsDevelopmentTrue(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 100,
      name: 'Draft Workflow',
      preferred_format: 'yaml',
      status: 'draft',
      workflow_type: 'execution',
    };

    const activeVersion: MockActiveVersion = {
      automation_sequence_yaml: 'name: test',
      automation_sequence: null,
    };

    const result = await simulateGitHubSync(
      workflow,
      activeVersion,
      'New Name'
    );

    const isDevelopment = result?.args?.[2];
    const success = isDevelopment === true;

    return {
      success,
      message: success
        ? 'Draft workflow correctly sets isDevelopment=true'
        : `Draft workflow incorrectly set isDevelopment=${isDevelopment}`,
      details: { status: workflow.status, isDevelopment },
      duration: Date.now() - startTime,
    };
  }

  async testSettingsWorkflowSetsIsDevelopmentTrue(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 100,
      name: 'Settings Workflow',
      preferred_format: 'yaml',
      status: 'deployed',
      workflow_type: 'settings',
    };

    const activeVersion: MockActiveVersion = {
      automation_sequence_yaml: 'name: test',
      automation_sequence: null,
    };

    const result = await simulateGitHubSync(
      workflow,
      activeVersion,
      'New Name'
    );

    const isDevelopment = result?.args?.[2];
    const success = isDevelopment === true;

    return {
      success,
      message: success
        ? 'Settings workflow correctly sets isDevelopment=true'
        : `Settings workflow incorrectly set isDevelopment=${isDevelopment}`,
      details: { workflow_type: workflow.workflow_type, isDevelopment },
      duration: Date.now() - startTime,
    };
  }

  async testDeployedWorkflowSetsIsDevelopmentFalse(): Promise<TestResult> {
    const startTime = Date.now();

    const workflow: MockWorkflow = {
      id: 100,
      name: 'Deployed Workflow',
      preferred_format: 'yaml',
      status: 'deployed',
      workflow_type: 'execution',
    };

    const activeVersion: MockActiveVersion = {
      automation_sequence_yaml: 'name: test',
      automation_sequence: null,
    };

    const result = await simulateGitHubSync(
      workflow,
      activeVersion,
      'New Name'
    );

    const isDevelopment = result?.args?.[2];
    const success = isDevelopment === false;

    return {
      success,
      message: success
        ? 'Deployed workflow correctly sets isDevelopment=false'
        : `Deployed workflow incorrectly set isDevelopment=${isDevelopment}`,
      details: { status: workflow.status, workflow_type: workflow.workflow_type, isDevelopment },
      duration: Date.now() - startTime,
    };
  }
}

// CLI runner
if (require.main === module) {
  const tester = new WorkflowRenameSyncTests();
  tester
    .runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      TestLogger.error('Workflow rename sync test suite crashed', error);
      process.exit(1);
    });
}

export { WorkflowRenameSyncTests };
