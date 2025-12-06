import { cacheResponse } from '@/lib/responseCache';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

type JSONValue =
  | string
  | number
  | boolean
  | { [x: string]: JSONValue }
  | Array<JSONValue>;
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
function extractStepsFromSequence(
  automationSequence: JSONValue[]
): JSONValue[] {
  const allSteps: JSONValue[] = [];

  if (
    !automationSequence ||
    !Array.isArray(automationSequence) ||
    automationSequence.length === 0
  ) {
    return allSteps;
  }

  const mainSequence = automationSequence[0] as JSONObject;
  if (!mainSequence?.arguments) return allSteps;

  const steps =
    ((mainSequence.arguments as JSONObject).steps as JSONValue[]) || [];

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

// Analyze automation sequence to identify conditional logic
function analyzeAutomationSequence(automationSequence: JSONValue[]) {
  if (
    !automationSequence ||
    !Array.isArray(automationSequence) ||
    automationSequence.length === 0
  ) {
    return { coreVariables: {}, conditionalVariables: {} };
  }

  const mainSequence = automationSequence[0] as JSONObject;
  if (
    !mainSequence?.arguments ||
    !(mainSequence.arguments as JSONObject)?.variables
  ) {
    return { coreVariables: {}, conditionalVariables: {} };
  }

  const allVariables = (mainSequence.arguments as JSONObject)
    .variables as Record<string, JSONValue>;
  const steps =
    ((mainSequence.arguments as JSONObject).steps as JSONValue[]) || [];

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
        controls: {},
      };

      // For each branch value, find variables used only in that branch
      Object.entries(conditionalBranches[varName]).forEach(
        ([branchValue, branchVars]) => {
          const branchSpecificVars: Record<string, JSONValue> = {};

          (branchVars as Set<string>).forEach(usedVar => {
            // Remove prefixes like "selectors." to get the base variable name
            const baseVarName = usedVar.split('.').pop() || usedVar;

            // Check if this variable exists in allVariables and is not used unconditionally
            Object.entries(allVariables).forEach(
              ([fullVarName, fullVarDef]) => {
                if (
                  fullVarName === baseVarName ||
                  fullVarName.endsWith(baseVarName)
                ) {
                  if (
                    !unconditionalVars.has(fullVarName) &&
                    !unconditionalVars.has(usedVar)
                  ) {
                    // Create branch-specific parameter name to avoid conflicts
                    const branchSpecificName = `${fullVarName}_${branchValue.toLowerCase().replace(/\s+/g, '_')}`;
                    branchSpecificVars[branchSpecificName] = {
                      ...(fullVarDef as Record<string, unknown>),
                      // Add metadata to track the original variable name
                      _originalName: fullVarName,
                      _branchValue: branchValue,
                    };
                  }
                }
              }
            );
          });

          if (Object.keys(branchSpecificVars).length > 0) {
            (
              conditionalVariables[varName] as unknown as {
                controls: Record<string, unknown>;
              }
            ).controls[branchValue] = branchSpecificVars;
          }
        }
      );
    } else if (!isVariableUsedInAnyBranch(varName, conditionalBranches)) {
      // This is a core variable (not used exclusively in branches)
      coreVariables[varName] = varDef;
    }
  });

  return { coreVariables, conditionalVariables };
}

