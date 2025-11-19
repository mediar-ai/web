import * as ts from 'typescript';

export interface WorkflowInput {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: any;
  description?: string;
  enumOptions?: string[];
  nested?: WorkflowInput[];
}

export interface WorkflowMetadata {
  name?: string;
  version?: string;
  description?: string;
  inputs: WorkflowInput[];
}

export function parseTypeScriptWorkflow(sourceCode: string): WorkflowMetadata {
  const sourceFile = ts.createSourceFile(
    'workflow.ts',
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  const metadata: WorkflowMetadata = {
    inputs: [],
  };

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      // Check for createWorkflow call
      if (ts.isIdentifier(expression) && expression.text === 'createWorkflow') {
        if (
          node.arguments.length > 0 &&
          ts.isObjectLiteralExpression(node.arguments[0])
        ) {
          parseWorkflowObject(node.arguments[0], metadata, sourceFile);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return metadata;
}

function parseWorkflowObject(
  objectLiteral: ts.ObjectLiteralExpression,
  metadata: WorkflowMetadata,
  sourceFile: ts.SourceFile
) {
  objectLiteral.properties.forEach(prop => {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return;

    const name = prop.name.text;

    if (name === 'name' && ts.isStringLiteral(prop.initializer)) {
      metadata.name = prop.initializer.text;
    } else if (name === 'version' && ts.isStringLiteral(prop.initializer)) {
      metadata.version = prop.initializer.text;
    } else if (name === 'description' && ts.isStringLiteral(prop.initializer)) {
      metadata.description = prop.initializer.text;
    } else if (name === 'input') {
      // Could be a variable reference (InputSchema) or inline z.object({})
      if (ts.isIdentifier(prop.initializer)) {
        // It's a reference, we need to find the definition in the file
        const variableName = prop.initializer.text;
        const schemaNode = findVariableDeclaration(sourceFile, variableName);
        if (schemaNode) {
          metadata.inputs = parseZodSchema(schemaNode);
        }
      } else {
        metadata.inputs = parseZodSchema(prop.initializer);
      }
    }
  });
}

function findVariableDeclaration(
  sourceFile: ts.SourceFile,
  variableName: string
): ts.Node | undefined {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function parseZodSchema(node: ts.Node): WorkflowInput[] {
  // Unwrap possible TypeAssertion (e.g. z.object(...) as any)
  if (ts.isAsExpression(node)) {
    return parseZodSchema(node.expression);
  }

  // Expecting z.object({ ... }) or a chain ending in z.object({ ... })
  // We need to find the z.object call in the chain

  let objectLiteral: ts.ObjectLiteralExpression | undefined;

  function findObjectLiteral(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) {
        // Check if this is the .object({}) call
        if (n.expression.name.text === 'object') {
          if (
            n.arguments.length > 0 &&
            ts.isObjectLiteralExpression(n.arguments[0])
          ) {
            objectLiteral = n.arguments[0];
          }
        }
        // Continue traversing down the expression chain
        findObjectLiteral(n.expression.expression);
      }
    }
  }

  findObjectLiteral(node);

  if (objectLiteral) {
    return parseZodObjectProperties(objectLiteral);
  }

  return [];
}

function parseZodObjectProperties(
  objectLiteral: ts.ObjectLiteralExpression
): WorkflowInput[] {
  const inputs: WorkflowInput[] = [];

  objectLiteral.properties.forEach(prop => {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return;

    const fieldName = prop.name.text;
    const fieldDef = parseZodField(prop.initializer);

    inputs.push({
      name: fieldName,
      ...fieldDef,
    });
  });

  return inputs;
}

function parseZodField(node: ts.Node): Omit<WorkflowInput, 'name'> {
  let type = 'unknown';
  let required = true;
  let description: string | undefined;
  let defaultValue: any;
  let enumOptions: string[] | undefined;
  let nested: WorkflowInput[] | undefined;

  function analyze(n: ts.Node) {
    // Unwrap AsExpression
    if (ts.isAsExpression(n)) {
      analyze(n.expression);
      return;
    }

    if (ts.isCallExpression(n)) {
      const expr = n.expression;

      if (ts.isPropertyAccessExpression(expr)) {
        const method = expr.name.text;

        // Modifiers
        if (method === 'optional') {
          required = false;
        } else if (method === 'default') {
          if (n.arguments.length > 0) {
            defaultValue = extractValue(n.arguments[0]);
          }
        } else if (method === 'describe') {
          if (n.arguments.length > 0 && ts.isStringLiteral(n.arguments[0])) {
            description = n.arguments[0].text;
          }
        }

        // Base types (if accessed via property like z.string().optional())
        const mappedType = mapZodTypeToType(method);
        if (mappedType !== 'unknown') {
          type = mappedType;

          if (
            method === 'object' &&
            n.arguments.length > 0 &&
            ts.isObjectLiteralExpression(n.arguments[0])
          ) {
            nested = parseZodObjectProperties(n.arguments[0]);
          }

          if (
            method === 'enum' &&
            n.arguments.length > 0 &&
            ts.isArrayLiteralExpression(n.arguments[0])
          ) {
            enumOptions = n.arguments[0].elements
              .filter(ts.isStringLiteral)
              .map(el => el.text);
          }
        }

        // Continue down the chain
        analyze(expr.expression);
      }
    } else if (ts.isIdentifier(n)) {
      // Base case: 'z' or imported variable
    }
  }

  analyze(node);

  const result: any = { type, required };
  if (description !== undefined) result.description = description;
  if (defaultValue !== undefined) result.defaultValue = defaultValue;
  if (enumOptions !== undefined) result.enumOptions = enumOptions;
  if (nested !== undefined) result.nested = nested;

  return result;
}

function mapZodTypeToType(zodMethod: string): string {
  switch (zodMethod) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    case 'enum':
      return 'enum';
    default:
      return 'unknown';
  }
}

function extractValue(node: ts.Node): any {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return parseFloat(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return [];
  return undefined;
}
