import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type JSONValue = string | number | boolean | { [x: string]: JSONValue } | Array<JSONValue>;
type JSONObject = { [x: string]: JSONValue };

// Define types for workflow components
interface WorkflowStep {
  group_name?: string;
  if?: string;
  steps?: WorkflowStep[];
  arguments?: Record<string, unknown>;
}

// Remove unused interface - the automation sequence is handled as JSONValue arrays

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

// Helper function to recursively extract all steps from automation sequence
function extractStepsFromSequence(automationSequence: JSONValue[]): JSONValue[] {
  const allSteps: JSONValue[] = [];
  
  if (!automationSequence || !Array.isArray(automationSequence) || automationSequence.length === 0) {
    return allSteps;
  }
  
  const mainSequence = automationSequence[0] as JSONObject;
  if (!mainSequence?.arguments) return allSteps;
  
  const steps = ((mainSequence.arguments as JSONObject).steps as JSONValue[]) || [];
  
  const processSteps = (stepList: JSONValue[]) => {
    stepList.forEach((stepValue: JSONValue) => {
      const step = stepValue as JSONObject;
      allSteps.push(step);
      
      // Recursively process nested steps in groups
      if (step.steps && Array.isArray(step.steps)) {
        processSteps(step.steps);
      }
    });
  };
  
  processSteps(steps);
  return allSteps;
}

// Helper function to detect checkbox-list fields based on workflow patterns
function detectCheckboxListFields(
  allVariables: Record<string, JSONValue>, 
  automationSequence: JSONValue[]
): Record<string, boolean> {
  const checkboxFields: Record<string, boolean> = {};
  const allSteps = extractStepsFromSequence(automationSequence);
  
  Object.entries(allVariables).forEach(([varName, varDef]) => {
    const variable = varDef as JSONObject;
    
    // Rule 1: Simple heuristic - array type with options
    if (variable.type === 'array' && Array.isArray(variable.options)) {
      checkboxFields[varName] = true;
      return;
    }
    
    // Rule 2: Array type with default values (fallback for when options aren't explicit)
    if (variable.type === 'array' && Array.isArray(variable.default) && variable.default.length > 0) {
      // Check for automation sequence patterns to confirm checkbox behavior
      const hasCheckboxPatterns = allSteps.some(stepValue => {
        const step = stepValue as JSONObject;
        
        // Pattern A: set_toggled with contains()
        if (step.tool_name === 'set_toggled' && 
          step.arguments &&
          typeof (step.arguments as JSONObject).state === 'string' &&
            ((step.arguments as JSONObject).state as string).includes(`contains(${varName},`)) {
          return true;
        }
        
        // Pattern B: Conditional groups with contains() or !contains()
        if (step.if && typeof step.if === 'string' &&
            (step.if.includes(`contains(${varName},`) || 
             step.if.includes(`!contains(${varName},`))) {
          return true;
        }
        
        // Pattern C: Group names that suggest checkbox behavior
        if (step.group_name && typeof step.group_name === 'string' &&
            step.if && typeof step.if === 'string' &&
            (step.if.includes(`contains(${varName},`) || 
             step.if.includes(`!contains(${varName},`))) {
          return true;
        }
        
        return false;
      });
      
      if (hasCheckboxPatterns) {
        checkboxFields[varName] = true;
      }
    }
  });
  
  return checkboxFields;
}

