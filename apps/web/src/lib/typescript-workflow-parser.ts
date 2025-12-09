import * as ts from 'typescript';

// ============================================================================
// Interfaces
// ============================================================================

export interface WorkflowInput {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: any;
  description?: string;
  enumOptions?: string[];
  nested?: WorkflowInput[];
}

export interface TypeScriptWorkflowMetadata {
  name: string;
  version: string;
  description?: string;
  inputs: WorkflowInput[];
  steps: {
    id: string;
    name: string;
    description?: string;
    type: 'action' | 'condition' | 'loop' | 'error_handler';
    position: { x: number; y: number };
    next?: string[];
    onError?: string;
    onSuccess?: string;
    onFailure?: string;
    condition?: string;
    execute?: string;
    inputs?: string[];
    outputs?: string[];
  }[];
  errorHandler?: {
    type: 'global' | 'step';
    code?: string;
  };
}

// Alias for compatibility
export type WorkflowMetadata = TypeScriptWorkflowMetadata;

// ============================================================================
// Main Parser Function
// ============================================================================

export function parseTypeScriptWorkflow(
  sourceCode: string
): TypeScriptWorkflowMetadata {
  const sourceFile = ts.createSourceFile(
    'workflow.ts',
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  const metadata: TypeScriptWorkflowMetadata = {
    name: 'Unknown Workflow',
    version: '1.0.0',
    inputs: [],
    steps: [],
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

    // Check for export default createWorkflow(...).step(...).build() pattern
    if (
      ts.isExportAssignment(node) &&
      !node.isExportEquals &&
      ts.isCallExpression(node.expression)
    ) {
      parseChainedWorkflow(node.expression, metadata, sourceFile);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return metadata;
}

// ============================================================================
// Chained Workflow Parsing (for .step().step().build() pattern)
// ============================================================================

interface StepReference {
  type: 'identifier' | 'createStep';
  name: string;
  resolvedId?: string;
  resolvedName?: string;
  resolvedDescription?: string;
}

function parseChainedWorkflow(
  node: ts.CallExpression,
  metadata: TypeScriptWorkflowMetadata,
  sourceFile: ts.SourceFile
) {
  // Collect all chained method calls
  const chain: Array<{ method: string; call: ts.CallExpression }> = [];
  let current: ts.Node = node;

  // Walk up the chain
  while (ts.isCallExpression(current)) {
    if (ts.isPropertyAccessExpression(current.expression)) {
      const methodName = current.expression.name.text;
      chain.unshift({ method: methodName, call: current });
      current = current.expression.expression;
    } else if (ts.isIdentifier(current.expression)) {
      // Found createWorkflow call
      if (current.expression.text === 'createWorkflow') {
        if (
          current.arguments.length > 0 &&
          ts.isObjectLiteralExpression(current.arguments[0])
        ) {
          parseWorkflowObject(current.arguments[0], metadata, sourceFile);
        }
      }
      break;
    } else {
      current = current.expression;
    }
  }

  // Parse chained method calls
  const stepReferences: StepReference[] = [];
  for (const { method, call } of chain) {
    if (method === 'step') {
      if (call.arguments.length > 0) {
        const arg = call.arguments[0];
        if (ts.isIdentifier(arg)) {
          const varName = arg.text;
          // Try to resolve the variable to a createStep call
          const createStepConfig = findCreateStepDefinition(
            sourceFile,
            varName
          );
          if (createStepConfig) {
            stepReferences.push({
              type: 'createStep',
              name: varName,
              resolvedId: createStepConfig.id,
              resolvedName: createStepConfig.name,
              resolvedDescription: createStepConfig.description,
            });
          } else {
            // It's an imported step function
            stepReferences.push({
              type: 'identifier',
              name: varName,
            });
          }
        } else if (ts.isCallExpression(arg)) {
          // Inline createStep call: .step(createStep({...}))
          const config = parseCreateStepCall(arg, sourceFile);
          if (config) {
            stepReferences.push({
              type: 'createStep',
              name: config.id || 'inline_step',
              resolvedId: config.id,
              resolvedName: config.name,
              resolvedDescription: config.description,
            });
          }
        }
      }
    } else if (method === 'onError') {
      if (call.arguments.length > 0) {
        metadata.errorHandler = {
          type: 'global',
          code: call.arguments[0].getText(sourceFile),
        };
      }
    }
    // onSuccess is handled as part of the workflow completion, not as metadata
  }

  // Convert step references to step metadata
  if (stepReferences.length > 0 && metadata.steps.length === 0) {
    metadata.steps = stepReferences.map((step, index) => ({
      id: step.resolvedId || step.name,
      name: step.resolvedName || toTitleCase(step.name),
      description: step.resolvedDescription,
      type: 'action' as const,
      position: { x: 100, y: 100 + index * 120 },
      next:
        index < stepReferences.length - 1
          ? [
              stepReferences[index + 1].resolvedId ||
                stepReferences[index + 1].name,
            ]
          : undefined,
    }));
  }
}

/**
 * Find a variable declaration that is assigned a createStep({...}) call
 * and extract the step configuration from it.
 */
function findCreateStepDefinition(
  sourceFile: ts.SourceFile,
  variableName: string
): { id?: string; name?: string; description?: string } | null {
  let result: { id?: string; name?: string; description?: string } | null =
    null;

  function visit(node: ts.Node) {
    if (result) return;

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      // Check if initializer is createStep({...})
      if (ts.isCallExpression(node.initializer)) {
        const config = parseCreateStepCall(node.initializer, sourceFile);
        if (config) {
          result = config;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

/**
 * Parse a createStep({...}) call expression and extract id, name, description
 */
function parseCreateStepCall(
  call: ts.CallExpression,
  _sourceFile: ts.SourceFile
): { id?: string; name?: string; description?: string } | null {
  // Check if this is a createStep call
  if (
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== 'createStep'
  ) {
    return null;
  }

  if (
    call.arguments.length === 0 ||
    !ts.isObjectLiteralExpression(call.arguments[0])
  ) {
    return null;
  }

  const config: { id?: string; name?: string; description?: string } = {};
  const objectLiteral = call.arguments[0];

  objectLiteral.properties.forEach(prop => {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return;

    const propName = prop.name.text;
    const value = prop.initializer;

    if (propName === 'id' && ts.isStringLiteral(value)) {
      config.id = value.text;
    } else if (propName === 'name' && ts.isStringLiteral(value)) {
      config.name = value.text;
    } else if (propName === 'description' && ts.isStringLiteral(value)) {
      config.description = value.text;
    }
  });

  return config;
}

// ============================================================================
// Workflow Object Parsing
// ============================================================================

function parseWorkflowObject(
  objectLiteral: ts.ObjectLiteralExpression,
  metadata: TypeScriptWorkflowMetadata,
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
      // Input Parsing Logic
      if (ts.isIdentifier(prop.initializer)) {
        const variableName = prop.initializer.text;
        const schemaNode = findVariableDeclaration(sourceFile, variableName);
        if (schemaNode) {
          metadata.inputs = parseZodSchema(schemaNode);
        }
      } else {
        metadata.inputs = parseZodSchema(prop.initializer);
      }
    } else if (
      name === 'steps' &&
      ts.isArrayLiteralExpression(prop.initializer)
    ) {
      // Step Parsing Logic
      metadata.steps = parseSteps(prop.initializer, sourceFile);
    } else if (name === 'onError') {
      metadata.errorHandler = {
        type: 'global',
        code: prop.initializer.getText(sourceFile),
      };
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

// ============================================================================
// Zod Schema Parsing (Robust AST Implementation)
// ============================================================================

function parseZodSchema(node: ts.Node): WorkflowInput[] {
  if (ts.isAsExpression(node)) {
    return parseZodSchema(node.expression);
  }

  let objectLiteral: ts.ObjectLiteralExpression | undefined;

  function findObjectLiteral(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) {
        if (n.expression.name.text === 'object') {
          if (
            n.arguments.length > 0 &&
            ts.isObjectLiteralExpression(n.arguments[0])
          ) {
            objectLiteral = n.arguments[0];
          }
        }
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
    if (ts.isAsExpression(n)) {
      analyze(n.expression);
      return;
    }

    if (ts.isCallExpression(n)) {
      const expr = n.expression;

      if (ts.isPropertyAccessExpression(expr)) {
        const method = expr.name.text;

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

        analyze(expr.expression);
      }
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

// ============================================================================
// Step Parsing (Restored)
// ============================================================================

function parseSteps(
  stepsArray: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile
): TypeScriptWorkflowMetadata['steps'] {
  const steps: TypeScriptWorkflowMetadata['steps'] = [];

  stepsArray.elements.forEach((element, index) => {
    if (ts.isIdentifier(element)) {
      const varName = element.text;
      // Try to resolve the variable to a createStep call
      const createStepConfig = findCreateStepDefinition(sourceFile, varName);

      if (createStepConfig) {
        // Variable references a createStep({id, name, description}) call
        steps.push({
          id: createStepConfig.id || varName,
          name: createStepConfig.name || toTitleCase(varName),
          description: createStepConfig.description,
          type: 'action',
          position: { x: 100, y: 100 + index * 120 },
          next:
            index < stepsArray.elements.length - 1
              ? [getNextStepId(stepsArray.elements[index + 1], sourceFile)]
              : undefined,
        });
      } else {
        // Step is an imported function (no createStep definition found)
        steps.push({
          id: varName,
          name: toTitleCase(varName),
          type: 'action',
          position: { x: 100, y: 100 + index * 120 },
          next:
            index < stepsArray.elements.length - 1
              ? [getNextStepId(stepsArray.elements[index + 1], sourceFile)]
              : undefined,
        });
      }
    } else if (ts.isCallExpression(element)) {
      // Inline step
      const step = parseInlineStep(element, index, sourceFile);
      if (step) steps.push(step);
    }
  });

  return steps;
}

/**
 * Get the ID for the next step element (for building the 'next' chain)
 */
function getNextStepId(
  element: ts.Expression,
  sourceFile: ts.SourceFile
): string {
  if (ts.isIdentifier(element)) {
    const varName = element.text;
    const createStepConfig = findCreateStepDefinition(sourceFile, varName);
    return createStepConfig?.id || varName;
  }
  return element.getText(sourceFile);
}

function parseInlineStep(
  call: ts.CallExpression,
  index: number,
  sourceFile: ts.SourceFile
): TypeScriptWorkflowMetadata['steps'][0] | null {
  if (call.arguments.length === 0) return null;

  const config = call.arguments[0];
  if (!ts.isObjectLiteralExpression(config)) return null;

  const step: TypeScriptWorkflowMetadata['steps'][0] = {
    id: `step_${index}`,
    name: `Step ${index + 1}`,
    type: 'action',
    position: { x: 100, y: 100 + index * 120 },
  };

  config.properties.forEach(prop => {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return;
    const propName = prop.name.text;
    const value = prop.initializer;

    switch (propName) {
      case 'id':
        if (ts.isStringLiteral(value)) step.id = value.text;
        break;
      case 'name':
        if (ts.isStringLiteral(value)) step.name = value.text;
        break;
      case 'description':
        if (ts.isStringLiteral(value)) step.description = value.text;
        break;
      case 'condition':
        step.type = 'condition';
        step.condition = value.getText(sourceFile);
        break;
      case 'execute':
        step.execute = value.getText(sourceFile);
        break;
      case 'onError':
        step.onError = value.getText(sourceFile);
        break;
    }
  });

  return step;
}

function toTitleCase(str: string): string {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ============================================================================
// Graph Generation (Restored)
// ============================================================================

export interface WorkflowGraphNode {
  id: string;
  type: 'action' | 'condition' | 'loop' | 'error_handler' | 'start' | 'end';
  data: {
    label: string;
    description?: string;
    inputs?: string[];
    outputs?: string[];
  };
  position: { x: number; y: number };
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'success' | 'failure' | 'error';
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export function generateWorkflowGraph(
  metadata: TypeScriptWorkflowMetadata
): WorkflowGraph {
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];

  nodes.push({
    id: '__start__',
    type: 'start',
    data: { label: 'Start' },
    position: { x: 100, y: 0 },
  });

  metadata.steps.forEach((step, index) => {
    nodes.push({
      id: step.id,
      type: step.type,
      data: {
        label: step.name,
        description: step.description,
        inputs: step.inputs,
        outputs: step.outputs,
      },
      position: step.position,
    });

    if (index === 0) {
      edges.push({
        id: `__start__->${step.id}`,
        source: '__start__',
        target: step.id,
        type: 'default',
      });
    } else {
      const prevStep = metadata.steps[index - 1];
      edges.push({
        id: `${prevStep.id}->${step.id}`,
        source: prevStep.id,
        target: step.id,
        type: 'default',
      });
    }

    if (step.onError) {
      edges.push({
        id: `${step.id}->error`,
        source: step.id,
        target: step.onError,
        type: 'error',
        label: 'On Error',
      });
    }

    if (step.type === 'condition') {
      if (step.onSuccess) {
        edges.push({
          id: `${step.id}->success`,
          source: step.id,
          target: step.onSuccess,
          type: 'success',
          label: 'True',
        });
      }
      if (step.onFailure) {
        edges.push({
          id: `${step.id}->failure`,
          source: step.id,
          target: step.onFailure,
          type: 'failure',
          label: 'False',
        });
      }
    }
  });

  const lastStep = metadata.steps[metadata.steps.length - 1];
  if (lastStep) {
    nodes.push({
      id: '__end__',
      type: 'end',
      data: { label: 'End' },
      position: { x: 100, y: 100 + metadata.steps.length * 120 },
    });

    edges.push({
      id: `${lastStep.id}->__end__`,
      source: lastStep.id,
      target: '__end__',
      type: 'default',
    });
  }

  return { nodes, edges };
}

export function extractMetadataFromCompiledJS(
  jsContent: string
): Partial<TypeScriptWorkflowMetadata> {
  return parseTypeScriptWorkflow(jsContent);
}
