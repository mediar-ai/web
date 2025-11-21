import { parseTypeScriptWorkflow } from '../../src/lib/typescript-workflow-parser';
import assert from 'assert';

test('should parse simple single-line inputs', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";
    const InputSchema = z.object({
      name: z.string(),
      age: z.number()
    });
    export const workflow = createWorkflow({
      name: "Test",
      version: "1.0",
      input: InputSchema,
      steps: []
    });
  `;

  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 2);
  assert.strictEqual(metadata.inputs[0].name, 'name');
  assert.strictEqual(metadata.inputs[0].type, 'string');
  assert.strictEqual(metadata.inputs[1].name, 'age');
  assert.strictEqual(metadata.inputs[1].type, 'number');
});

test('should parse multi-line inputs (the bug)', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";
    const InputSchema = z.object({
      targetFile: z
        .string()
        .optional()
        .describe("Description"),

      environment: z
        .enum(["TEST", "LIVE"])
        .default("TEST")
    });
    export const workflow = createWorkflow({
      name: "Test",
      version: "1.0",
      input: InputSchema,
      steps: []
    });
  `;

  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 2, 'Should have 2 inputs');

  const targetFile = metadata.inputs.find(i => i.name === 'targetFile');
  assert.ok(targetFile, 'targetFile should exist');
  assert.strictEqual(
    targetFile?.type,
    'string',
    `Expected type 'string', got '${targetFile?.type}'`
  );
  assert.strictEqual(targetFile?.required, false, 'Should not be required');
  assert.strictEqual(targetFile?.description, 'Description');

  const environment = metadata.inputs.find(i => i.name === 'environment');
  assert.ok(environment, 'environment should exist');
  assert.ok(
    environment?.type.includes('enum'),
    `Expected enum type, got '${environment?.type}'`
  );
  assert.strictEqual(environment?.defaultValue, 'TEST');
});

test('should parse complex chained inputs', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";
    const InputSchema = z.object({
      tags: z.array(z.string()).default([]),
      isActive: z.boolean().default(true),
      config: z.object({ key: z.string() }).optional()
    });
    export const workflow = createWorkflow({
      name: "Test",
      version: "1.0",
      input: InputSchema,
      steps: []
    });
  `;

  const metadata = parseTypeScriptWorkflow(source);

  const tags = metadata.inputs.find(i => i.name === 'tags');
  assert.strictEqual(tags?.type, 'array');

  const isActive = metadata.inputs.find(i => i.name === 'isActive');
  assert.strictEqual(isActive?.type, 'boolean');
  assert.strictEqual(isActive?.defaultValue, true);
});

test('should parse chained .step() calls (OneDrive workflow pattern)', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";

    const inputSchema = z.object({
      email: z.string().email().describe("Microsoft account email"),
      password: z.string().describe("Microsoft account password"),
      otp: z.string().optional().describe("2FA/OTP code (if required)"),
    });

    export default createWorkflow({
      name: "OneDrive Authentication Workflow",
      version: "1.0.7",
      input: inputSchema,
    })
      .step(signOutOneDrive)
      .step(launchOneDrive)
      .step(detectLoginScreen)
      .step(enterEmail)
      .step(enterPassword)
      .step(handle2FA)
      .step(completeSetup)
      .onSuccess(({ input, context }) => ({ success: true }))
      .onError(async ({ error, context, step, logger }) => {
        logger.error("Workflow failed");
      })
      .build();
  `;

  const metadata = parseTypeScriptWorkflow(source);

  // Check workflow metadata
  assert.strictEqual(metadata.name, 'OneDrive Authentication Workflow');
  assert.strictEqual(metadata.version, '1.0.7');

  // Check inputs
  assert.strictEqual(metadata.inputs.length, 3);
  const emailInput = metadata.inputs.find(i => i.name === 'email');
  assert.ok(emailInput, 'email input should exist');
  assert.strictEqual(emailInput?.type, 'string');
  assert.strictEqual(emailInput?.description, 'Microsoft account email');

  // Check steps are parsed from chained .step() calls
  assert.strictEqual(metadata.steps.length, 7, 'Should have 7 steps from chained calls');
  assert.strictEqual(metadata.steps[0].id, 'signOutOneDrive');
  assert.strictEqual(metadata.steps[1].id, 'launchOneDrive');
  assert.strictEqual(metadata.steps[2].id, 'detectLoginScreen');
  assert.strictEqual(metadata.steps[3].id, 'enterEmail');
  assert.strictEqual(metadata.steps[4].id, 'enterPassword');
  assert.strictEqual(metadata.steps[5].id, 'handle2FA');
  assert.strictEqual(metadata.steps[6].id, 'completeSetup');

  // Check step names are properly formatted
  assert.strictEqual(metadata.steps[0].name, 'Sign Out One Drive');
  assert.strictEqual(metadata.steps[1].name, 'Launch One Drive');

  // Check steps are linked
  assert.deepStrictEqual(metadata.steps[0].next, ['launchOneDrive']);
  assert.deepStrictEqual(metadata.steps[1].next, ['detectLoginScreen']);
  assert.strictEqual(metadata.steps[6].next, undefined); // Last step has no next

  // Check error handler is detected
  assert.ok(metadata.errorHandler, 'Should have global error handler');
  assert.strictEqual(metadata.errorHandler?.type, 'global');
});
