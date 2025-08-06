import type { AutomationSequence, JSONSchemaProperty, MCPTool, SchemaAnalysisResult, WorkflowRecord, WorkflowStep, WorkflowVariable } from './types';

/**
 * Generate an MCP tool from a workflow record
 * Reuses the same schema analysis logic as the existing API endpoints
 */
export async function generateToolFromWorkflow(workflow: WorkflowRecord): Promise<MCPTool> {
  console.log(`[FIX] [MCP] Generating MCP tool for workflow: ${workflow.name} (ID: ${workflow.id})`);

  try {
    // Normalize automation_sequence to always be an array
    let sequences = workflow.automation_sequence;
    if (!Array.isArray(sequences)) {
      sequences = [sequences];
    }
    
    // Use the same schema analysis logic as your existing /schema endpoint
    const { coreVariables, conditionalVariables } = analyzeAutomationSequence(sequences);
    
    // Merge core and conditional variables
    const mergedSchema = { ...coreVariables, ...conditionalVariables };
    
    // Filter out internal parameters (same logic as your API)
    const filteredSchema = filterInternalParameters(mergedSchema);
    
    // Add standard execution parameters
    const enhancedSchema = addStandardExecutionParameters(filteredSchema);
    
    // Convert to JSON Schema
    const jsonSchema = convertToJSONSchema(enhancedSchema);
    
    // Generate tool name
    const toolName = generateToolName(workflow);
    
    // Generate description
    const description = generateToolDescription(workflow);
    
    const tool: MCPTool = {
      name: toolName,
      description,
      inputSchema: {
        type: 'object',
        properties: jsonSchema,
        required: [] // Make all parameters optional for flexibility
      },
      metadata: {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        category: workflow.category,
        estimated_duration_seconds: workflow.estimated_duration_seconds,
        parameter_count: Object.keys(jsonSchema).length,
      }
    };

    console.log(`[FIX] [MCP] Generated MCP tool: ${toolName}`);
    return tool;

  } catch (error) {
    console.error(`[FIX] [MCP] Error generating tool for workflow ${workflow.id}:`, error);
    throw new Error(`Failed to generate tool for workflow ${workflow.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Analyze automation sequence to extract variables
 * Uses the same logic as your existing schema analysis
 */
function analyzeAutomationSequence(sequences: AutomationSequence[]): SchemaAnalysisResult {
  const coreVariables: Record<string, WorkflowVariable> = {};
  const conditionalVariables: Record<string, WorkflowVariable> = {};

  for (const sequence of sequences) {
    if (sequence.arguments?.variables) {
      // Core variables from the main arguments
      Object.entries(sequence.arguments.variables).forEach(([key, variable]) => {
        if (!isInternalParameter(key)) {
          coreVariables[key] = variable;
        }
      });
    }

    // Analyze conditional steps for additional variables
    if (sequence.arguments?.steps) {
      analyzeStepsForVariables(sequence.arguments.steps, conditionalVariables);
    }
  }

  return { coreVariables, conditionalVariables };
}

/**
 * Recursively analyze steps for conditional variables
 */
function analyzeStepsForVariables(steps: WorkflowStep[], conditionalVars: Record<string, WorkflowVariable>): void {
  for (const step of steps) {
    if (step.steps) {
      analyzeStepsForVariables(step.steps, conditionalVars);
    }
    
    // Extract variables from step arguments
    if (step.arguments) {
      Object.entries(step.arguments).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'type' in value) {
          const variable = value as WorkflowVariable;
          if (!isInternalParameter(key)) {
            conditionalVars[key] = variable;
          }
        }
      });
    }
  }
}

/**
 * Filter out internal/system parameters
 */
function filterInternalParameters(variables: Record<string, WorkflowVariable>): Record<string, WorkflowVariable> {
  const filtered: Record<string, WorkflowVariable> = {};
  
  for (const [key, variable] of Object.entries(variables)) {
    if (!isInternalParameter(key)) {
      filtered[key] = variable;
    }
  }
  
  return filtered;
}

/**
 * Check if parameter is internal/system parameter
 */
function isInternalParameter(key: string): boolean {
  const internalParams = [
    'url',
    'selectors', 
    'output_parser',
    'quote_parser',
    'products_parser',
    'steps'
  ];
  
  return internalParams.includes(key) || key.endsWith('_parser') || key.startsWith('_');
}

/**
 * Add standard execution parameters to all tools
 */
function addStandardExecutionParameters(variables: Record<string, WorkflowVariable>): Record<string, WorkflowVariable> {
  return {
    ...variables,
    execution_mode: {
      type: 'enum',
      label: 'Execution Mode',
      description: "Execution mode: 'async' returns immediately with execution ID, 'sync' waits for completion",
      options: ['async', 'sync'],
      default: 'async'
    },
    include_cache: {
      type: 'boolean',
      label: 'Use Cache',
      description: 'Use cached results if available for faster response',
      default: true
    },
    full_detailed_response: {
      type: 'boolean',
      label: 'Detailed Response',
      description: 'Include detailed logs and raw data in response',
      default: false
    }
  };
}

/**
 * Convert workflow variables to JSON Schema properties
 */
function convertToJSONSchema(variables: Record<string, WorkflowVariable>): Record<string, JSONSchemaProperty> {
  const schema: Record<string, JSONSchemaProperty> = {};
  
  for (const [key, variable] of Object.entries(variables)) {
    schema[key] = convertVariableToJSONSchema(variable, key);
  }
  
  return schema;
}

/**
 * Convert a single variable to JSON Schema property
 */
function convertVariableToJSONSchema(variable: WorkflowVariable, key: string): JSONSchemaProperty {
  const property: JSONSchemaProperty = {
    type: mapVariableType(variable.type || 'string'),
    description: variable.description || variable.label || `Parameter: ${key}`
  };

  // Add default value
  if (variable.default !== undefined) {
    property.default = variable.default;
  }

  // Handle enum/options
  if (variable.options && Array.isArray(variable.options)) {
    if (typeof variable.options[0] === 'string') {
      property.enum = variable.options as string[];
    } else {
      // Handle {value, label} format
      property.enum = (variable.options as Array<{value: string; label: string}>).map(opt => opt.value);
    }
  }

  // Handle conditional visibility
  if (variable.controls) {
    property.description += ` (Available when ${key} matches specific values)`;
  }

  return property;
}

/**
 * Map workflow variable types to JSON Schema types
 */
function mapVariableType(type: string): string {
  const typeMap: Record<string, string> = {
    'string': 'string',
    'enum': 'string',
    'boolean': 'boolean',
    'number': 'number',
    'integer': 'integer',
    'array': 'array',
    'object': 'object'
  };
  
  return typeMap[type] || 'string';
}

/**
 * Generate a tool name from workflow
 */
function generateToolName(workflow: WorkflowRecord): string {
  // Create a clean tool name from workflow name
  const baseName = workflow.name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Remove duplicate underscores
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores

  // Add category prefix if available
  const prefix = workflow.category ? `${workflow.category}_` : '';
  
  return `${prefix}${baseName}`.substring(0, 64); // Limit length
}

/**
 * Generate tool description
 */
function generateToolDescription(workflow: WorkflowRecord): string {
  let description = workflow.description || `Workflow: ${workflow.name}`;
  
  // Add duration estimate
  if (workflow.estimated_duration_seconds) {
    description += ` (estimated duration: ${workflow.estimated_duration_seconds}s)`;
  }
  
  // Add standard footer
  description += '. This tool executes a browser automation workflow that performs complex tasks automatically.';
  
  return description;
} 