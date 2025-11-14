/**
 * TypeScript Workflow Parser
 *
 * Extracts workflow metadata from TypeScript workflows by parsing the AST
 * and extracting steps, inputs, conditions, error handlers, and type information.
 *
 * This enables n8n-style graph visualization of TypeScript workflows in the UI.
 */

import * as ts from 'typescript';

export interface TypeScriptWorkflowMetadata {
  name: string;
  version: string;
  description?: string;

  // Input schema (extracted from Zod or TypeScript types)
  inputs: {
    name: string;
    type: string;
    required: boolean;
    default?: any;
    description?: string;
  }[];

  // Steps (extracted from the steps array)
  steps: {
    id: string;
    name: string;
    description?: string;
    type: 'action' | 'condition' | 'loop' | 'error_handler';

    // For graph visualization
    position?: { x: number; y: number };

    // Connections to other steps
    next?: string[]; // Normal flow
    onError?: string; // Error handler
    onSuccess?: string; // Success branch (for conditions)
    onFailure?: string; // Failure branch (for conditions)

    // Extracted from step definition
    condition?: string; // JavaScript code for condition
    execute?: string; // JavaScript code for execute function
    inputs?: string[]; // Which input variables this step uses
    outputs?: string[]; // Which context variables this step sets
  }[];

  // Error handler configuration
  errorHandler?: {
    type: 'global' | 'step';
    code?: string;
  };

  // Extracted source code locations (for debugging)
  sourceMap?: {
    workflowDefinition: { line: number; column: number };
    steps: Record<string, { file: string; line: number; column: number }>;
  };
}

/**
 * Parse TypeScript workflow from source code
 */