// Analyze automation sequence to identify conditional logic
function analyzeAutomationSequence(automationSequence: JSONValue[]) {
  if (!automationSequence || !Array.isArray(automationSequence) || automationSequence.length === 0) {
    return { coreVariables: {}, conditionalVariables: {} };
  }
  
  const mainSequence = automationSequence[0] as JSONObject;
  if (!mainSequence?.arguments || !(mainSequence.arguments as JSONObject)?.variables) {
    return { coreVariables: {}, conditionalVariables: {} };
  }
  
  const allVariables = (mainSequence.arguments as JSONObject).variables as Record<string, JSONValue>;
  const steps = ((mainSequence.arguments as JSONObject).steps as JSONValue[]) || [];
  
  // Track which variables are used in unconditional vs conditional contexts
  const unconditionalVars = new Set<string>();
  const conditionalBranches: Record<string, Record<string, Set<string>>> = {};
  
  // Process each step
  steps.forEach((stepValue: JSONValue) => {
    const step = stepValue as JSONObject;
    if (step.group_name && step.if) {
      // This is a conditional group
      const condition = step.if as string;
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
          step.steps.forEach((subStep: unknown) => {
            extractVariablesFromStep(subStep as WorkflowStep, branchVars);
          });
        }
        
        conditionalBranches[controlVar][value] = branchVars;
      }
    } else if (step.steps && Array.isArray(step.steps)) {
      // Unconditional group
      step.steps.forEach((subStep: unknown) => {
        extractVariablesFromStep(subStep as WorkflowStep, unconditionalVars);
      });
    } else {
      // Single unconditional step
      extractVariablesFromStep(step, unconditionalVars);
    }
  });
  
  // Build the hierarchical schema
  const coreVariables: Record<string, JSONValue> = {};
  const conditionalVariables: Record<string, JSONValue> = {};
  
  // Process all variables
  Object.entries(allVariables).forEach(([varName, varDef]) => {
    // Check if this variable is a controlling variable
    if (conditionalBranches[varName]) {
      // This is a controlling variable
      conditionalVariables[varName] = {
        ...(varDef as Record<string, unknown>),
        controls: {}
      };
      
      // For each branch value, find variables used only in that branch
      Object.entries(conditionalBranches[varName]).forEach(([branchValue, branchVars]) => {
        const branchSpecificVars: Record<string, JSONValue> = {};
        
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
                  ...(fullVarDef as Record<string, unknown>),
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

// Helper to check if a variable is used in any conditional branch
function isVariableUsedInAnyBranch(varName: string, conditionalBranches: Record<string, Record<string, Set<string>>>): boolean {
  for (const [, branches] of Object.entries(conditionalBranches)) {
    for (const [, branchVars] of Object.entries(branches)) {
      if ((branchVars as Set<string>).has(varName)) {
        return true;
      }
    }
  }
  return false;
}

// Helper to recursively transform variables into a UI-friendly schema
const transformVariablesToSchema = (variables: JSONObject, automationSequence: JSONValue[] = []): JSONObject => {
  const schema: JSONObject = {};
  const checkboxFields = detectCheckboxListFields(variables, automationSequence);
  
  for (const key in variables) {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const variable = { ...(variables[key] as JSONObject) };

      // Convert "enum" to "select" for the UI component
      if (variable.type === 'enum' && Array.isArray(variable.options)) {
        variable.type = 'select';
        // Format options for the Select component
        variable.options = (variable.options as string[]).map(opt => ({ value: opt, label: opt }));
      }
      // Convert detected checkbox arrays to checkbox-list
      else if (checkboxFields[key]) {
        variable.type = 'checkbox-list';
        
        // Use explicit options if available
        if (Array.isArray(variable.options)) {
          variable.options = (variable.options as string[]).map(item => ({
            value: item,
            label: item
          }));
        }
        // Fallback: generate options from default values
        else if (Array.isArray(variable.default)) {
          variable.options = (variable.default as string[]).map(item => ({
            value: item,
            label: item
          }));
        }
        
      }
      // Simple fallback: if it's an array type, convert to checkbox-list
      else if (variable.type === 'array') {
        variable.type = 'checkbox-list';
        
        // Generate options from available sources
        if (Array.isArray(variable.options)) {
          variable.options = (variable.options as string[]).map(item => ({
            value: item,
            label: item
          }));
        } else if (Array.isArray(variable.default)) {
        variable.options = (variable.default as string[]).map(item => ({
          value: item,
          label: item
        }));
        }
        
      }
      
      schema[key] = variable;
    }
  }
  return schema;
};

// Helper to recursively extract default values from a schema object
const extractDefaults = (schema: JSONObject): JSONObject => {
  const defaults: JSONObject = {};
  for (const key in schema) {
    const value = schema[key] as JSONObject;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.hasOwnProperty('default')) {
        defaults[key] = value.default;
      } else if (!value.hasOwnProperty('controls')) {
        // This is a nested group of parameters, not a parameter itself.
        // Don't recurse into 'controls' - those are conditional
        const nestedDefaults = extractDefaults(value);
        if (Object.keys(nestedDefaults).length > 0) {
          defaults[key] = nestedDefaults;
        }
      }
    }
  }
  return defaults;
};

export async function GET(request: NextRequest) {
  try {
    
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status'); // No default - show all by default
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query with filters
    let query = supabase
      .from('deployed_workflows')
      .select(`
        id,
        name,
        description,
        version,
        status,
        workflow_type,
        parent_workflow_id,
        display_order,
        category,
        estimated_duration_seconds,
        successful_runs,
        failed_runs,
        cancelled_runs,
        total_executions,
        automation_sequence,
        created_at,
        updated_at
      `)
      .eq('workflow_type', 'execution') // Only fetch execution workflows directly
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Only filter by status if explicitly provided
    if (status) {
      query = query.eq('status', status);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const { data: workflows, error } = await query;

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Fetch all settings workflows for the execution workflows we just fetched
    const workflowIds = (workflows || []).map(w => w.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let settingsWorkflows: any[] = [];
    
    if (workflowIds.length > 0) {
      const { data: settings, error: settingsError } = await supabase
        .from('deployed_workflows')
        .select(`
          id,
          name,
          description,
          version,
          status,
          workflow_type,
          parent_workflow_id,
          display_order,
          category,
          estimated_duration_seconds,
          successful_runs,
          failed_runs,
          cancelled_runs,
          total_executions,
          automation_sequence,
          created_at,
          updated_at
        `)
        .eq('workflow_type', 'settings')
        .in('parent_workflow_id', workflowIds)
        .order('display_order', { ascending: true });

      if (!settingsError) {
        settingsWorkflows = settings || [];
      }
    }

    // Helper function to process workflow schema (shared logic for all workflow types)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processWorkflowSchema = (workflow: any) => {
      let executionSchema: JSONObject = {};
      let sampleInputs: JSONObject = {};

      try {
        if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0) {
          // Analyze the automation sequence for conditional logic
          const { coreVariables, conditionalVariables } = analyzeAutomationSequence(workflow.automation_sequence);
          
          // Merge core and conditional variables into a hierarchical schema
          const hierarchicalSchema = { ...coreVariables, ...conditionalVariables };
          
          // Transform the schema for UI (convert enum to select, checkbox-list, etc.)
          executionSchema = transformVariablesToSchema(hierarchicalSchema, workflow.automation_sequence);
          
          // Extract default values from the hierarchical schema
          sampleInputs = extractDefaults(executionSchema);
        }
      } catch (e) {
        console.error(`Error parsing schema for workflow ${workflow.id}:`, e);
      }
      
      return {
        ...workflow,
        input_parameters: executionSchema, // The full schema
        sample_inputs: sampleInputs,       // The default values
      };
    };

    // Process settings workflows using the existing logic
    const processedSettingsWorkflows = settingsWorkflows.map(processWorkflowSchema);

    // Group processed settings workflows by parent_workflow_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingsByParent = processedSettingsWorkflows.reduce((acc: Record<number, any[]>, settings) => {
      const parentId = settings.parent_workflow_id;
      if (parentId && !acc[parentId]) {
        acc[parentId] = [];
      }
      if (parentId) {
        acc[parentId].push(settings);
      }
      return acc;
    }, {});

    // Get total count for pagination (only execution workflows)
    let countQuery = supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .eq('workflow_type', 'execution');

    // Apply same filters as main query
    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    if (category) {
      countQuery = countQuery.eq('category', category);
    }

    const { count: totalCount } = await countQuery;

    // Format execution workflows using the same processing function
    const formattedWorkflows = (workflows || []).map(workflow => ({
      ...processWorkflowSchema(workflow),
      settings_workflows: settingsByParent[workflow.id] || [], // Add nested settings workflows
    }));

    return NextResponse.json({
      success: true,
      workflows: formattedWorkflows,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit
      },
      filters: {
        category: category || 'all',
        status,
        applied_filters: {
          ...(category && { category }),
          status
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error listing workflows:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflows',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
