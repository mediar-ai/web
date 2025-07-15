import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Define types for workflow components (reused from overview endpoint)
interface WorkflowStep {
  group_name?: string;
  if?: string;
  steps?: WorkflowStep[];
  arguments?: Record<string, unknown>;
}

interface WorkflowVariable {
  type: string;
  default?: unknown;
  description?: string;
  required?: boolean;
  options?: unknown[];
}

interface AutomationSequence {
  arguments?: {
    variables?: Record<string, WorkflowVariable>;
    steps?: WorkflowStep[];
    output_parser?: {
      fieldsToExtract?: Record<string, unknown>;
    };
  };
}

// Helper function to extract variables from a step's arguments
function extractVariablesFromStep(step: WorkflowStep, variables: Set<string>) {
  if (!step || !step.arguments) return;
  
  const extractFromValue = (value: unknown): void => {
    if (typeof value === 'string') {
      // Extract {{variable}} patterns
      const matches = value.match(/\{\{([^}]+)\}\}/g);
      if (matches) {
        matches.forEach(match => {
          const varName = match.replace(/\{\{|\}\}/g, '').trim();
          variables.add(varName);
        });
      }
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(v => extractFromValue(v));
    }
  };
  
  extractFromValue(step.arguments);
}

// Helper function to check if variable is used in any conditional branch
function isVariableUsedInAnyBranch(varName: string, conditionalBranches: Record<string, Record<string, Set<string>>>): boolean {
  for (const controlVar in conditionalBranches) {
    for (const branchValue in conditionalBranches[controlVar]) {
      if (conditionalBranches[controlVar][branchValue].has(varName)) {
        return true;
      }
    }
  }
  return false;
}

// Analyze automation sequence to identify conditional logic (reused from overview endpoint)
function analyzeAutomationSequence(automationSequence: AutomationSequence[]) {
  if (!automationSequence || !Array.isArray(automationSequence) || automationSequence.length === 0) {
    return { coreVariables: {}, conditionalVariables: {} };
  }
  
  const mainSequence = automationSequence[0];
  if (!mainSequence.arguments || !mainSequence.arguments.variables) {
    return { coreVariables: {}, conditionalVariables: {} };
  }
  
  const allVariables = mainSequence.arguments.variables;
  const steps = mainSequence.arguments.steps || [];
  
  // Track which variables are used in unconditional vs conditional contexts
  const unconditionalVars = new Set<string>();
  const conditionalBranches: Record<string, Record<string, Set<string>>> = {};
  
  // Process each step
  steps.forEach((step: WorkflowStep) => {
    if (step.group_name && step.if) {
      // This is a conditional group
      const condition = step.if;
      // Parse condition like "quote_type == 'Face Value'"
      const conditionMatch = condition.match(/(\w+)\s*==\s*['"]([^'"]+)['"]/);
      if (conditionMatch) {
        const [, controlVar, value] = conditionMatch;
        
        if (!conditionalBranches[controlVar]) {
          conditionalBranches[controlVar] = {};
        }
        
        // Extract variables used in this branch
        const branchVars = new Set<string>();
        if (step.steps && Array.isArray(step.steps)) {
          step.steps.forEach((subStep: WorkflowStep) => {
            extractVariablesFromStep(subStep, branchVars);
          });
        }
        
        conditionalBranches[controlVar][value] = branchVars;
      }
    } else if (step.steps && Array.isArray(step.steps)) {
      // Unconditional group
      step.steps.forEach((subStep: WorkflowStep) => {
        extractVariablesFromStep(subStep, unconditionalVars);
      });
    } else {
      // Single unconditional step
      extractVariablesFromStep(step, unconditionalVars);
    }
  });
  
  // Build the hierarchical schema
  const coreVariables: Record<string, WorkflowVariable> = {};
  const conditionalVariables: Record<string, WorkflowVariable & { controls?: Record<string, Record<string, WorkflowVariable>> }> = {};
  
  // Process all variables
  Object.entries(allVariables).forEach(([varName, varDef]) => {
    // Check if this variable is a controlling variable
    if (conditionalBranches[varName]) {
      // This is a controlling variable
      conditionalVariables[varName] = {
        ...varDef,
        controls: {}
      };
      
      // For each branch value, find variables used only in that branch
      Object.entries(conditionalBranches[varName]).forEach(([branchValue, branchVars]) => {
        const branchSpecificVars: Record<string, unknown> = {};
        
        (branchVars as Set<string>).forEach(usedVar => {
          // Remove prefixes like "selectors." to get the base variable name
          const baseVarName = usedVar.split('.').pop() || usedVar;
          
          // Check if this variable exists in allVariables and is not used unconditionally
          Object.entries(allVariables).forEach(([fullVarName, fullVarDef]) => {
            if (fullVarName === baseVarName || fullVarName.endsWith(baseVarName)) {
              if (!unconditionalVars.has(fullVarName) && !unconditionalVars.has(usedVar)) {
                // Create branch-specific parameter name to avoid conflicts
                const branchSpecificName = `${fullVarName}_${branchValue.toLowerCase().replace(/\s+/g, '_')}`;
                branchSpecificVars[branchSpecificName] = {
                  ...fullVarDef,
                  // Add metadata to track the original variable name
                  _originalName: fullVarName,
                  _branchValue: branchValue
                };
              }
            }
          });
        });
        
        if (Object.keys(branchSpecificVars).length > 0) {
          (conditionalVariables[varName] as unknown as { controls: Record<string, unknown> }).controls[branchValue] = branchSpecificVars;
        }
      });
    } else if (!isVariableUsedInAnyBranch(varName, conditionalBranches)) {
      // This is a core variable (not used exclusively in branches)
      coreVariables[varName] = varDef;
    }
  });
  
  return { coreVariables, conditionalVariables };
}

