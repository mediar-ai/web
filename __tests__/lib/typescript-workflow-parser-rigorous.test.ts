import { parseTypeScriptWorkflow } from '../../src/lib/typescript-workflow-parser';
import assert from 'assert';

test('should parse empty input schema', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";
    export const workflow = createWorkflow({
      name: "Empty",
      version: "1.0",
      input: z.object({}),
      steps: []
    });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 0);
});

test('should handle comments and weird formatting', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";
    const Input = z.object({
      // This is a comment
      field1: z.string(), /* inline comment */

      field2: z
        .number()
        // another comment
        .min(10)
    });

    export const workflow = createWorkflow({
      name: "Formatted",
      version: "1.0",
      input: Input,
      steps: []
    });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 2);
  assert.strictEqual(metadata.inputs[0].name, 'field1');
  assert.strictEqual(metadata.inputs[0].type, 'string');
  assert.strictEqual(metadata.inputs[1].name, 'field2');
  assert.strictEqual(metadata.inputs[1].type, 'number');
});

test('should parse nested objects', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";
    const Input = z.object({
      user: z.object({
        firstName: z.string(),
        address: z.object({
          street: z.string(),
          zip: z.number()
        })
      })
    });
    export const workflow = createWorkflow({
      name: "Nested",
      version: "1.0",
      input: Input,
      steps: []
    });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 1);

  const user = metadata.inputs[0];
  assert.strictEqual(user.name, 'user');
  assert.strictEqual(user.type, 'object');
  assert.ok(user.nested, 'Should have nested properties');
  assert.strictEqual(user.nested?.length, 2);

  const address = user.nested?.find(i => i.name === 'address');
  assert.ok(address, 'Address should exist');
  assert.strictEqual(address?.type, 'object');
  assert.strictEqual(address?.nested?.length, 2);
  assert.strictEqual(
    address?.nested?.find(i => i.name === 'zip')?.type,
    'number'
  );
});

test('should parse arrays of primitives and objects', () => {
  const source = `
    import { createWorkflow, z } from "@mediar-ai/workflow";
    export const workflow = createWorkflow({
      name: "Arrays",
      input: z.object({
        tags: z.array(z.string()),
        items: z.array(z.object({
          id: z.number(),
          label: z.string()
        }))
      }),
      steps: []
    });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 2);

  const tags = metadata.inputs.find(i => i.name === 'tags');
  assert.strictEqual(tags?.type, 'array');

  const items = metadata.inputs.find(i => i.name === 'items');
  assert.strictEqual(items?.type, 'array');
  // Note: The current parser implementation extracts the base type "array"
  // It doesn't currently recursively parse the generic type inside z.array() into 'nested'
  // unless the logic was specifically added to handle z.array(z.object(...)).
  // The current implementation sets 'type' to 'array' and stops there for the structure unless extended.
  // Let's verify what it does - based on code reading, it only sets 'nested' for 'object' type.
});

test('should handle long chains of Zod modifiers', () => {
  const source = `
    const Schema = z.object({
      email: z.string()
        .email()
        .min(5)
        .max(100)
        .trim()
        .toLowerCase()
        .optional()
        .describe("User Email")
        .default("test@example.com")
    });
    export const workflow = createWorkflow({ input: Schema });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  const email = metadata.inputs[0];

  assert.strictEqual(email.name, 'email');
  assert.strictEqual(email.type, 'string');
  assert.strictEqual(email.required, false);
  assert.strictEqual(email.description, 'User Email');
  assert.strictEqual(email.defaultValue, 'test@example.com');
});

test('should handle "as" expressions (Type Assertions)', () => {
  const source = `
    const Input = z.object({
      forced: z.string()
    }) as any;

    export const workflow = createWorkflow({
      name: "Casted",
      input: Input,
      steps: []
    });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 1);
  assert.strictEqual(metadata.inputs[0].name, 'forced');
});

test('should handle "as" expressions on individual fields', () => {
  const source = `
    const Input = z.object({
      field: z.string().optional() as any
    });
    export const workflow = createWorkflow({ input: Input });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 1);
  assert.strictEqual(metadata.inputs[0].name, 'field');
  assert.strictEqual(metadata.inputs[0].type, 'string');
});

test('should parse enums correctly', () => {
  const source = `
    const Input = z.object({
      status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]).default("PENDING")
    });
    export const workflow = createWorkflow({ input: Input });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  const status = metadata.inputs[0];

  assert.strictEqual(status.name, 'status');
  assert.strictEqual(status.type, 'enum');
  assert.strictEqual(status.defaultValue, 'PENDING');
  assert.ok(Array.isArray(status.enumOptions));
  assert.deepStrictEqual(status.enumOptions, ['ACTIVE', 'INACTIVE', 'PENDING']);
});

test('should handle missing optional metadata fields', () => {
  const source = `
    export const workflow = createWorkflow({
      input: z.object({ foo: z.string() }),
      steps: []
    });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 1);
  assert.strictEqual(metadata.name, 'Unknown Workflow');
  assert.strictEqual(metadata.version, '1.0.0');
  assert.strictEqual(metadata.description, undefined);
});

test('should handle variable references defined far away', () => {
  const source = `
    import { z } from "zod";

    // ... some other code ...

    const UserSchema = z.object({
      id: z.number()
    });

    // ... more code ...

    export const workflow = createWorkflow({
      name: "RefTest",
      input: UserSchema
    });
  `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 1);
  assert.strictEqual(metadata.inputs[0].name, 'id');
});

test('should handle mixed types that are not standard primitives', () => {
  // For now, mappedType defaults to 'unknown' if not in the list
  const source = `
      const Input = z.object({
        anyField: z.any(),
        unknownField: z.unknown(),
        dateField: z.date(),
        custom: z.custom<MyType>()
      });
      export const workflow = createWorkflow({ input: Input });
    `;
  const metadata = parseTypeScriptWorkflow(source);
  assert.strictEqual(metadata.inputs.length, 4);
  // All should be unknown based on current mapZodTypeToType implementation
  assert.strictEqual(metadata.inputs[0].type, 'unknown');
});
