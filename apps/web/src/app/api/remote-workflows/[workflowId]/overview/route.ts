import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

export const dynamic = 'force-dynamic';

type JSONValue =
  | string
  | number
  | boolean
  | { [x: string]: JSONValue }
  | Array<JSONValue>
  | null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type JSONObject = { [x: string]: JSONValue };

// Define types for workflow components
interface WorkflowStep {
  group_name?: string;
  if?: string;
  steps?: WorkflowStep[];
  arguments?: Record<string, unknown>;
}

interface WorkflowVariable {
  type?: string;
  label?: string;
  description?: string;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
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

// Analyze automation sequence to identify conditional logic
function analyzeAutomationSequence(automationSequence: AutomationSequence[]) {
  if (
    !automationSequence ||
    !Array.isArray(automationSequence) ||
    automationSequence.length === 0
  ) {
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
  const conditionalVariables: Record<
    string,
    WorkflowVariable & {
      controls?: Record<string, Record<string, WorkflowVariable>>;
    }
  > = {};

  // Process all variables
  Object.entries(allVariables).forEach(([varName, varDef]) => {
    // Check if this variable is a controlling variable
    if (conditionalBranches[varName]) {
      // This is a controlling variable
      conditionalVariables[varName] = {
        ...varDef,
        controls: {},
      };

      // For each branch value, find variables used only in that branch
      Object.entries(conditionalBranches[varName]).forEach(
        ([branchValue, branchVars]) => {
          const branchSpecificVars: Record<string, unknown> = {};

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
                      ...fullVarDef,
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  // STEP 1: Authenticate
  const { userId: authenticatedUserId, has, orgId } = await auth();

  if (!authenticatedUserId) {
    console.warn('[SECURITY] Unauthenticated request to workflow overview');
    return NextResponse.json(
      { error: 'Unauthorized - Authentication required' },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Supabase environment variables are not set.' },
      { status: 500 }
    );
  }

  const { workflowId } = await params;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Resolve workflow ID (supports both numeric ID and UUID)
  const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

  if (resolveError || workflowIdNum === null) {
    return NextResponse.json(
      { success: false, error: resolveError || `Workflow ${workflowId} not found` },
      { status: 404 }
    );
  }

  const { data: workflow, error } = await supabase
    .from('workflow_statistics_summary')
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
      updated_at
    `
    )
    .eq('id', workflowId)
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  if (!workflow) {
    return NextResponse.json(
      { success: false, error: 'Workflow not found' },
      { status: 404 }
    );
  }

  // STEP 2: Get workflow ownership data and verify authorization
  const { data: workflowOwnership, error: ownershipError } = await supabase
    .from('deployed_workflows')
    .select(
      'id, name, created_by, organization_id, automation_sequence, preferred_format, typescript_metadata, github_folder, tags'
    )
    .eq('id', workflowId)
    .single();

  if (ownershipError || !workflowOwnership) {
    return NextResponse.json(
      { success: false, error: 'Workflow not found' },
      { status: 404 }
    );
  }

  // Import auth helper to check for Mediar org/admin status
  const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
  const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

  // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
  const isOwner = workflowOwnership.created_by === authenticatedUserId;
  const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
  const isSameOrg =
    workflowOwnership.organization_id &&
    workflowOwnership.organization_id === orgId;

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
  // - User is in Mediar org or is a Mediar admin (can view any workflow)
  // - User is the workflow owner
  // - User is org admin in the same org (legacy organization_id field)
  // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
  if (
    !isMediarOrg &&
    !isMediarAdmin &&
    !isOwner &&
    !(isOrgAdmin && isSameOrg) &&
    !hasOrgAccess
  ) {
    console.warn(
      `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized read of workflow ${workflowIdNum}`
    );
    return NextResponse.json(
      { error: 'Forbidden - You do not have access to this workflow' },
      { status: 403 }
    );
  }

  // Use automation_sequence from workflowOwnership query
  const workflowSequence = {
    automation_sequence: workflowOwnership.automation_sequence,
  };

  if (!workflowSequence.automation_sequence) {
    console.warn(`No automation sequence found for workflow ${workflowId}`);
    // Continue without sequence - we'll just return empty schema
  }

  let executionSchema = {};
  let sampleInputs = {};
  let expectedOutputs = {};

  try {
    if (
      workflowSequence &&
      workflowSequence.automation_sequence &&
      Array.isArray(workflowSequence.automation_sequence) &&
      workflowSequence.automation_sequence.length > 0
    ) {
      // Analyze the automation sequence for conditional logic
      const { coreVariables, conditionalVariables } = analyzeAutomationSequence(
        workflowSequence.automation_sequence
      );

      // Merge core and conditional variables into a hierarchical schema
      executionSchema = { ...coreVariables, ...conditionalVariables };

      // Extract default values from the hierarchical schema
      const extractDefaultsFromHierarchical = (
        schema: Record<string, unknown>
      ): Record<string, unknown> => {
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
      };

      sampleInputs = extractDefaultsFromHierarchical(executionSchema);

      // Extract expected outputs
      const mainSequence = workflowSequence.automation_sequence[0];
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
    }
  } catch (e) {
    console.error(
      `Error parsing dynamic fields for workflow ${workflow.id}:`,
      e
    );
  }

  const responsePayload = {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    version: workflow.current_version,
    status: workflow.status,
    is_executable: workflow.status === 'deployed',
    category: workflow.category,
    estimated_duration_seconds: workflow.current_version_avg_duration,
    preferred_format:
      workflowOwnership.preferred_format ||
      (workflowOwnership.typescript_metadata ||
      (workflowOwnership.github_folder &&
        workflowOwnership.github_folder.includes('typescript'))
        ? 'typescript'
        : 'yaml'),
    typescript_metadata: workflowOwnership.typescript_metadata,
    input_parameters: executionSchema,
    expected_outputs: expectedOutputs,
    sample_inputs: sampleInputs,
    performance_metrics: {
      // Overall workflow statistics (across all versions)
      overall: {
        successful_runs: workflow.overall_successful_runs,
        failed_runs: workflow.overall_failed_runs,
        total_executions: workflow.overall_total_executions,
        success_rate: workflow.overall_success_rate,
      },
      // Current version statistics
      current_version: {
        successful_runs: workflow.current_version_successful_runs,
        failed_runs: workflow.current_version_failed_runs,
        total_executions: workflow.current_version_total_executions,
        success_rate: workflow.current_version_success_rate,
        average_duration_seconds: workflow.current_version_avg_duration,
      },
      // Legacy fields for backward compatibility
      successful_runs: workflow.overall_successful_runs,
      failed_runs: workflow.overall_failed_runs,
      total_executions: workflow.overall_total_executions,
      success_rate: workflow.overall_success_rate,
    },
    version_info: {
      current_version: workflow.current_version,
      total_versions: workflow.total_versions,
    },
    automation_sequence: workflowSequence?.automation_sequence || null,
    tags: workflowOwnership.tags || [],
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
  };

  return NextResponse.json({
    success: true,
    workflow: responsePayload,
  });
}