// Helper to extract default values from hierarchical schema
function extractDefaultsFromHierarchical(schema: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const key in schema) {
    const value = schema[key] as Record<string, unknown>;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.hasOwnProperty('default')) {
        defaults[key] = value.default;
      }
      // Don't recurse into 'controls' - those are conditional
      if (!value.hasOwnProperty('controls')) {
        const nestedDefaults = extractDefaultsFromHierarchical(value as Record<string, unknown>);
        if (Object.keys(nestedDefaults).length > 0) {
          defaults[key] = nestedDefaults;
        }
      }
    }
  }
  return defaults;
}

// Helper to filter out internal/technical parameters that API users don't need to see
function filterInternalParameters(schema: Record<string, unknown>): Record<string, unknown> {
  const internalParams = ['quote_parser', 'url']; // Parameters to exclude from API documentation
  const filtered: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(schema)) {
    if (!internalParams.includes(key)) {
      filtered[key] = value;
    }
  }
  
  console.log(`🧹 Filtered out ${Object.keys(schema).length - Object.keys(filtered).length} internal parameters: ${internalParams.filter(param => param in schema).join(', ')}`);
  return filtered;
}

// Helper to convert conditional branch-specific parameters back to original parameter names
// This ensures the API documentation shows what users should actually send to the execute endpoint
function convertToApiParameterNames(schema: Record<string, unknown>): Record<string, unknown> {
  const apiSchema: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const param = value as Record<string, unknown>;
      
      // Check if this is a controlling parameter with conditional branches
      if (param.controls) {
        // This is a controlling parameter - keep it as is
        apiSchema[key] = param;
        
        // Process the conditional branches to extract original parameter names
        const controls = param.controls as Record<string, Record<string, unknown>>;
        const originalParams: Record<string, unknown> = {};
        
        // Extract unique original parameter names from all branches
        for (const [, branchParams] of Object.entries(controls)) {
          for (const [, branchParamDef] of Object.entries(branchParams)) {
            const branchParam = branchParamDef as Record<string, unknown>;
            const originalName = branchParam._originalName as string;
            
            if (originalName && !originalParams[originalName]) {
              // Create the original parameter with conditional context
              originalParams[originalName] = {
                ...branchParam,
                // Remove branch-specific metadata
                _originalName: undefined,
                _branchValue: undefined,
                // Add conditional context
                conditional: true,
                availableWhen: `${key} is set`,
                description: `${branchParam.description || ''} (Available when ${key} matches specific values)`.trim()
              };
            }
          }
        }
        
        // Add original parameters to the schema
        Object.assign(apiSchema, originalParams);
      } else {
        // Regular parameter - keep as is
        apiSchema[key] = param;
      }
    }
  }
  
  console.log(`🔄 Converted conditional parameters to API-friendly format`);
  return apiSchema;
}

