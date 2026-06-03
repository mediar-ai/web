import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

// Import the required types
type JSONValue =
  | string
  | number
  | boolean
  | { [x: string]: JSONValue }
  | Array<JSONValue>
  | null;
type JSONObject = { [x: string]: JSONValue };

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
  // YAML format fields (top-level)
  variables?: Record<string, WorkflowVariable>;
  steps?: WorkflowStep[];
  selectors?: Record<string, string>;
  output?: { run?: string };
  troubleshooting?: WorkflowStep[];
  // Legacy MCP format (nested under arguments)
  arguments?: {
    variables?: Record<string, WorkflowVariable>;
    steps?: WorkflowStep[];
    output_parser?: {
      fieldsToExtract?: Record<string, unknown>;
    };
  };
}

// Helper to extract default values from hierarchical schema
function extractDefaultsFromHierarchical(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const key in schema) {
    const value = schema[key] as Record<string, unknown>;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.hasOwnProperty('default')) {
        defaults[key] = value.default;
      }
      // Don't recurse into 'controls' - those are conditional
      if (!value.hasOwnProperty('controls')) {
        const nestedDefaults = extractDefaultsFromHierarchical(
          value as Record<string, unknown>
        );
        if (Object.keys(nestedDefaults).length > 0) {
          defaults[key] = nestedDefaults;
        }
      }
    }
  }
  return defaults;
}

