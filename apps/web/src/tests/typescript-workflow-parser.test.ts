/**
 * TypeScript Workflow Parser Tests
 *
 * Tests for the TypeScript workflow parser that extracts metadata from workflow files.
 */

import { parseTypeScriptWorkflow } from '../lib/typescript-workflow-parser';
import { TestLogger } from './utils';

export class TypeScriptWorkflowParserTests {
  async runAllTests(): Promise<boolean> {
    const tests = [
      this.testImportedStepFunctions,
      this.testCreateStepVariableReference,
      this.testMultipleCreateStepVariables,
      this.testInlineCreateStepCall,
      this.testMixedStepTypes,
      this.testWorkflowNameAndVersion,
      this.testZodInputSchema,
      this.testNestedZodSchema,
      this.testOnErrorHandler,
      this.testEmptyWorkflow,
      this.testStepNextChaining,
      this.testStepDescription,
      this.testArrayStyleStepsWithCreateStep,
    ];

    let allPassed = true;
    for (const test of tests) {
      try {
        const result = await test.call(this);
        if (!result) {
          allPassed = false;
          TestLogger.error(`❌ ${test.name} failed`);
        } else {
          TestLogger.success(`✓ ${test.name}`);
        }
      } catch (error) {
        allPassed = false;
        TestLogger.error(`❌ ${test.name} threw error: ${error}`);
      }
    }
    return allPassed;
  }

