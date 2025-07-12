import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type JSONValue = string | number | boolean | { [x: string]: JSONValue } | Array<JSONValue>;
type JSONObject = { [x: string]: JSONValue };

// Helper function to extract variables from a step's arguments
function extractVariablesFromStep(step: any, variables: Set<string>) {
  if (!step || !step.arguments) return;
  
  const extractFromValue = (value: any): void => {
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

// Analyze automation sequence to identify conditional logic
function analyzeAutomationSequence(automationSequence: any[]) {
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
  const conditionalBranches: Record<string, any> = {};
  
  // Process each step
  steps.forEach((step: any) => {
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
          step.steps.forEach((subStep: any) => {
            extractVariablesFromStep(subStep, branchVars);
          });
        }
        
        conditionalBranches[controlVar][value] = branchVars;
      }
    } else if (step.steps && Array.isArray(step.steps)) {
      // Unconditional group
      step.steps.forEach((subStep: any) => {
        extractVariablesFromStep(subStep, unconditionalVars);
      });
    } else {
      // Single unconditional step
      extractVariablesFromStep(step, unconditionalVars);
    }
  });
  
  // Build the hierarchical schema
  const coreVariables: Record<string, any> = {};
  const conditionalVariables: Record<string, any> = {};
  
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
        const branchSpecificVars: Record<string, any> = {};
        
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
          conditionalVariables[varName].controls[branchValue] = branchSpecificVars;
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
function isVariableUsedInAnyBranch(varName: string, conditionalBranches: Record<string, any>): boolean {
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
const transformVariablesToSchema = (variables: JSONObject): JSONObject => {
  const schema: JSONObject = {};
  for (const key in variables) {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const variable = { ...(variables[key] as JSONObject) };

      // Convert "enum" to "select" for the UI component
      if (variable.type === 'enum' && Array.isArray(variable.options)) {
        variable.type = 'select';
        // Format options for the Select component
        variable.options = (variable.options as string[]).map(opt => ({ value: opt, label: opt }));
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
    console.log('⚡ Fast workflow list from Vercel...');
    
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status') || 'active';
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
        category,
        tags,
        difficulty_level,
        estimated_duration_seconds,
        successful_runs,
        failed_runs,
        total_executions,
        deployment_status,
        automation_sequence,
        created_at,
        updated_at
      `)
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq('category', category);
    }

    const { data: workflows, error } = await query;

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .eq('status', status);

    // Format workflows with computed fields
    const formattedWorkflows = (workflows || []).map(workflow => {
      let executionSchema: JSONObject = {};
      let sampleInputs: JSONObject = {};

      try {
        if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0) {
          // Analyze the automation sequence for conditional logic
          const { coreVariables, conditionalVariables } = analyzeAutomationSequence(workflow.automation_sequence);
          
          // Merge core and conditional variables into a hierarchical schema
          const hierarchicalSchema = { ...coreVariables, ...conditionalVariables };
          
          // Transform the schema for UI (convert enum to select, etc.)
          executionSchema = transformVariablesToSchema(hierarchicalSchema);
          
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
    });

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