// Helper function to extract steps from nested automation sequence
function extractStepsFromSequence(
  automationSequence: JSONValue[]
): JSONValue[] {
  const allSteps: JSONValue[] = [];

  function collectSteps(items: JSONValue[]) {
    items.forEach(item => {
      const obj = item as JSONObject;
      if (obj.steps && Array.isArray(obj.steps)) {
        allSteps.push(...obj.steps);
        collectSteps(obj.steps);
      } else {
        allSteps.push(item);
      }
    });
  }

  collectSteps(automationSequence);
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
    if (
      variable.type === 'array' &&
      Array.isArray(variable.default) &&
      variable.default.length > 0
    ) {
      // Check for automation sequence patterns to confirm checkbox behavior
      const hasCheckboxPatterns = allSteps.some(stepValue => {
        const step = stepValue as JSONObject;

        // Pattern A: set_toggled with contains()
        if (
          step.tool_name === 'set_toggled' &&
          step.arguments &&
          typeof (step.arguments as JSONObject).state === 'string' &&
          ((step.arguments as JSONObject).state as string).includes(
            `contains(${varName},`
          )
        ) {
          return true;
        }

        // Pattern B: Conditional groups with contains() or !contains()
        if (
          step.if &&
          typeof step.if === 'string' &&
          (step.if.includes(`contains(${varName},`) ||
            step.if.includes(`!contains(${varName},`))
        ) {
          return true;
        }

        // Pattern C: Group names that suggest checkbox behavior
        if (
          step.group_name &&
          typeof step.group_name === 'string' &&
          step.if &&
          typeof step.if === 'string' &&
          (step.if.includes(`contains(${varName},`) ||
            step.if.includes(`!contains(${varName},`))
        ) {
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

// Helper to recursively transform variables into a UI-friendly schema
const transformVariablesToSchema = (
  variables: JSONObject,
  automationSequence: JSONValue[] = []
): JSONObject => {
  const schema: JSONObject = {};
  const checkboxFields = detectCheckboxListFields(
    variables,
    automationSequence
  );

  for (const key in variables) {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const variable = { ...(variables[key] as JSONObject) };

      // Convert "enum" to "select" for the UI component
      if (variable.type === 'enum' && Array.isArray(variable.options)) {
        variable.type = 'select';
      }
      // Convert detected checkbox arrays to checkbox-list
      else if (checkboxFields[key]) {
        variable.type = 'checkbox-list';

        // Use explicit options if available
        if (Array.isArray(variable.options)) {
          // Deduplicate options to avoid key conflicts
          const uniqueOptions = [...new Set(variable.options as string[])];
          variable.options = uniqueOptions.map(item => ({
            value: item,
            label: item,
          }));
        }
        // Fallback: generate options from default values
        else if (Array.isArray(variable.default)) {
          // Deduplicate options to avoid key conflicts
          const uniqueDefaults = [...new Set(variable.default as string[])];
          variable.options = uniqueDefaults.map(item => ({
            value: item,
            label: item,
          }));
        }
      }
      // Simple fallback: if it's an array type WITHOUT item_schema, convert to checkbox-list
      else if (variable.type === 'array' && !variable.item_schema) {
        variable.type = 'checkbox-list';

        // Generate options from available sources
        if (Array.isArray(variable.options)) {
          // Deduplicate options to avoid key conflicts
          const uniqueOptions = [...new Set(variable.options as string[])];
          variable.options = uniqueOptions.map(item => ({
            value: item,
            label: item,
          }));
        } else if (Array.isArray(variable.default)) {
          // Deduplicate options to avoid key conflicts
          const uniqueDefaults = [...new Set(variable.default as string[])];
          variable.options = uniqueDefaults.map(item => ({
            value: item,
            label: item,
          }));
        }
      }

      // Handle nested schemas for object and array types
      if (variable.type === 'object' && variable.value_schema) {
        const valueSchema = variable.value_schema as JSONObject;

        // If value_schema is enum, convert to select and pass through for UI
        if (valueSchema.type === 'enum' && Array.isArray(valueSchema.options)) {
          variable.value_type = 'select'; // Store for UI to detect
          variable.value_options = valueSchema.options; // Pass through enum options
        }

        // Recursively transform value_schema
        variable.value_schema = transformVariablesToSchema({ temp: valueSchema }, automationSequence).temp;
      }

      if (variable.type === 'object' && variable.properties) {
        // Recursively transform nested properties
        variable.properties = transformVariablesToSchema(variable.properties as JSONObject, automationSequence);
      }

      if (variable.type === 'array' && variable.item_schema) {
        // Recursively transform item_schema
        const itemSchema = variable.item_schema as JSONObject;
        variable.item_schema = transformVariablesToSchema({ temp: itemSchema }, automationSequence).temp;
      }

      schema[key] = variable;
    }
  }
  return schema;
};

// Helper to filter out internal/technical parameters that API users don't need to see
function filterInternalParameters(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const internalParams = ['quote_parser', 'url']; // Parameters to exclude from API documentation
  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!internalParams.includes(key)) {
      filtered[key] = value;
    }
  }

  console.log(
    `[CLEAN] Filtered out ${Object.keys(schema).length - Object.keys(filtered).length} internal parameters: ${internalParams.filter(param => param in schema).join(', ')}`
  );
  return filtered;
}

// Helper to convert conditional branch-specific parameters back to original parameter names
// This ensures the API documentation shows what users should actually send to the execute endpoint
function convertToApiParameterNames(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const apiSchema: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const param = value as Record<string, unknown>;

      // Check if this is a controlling parameter with conditional branches
      if (param.controls) {
        // This is a controlling parameter - keep it as is
        apiSchema[key] = param;

        // Process the conditional branches to extract original parameter names
        const controls = param.controls as Record<
          string,
          Record<string, unknown>
        >;
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
                description:
                  `${branchParam.description || ''} (Available when ${key} matches specific values)`.trim(),
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
function extractValidationRules(
  schema: Record<string, unknown>
): Record<string, unknown> {
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
        paramRules.branches = Object.keys(
          value.controls as Record<string, unknown>
        );
      }

      if (Object.keys(paramRules).length > 0) {
        rules[key] = paramRules;
      }
    }
  }

  return rules;
}

// Helper to check if parameter is internal/system parameter
function isInternalParameter(key: string): boolean {
  const internalParams = [
    'url',
    'selectors',
    'output_parser',
    'quote_parser',
    'products_parser',
    'steps',
  ];

  return (
    internalParams.includes(key) ||
    key.endsWith('_parser') ||
    key.startsWith('_')
  );
}

// Analyze automation sequence to extract variables
function analyzeAutomationSequence(sequences: AutomationSequence[]): {
  coreVariables: Record<string, WorkflowVariable>;
  conditionalVariables: Record<string, WorkflowVariable>;
} {
  const coreVariables: Record<string, WorkflowVariable> = {};
  const conditionalVariables: Record<string, WorkflowVariable> = {};

  for (const sequence of sequences) {
    if (sequence.variables) {
      // Core variables from the YAML format (top-level variables)
      Object.entries(sequence.variables).forEach(
        ([key, variable]) => {
          if (!isInternalParameter(key)) {
            coreVariables[key] = variable;
          }
        }
      );
    }

    // Analyze conditional steps for additional variables (YAML format: top-level steps)
    if (sequence.steps) {
      analyzeStepsForVariables(sequence.steps, conditionalVariables);
    }
  }

  return { coreVariables, conditionalVariables };
}

// Recursively analyze steps for conditional variables
function analyzeStepsForVariables(
  steps: WorkflowStep[],
  conditionalVars: Record<string, WorkflowVariable>
): void {
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to workflow schema');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Check for version parameter in query string
    const { searchParams } = new URL(request.url);
    const versionNumber = searchParams.get('version');
    const useLocalFile = searchParams.get('local') === 'true';

    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    console.log(
      `📋 Generating dynamic schema for workflow ${workflowIdNum}${versionNumber ? ` version ${versionNumber}` : ' (active version)'}${useLocalFile ? ' (LOCAL FILE MODE)' : ''}...`
    );

    let workflow;

    // LOCAL FILE MODE: Read from local YAML file for testing
    if (useLocalFile) {
      console.log('🔧 [LOCAL MODE] Reading workflow from local file system...');
      const fs = await import('fs/promises');
      const yaml = await import('js-yaml');

      const localYamlPath = 'C:\\Users\\screenpipe-windows\\workflows\\sample_workflow_1\\terminator.yaml';

      try {
        const yamlContent = await fs.readFile(localYamlPath, 'utf-8');
        const parsedYaml = yaml.load(yamlContent);

        console.log('✅ [LOCAL MODE] Successfully read local YAML file');

        // Create a mock workflow object with the YAML data
        workflow = {
          id: workflowIdNum,
          name: 'Local Test Workflow (sample_workflow_1)',
          description: 'Testing value_schema with local YAML file',
          version: 999,
          status: 'deployed',
          estimated_duration_seconds: 0,
          automation_sequence: [parsedYaml],
          automation_sequence_yaml: yamlContent,
        };
      } catch (error) {
        console.error('❌ [LOCAL MODE] Failed to read local file:', error);
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to read local YAML file',
            details: error instanceof Error ? error.message : String(error),
            path: localYamlPath,
          },
          { status: 500 }
        );
      }
    } else if (versionNumber && versionNumber !== 'active') {
      // Fetch specific version from deployed_workflow_versions
      const { data: versionData, error: versionError } = await supabase
        .from('deployed_workflow_versions')
        .select(
          'automation_sequence, automation_sequence_yaml, preferred_format, version_number, workflow_id, typescript_metadata'
        )
        .eq('workflow_id', workflowIdNum)
        .eq('version_number', versionNumber)
        .single();

      if (versionError || !versionData) {
        return NextResponse.json(
          {
            success: false,
            error: `Version ${versionNumber} not found for workflow ${workflowIdNum}`,
            timestamp: new Date().toISOString(),
          },
          { status: 404 }
        );
      }

      // STEP 2: Get basic workflow info with ownership data (including typescript_metadata for fallback)
      const { data: workflowInfo, error: workflowInfoError } = await supabase
        .from('deployed_workflows')
        .select('id, name, description, status, estimated_duration_seconds, created_by, organization_id, typescript_metadata, preferred_format')
        .eq('id', workflowIdNum)
        .single();

      if (workflowInfoError || !workflowInfo) {
        return NextResponse.json(
          {
            success: false,
            error: `Workflow ${workflowIdNum} not found`,
            timestamp: new Date().toISOString(),
          },
          { status: 404 }
        );
      }

      // Import auth helper to check for Mediar org/admin status
      const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
      const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

      // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
      const isOwner = workflowInfo.created_by === authenticatedUserId;
      const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
      const isSameOrg = workflowInfo.organization_id && workflowInfo.organization_id === orgId;

      // Check workflow_organization_access table for organization-based access
    // Allow ANY member of an organization with access (not just admins)
      let hasOrgAccess = false;
      if (orgId) {
        const { data: orgAccess } = await supabase
          .from('workflow_organization_access')
          .select('organization_id')
          .eq('workflow_id', workflowIdNum)
          .eq('organization_id', orgId)
          .single();

        hasOrgAccess = !!orgAccess;
      }

      // Allow access if:
      // - User is in Mediar org or is a Mediar admin (can view any workflow schema)
      // - User is the workflow owner
      // - User is org admin in the same org (legacy organization_id field)
      // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
      if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
        console.warn(
          `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized read of workflow ${workflowIdNum} schema`
        );
        return NextResponse.json(
          { error: 'Forbidden - You do not have access to this workflow' },
          { status: 403 }
        );
      }

      // Parse automation sequence based on preferred format
      let automationSequence;
      try {
        if (
          versionData.preferred_format === 'yaml' &&
          versionData.automation_sequence_yaml
        ) {
          const yaml = await import('js-yaml');
          automationSequence = yaml.load(versionData.automation_sequence_yaml);
        } else {
          automationSequence = versionData.automation_sequence;
        }
      } catch (parseError) {
        console.error('[ERROR] Error parsing automation sequence:', parseError);
        return NextResponse.json(
          { success: false, error: 'Failed to parse automation sequence' },
          { status: 500 }
        );
      }

      // Combine data to match expected format
      // Fallback to main workflow's typescript_metadata if version doesn't have it
      workflow = {
        ...workflowInfo,
        version: versionData.version_number,
        automation_sequence: Array.isArray(automationSequence)
          ? automationSequence
          : [automationSequence],
        automation_sequence_yaml: versionData.automation_sequence_yaml,
        preferred_format: versionData.preferred_format || workflowInfo.preferred_format,
        typescript_metadata: versionData.typescript_metadata || workflowInfo.typescript_metadata,
      };
    } else {
      // STEP 2: Fetch workflow data with active version (need ownership data from main table)
      // First get ownership data from deployed_workflows
      const { data: workflowOwnership, error: ownershipError } = await supabase
        .from('deployed_workflows')
        .select('id, name, created_by, organization_id')
        .eq('id', workflowIdNum)
        .single();

      if (ownershipError || !workflowOwnership) {
        return NextResponse.json(
          {
            success: false,
            error: `Workflow ${workflowIdNum} not found`,
            timestamp: new Date().toISOString(),
          },
          { status: 404 }
        );
      }

      // Import auth helper to check for Mediar org/admin status
      const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
      const { isMediarOrg: isMediarOrgElse, isMediarAdmin: isMediarAdminElse } = await getEffectiveOrgId(null);

      // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
      const isOwner = workflowOwnership.created_by === authenticatedUserId;
      const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
      const isSameOrg = workflowOwnership.organization_id && workflowOwnership.organization_id === orgId;

      // Check workflow_organization_access table for organization-based access
    // Allow ANY member of an organization with access (not just admins)
      let hasOrgAccess = false;
      if (orgId) {
        const { data: orgAccess } = await supabase
          .from('workflow_organization_access')
          .select('organization_id')
          .eq('workflow_id', workflowIdNum)
          .eq('organization_id', orgId)
          .single();

        hasOrgAccess = !!orgAccess;
      }

      // Allow access if:
      // - User is in Mediar org or is a Mediar admin (can view any workflow schema)
      // - User is the workflow owner
      // - User is org admin in the same org (legacy organization_id field)
      // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
      if (!isMediarOrgElse && !isMediarAdminElse && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
        console.warn(
          `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized read of workflow ${workflowIdNum} schema`
        );
        return NextResponse.json(
          { error: 'Forbidden - You do not have access to this workflow' },
          { status: 403 }
        );
      }

      // Now fetch the actual workflow data with sequence
      const { data: activeWorkflow, error: workflowError } = await supabase
        .from('deployed_workflows_with_sequence')
        .select(
          'id, name, description, version, status, automation_sequence, automation_sequence_yaml, estimated_duration_seconds, preferred_format, typescript_metadata'
        )
        .eq('id', workflowIdNum)
        .single();

      if (workflowError || !activeWorkflow) {
        return NextResponse.json(
          {
            success: false,
            error: `Workflow ${workflowIdNum} not found`,
            timestamp: new Date().toISOString(),
          },
          { status: 404 }
        );
      }

      workflow = activeWorkflow;
    }

    let inputParameters = {};
    let sampleRequest = {};
    let validationRules = {};
    let expectedOutputs = {};

    try {
      // Handle TypeScript workflows
      if (workflow.preferred_format === 'typescript' && workflow.typescript_metadata?.inputs) {
        console.log(
          `🔍 Processing TypeScript workflow ${workflowIdNum} (version: ${workflow.version || 'active'})...`
        );
        console.log(
          `📊 Found ${workflow.typescript_metadata.inputs.length} TypeScript inputs`
        );

        const inputs = workflow.typescript_metadata.inputs;

        inputs.forEach((input: any) => {
          // Map TypeScript type to YAML type
          let yamlType = input.type;
          if (input.type === 'string') yamlType = 'text';

          const paramConfig: any = {
            type: yamlType,
            label: input.name.charAt(0).toUpperCase() +
                   input.name.slice(1).replace(/([A-Z])/g, ' $1').trim(),
            description: input.description,
            required: input.required,
            default: input.defaultValue,
          };

          // Add enum options if available
          if (input.enumOptions && input.enumOptions.length > 0) {
            paramConfig.options = input.enumOptions;
          }

          (inputParameters as any)[input.name] = paramConfig;

          // Set sample input from default value
          if (input.defaultValue !== undefined) {
            (sampleRequest as any)[input.name] = input.defaultValue;
          } else if (input.required) {
            (sampleRequest as any)[input.name] = '';
          }
        });

        console.log(
          `✅ Processed ${inputs.length} TypeScript input parameters`
        );
      } else if (workflow.preferred_format === 'typescript') {
        console.warn(
          `⚠️ TypeScript workflow ${workflowIdNum} has no typescript_metadata or inputs`
        );
      } else {
        // Handle YAML workflows
        // Handle both object and array formats for automation_sequence
        let automationSequenceArray;
        if (workflow.automation_sequence) {
          if (Array.isArray(workflow.automation_sequence)) {
            automationSequenceArray = workflow.automation_sequence;
          } else if (typeof workflow.automation_sequence === 'object') {
            // Convert single object to array
            automationSequenceArray = [workflow.automation_sequence];
          }
        }

        if (automationSequenceArray && automationSequenceArray.length > 0) {
        console.log(
          `🔍 Analyzing automation sequence for workflow ${workflowIdNum}...`
        );

        // Analyze the automation sequence for conditional logic
        const { coreVariables, conditionalVariables } =
          analyzeAutomationSequence(automationSequenceArray);

        // Merge core and conditional variables into a hierarchical schema
        const mergedSchema = { ...coreVariables, ...conditionalVariables };

        // Transform the schema for UI (convert enum to select, array to checkbox-list, etc.)
        const transformedSchema = transformVariablesToSchema(
          mergedSchema as unknown as JSONObject,
          automationSequenceArray
        );

        // Filter out internal/technical parameters from the public API documentation
        const filteredSchema = filterInternalParameters(transformedSchema);

        // Convert conditional branch-specific parameters back to original parameter names for API docs
        // This ensures docs show what users should actually send to the execute endpoint
        const apiReadySchema = convertToApiParameterNames(filteredSchema);
        inputParameters = apiReadySchema;

        // Extract sample values from the API-ready schema
        sampleRequest = extractDefaultsFromHierarchical(apiReadySchema);

        // Extract validation rules from the API-ready schema
        validationRules = extractValidationRules(apiReadySchema);

        // Extract expected outputs (legacy UI parser only)
        const mainSequence = automationSequenceArray[0];
        if (
          mainSequence.arguments &&
          mainSequence.arguments.output_parser &&
          mainSequence.arguments.output_parser.fieldsToExtract
        ) {
          expectedOutputs = Object.keys(
            mainSequence.arguments.output_parser.fieldsToExtract
          ).reduce(
            (acc, key) => {
              acc[key] = 'dynamically extracted';
              return acc;
            },
            {} as Record<string, string>
          );
        }

        // NEW: If YAML defines arguments.mediar_parser.schema, expose enrichment controls pre-execution
        try {
          const mediarParserCfg = mainSequence?.arguments?.mediar_parser;
          const hasMediarSchema = !!(mediarParserCfg && mediarParserCfg.schema);
          if (hasMediarSchema) {
            // Inject FLAT enrichment controls so the UI renders each field (no nested object at top level)
            const enrichmentControlsFlat: Record<string, unknown> = {
              // Allow overriding schema at runtime (preferred: mediar_parser.schema)
              'mediar_parser.schema': {
                type: 'string',
                label: 'Schema (JSON)',
                description:
                  'Paste a JSON Schema for the structured output. If empty, the workflow default (arguments.mediar_parser.schema) is used.',
                default: '',
              },
            };

            // Merge into API-ready schema so it renders in the pre-execution form
            inputParameters = { ...inputParameters, ...enrichmentControlsFlat };

            // Pre-fill the schema editor with the YAML's default schema (pretty-printed)
            try {
              const pretty = JSON.stringify(mediarParserCfg.schema, null, 2);
              // Put as default of the field so UI pre-fills the editor
              const fieldKey = 'mediar_parser.schema';
              const ip = inputParameters as Record<string, any>;
              if (ip[fieldKey] && typeof ip[fieldKey] === 'object') {
                ip[fieldKey].default = pretty;
              }
              // Also expose in sample inputs for API docs completeness
              (sampleRequest as Record<string, unknown>) = {
                ...(sampleRequest as Record<string, unknown>),
                mediar_parser: { schema: pretty },
              };
            } catch {
              // ignore formatting errors; leave editor empty
            }
          }
        } catch (e) {
          console.warn(
            '[WARN] Failed to inject mediar_parser enrichment controls into schema:',
            e
          );
        }

        console.log(
          `[SUCCESS] Successfully analyzed schema: ${Object.keys(inputParameters).length} parameters found`
        );
        } else {
          console.log(
            `[WARN]  No automation sequence found for workflow ${workflowIdNum}`
          );
        }
      }
    } catch (e) {
      console.error(
        `[ERROR] Error analyzing schema for workflow ${workflowIdNum}:`,
        e
      );
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
        estimated_duration_seconds: workflow.estimated_duration_seconds,
      },
      automation_sequence: workflow.automation_sequence,
      automation_sequence_yaml: workflow.automation_sequence_yaml || null,
      schema: {
        input_parameters: inputParameters,
        sample_request: sampleRequest,
        validation_rules: validationRules,
        expected_outputs: expectedOutputs,
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
}).then(response => response.json())`,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        parameter_count: Object.keys(inputParameters).length,
        has_conditional_logic: Object.values(inputParameters).some(
          param => param && typeof param === 'object' && 'controls' in param
        ),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[ERROR] Error generating workflow schema:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate workflow schema',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