  /**
   * Test parsing workflow with imported step functions
   */
  async testImportedStepFunctions(): Promise<boolean> {
    const workflow = `
import { createWorkflow, z } from "@mediar-ai/workflow";
import { signOutOneDrive } from "./steps/00-sign-out";
import { launchOneDrive } from "./steps/01-launch-onedrive";
import { detectLoginScreen } from "./steps/02-detect-login-screen";

export default createWorkflow({
  name: "OneDrive Auth",
  version: "1.0.0",
})
  .step(signOutOneDrive)
  .step(launchOneDrive)
  .step(detectLoginScreen)
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 3) {
      TestLogger.error(`Expected 3 steps, got ${result.steps.length}`);
      return false;
    }

    if (result.steps[0].id !== 'signOutOneDrive') {
      TestLogger.error(
        `Expected step[0].id to be 'signOutOneDrive', got '${result.steps[0].id}'`
      );
      return false;
    }

    if (result.steps[1].id !== 'launchOneDrive') {
      TestLogger.error(
        `Expected step[1].id to be 'launchOneDrive', got '${result.steps[1].id}'`
      );
      return false;
    }

    if (result.steps[2].id !== 'detectLoginScreen') {
      TestLogger.error(
        `Expected step[2].id to be 'detectLoginScreen', got '${result.steps[2].id}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing workflow with createStep variable reference
   */
  async testCreateStepVariableReference(): Promise<boolean> {
    const workflow = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const scanStep = createStep({
  id: "scan_unprocessed",
  name: "Scan Unprocessed Files",
  description: "Scans folder for unprocessed files",
  execute: async ({ input }) => {},
});

export default createWorkflow({
  name: "Scan Workflow",
})
  .step(scanStep)
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 1) {
      TestLogger.error(`Expected 1 step, got ${result.steps.length}`);
      return false;
    }

    if (result.steps[0].id !== 'scan_unprocessed') {
      TestLogger.error(
        `Expected step[0].id to be 'scan_unprocessed', got '${result.steps[0].id}'`
      );
      return false;
    }

    if (result.steps[0].name !== 'Scan Unprocessed Files') {
      TestLogger.error(
        `Expected step[0].name to be 'Scan Unprocessed Files', got '${result.steps[0].name}'`
      );
      return false;
    }

    if (result.steps[0].description !== 'Scans folder for unprocessed files') {
      TestLogger.error(
        `Expected step[0].description, got '${result.steps[0].description}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing workflow with multiple createStep variables
   */
  async testMultipleCreateStepVariables(): Promise<boolean> {
    const workflow = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const step1 = createStep({
  id: "step_one",
  name: "First Step",
  execute: async () => {},
});

const step2 = createStep({
  id: "step_two",
  name: "Second Step",
  description: "Does the second thing",
  execute: async () => {},
});

const step3 = createStep({
  id: "step_three",
  name: "Third Step",
  execute: async () => {},
});

export default createWorkflow({
  name: "Multi Step Workflow",
})
  .step(step1)
  .step(step2)
  .step(step3)
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 3) {
      TestLogger.error(`Expected 3 steps, got ${result.steps.length}`);
      return false;
    }

    if (result.steps[0].id !== 'step_one') {
      TestLogger.error(
        `Expected step[0].id to be 'step_one', got '${result.steps[0].id}'`
      );
      return false;
    }

    if (result.steps[1].id !== 'step_two') {
      TestLogger.error(
        `Expected step[1].id to be 'step_two', got '${result.steps[1].id}'`
      );
      return false;
    }

    if (result.steps[1].description !== 'Does the second thing') {
      TestLogger.error(
        `Expected step[1].description, got '${result.steps[1].description}'`
      );
      return false;
    }

    if (result.steps[2].id !== 'step_three') {
      TestLogger.error(
        `Expected step[2].id to be 'step_three', got '${result.steps[2].id}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing workflow with inline createStep call
   */
  async testInlineCreateStepCall(): Promise<boolean> {
    const workflow = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

export default createWorkflow({
  name: "Inline Step Workflow",
})
  .step(createStep({
    id: "inline_step",
    name: "Inline Step",
    execute: async () => {},
  }))
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 1) {
      TestLogger.error(`Expected 1 step, got ${result.steps.length}`);
      return false;
    }

    if (result.steps[0].id !== 'inline_step') {
      TestLogger.error(
        `Expected step[0].id to be 'inline_step', got '${result.steps[0].id}'`
      );
      return false;
    }

    if (result.steps[0].name !== 'Inline Step') {
      TestLogger.error(
        `Expected step[0].name to be 'Inline Step', got '${result.steps[0].name}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing workflow with mixed step types (imported + createStep)
   */
  async testMixedStepTypes(): Promise<boolean> {
    const workflow = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";
import { importedStep } from "./steps/imported";

const localStep = createStep({
  id: "local_step",
  name: "Local Step",
  execute: async () => {},
});

export default createWorkflow({
  name: "Mixed Workflow",
})
  .step(importedStep)
  .step(localStep)
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 2) {
      TestLogger.error(`Expected 2 steps, got ${result.steps.length}`);
      return false;
    }

    // First step is imported (no createStep definition found)
    if (result.steps[0].id !== 'importedStep') {
      TestLogger.error(
        `Expected step[0].id to be 'importedStep', got '${result.steps[0].id}'`
      );
      return false;
    }

    // Second step is from createStep
    if (result.steps[1].id !== 'local_step') {
      TestLogger.error(
        `Expected step[1].id to be 'local_step', got '${result.steps[1].id}'`
      );
      return false;
    }

    if (result.steps[1].name !== 'Local Step') {
      TestLogger.error(
        `Expected step[1].name to be 'Local Step', got '${result.steps[1].name}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing workflow name and version
   */
  async testWorkflowNameAndVersion(): Promise<boolean> {
    const workflow = `
import { createWorkflow } from "@mediar-ai/workflow";

export default createWorkflow({
  name: "My Test Workflow",
  version: "2.5.0",
})
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.name !== 'My Test Workflow') {
      TestLogger.error(
        `Expected name to be 'My Test Workflow', got '${result.name}'`
      );
      return false;
    }

    if (result.version !== '2.5.0') {
      TestLogger.error(
        `Expected version to be '2.5.0', got '${result.version}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing Zod input schema
   */
  async testZodInputSchema(): Promise<boolean> {
    const workflow = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  email: z.string().email().describe("User email address"),
  password: z.string().describe("User password"),
  rememberMe: z.boolean().optional().default(false),
});

export default createWorkflow({
  name: "Login Workflow",
  input: inputSchema,
})
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.inputs.length !== 3) {
      TestLogger.error(`Expected 3 inputs, got ${result.inputs.length}`);
      return false;
    }

    const emailInput = result.inputs.find(i => i.name === 'email');
    if (!emailInput) {
      TestLogger.error(`Expected to find 'email' input`);
      return false;
    }
    if (emailInput.type !== 'string') {
      TestLogger.error(
        `Expected email type to be 'string', got '${emailInput.type}'`
      );
      return false;
    }
    if (emailInput.description !== 'User email address') {
      TestLogger.error(
        `Expected email description, got '${emailInput.description}'`
      );
      return false;
    }

    const rememberMeInput = result.inputs.find(i => i.name === 'rememberMe');
    if (!rememberMeInput) {
      TestLogger.error(`Expected to find 'rememberMe' input`);
      return false;
    }
    if (rememberMeInput.required !== false) {
      TestLogger.error(`Expected rememberMe to be optional`);
      return false;
    }

    return true;
  }

  /**
   * Test parsing nested Zod schema
   */
  async testNestedZodSchema(): Promise<boolean> {
    const workflow = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  user: z.object({
    name: z.string(),
    age: z.number(),
  }),
});

export default createWorkflow({
  name: "Nested Schema Workflow",
  input: inputSchema,
})
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.inputs.length !== 1) {
      TestLogger.error(`Expected 1 input, got ${result.inputs.length}`);
      return false;
    }

    const userInput = result.inputs[0];
    if (userInput.name !== 'user') {
      TestLogger.error(
        `Expected input name to be 'user', got '${userInput.name}'`
      );
      return false;
    }
    if (userInput.type !== 'object') {
      TestLogger.error(
        `Expected user type to be 'object', got '${userInput.type}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing onError handler
   */
  async testOnErrorHandler(): Promise<boolean> {
    const workflow = `
import { createWorkflow } from "@mediar-ai/workflow";

export default createWorkflow({
  name: "Error Handler Workflow",
})
  .onError(async ({ error, logger }) => {
    logger.error("Workflow failed:", error);
  })
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (!result.errorHandler) {
      TestLogger.error(`Expected errorHandler to be defined`);
      return false;
    }

    if (result.errorHandler.type !== 'global') {
      TestLogger.error(
        `Expected errorHandler.type to be 'global', got '${result.errorHandler.type}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test parsing empty workflow
   */
  async testEmptyWorkflow(): Promise<boolean> {
    const workflow = `
import { createWorkflow } from "@mediar-ai/workflow";

export default createWorkflow({
  name: "Empty Workflow",
})
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.name !== 'Empty Workflow') {
      TestLogger.error(
        `Expected name to be 'Empty Workflow', got '${result.name}'`
      );
      return false;
    }

    if (result.steps.length !== 0) {
      TestLogger.error(`Expected 0 steps, got ${result.steps.length}`);
      return false;
    }

    return true;
  }

  /**
   * Test step next chaining is correct
   */
  async testStepNextChaining(): Promise<boolean> {
    const workflow = `
import { createWorkflow, createStep } from "@mediar-ai/workflow";

const step1 = createStep({ id: "s1", name: "Step 1", execute: async () => {} });
const step2 = createStep({ id: "s2", name: "Step 2", execute: async () => {} });
const step3 = createStep({ id: "s3", name: "Step 3", execute: async () => {} });

export default createWorkflow({ name: "Chain Test" })
  .step(step1)
  .step(step2)
  .step(step3)
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 3) {
      TestLogger.error(`Expected 3 steps, got ${result.steps.length}`);
      return false;
    }

    // First step should point to second
    if (!result.steps[0].next || result.steps[0].next[0] !== 's2') {
      TestLogger.error(
        `Expected step[0].next to be ['s2'], got ${JSON.stringify(result.steps[0].next)}`
      );
      return false;
    }

    // Second step should point to third
    if (!result.steps[1].next || result.steps[1].next[0] !== 's3') {
      TestLogger.error(
        `Expected step[1].next to be ['s3'], got ${JSON.stringify(result.steps[1].next)}`
      );
      return false;
    }

    // Last step should have no next
    if (result.steps[2].next !== undefined) {
      TestLogger.error(
        `Expected step[2].next to be undefined, got ${JSON.stringify(result.steps[2].next)}`
      );
      return false;
    }

    return true;
  }

  /**
   * Test step description is captured
   */
  async testStepDescription(): Promise<boolean> {
    const workflow = `
import { createWorkflow, createStep } from "@mediar-ai/workflow";

const myStep = createStep({
  id: "my_step",
  name: "My Step",
  description: "This step does something important",
  execute: async () => {},
});

export default createWorkflow({ name: "Description Test" })
  .step(myStep)
  .build();
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 1) {
      TestLogger.error(`Expected 1 step, got ${result.steps.length}`);
      return false;
    }

    if (result.steps[0].description !== 'This step does something important') {
      TestLogger.error(
        `Expected description, got '${result.steps[0].description}'`
      );
      return false;
    }

    return true;
  }

  /**
   * Test array-style steps: [step1, step2] with createStep variables
   * This is the pattern used by the paint workflow:
   *   createWorkflow({ steps: [cleanup, openPaint, drawMediarText] })
   */
  async testArrayStyleStepsWithCreateStep(): Promise<boolean> {
    const workflow = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const inputSchema = z.object({});

const cleanup = createStep({
  id: "cleanup",
  name: "Close Paint and Notepad",
  description: "Close any existing instances",
  execute: async ({ desktop, logger }) => {},
});

const openPaint = createStep({
  id: "open_paint",
  name: "Open MS Paint",
  description: "Opens Microsoft Paint",
  execute: async ({ desktop, logger }) => {},
});

const drawMediarText = createStep({
  id: "draw_mediar_text",
  name: "Draw MEDIAR.AI",
  description: "Draw the text using mouse strokes",
  execute: async ({ desktop, logger }) => {},
});

const msPaintMediarWorkflow = createWorkflow({
  input: inputSchema,
  steps: [cleanup, openPaint, drawMediarText],
  onError: async ({ error, logger }) => {},
});

export default msPaintMediarWorkflow;
`;

    const result = parseTypeScriptWorkflow(workflow);

    if (result.steps.length !== 3) {
      TestLogger.error(`Expected 3 steps, got ${result.steps.length}`);
      return false;
    }

    // Check that step IDs are resolved from createStep, not variable names
    if (result.steps[0].id !== 'cleanup') {
      TestLogger.error(
        `Expected step[0].id to be 'cleanup', got '${result.steps[0].id}'`
      );
      return false;
    }

    if (result.steps[1].id !== 'open_paint') {
      TestLogger.error(
        `Expected step[1].id to be 'open_paint', got '${result.steps[1].id}'`
      );
      return false;
    }

    if (result.steps[2].id !== 'draw_mediar_text') {
      TestLogger.error(
        `Expected step[2].id to be 'draw_mediar_text', got '${result.steps[2].id}'`
      );
      return false;
    }

    // Check names are resolved
    if (result.steps[1].name !== 'Open MS Paint') {
      TestLogger.error(
        `Expected step[1].name to be 'Open MS Paint', got '${result.steps[1].name}'`
      );
      return false;
    }

    // Check descriptions are resolved
    if (result.steps[1].description !== 'Opens Microsoft Paint') {
      TestLogger.error(
        `Expected step[1].description to be 'Opens Microsoft Paint', got '${result.steps[1].description}'`
      );
      return false;
    }

    // Check next chaining uses resolved IDs
    if (!result.steps[0].next || result.steps[0].next[0] !== 'open_paint') {
      TestLogger.error(
        `Expected step[0].next to be ['open_paint'], got ${JSON.stringify(result.steps[0].next)}`
      );
      return false;
    }

    if (
      !result.steps[1].next ||
      result.steps[1].next[0] !== 'draw_mediar_text'
    ) {
      TestLogger.error(
        `Expected step[1].next to be ['draw_mediar_text'], got ${JSON.stringify(result.steps[1].next)}`
      );
      return false;
    }

    return true;
  }
}

// Allow running directly
if (require.main === module) {
  const tests = new TypeScriptWorkflowParserTests();
  tests.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  });
}