export function parseTypeScriptWorkflow(
  terminatorTsContent: string,
  _stepFiles?: Map<string, string> // filename -> content
): TypeScriptWorkflowMetadata {
  const sourceFile = ts.createSourceFile(
    'terminator.ts',
    terminatorTsContent,
    ts.ScriptTarget.Latest,
    true
  );

  const metadata: TypeScriptWorkflowMetadata = {
    name: 'Unknown Workflow',
    version: '1.0.0',
    inputs: [],
    steps: [],
  };

  // First, find variable declarations (like InputSchema)
  const variableDeclarations = new Map<string, ts.Node>();

  function collectVariables(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach(decl => {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          variableDeclarations.set(decl.name.text, decl.initializer);
        }
      });
    }
    ts.forEachChild(node, collectVariables);
  }

  collectVariables(sourceFile);

  // Find the createWorkflow() call
  visitNode(sourceFile);

  function visitNode(node: ts.Node) {
    // Look for: createWorkflow({ ... })
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'createWorkflow') {
        if (node.arguments.length > 0) {
          const configArg = node.arguments[0];
          if (ts.isObjectLiteralExpression(configArg)) {
            parseWorkflowConfig(configArg);
          }
        }
      }
    }

    ts.forEachChild(node, visitNode);
  }

  function parseWorkflowConfig(config: ts.ObjectLiteralExpression) {
    config.properties.forEach(prop => {
      if (!ts.isPropertyAssignment(prop)) return;
      if (!ts.isIdentifier(prop.name)) return;

      const propName = prop.name.text;
      const value = prop.initializer;

      switch (propName) {
        case 'name':
          if (ts.isStringLiteral(value)) {
            metadata.name = value.text;
          }
          break;

        case 'version':
          if (ts.isStringLiteral(value)) {
            metadata.version = value.text;
          }
          break;

        case 'description':
          if (ts.isStringLiteral(value)) {
            metadata.description = value.text;
          }
          break;

        case 'input':
          // Check if it's a variable reference (e.g., InputSchema)
          if (ts.isIdentifier(value)) {
            const variableName = value.text;
            const variableNode = variableDeclarations.get(variableName);
            if (variableNode) {
              metadata.inputs = parseInputSchema(variableNode);
            }
          } else {
            metadata.inputs = parseInputSchema(value);
          }
          break;

        case 'steps':
          if (ts.isArrayLiteralExpression(value)) {
            metadata.steps = parseSteps(value);
          }
          break;

        case 'onError':
          metadata.errorHandler = {
            type: 'global',
            code: value.getText(sourceFile),
          };
          break;
      }
    });
  }

  function parseInputSchema(
    schemaNode: ts.Node
  ): TypeScriptWorkflowMetadata['inputs'] {
    const inputs: TypeScriptWorkflowMetadata['inputs'] = [];

    // Look for z.object({ ... }) pattern
    if (!ts.isCallExpression(schemaNode)) return inputs;

    const args = schemaNode.arguments;
    if (args.length === 0) return inputs;

    const schemaObj = args[0];
    if (!ts.isObjectLiteralExpression(schemaObj)) return inputs;

    schemaObj.properties.forEach(prop => {
      if (!ts.isPropertyAssignment(prop)) return;
      if (!ts.isIdentifier(prop.name)) return;

      const fieldName = prop.name.text;
      const fieldSchema = prop.initializer;

      inputs.push({
        name: fieldName,
        type: extractZodType(fieldSchema),
        required: !isOptionalZodField(fieldSchema),
        default: extractZodDefault(fieldSchema),
        description: extractZodDescription(fieldSchema),
      });
    });

    return inputs;
  }

  function extractZodType(node: ts.Node): string {
    const text = node.getText(sourceFile);

    // Extract Zod type from chained methods: z.string().optional().describe(...) -> "string"
    // Match the first z.type() call
    if (text.match(/z\.string\(/)) return 'string';
    if (text.match(/z\.number\(/)) return 'number';
    if (text.match(/z\.boolean\(/)) return 'boolean';
    if (text.match(/z\.array\(/)) return 'array';
    if (text.match(/z\.object\(/)) return 'object';
    if (text.match(/z\.enum\(/)) {
      // Extract enum values: z.enum(['a', 'b']) -> "enum('a','b')"
      const match = text.match(/z\.enum\(\[([^\]]+)\]/);
      if (match) {
        return `enum(${match[1]})`;
      }
      return 'enum';
    }

    return 'unknown';
  }

  function isOptionalZodField(node: ts.Node): boolean {
    const text = node.getText(sourceFile);
    return text.includes('.optional()');
  }

  function extractZodDefault(node: ts.Node): any {
    const text = node.getText(sourceFile);
    const match = text.match(/\.default\(([^)]+)\)/);
    if (!match) return undefined;

    const defaultValue = match[1];

    // Try to parse as JSON
    try {
      return JSON.parse(defaultValue);
    } catch {
      // Return as string if not parseable
      return defaultValue.replace(/^['"]|['"]$/g, '');
    }
  }

  function extractZodDescription(node: ts.Node): string | undefined {
    const text = node.getText(sourceFile);
    const match = text.match(/\.describe\(['"]([^'"]+)['"]\)/);
    return match ? match[1] : undefined;
  }

  function parseSteps(
    stepsArray: ts.ArrayLiteralExpression
  ): TypeScriptWorkflowMetadata['steps'] {
    const steps: TypeScriptWorkflowMetadata['steps'] = [];

    stepsArray.elements.forEach((element, index) => {
      if (ts.isIdentifier(element)) {
        // Step is imported: e.g., "openNotepad"
        steps.push({
          id: element.text,
          name: toTitleCase(element.text),
          type: 'action',
          position: { x: 100, y: 100 + index * 120 },
          next:
            index < stepsArray.elements.length - 1
              ? [stepsArray.elements[index + 1].getText(sourceFile)]
              : undefined,
        });
      } else if (ts.isCallExpression(element)) {
        // Inline step definition: createStep({ ... })
        const step = parseInlineStep(element, index);
        if (step) steps.push(step);
      }
    });

    return steps;
  }

  function parseInlineStep(
    call: ts.CallExpression,
    index: number
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
      if (!ts.isPropertyAssignment(prop)) return;
      if (!ts.isIdentifier(prop.name)) return;

      const propName = prop.name.text;
      const value = prop.initializer;

      switch (propName) {
        case 'id':
          if (ts.isStringLiteral(value)) {
            step.id = value.text;
          }
          break;

        case 'name':
          if (ts.isStringLiteral(value)) {
            step.name = value.text;
          }
          break;

        case 'description':
          if (ts.isStringLiteral(value)) {
            step.description = value.text;
          }
          break;

        case 'condition':
          step.type = 'condition';
          step.condition = value.getText(sourceFile);
          break;

        case 'execute':
          step.execute = value.getText(sourceFile);
          break;

        case 'onError':
          step.onError = extractErrorHandler(value);
          break;
      }
    });

    return step;
  }

  function extractErrorHandler(node: ts.Node): string | undefined {
    // For now, just return the string representation
    // In the future, we could parse this more deeply
    return node.getText(sourceFile);
  }

  function toTitleCase(str: string): string {
    return str
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();
  }

  return metadata;
}

/**
 * Extract metadata from compiled JavaScript (for workflows already built)
 * This is a fallback when TypeScript source is not available.
 */
export function extractMetadataFromCompiledJS(
  jsContent: string
): Partial<TypeScriptWorkflowMetadata> {
  // Parse the compiled JS to extract createWorkflow() call
  const _sourceFile = ts.createSourceFile(
    'workflow.js',
    jsContent,
    ts.ScriptTarget.Latest,
    true
  );

  // Use the same parser logic
  return parseTypeScriptWorkflow(jsContent);
}

/**
 * Generate n8n-style graph data from workflow metadata
 */
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

  // Add start node
  nodes.push({
    id: '__start__',
    type: 'start',
    data: { label: 'Start' },
    position: { x: 100, y: 0 },
  });

  // Add step nodes
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
      position: step.position || { x: 100, y: 100 + index * 120 },
    });

    // Add edge from previous step
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

    // Add error edges
    if (step.onError) {
      edges.push({
        id: `${step.id}->error`,
        source: step.id,
        target: step.onError,
        type: 'error',
        label: 'On Error',
      });
    }

    // Add condition edges
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

  // Add end node
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
