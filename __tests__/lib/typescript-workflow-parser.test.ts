import { parseTypeScriptWorkflow } from '../../src/lib/typescript-workflow-parser';
import assert from 'assert';

console.log('🧪 Running TypeScript Workflow Parser Tests...');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`❌ ${name}`);
    console.error(`   Error: ${e.message}`);
    failed++;
  }
}

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

console.log(`\nTests completed: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