// Helper to check if a variable is used in any conditional branch
function isVariableUsedInAnyBranch(
  varName: string,
  conditionalBranches: Record<string, Record<string, Set<string>>>
): boolean {
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
        // Format options for the Select component
        variable.options = (variable.options as string[]).map(opt => ({
          value: opt,
          label: opt,
        }));
      }
      // Convert detected checkbox arrays to checkbox-list
      else if (checkboxFields[key]) {
        variable.type = 'checkbox-list';

        // Use explicit options if available
        if (Array.isArray(variable.options)) {
          variable.options = (variable.options as string[]).map(item => ({
            value: item,
            label: item,
          }));
        }
        // Fallback: generate options from default values
        else if (Array.isArray(variable.default)) {
          variable.options = (variable.default as string[]).map(item => ({
            value: item,
            label: item,
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
            label: item,
          }));
        } else if (Array.isArray(variable.default)) {
          variable.options = (variable.default as string[]).map(item => ({
            value: item,
            label: item,
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
    // Import the new auth helper
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');

    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status'); // No default - show all by default
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const viewOrgId = searchParams.get('viewOrgId'); // Allow Mediar admins to specify org
    const versionParam = searchParams.get('version'); // 'latest' for desktop app
    const tagsParam = searchParams.get('tags'); // Comma-separated tags to filter by
    const filterTags = tagsParam
      ? tagsParam.split(',').map(t => t.trim().toLowerCase())
      : [];

    // Get effective organization context
    // Don't override orgId if viewing "All Orgs" - keep the user's actual org
    const {
      orgId,
      isMediarOrg,
      isMediarAdmin,
      actualOrgId: _actualOrgId,
    } = await getEffectiveOrgId(viewOrgId === 'ALL' ? null : viewOrgId);

    if (!orgId) {
      return NextResponse.json(
        {
          success: false,
          error: 'No organization context',
          workflows: [],
        },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, get workflow IDs this organization has access to
    let accessibleWorkflowIds: number[] = [];

    // Show all workflows if:
    // 1. Mediar admin explicitly selected "All Orgs" (viewOrgId === 'ALL')
    const showAllWorkflows = isMediarAdmin && viewOrgId === 'ALL';

    if (showAllWorkflows) {
      // Show all workflows from all organizations
      const { data: allWorkflows, error: allError } = await supabase
        .from('deployed_workflows')
        .select('id')
        .is('parent_workflow_id', null);

      if (allError) {
        console.error(
          '[Workflows List] Error fetching all workflows:',
          allError
        );
      }
      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
    } else {
      // Regular org sees:
      // 1. Workflows they own
      // 2. Workflows explicitly shared with them via workflow_organization_access
      // 3. Globally public workflows (is_public = true)

      // Get workflows owned by this org
      const { data: ownedWorkflows, error: ownedError } = await supabase
        .from('deployed_workflows')
        .select('id, organization_id')
        .eq('organization_id', orgId)
        .is('parent_workflow_id', null);

      if (ownedError) {
        console.error(
          '[Workflows List] Error fetching owned workflows:',
          ownedError
        );
      }

      // Get workflows explicitly shared with this org
      const { data: sharedAccess, error: sharedError } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id')
        .eq('organization_id', orgId);

      if (sharedError) {
        console.error(
          '[Workflows List] Error fetching shared workflows:',
          sharedError
        );
      }

      // Get globally public workflows (is_public = true)
      const { data: publicWorkflows, error: publicError } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('is_public', true)
        .is('parent_workflow_id', null);

      if (publicError) {
        console.error(
          '[Workflows List] Error fetching public workflows:',
          publicError
        );
      }

      const ownedIds = (ownedWorkflows || []).map(w => w.id);
      const sharedIds = (sharedAccess || []).map(a => a.workflow_id);
      const publicIds = (publicWorkflows || []).map(w => w.id);

      // Combine and deduplicate
      accessibleWorkflowIds = [
        ...new Set([...ownedIds, ...sharedIds, ...publicIds]),
      ];
    }

    if (accessibleWorkflowIds.length === 0 && !showAllWorkflows) {
      // No workflows accessible
      return NextResponse.json({
        success: true,
        workflows: [],
        pagination: {
          total: 0,
          limit,
          offset,
          has_more: false,
        },
        filters: {
          category: category || 'all',
          status,
          applied_filters: {
            ...(category && { category }),
            status,
          },
        },
        organization: {
          id: orgId,
          isMediar: isMediarOrg,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Build query with filters - using statistics summary view for version-specific stats
    // Desktop app (version=latest) uses latest version, web app uses active version
    // Only fetch workflows this org has access to
    const statsViewName =
      versionParam === 'latest'
        ? 'workflow_statistics_summary_latest' // Desktop: uses latest version by created_at
        : 'workflow_statistics_summary'; // Web: uses active version

    let query = supabase
      .from(statsViewName)
      .select(
        `
        id,
        name,
        description,
        current_version,
        status,
        category,
        overall_total_executions,
        overall_successful_runs,
        overall_failed_runs,
        overall_success_rate,
        current_version_total_executions,
        current_version_successful_runs,
        current_version_failed_runs,
        current_version_success_rate,
        current_version_avg_duration,
        total_versions,
        created_at,
        updated_at,
        last_activity_at,
        last_modified_at
      `
      )
      .in('id', accessibleWorkflowIds)
      .order('last_modified_at', { ascending: false })
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

    // Fetch automation sequences for the workflows (needed for input parameter detection)
    const workflowIds = (workflows || []).map(w => w.id);
    const automationSequences: Record<number, any> = {};
    const cronData: Record<number, any> = {};

    // Determine which view to use based on version parameter
    const viewName =
      versionParam === 'latest'
        ? 'deployed_workflows_with_sequence_latest'
        : 'deployed_workflows_with_sequence';

    if (versionParam === 'latest') {
      console.log('[API] Using LATEST view for desktop app');
    }

    if (workflowIds.length > 0) {
      // First, fetch cron data and other config directly from deployed_workflows table
      // (deployed_workflows_with_sequence view doesn't have all fields)
      const { data: cronWorkflows, error: cronError } = await supabase
        .from('deployed_workflows')
        .select(
          `
          id,
          organization_id,
          created_by,
          estimated_duration_seconds,
          cron_expression,
          cron_timezone,
          cron_enabled,
          last_scheduled_execution,
          next_scheduled_execution,
          cron_max_concurrent,
          cron_retry_on_failure,
          cron_retry_count,
          cron_auto_paused,
          auto_paused_at,
          auto_pause_reason,
          consecutive_failures,
          last_failure_message,
          preferred_format,
          typescript_metadata,
          tags
        `
        )
        .in('id', workflowIds);

      // Lookup user emails for author display
      // created_by can be either a user_id (e.g., user_2yyb...) or email (for legacy/deleted users)
      const userIdToEmail: Record<string, string> = {};
      if (!cronError && cronWorkflows) {
        const userIds = cronWorkflows
          .map(cw => cw.created_by)
          .filter((id): id is string => !!id && id.startsWith('user_'));

        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from('mediar_users')
            .select('user_id, email')
            .in('user_id', [...new Set(userIds)]);

          if (users) {
            users.forEach(u => {
              if (u.email) userIdToEmail[u.user_id] = u.email;
            });
          }
        }
      }

      if (!cronError && cronWorkflows) {
        console.log(
          '[API] Fetched cron data for',
          cronWorkflows.length,
          'workflows'
        );
        cronWorkflows.forEach(cw => {
          if (cw.cron_expression) {
            console.log(
              `[API] Workflow ${cw.id} has cron:`,
              cw.cron_expression,
              'enabled:',
              cw.cron_enabled
            );
          }
          // Resolve author email: if created_by is a user_id, look up email
          const authorEmail = cw.created_by?.startsWith('user_')
            ? userIdToEmail[cw.created_by] || cw.created_by
            : cw.created_by;
          cronData[cw.id] = {
            organization_id: cw.organization_id,
            created_by: authorEmail, // Store resolved email for display
            estimated_duration_seconds: cw.estimated_duration_seconds,
            cron_expression: cw.cron_expression,
            cron_timezone: cw.cron_timezone,
            cron_enabled: cw.cron_enabled,
            last_scheduled_execution: cw.last_scheduled_execution,
            next_scheduled_execution: cw.next_scheduled_execution,
            cron_max_concurrent: cw.cron_max_concurrent,
            cron_retry_on_failure: cw.cron_retry_on_failure,
            cron_retry_count: cw.cron_retry_count,
            cron_auto_paused: cw.cron_auto_paused,
            auto_paused_at: cw.auto_paused_at,
            auto_pause_reason: cw.auto_pause_reason,
            consecutive_failures: cw.consecutive_failures,
            last_failure_message: cw.last_failure_message,
            preferred_format: cw.preferred_format,
            typescript_metadata: cw.typescript_metadata,
            tags: cw.tags || [],
          };
        });
        console.log(
          '[API] Total workflows with cron data in cronData:',
          Object.keys(cronData).filter(
            id => cronData[parseInt(id)].cron_expression
          ).length
        );
        // Debug: log workflows with tags
        const workflowsWithTags = Object.entries(cronData).filter(
          ([_, data]: [string, any]) => data.tags && data.tags.length > 0
        );
        console.log(
          '[API] Workflows with tags in cronData:',
          workflowsWithTags.map(([id, data]: [string, any]) => ({
            id,
            tags: data.tags,
          }))
        );
      } else if (cronError) {
        console.error('[API] Error fetching cron data:', cronError);
      }

      // Then fetch automation sequences
      const { data: sequences, error: sequencesError } = await supabase
        .from(viewName)
        .select(
          `
          id,
          automation_sequence,
          workflow_type,
          parent_workflow_id,
          display_order,
          latest_version_number
        `
        )
        .in('id', workflowIds);

      console.log(
        '[API] Fetched automation sequences:',
        sequences?.length,
        'error:',
        sequencesError?.message
      );

      if (!sequencesError && sequences) {
        sequences.forEach(seq => {
          // Merge cron data with automation sequence data
          automationSequences[seq.id] = {
            ...seq,
            ...(cronData[seq.id] || {}),
          };
        });
        console.log(
          '[API] After merge, workflows with cron in automationSequences:',
          Object.keys(automationSequences).filter(
            id => automationSequences[parseInt(id)]?.cron_expression
          ).length
        );
        // Log specific workflows
        [71, 73, 74, 65, 313, 84].forEach(id => {
          if (automationSequences[id]) {
            console.log(
              `[API] Workflow ${id} cron after merge:`,
              automationSequences[id].cron_expression,
              'enabled:',
              automationSequences[id].cron_enabled
            );
          }
        });
      }
    }

    // Author names are now stored directly in deployed_workflows.created_by field
    // (stores email or user ID when workflow is created)

    // Fetch all settings workflows for the execution workflows we just fetched

    let settingsWorkflows: any[] = [];

    if (workflowIds.length > 0) {
      const { data: settings, error: settingsError } = await supabase
        .from(viewName) // Use the same view as for execution workflows
        .select(
          `
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
          cron_expression,
          cron_timezone,
          cron_enabled,
          last_scheduled_execution,
          next_scheduled_execution,
          cron_max_concurrent,
          cron_retry_on_failure,
          cron_retry_count,
          created_at,
          updated_at,
          organization_id
        `
        )
        .eq('workflow_type', 'settings')
        .in('parent_workflow_id', workflowIds)
        .order('display_order', { ascending: true });

      if (!settingsError) {
        settingsWorkflows = settings || [];
      }
    }

    // If Mediar org or Mediar admin, also fetch information about which orgs have access to each workflow
    const workflowAccessInfo: Record<number, string[]> = {};
    if ((isMediarOrg || isMediarAdmin) && workflowIds.length > 0) {
      const { data: accessData } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id, organization_id')
        .in('workflow_id', workflowIds);

      if (accessData) {
        accessData.forEach(access => {
          if (!workflowAccessInfo[access.workflow_id]) {
            workflowAccessInfo[access.workflow_id] = [];
          }
          workflowAccessInfo[access.workflow_id].push(access.organization_id);
        });
      }
    }

    // Helper function to process workflow schema (shared logic for all workflow types)

    const processWorkflowSchema = (workflow: any) => {
      let executionSchema: JSONObject = {};
      let sampleInputs: JSONObject = {};

      try {
        // Handle TypeScript workflows
        if (
          workflow.preferred_format === 'typescript' &&
          workflow.typescript_metadata?.inputs
        ) {
          // Transform TypeScript inputs to YAML parameter format
          const inputs = workflow.typescript_metadata.inputs;

          inputs.forEach((input: any) => {
            // Map TypeScript type to YAML type
            let yamlType = input.type;
            if (input.type === 'string') yamlType = 'text';

            const paramConfig: any = {
              type: yamlType,
              label:
                input.name.charAt(0).toUpperCase() +
                input.name
                  .slice(1)
                  .replace(/([A-Z])/g, ' $1')
                  .trim(),
              description: input.description,
              required: input.required,
              default: input.defaultValue,
            };

            // Add enum options if available
            if (input.enumOptions && input.enumOptions.length > 0) {
              paramConfig.options = input.enumOptions;
            }

            executionSchema[input.name] = paramConfig;

            // Set sample input from default value
            if (input.defaultValue !== undefined) {
              sampleInputs[input.name] = input.defaultValue;
            } else if (input.required) {
              sampleInputs[input.name] = '';
            }
          });
        } else if (
          workflow.automation_sequence &&
          Array.isArray(workflow.automation_sequence) &&
          workflow.automation_sequence.length > 0
        ) {
          // Handle YAML workflows
          // Analyze the automation sequence for conditional logic
          const { coreVariables, conditionalVariables } =
            analyzeAutomationSequence(workflow.automation_sequence);

          // Merge core and conditional variables into a hierarchical schema
          const hierarchicalSchema = {
            ...coreVariables,
            ...conditionalVariables,
          };

          // Transform the schema for UI (convert enum to select, checkbox-list, etc.)
          executionSchema = transformVariablesToSchema(
            hierarchicalSchema,
            workflow.automation_sequence
          );

          // Extract default values from the hierarchical schema
          sampleInputs = extractDefaults(executionSchema);
        }
      } catch (e) {
        console.error(`Error parsing schema for workflow ${workflow.id}:`, e);
      }

      return {
        ...workflow,
        input_parameters: executionSchema, // The full schema
        sample_inputs: sampleInputs, // The default values
      };
    };

    // Process settings workflows using the existing logic
    const processedSettingsWorkflows = settingsWorkflows.map(
      processWorkflowSchema
    );

    // Group processed settings workflows by parent_workflow_id

    const settingsByParent = processedSettingsWorkflows.reduce(
      (acc: Record<number, any[]>, settings) => {
        const parentId = settings.parent_workflow_id;
        if (parentId && !acc[parentId]) {
          acc[parentId] = [];
        }
        if (parentId) {
          acc[parentId].push(settings);
        }
        return acc;
      },
      {}
    );

    // Get total count for pagination (only accessible workflows)
    let countQuery = supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .in('id', accessibleWorkflowIds)
      .is('parent_workflow_id', null); // Only top-level workflows

    // Apply same filters as main query
    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    if (category) {
      countQuery = countQuery.eq('category', category);
    }

    const { count: totalCount } = await countQuery;

    // Format execution workflows, filtering out child workflows (those with parent_workflow_id)
    const formattedWorkflows = (workflows || [])
      .filter(workflow => {
        // Only include top-level workflows (those without a parent)
        const parentId = automationSequences[workflow.id]?.parent_workflow_id;
        return !parentId; // Include only if no parent_workflow_id
      })
      .map(workflow => {
        // Merge automation sequence and other missing fields
        const workflowWithSequence = {
          ...workflow,
          // Map new field names to expected names for backward compatibility
          version: workflow.current_version,
          successful_runs: workflow.overall_successful_runs,
          failed_runs: workflow.overall_failed_runs,
          total_executions: workflow.overall_total_executions,
          // Add config fields
          estimated_duration_seconds:
            automationSequences[workflow.id]?.estimated_duration_seconds,
          // Add automation sequence from separate query
          automation_sequence:
            automationSequences[workflow.id]?.automation_sequence,
          workflow_type:
            automationSequences[workflow.id]?.workflow_type || 'execution',
          parent_workflow_id:
            automationSequences[workflow.id]?.parent_workflow_id,
          display_order: automationSequences[workflow.id]?.display_order || 0,
          organization_id: automationSequences[workflow.id]?.organization_id,
          author_name: automationSequences[workflow.id]?.created_by || null,
          // Add cron scheduling fields
          cron_expression: automationSequences[workflow.id]?.cron_expression,
          cron_timezone: automationSequences[workflow.id]?.cron_timezone,
          cron_enabled: automationSequences[workflow.id]?.cron_enabled,
          last_scheduled_execution:
            automationSequences[workflow.id]?.last_scheduled_execution,
          next_scheduled_execution:
            automationSequences[workflow.id]?.next_scheduled_execution,
          cron_max_concurrent:
            automationSequences[workflow.id]?.cron_max_concurrent,
          cron_retry_on_failure:
            automationSequences[workflow.id]?.cron_retry_on_failure,
          cron_retry_count: automationSequences[workflow.id]?.cron_retry_count,
          // Add auto-pause fields
          cron_auto_paused: automationSequences[workflow.id]?.cron_auto_paused,
          auto_paused_at: automationSequences[workflow.id]?.auto_paused_at,
          auto_pause_reason:
            automationSequences[workflow.id]?.auto_pause_reason,
          consecutive_failures:
            automationSequences[workflow.id]?.consecutive_failures,
          last_failure_message:
            automationSequences[workflow.id]?.last_failure_message,
          // Add TypeScript workflow fields
          preferred_format: automationSequences[workflow.id]?.preferred_format,
          typescript_metadata:
            automationSequences[workflow.id]?.typescript_metadata,
          // Add version-specific statistics as additional fields
          current_version_stats: {
            successful_runs: workflow.current_version_successful_runs,
            failed_runs: workflow.current_version_failed_runs,
            total_executions: workflow.current_version_total_executions,
            success_rate: workflow.current_version_success_rate,
            average_duration_seconds: workflow.current_version_avg_duration,
          },
          overall_stats: {
            successful_runs: workflow.overall_successful_runs,
            failed_runs: workflow.overall_failed_runs,
            total_executions: workflow.overall_total_executions,
            success_rate: workflow.overall_success_rate,
          },
          version_info: {
            current_version: workflow.current_version,
            total_versions: workflow.total_versions,
            // Latest version by created_at (from _latest view when version=latest param is used)
            latest_version:
              automationSequences[workflow.id]?.latest_version_number ||
              workflow.current_version,
          },
          // Add tags for filtering
          tags: automationSequences[workflow.id]?.tags || [],
          // Add access info for Mediar admins
          ...((isMediarOrg || isMediarAdmin) && {
            shared_with_orgs: workflowAccessInfo[workflow.id] || [],
          }),
        };

        return {
          ...processWorkflowSchema(workflowWithSequence),
          settings_workflows: settingsByParent[workflow.id] || [], // Add nested settings workflows
        };
      });

    // Filter by tags if provided
    const filteredWorkflows =
      filterTags.length > 0
        ? formattedWorkflows.filter(w => {
            const workflowTags = (w.tags || []).map((t: string) =>
              t.toLowerCase()
            );
            return filterTags.some(tag => workflowTags.includes(tag));
          })
        : formattedWorkflows;

    const responseData = {
      success: true,
      workflows: filteredWorkflows,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit,
      },
      filters: {
        category: category || 'all',
        status,
        tags: filterTags,
        applied_filters: {
          ...(category && { category }),
          status,
          ...(filterTags.length > 0 && { tags: filterTags }),
        },
      },
      organization: {
        id: orgId,
        isMediar: isMediarOrg,
      },
      timestamp: new Date().toISOString(),
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/list',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: {
        category: category || null,
        status: status || null,
        limit,
        offset,
      },
      executionTimeMs: 50, // placeholder
    });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('[ERROR] Error listing workflows:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflows',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