// Helper to extract validation rules from schema
function extractValidationRules(schema: Record<string, unknown>): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  
  for (const key in schema) {
    const value = schema[key] as Record<string, unknown>;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const paramRules: Record<string, unknown> = {};
      
      if (value.type) paramRules.type = value.type;
      if (value.required) paramRules.required = value.required;
      if (value.description) paramRules.description = value.description;
      if (value.options) paramRules.options = value.options;
      
      // Add conditional logic info
      if (value.controls) {
        paramRules.conditional = true;
        paramRules.branches = Object.keys(value.controls as Record<string, unknown>);
      }
      
      if (Object.keys(paramRules).length > 0) {
        rules[key] = paramRules;
      }
    }
  }
  
  return rules;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    console.log(`📋 Generating dynamic schema for workflow ${workflowIdNum}...`);
    
    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch workflow data
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, description, version, status, automation_sequence, estimated_duration_seconds')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} not found`,
          timestamp: new Date().toISOString()
        },
        { status: 404 }
      );
    }

    let inputParameters = {};
    let sampleRequest = {};
    let validationRules = {};
    let expectedOutputs = {};

    try {
      if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0) {
        console.log(`🔍 Analyzing automation sequence for workflow ${workflowIdNum}...`);
        
        // Analyze the automation sequence for conditional logic
        const { coreVariables, conditionalVariables } = analyzeAutomationSequence(workflow.automation_sequence);
        
        // Merge core and conditional variables into a hierarchical schema
        const mergedSchema = { ...coreVariables, ...conditionalVariables };
        
        // Filter out internal/technical parameters from the public API documentation
        const filteredSchema = filterInternalParameters(mergedSchema);
        
        // Convert conditional branch-specific parameters back to original parameter names for API docs
        // This ensures docs show what users should actually send to the execute endpoint
        const apiReadySchema = convertToApiParameterNames(filteredSchema);
        inputParameters = apiReadySchema;
        
        // Extract sample values from the API-ready schema
        sampleRequest = extractDefaultsFromHierarchical(apiReadySchema);
        
        // Extract validation rules from the API-ready schema
        validationRules = extractValidationRules(apiReadySchema);
        
        // Extract expected outputs
        const mainSequence = workflow.automation_sequence[0];
        if (mainSequence.arguments && mainSequence.arguments.output_parser && mainSequence.arguments.output_parser.fieldsToExtract) {
          expectedOutputs = Object.keys(mainSequence.arguments.output_parser.fieldsToExtract).reduce((acc, key) => {
            acc[key] = "dynamically extracted";
            return acc;
          }, {} as Record<string, string>);
        }
        
        console.log(`✅ Successfully analyzed schema: ${Object.keys(inputParameters).length} parameters found`);
      } else {
        console.log(`⚠️  No automation sequence found for workflow ${workflowIdNum}`);
      }
    } catch (e) {
      console.error(`❌ Error analyzing schema for workflow ${workflowIdNum}:`, e);
      // Continue with empty schema rather than failing
    }

    const response = {
      success: true,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        status: workflow.status,
        is_executable: workflow.status === 'deployed',
        estimated_duration_seconds: workflow.estimated_duration_seconds
      },
      schema: {
        input_parameters: inputParameters,
        sample_request: sampleRequest,
        validation_rules: validationRules,
        expected_outputs: expectedOutputs
      },
      api_info: {
        execute_endpoint: `/api/remote-workflows/${workflowIdNum}/execute`,
        method: 'POST',
        content_type: 'application/json',
        example_curl: `curl -X POST \\
  ${process.env.VERCEL_URL || 'https://app.mediar.ai'}/api/remote-workflows/${workflowIdNum}/execute \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ parameters: sampleRequest }, null, 2)}'`,
        example_javascript: `fetch('/api/remote-workflows/${workflowIdNum}/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify({ parameters: sampleRequest })})
}).then(response => response.json())`
      },
      metadata: {
        generated_at: new Date().toISOString(),
        parameter_count: Object.keys(inputParameters).length,
        has_conditional_logic: Object.values(inputParameters).some(param => 
          param && typeof param === 'object' && 'controls' in param
        )
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ Error generating workflow schema:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate workflow schema',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 