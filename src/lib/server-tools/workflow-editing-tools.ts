/**
 * Server-side workflow editing tools that use shared version service
 * Ensures GitHub sync happens automatically for all modifications
 *
 * These tools use the WorkflowVersionService directly for fast execution
 * while maintaining GitHub sync and avoiding API overhead.
 */

import { Type } from '@/app/api/ai/types/vertex';

// Alias for backward compatibility
const SchemaType = Type;
import * as yaml from 'js-yaml';
import { workflowVersionService } from '@/lib/services/workflow-version-service';

// Types matching the client-side workflow schema
interface JumpCondition {
  if: string;
  to_id: string;
  reason?: string;
}

interface CommandStep {
  name?: string;
  id?: string;
  tool_name: string;
  arguments?: Record<string, any>;
  description?: string;
  delay_ms?: number;
  continue_on_error?: boolean;
  retries?: number;
  timeout_ms?: number;
  if?: string;
  fallback_id?: string;
  jumps?: JumpCondition[];
}

interface _WorkflowSequence {
  steps?: CommandStep[];
  [key: string]: any;
}

interface StepUpdate {
  name?: string;
  id?: string;
  tool_name?: string;
  arguments?: Record<string, any>;
  description?: string;
  delay_ms?: number;
  continue_on_error?: boolean;
  retries?: number;
  timeout_ms?: number;
  if?: string;
  fallback_id?: string;
  jumps?: JumpCondition[];
}

/**
 * Check if user is authorized to modify a workflow
 * Note: The API route will also do authorization, but we check here first
 * to provide better error messages
 */
async function checkWorkflowAuthorization(
  workflowId: number,
  userContext: { userId: string; orgId: string | null; email?: string | null }
): Promise<void> {
  // Import Supabase only for authorization check
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get workflow ownership and organization
  const { data: workflow, error } = await supabase
    .from('deployed_workflows')
    .select('created_by, organization_id')
    .eq('id', workflowId)
    .single();

  if (error || !workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  // Check if user is Mediar org/admin (using same pattern as API routes)
  const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
  const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

  // Prevent modification of public workflows (NULL organization_id) by non-Mediar users
  if (!workflow.organization_id && !isMediarOrg && !isMediarAdmin) {
    console.warn(
      `[SECURITY] User ${userContext.userId} attempted to modify public workflow ${workflowId} via AI server-side tool`
    );
    throw new Error('Forbidden - Public workflows can only be modified by Mediar administrators');
  }

  // Check ownership/org membership
  const isOwner = workflow.created_by === userContext.userId;
  const isSameOrg = workflow.organization_id && workflow.organization_id === userContext.orgId;

  // Check workflow_organization_access table for organization-based access
  let hasOrgAccess = false;
  if (userContext.orgId) {
    const { data: orgAccess } = await supabase
      .from('workflow_organization_access')
      .select('access_level')
      .eq('workflow_id', workflowId)
      .eq('organization_id', userContext.orgId)
      .single();

    // Only 'write' or 'admin' access levels can modify workflows
    hasOrgAccess = !!orgAccess && ['write', 'admin'].includes(orgAccess.access_level as string);
  }

  // Allow modification if:
  // - User is in Mediar org or is a Mediar admin (can modify all workflows)
  // - User is the workflow owner
  // - User is in the same org (legacy organization_id field)
  // - User's organization has write/admin access via workflow_organization_access table
  if (!isMediarOrg && !isMediarAdmin && !isOwner && !isSameOrg && !hasOrgAccess) {
    console.warn(
      `[SECURITY] User ${userContext.userId} (orgId: ${userContext.orgId}) attempted unauthorized modification of workflow ${workflowId} via AI server-side tool`
    );
    throw new Error('Forbidden - You do not have permission to modify this workflow');
  }

  console.log(`[AUTH] User ${userContext.userId} authorized to modify workflow ${workflowId}`);
}

/**
 * Parse workflow content to extract sequence structure
 */
function parseWorkflowContent(content: string | null | undefined): { parsed: any; isYaml: boolean } {
  if (!content) {
    throw new Error('Workflow content is empty');
  }

  // Try YAML first
  try {
    const parsed = yaml.load(content) as any;
    return { parsed, isYaml: true };
  } catch {
    // Try JSON
    try {
      const parsed = JSON.parse(content);
      return { parsed, isYaml: false };
    } catch {
      throw new Error('Invalid workflow format - not valid YAML or JSON');
    }
  }
}

/**
 * Get steps array from parsed workflow
 */
function getSteps(workflow: any): CommandStep[] {
  // Direct steps array
  if (Array.isArray(workflow.steps)) {
    return workflow.steps;
  }

  // Wrapped in execute_sequence tool format
  if (Array.isArray(workflow)) {
    const firstItem = workflow[0];
    if (firstItem?.tool_name === 'execute_sequence' && firstItem.arguments?.steps) {
      return firstItem.arguments.steps;
    }
  }

  // Single execute_sequence object
  if (workflow.tool_name === 'execute_sequence' && workflow.arguments?.steps) {
    return workflow.arguments.steps;
  }

  return [];
}

/**
 * Set steps array in workflow structure
 */
function setSteps(workflow: any, steps: CommandStep[]): void {
  // Direct steps array
  if (Array.isArray(workflow.steps)) {
    workflow.steps = steps;
    return;
  }

  // Wrapped in execute_sequence tool format
  if (Array.isArray(workflow)) {
    const firstItem = workflow[0];
    if (firstItem?.tool_name === 'execute_sequence' && firstItem.arguments) {
      firstItem.arguments.steps = steps;
      return;
    }
  }

  // Single execute_sequence object
  if (workflow.tool_name === 'execute_sequence' && workflow.arguments) {
    workflow.arguments.steps = steps;
    return;
  }

  // Default: set as direct steps
  workflow.steps = steps;
}

/**
 * Find step by identifier (ID, name, or 1-based index)
 * Numeric indices are 1-based (1 = first step, 2 = second step, -1 = last step)
 */
function findStepIndex(steps: CommandStep[], identifier: string | number): number {
  // Numeric index: 1-based for positive, negative indices count from end
  if (typeof identifier === 'number') {
    // Negative: -1 = last, -2 = second to last, etc.
    // Positive: 1 = first (index 0), 2 = second (index 1), etc.
    const index = identifier < 0 ? steps.length + identifier : identifier - 1;
    return index >= 0 && index < steps.length ? index : -1;
  }

  // Parse string as number if possible (1-based)
  const numId = parseInt(identifier as string, 10);
  if (!isNaN(numId)) {
    const index = numId < 0 ? steps.length + numId : numId - 1;
    return index >= 0 && index < steps.length ? index : -1;
  }

  // Find by ID
  const byId = steps.findIndex(s => s.id === identifier);
  if (byId !== -1) return byId;

  // Find by name
  return steps.findIndex(s => s.name === identifier);
}

/**
 * Server-side workflow editing tools
 */
export const serverSideWorkflowTools = {
  /**
   * Update a workflow step
   */
  update_workflow_step: {
    description: 'Update a step in the currently focused workflow',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        step_identifier: {
          type: SchemaType.STRING,
          description: 'Step ID, name, or 1-based index (1 = first step, 2 = second, -1 = last)'
        },
        updates: {
          type: SchemaType.OBJECT,
          description: 'Fields to update in the step (all optional)',
          properties: {
            name: { type: SchemaType.STRING, description: 'New step name' },
            id: { type: SchemaType.STRING, description: 'Unique step ID for referencing in jumps/fallbacks. Results accessible as {id}_status and {id}_result' },
            tool_name: { type: SchemaType.STRING, description: 'New tool name' },
            arguments: {
              type: SchemaType.OBJECT,
              description: 'Tool arguments object',
              additionalProperties: true
            },
            description: { type: SchemaType.STRING, description: 'Step description' },
            delay_ms: { type: SchemaType.NUMBER, description: 'Delay in milliseconds' },
            continue_on_error: { type: SchemaType.BOOLEAN, description: 'Continue if step fails' },
            retries: { type: SchemaType.NUMBER, description: 'Number of retries' },
            timeout_ms: { type: SchemaType.NUMBER, description: 'Timeout in milliseconds' },
            if: { type: SchemaType.STRING, description: 'Condition expression to run step. Supports: ==, !=, >, <, >=, <=, &&, ||, !, contains(), startsWith(), endsWith(). Access step results as {step_id}_status or {step_id}_result' },
            fallback_id: { type: SchemaType.STRING, description: 'Step ID to jump to if this step fails after all retries' },
            jumps: {
              type: SchemaType.ARRAY,
              description: 'Conditional jumps evaluated in order after successful execution. First matching condition triggers jump.',
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  if: { type: SchemaType.STRING, description: 'Expression to evaluate (e.g., "status == success", "contains(result, error)")' },
                  to_id: { type: SchemaType.STRING, description: 'Target step ID to jump to when condition is true' },
                  reason: { type: SchemaType.STRING, description: 'Optional explanation logged when jump is taken' }
                },
                required: ['if', 'to_id']
              }
            },
          },
        },
      },
      required: ['step_identifier', 'updates']  // workflow_id removed - injected by backend from request context
    },
    execute: async (
      params: {
        workflow_id: number;
        step_identifier: string | number;
        updates: StepUpdate;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Updating step:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version using the service
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Use content based on preferred format
        let content: string;
        let parsed: any;

        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          // For jsonb format, use JSON content directly
          parsed = currentVersion.jsonContent;
          content = JSON.stringify(parsed);
        } else {
          // For yaml or typescript formats, use YAML if available, otherwise stringify JSON
          content = currentVersion.yamlContent ||
                   JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }
        const steps = getSteps(parsed);

        const stepIndex = findStepIndex(steps, params.step_identifier);
        if (stepIndex === -1) {
          throw new Error(`Step '${params.step_identifier}' not found`);
        }

        // Update the step with deep merge for arguments
        const existingStep = steps[stepIndex];
        const mergedStep = { ...existingStep };

        for (const [key, value] of Object.entries(params.updates)) {
          if (key === 'arguments' && existingStep.arguments && typeof value === 'object' && value !== null) {
            // Deep merge arguments: preserve existing keys, override only specified ones
            mergedStep.arguments = { ...existingStep.arguments, ...value };
          } else {
            (mergedStep as any)[key] = value;
          }
        }

        steps[stepIndex] = mergedStep;
        setSteps(parsed, steps);

        // Convert back to YAML (always use YAML for GitHub sync)
        const newYamlContent = yaml.dump(parsed);

        // Create new version using the service (direct call, no API overhead)
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes: `Updated step: ${params.step_identifier}`,
          setAsActive: false,
          userId: userContext.userId,
          orgId: userContext.orgId
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create workflow version');
        }

        console.log('[SERVER-WORKFLOW-EDIT] Step updated successfully, version:', result.version?.version_number);

        const updatedStep = steps[stepIndex];
        const changedFields = Object.keys(params.updates).join(', ');

        return {
          success: true,
          message: `Successfully updated step "${updatedStep.name || updatedStep.id || 'unnamed'}" at position ${stepIndex + 1}. Changed fields: ${changedFields}.`,
          action: 'updated',
          step_name: updatedStep.name || updatedStep.id || 'unnamed',
          step_index: stepIndex,
          step_identifier_used: params.step_identifier,
          changes: params.updates,
          updated_step: updatedStep,
          total_step_count: steps.length,
          version_id: result.version?.id,
          version_number: result.version?.version_number,
          workflow_updated: true,
          workflow_data: {
            id: params.workflow_id,
            yaml_content: newYamlContent,
            step_count: steps.length,
            last_modified: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Add a new step to the workflow
   */
  add_workflow_step: {
    description: 'Add a new step to the currently focused workflow. Use 1-based position.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        step: {
          type: SchemaType.OBJECT,
          description: 'Step definition',
          properties: {
            name: { type: SchemaType.STRING, description: 'Step name' },
            id: { type: SchemaType.STRING, description: 'Unique step ID for referencing in jumps/fallbacks. Results accessible as {id}_status and {id}_result' },
            tool_name: { type: SchemaType.STRING, description: 'MCP tool to execute' },
            arguments: {
              type: SchemaType.OBJECT,
              description: 'Tool arguments object',
              additionalProperties: true
            },
            description: { type: SchemaType.STRING, description: 'Step description (optional)' },
            delay_ms: { type: SchemaType.NUMBER, description: 'Delay in milliseconds (optional)' },
            continue_on_error: { type: SchemaType.BOOLEAN, description: 'Continue if step fails (optional)' },
            retries: { type: SchemaType.NUMBER, description: 'Number of retries (optional)' },
            timeout_ms: { type: SchemaType.NUMBER, description: 'Timeout in milliseconds (optional)' },
            if: { type: SchemaType.STRING, description: 'Condition expression to run step. Supports: ==, !=, >, <, >=, <=, &&, ||, !, contains(), startsWith(), endsWith(). Access step results as {step_id}_status or {step_id}_result' },
            fallback_id: { type: SchemaType.STRING, description: 'Step ID to jump to if this step fails after all retries' },
            jumps: {
              type: SchemaType.ARRAY,
              description: 'Conditional jumps evaluated in order after successful execution. First matching condition triggers jump.',
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  if: { type: SchemaType.STRING, description: 'Expression to evaluate (e.g., "status == success", "contains(result, error)")' },
                  to_id: { type: SchemaType.STRING, description: 'Target step ID to jump to when condition is true' },
                  reason: { type: SchemaType.STRING, description: 'Optional explanation logged when jump is taken' }
                },
                required: ['if', 'to_id']
              }
            },
          },
          required: ['id', 'tool_name']
        },
        position: {
          type: SchemaType.NUMBER,
          description: 'Position to insert step (1-based, e.g., 1 = insert at beginning, omit to append at end)'
        }
      },
      required: ['step']  // workflow_id removed - injected by backend from request context
    },
    execute: async (
      params: {
        workflow_id: number;
        step: CommandStep;
        position?: number | null;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Adding step:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version using the service
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Use content based on preferred format
        let parsed: any;

        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          parsed = currentVersion.jsonContent;
        } else {
          const content = currentVersion.yamlContent ||
                   JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }
        const steps = getSteps(parsed);

        // Convert 1-based position to 0-based index
        // position=1 means insert at beginning (index 0), position=2 means after first step (index 1), etc.
        const position = params.position === null ? undefined : params.position;
        let insertIdx: number;

        // Normalize step arguments: disable expensive UI diff params for production workflows
        const normalizedStep = {
          ...params.step,
          arguments: { ...params.step.arguments }
        };
        if ('ui_diff_before_after' in normalizedStep.arguments) {
          normalizedStep.arguments.ui_diff_before_after = false;
        }
        if ('include_tree_after_action' in normalizedStep.arguments) {
          normalizedStep.arguments.include_tree_after_action = false;
        }

        if (position !== undefined && position >= 1 && position <= steps.length + 1) {
          insertIdx = position - 1;  // Convert 1-based to 0-based
          steps.splice(insertIdx, 0, normalizedStep);
        } else {
          insertIdx = steps.length;
          steps.push(normalizedStep);
        }

        setSteps(parsed, steps);

        // Convert back to YAML (always use YAML for GitHub sync)
        const newYamlContent = yaml.dump(parsed);

        // Create new version using the service (direct call, no API overhead)
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes: `Added step: ${params.step.name || params.step.id || 'unnamed'}`,
          setAsActive: false,
          userId: userContext.userId,
          orgId: userContext.orgId
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create workflow version');
        }

        console.log('[SERVER-WORKFLOW-EDIT] Step added successfully, version:', result.version?.version_number);

        const addedStep = params.step;

        return {
          success: true,
          message: `Successfully added step "${addedStep.name || addedStep.id || 'unnamed'}" at position ${insertIdx + 1}. Workflow now has ${steps.length} step${steps.length !== 1 ? 's' : ''}.`,
          action: 'added',
          step_name: addedStep.name || addedStep.id || 'unnamed',
          step_index: insertIdx + 1,  // Return 1-based index
          added_step: addedStep,
          total_step_count: steps.length,
          version_id: result.version?.id,
          version_number: result.version?.version_number,
          workflow_updated: true,
          workflow_data: {
            id: params.workflow_id,
            yaml_content: newYamlContent,
            step_count: steps.length,
            last_modified: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Remove a step from the workflow
   */
  remove_workflow_step: {
    description: 'Remove a step from the currently focused workflow',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        step_identifier: {
          type: SchemaType.STRING,
          description: 'Step ID, name, or 1-based index (1 = first step, 2 = second, -1 = last)'
        },
      },
      required: ['step_identifier']
    },
    execute: async (
      params: {
        workflow_id: number;
        step_identifier: string | number;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Removing step:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version using the service
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Use content based on preferred format
        let content: string;
        let parsed: any;

        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          // For jsonb format, use JSON content directly
          parsed = currentVersion.jsonContent;
          content = JSON.stringify(parsed);
        } else {
          // For yaml or typescript formats, use YAML if available, otherwise stringify JSON
          content = currentVersion.yamlContent ||
                   JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }
        const steps = getSteps(parsed);

        const stepIndex = findStepIndex(steps, params.step_identifier);
        if (stepIndex === -1) {
          throw new Error(`Step '${params.step_identifier}' not found`);
        }

        // Remove the step
        const removedStep = steps[stepIndex];
        steps.splice(stepIndex, 1);
        setSteps(parsed, steps);

        // Convert back to YAML (always use YAML for GitHub sync)
        const newYamlContent = yaml.dump(parsed);

        // Create new version using the service (direct call, no API overhead)
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes: `Removed step: ${removedStep.name || params.step_identifier}`,
          setAsActive: false,
          userId: userContext.userId,
          orgId: userContext.orgId
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create workflow version');
        }

        console.log('[SERVER-WORKFLOW-EDIT] Step removed successfully, version:', result.version?.version_number);

        return {
          success: true,
          message: `Successfully removed step "${removedStep.name || removedStep.id || 'unnamed'}" (was at position ${stepIndex + 1}). Workflow now has ${steps.length} step${steps.length !== 1 ? 's' : ''}.`,
          action: 'removed',
          removed_step_name: removedStep.name || removedStep.id || 'unnamed',
          removed_step_index: stepIndex,
          removed_step_tool: removedStep.tool_name,
          step_identifier_used: params.step_identifier,
          remaining_step_count: steps.length,
          version_id: result.version?.id,
          version_number: result.version?.version_number,
          workflow_updated: true,
          workflow_data: {
            id: params.workflow_id,
            yaml_content: newYamlContent,
            step_count: steps.length,
            last_modified: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Get current workflow content
   */
  get_workflow: {
    description: 'Get the current workflow with steps, variables, and output parser. Returns structured data with 1-based step indices for use with get_step and execute_workflow.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: []
    },
    execute: async (
      params: { workflow_id: number },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Getting workflow:', params.workflow_id);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version using the service
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Parse content to extract steps
        let parsed: any;
        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          parsed = currentVersion.jsonContent;
        } else {
          const content = currentVersion.yamlContent ||
                         JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }

        const steps = getSteps(parsed);

        // Return structured data with 1-based indices
        return {
          steps: steps.map((step, i) => ({
            index: i + 1,  // 1-based index for AI to use
            id: step.id,
            name: step.name,
            tool_name: step.tool_name,
            arguments: step.arguments,
            ...(step.description && { description: step.description }),
            ...(step.delay_ms && { delay_ms: step.delay_ms }),
            ...(step.continue_on_error && { continue_on_error: step.continue_on_error }),
            ...(step.retries && { retries: step.retries }),
            ...(step.timeout_ms && { timeout_ms: step.timeout_ms }),
            ...(step.if && { if: step.if }),
            ...(step.fallback_id && { fallback_id: step.fallback_id }),
            ...(step.jumps && { jumps: step.jumps }),
          })),
          total_steps: steps.length,
          variables: parsed.variables || {},
          troubleshooting: parsed.troubleshooting || [],
          output: parsed.output || null,
          version_number: currentVersion.versionNumber
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Search workflow YAML content for a pattern
   */
  search_workflow: {
    description: 'Search workflow YAML content and return matching lines with context',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        pattern: {
          type: SchemaType.STRING,
          description: 'Regex pattern to search (e.g., "click", "error", "step_.*")'
        },
        context_lines: {
          type: SchemaType.NUMBER,
          description: 'Number of lines before/after match (default: 3)'
        }
      },
      required: ['pattern']
    },
    execute: async (
      params: {
        workflow_id: number;
        pattern: string;
        context_lines?: number;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Searching workflow:', params.workflow_id, 'pattern:', params.pattern);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Get YAML content
        let content: string;
        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          content = yaml.dump(currentVersion.jsonContent);
        } else {
          content = currentVersion.yamlContent || yaml.dump(currentVersion.jsonContent);
        }

        // Split into lines
        const lines = content.split('\n');
        const contextLines = params.context_lines ?? 3;

        // Create regex from pattern
        let regex: RegExp;
        try {
          regex = new RegExp(params.pattern, 'i');
        } catch (e) {
          throw new Error(`Invalid regex pattern: ${params.pattern}`);
        }

        // Find matches
        const matches: Array<{
          line_number: number;
          content: string;
          context_before: string[];
          context_after: string[];
        }> = [];

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const startContext = Math.max(0, i - contextLines);
            const endContext = Math.min(lines.length - 1, i + contextLines);

            matches.push({
              line_number: i + 1, // 1-based line numbers
              content: lines[i],
              context_before: lines.slice(startContext, i),
              context_after: lines.slice(i + 1, endContext + 1)
            });
          }
        }

        return {
          matches,
          total_matches: matches.length,
          total_lines: lines.length
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Get a specific step from the workflow
   */
  get_step: {
    description: 'Get a specific step from the workflow. Use 1-based index (1 = first step, 2 = second, -1 = last).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        step_identifier: {
          type: SchemaType.STRING,
          description: '1-based step index (e.g., "1" for first step), step ID, or step name'
        },
      },
      required: ['step_identifier']
    },
    execute: async (
      params: {
        workflow_id: number;
        step_identifier: string | number;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Getting step info:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version using the service
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Use content based on preferred format
        let parsed: any;

        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          parsed = currentVersion.jsonContent;
        } else {
          const content = currentVersion.yamlContent ||
                   JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }
        const steps = getSteps(parsed);

        const stepIndex = findStepIndex(steps, params.step_identifier);
        if (stepIndex === -1) {
          throw new Error(`Step '${params.step_identifier}' not found`);
        }

        return {
          step: steps[stepIndex],
          index: stepIndex + 1  // Return 1-based index
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Reorder workflow steps
   */
  reorder_workflow_steps: {
    description: 'Reorder steps in the currently focused workflow. Use 1-based indices.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from_index: {
          type: SchemaType.NUMBER,
          description: 'Current position of step (1-based, e.g., 1 = first step)'
        },
        to_index: {
          type: SchemaType.NUMBER,
          description: 'Target position for step (1-based, e.g., 1 = first position)'
        }
      },
      required: ['from_index', 'to_index']
    },
    execute: async (
      params: {
        workflow_id: number;
        from_index: number;
        to_index: number;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Reordering steps:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version using the service
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Use content based on preferred format
        let parsed: any;

        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          parsed = currentVersion.jsonContent;
        } else {
          const content = currentVersion.yamlContent ||
                   JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }
        const steps = getSteps(parsed);

        // Convert 1-based to 0-based
        const fromIdx = params.from_index - 1;
        const toIdx = params.to_index - 1;

        if (fromIdx < 0 || fromIdx >= steps.length) {
          throw new Error(`Invalid from_index: ${params.from_index}. Must be 1-${steps.length}`);
        }
        if (toIdx < 0 || toIdx >= steps.length) {
          throw new Error(`Invalid to_index: ${params.to_index}. Must be 1-${steps.length}`);
        }

        // Reorder steps
        const [movedStep] = steps.splice(fromIdx, 1);
        steps.splice(toIdx, 0, movedStep);
        setSteps(parsed, steps);

        // Convert back to YAML (always use YAML for GitHub sync)
        const newYamlContent = yaml.dump(parsed);

        // Create new version using the service (direct call, no API overhead)
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes: `Reordered steps: moved from position ${params.from_index} to ${params.to_index}`,
          setAsActive: false,
          userId: userContext.userId,
          orgId: userContext.orgId
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create workflow version');
        }

        console.log('[SERVER-WORKFLOW-EDIT] Steps reordered successfully, version:', result.version?.version_number);

        return {
          success: true,
          message: `Successfully moved step "${movedStep.name || movedStep.id || 'unnamed'}" from position ${params.from_index} to position ${params.to_index}.`,
          action: 'reordered',
          moved_step_name: movedStep.name || movedStep.id || 'unnamed',
          from_index: params.from_index,
          to_index: params.to_index,
          total_step_count: steps.length,
          version_id: result.version?.id,
          version_number: result.version?.version_number,
          workflow_updated: true,
          workflow_data: {
            id: params.workflow_id,
            yaml_content: newYamlContent,
            step_count: steps.length,
            last_modified: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Update a workflow variable
   */
  update_workflow_variable: {
    description: 'Update a variable in the currently focused workflow. Can add new variables or modify existing ones.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        variable_name: {
          type: SchemaType.STRING,
          description: 'Name of the variable to update or create'
        },
        variable_value: {
          type: SchemaType.OBJECT,
          description: 'Variable definition object with type, label, default, etc.',
          properties: {
            type: { type: SchemaType.STRING, description: 'Variable type: string, number, boolean, enum, array, or object' },
            label: { type: SchemaType.STRING, description: 'Human-readable label for the variable' },
            default: { description: 'Default value for the variable. Must match the variable type: for arrays use ["item1", "item2"], for objects use { "key": "value" }, for strings/numbers/booleans use the literal value.' },
            description: { type: SchemaType.STRING, description: 'Description of the variable' },
            required: { type: SchemaType.BOOLEAN, description: 'Whether this variable is required (default: true)' },
            regex: { type: SchemaType.STRING, description: 'For string type: regex pattern for validation' },
            options: {
              type: SchemaType.ARRAY,
              description: 'For enum type: list of allowed string values. Example: ["TEST", "LIVE"]',
              items: { type: SchemaType.STRING }
            },
            item_schema: {
              type: SchemaType.OBJECT,
              description: 'For array type: defines schema for each array item. Access elements with {{arr[0]}}, {{arr[1].field}}. Example: { type: "object", properties: { name: { type: "string" }, code: { type: "string" } } }',
              additionalProperties: true
            },
            properties: {
              type: SchemaType.OBJECT,
              description: 'For object type with known fields: defines schema for each named property. Example: { name: { type: "string", label: "Name" }, enabled: { type: "boolean" } }',
              additionalProperties: true
            },
            value_schema: {
              type: SchemaType.OBJECT,
              description: 'For object type with uniform values: defines schema for all values. Example for environment flags: { type: "enum", options: ["TEST", "LIVE"] }',
              additionalProperties: true
            }
          },
          additionalProperties: true
        },
        delete: {
          type: SchemaType.BOOLEAN,
          description: 'If true, delete the variable instead of updating it'
        }
      },
      required: ['variable_name']
    },
    execute: async (
      params: {
        workflow_id: number;
        variable_name: string;
        variable_value?: Record<string, any>;
        delete?: boolean;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Updating variable:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version using the service
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Parse content
        let parsed: any;
        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          parsed = currentVersion.jsonContent;
        } else {
          const content = currentVersion.yamlContent ||
                         JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }

        // Ensure variables object exists
        if (!parsed.variables) {
          parsed.variables = {};
        }

        let action: string;
        let changeNotes: string;

        if (params.delete) {
          // Delete the variable
          if (!(params.variable_name in parsed.variables)) {
            throw new Error(`Variable '${params.variable_name}' not found`);
          }
          delete parsed.variables[params.variable_name];
          action = 'deleted';
          changeNotes = `Deleted variable: ${params.variable_name}`;
        } else if (!params.variable_value) {
          throw new Error('variable_value is required when not deleting');
        } else {
          // Add or update the variable
          const isNew = !(params.variable_name in parsed.variables);
          parsed.variables[params.variable_name] = params.variable_value;
          action = isNew ? 'added' : 'updated';
          changeNotes = `${isNew ? 'Added' : 'Updated'} variable: ${params.variable_name}`;
        }

        // Convert back to YAML
        const newYamlContent = yaml.dump(parsed);

        // Create new version
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes,
          setAsActive: false,
          userId: userContext.userId,
          orgId: userContext.orgId
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create workflow version');
        }

        console.log('[SERVER-WORKFLOW-EDIT] Variable updated successfully, version:', result.version?.version_number);

        return {
          success: true,
          message: `Successfully ${action} variable "${params.variable_name}".`,
          action,
          variable_name: params.variable_name,
          variable_value: params.delete ? null : params.variable_value,
          total_variables: Object.keys(parsed.variables).length,
          version_id: result.version?.id,
          version_number: result.version?.version_number,
          workflow_updated: true,
          workflow_data: {
            id: params.workflow_id,
            yaml_content: newYamlContent,
            step_count: (parsed.steps || []).length,
            last_modified: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Update workflow output parser
   */
  update_workflow_output: {
    description: 'Update the output parser section of the workflow. The output section contains JavaScript code that processes workflow results.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        output: {
          type: SchemaType.OBJECT,
          description: 'Output parser configuration object',
          properties: {
            run: { type: SchemaType.STRING, description: 'JavaScript code to process sequenceResult and return formatted output. sequenceResult contains: { status: "success"|"partial_success"|"error", results: [{step_id, tool_name, result, status, duration_ms}...], executed_tools: number, total_duration_ms: number }. Access step results via sequenceResult.results[i].result or find by step_id.' }
          },
          additionalProperties: true
        },
        delete: {
          type: SchemaType.BOOLEAN,
          description: 'If true, remove the output section entirely'
        }
      },
      required: []
    },
    execute: async (
      params: {
        workflow_id: number;
        output?: { run?: string; [key: string]: any };
        delete?: boolean;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Updating output:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Parse content
        let parsed: any;
        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          parsed = currentVersion.jsonContent;
        } else {
          const content = currentVersion.yamlContent ||
                         JSON.stringify(currentVersion.jsonContent || {});
          const result = parseWorkflowContent(content);
          parsed = result.parsed;
        }

        let action: string;
        let changeNotes: string;

        if (params.delete) {
          if (!parsed.output) {
            throw new Error('No output section to delete');
          }
          delete parsed.output;
          action = 'deleted';
          changeNotes = 'Deleted output parser section';
        } else if (!params.output) {
          throw new Error('output is required when not deleting');
        } else {
          const isNew = !parsed.output;
          parsed.output = params.output;
          action = isNew ? 'added' : 'updated';
          changeNotes = `${isNew ? 'Added' : 'Updated'} output parser section`;
        }

        // Convert back to YAML
        const newYamlContent = yaml.dump(parsed);

        // Create new version
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes,
          setAsActive: false,
          userId: userContext.userId,
          orgId: userContext.orgId
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create workflow version');
        }

        console.log('[SERVER-WORKFLOW-EDIT] Output updated successfully, version:', result.version?.version_number);

        return {
          success: true,
          message: `Successfully ${action} output parser section.`,
          action,
          has_output: !!parsed.output,
          version_id: result.version?.id,
          version_number: result.version?.version_number,
          workflow_updated: true,
          workflow_data: {
            id: params.workflow_id,
            yaml_content: newYamlContent,
            step_count: (parsed.steps || []).length,
            last_modified: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  },

  /**
   * Update workflow troubleshooting steps
   */
  update_workflow_troubleshooting: {
    description: 'Add, update, or remove troubleshooting steps. Troubleshooting steps are error recovery steps that can be jumped to via fallback_id when main steps fail.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        action: {
          type: SchemaType.STRING,
          description: 'Action to perform: "add" (add new step), "update" (modify existing), "remove" (delete step), "clear" (remove all)'
        },
        step_id: {
          type: SchemaType.STRING,
          description: 'ID of the troubleshooting step to update or remove (required for update/remove actions)'
        },
        step: {
          type: SchemaType.OBJECT,
          description: 'Step definition for add/update actions',
          properties: {
            id: { type: SchemaType.STRING, description: 'Unique step ID (required for add, used as target for fallback_id)' },
            tool_name: { type: SchemaType.STRING, description: 'MCP tool to execute' },
            arguments: {
              type: SchemaType.OBJECT,
              description: 'Tool arguments object',
              additionalProperties: true
            },
            description: { type: SchemaType.STRING, description: 'Step description' },
            continue_on_error: { type: SchemaType.BOOLEAN, description: 'Continue if step fails' },
            retries: { type: SchemaType.NUMBER, description: 'Number of retries' },
            jumps: {
              type: SchemaType.ARRAY,
              description: 'Conditional jumps after successful execution',
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  if: { type: SchemaType.STRING, description: 'Expression to evaluate' },
                  to_id: { type: SchemaType.STRING, description: 'Target step ID' },
                  reason: { type: SchemaType.STRING, description: 'Optional explanation' }
                },
                required: ['if', 'to_id']
              }
            }
          },
          required: ['id', 'tool_name']
        }
      },
      required: ['action']
    },
    execute: async (
      params: {
        workflow_id: number;
        action: 'add' | 'update' | 'remove' | 'clear';
        step_id?: string;
        step?: CommandStep;
      },
      userContext: { userId: string; orgId: string | null; email?: string | null }
    ) => {
      try {
        console.log('[SERVER-WORKFLOW-EDIT] Updating troubleshooting:', params);

        // AUTHORIZATION CHECK
        await checkWorkflowAuthorization(params.workflow_id, userContext);

        // Get latest workflow version
        const currentVersion = await workflowVersionService.getLatestVersion(params.workflow_id);

        // Parse content
        let parsed: any;
        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          parsed = currentVersion.jsonContent;
        } else if (currentVersion.yamlContent) {
          parsed = yaml.load(currentVersion.yamlContent) || {};
        } else {
          throw new Error('No workflow content found');
        }

        // Ensure troubleshooting array exists
        if (!parsed.troubleshooting) {
          parsed.troubleshooting = [];
        }

        let changeNotes: string;
        let resultMessage: string;

        switch (params.action) {
          case 'add': {
            if (!params.step || !params.step.id) {
              throw new Error('step with id is required for add action');
            }
            // Check for duplicate ID
            const existingIndex = parsed.troubleshooting.findIndex((s: any) => s.id === params.step!.id);
            if (existingIndex !== -1) {
              throw new Error(`Troubleshooting step with ID '${params.step.id}' already exists`);
            }
            parsed.troubleshooting.push(params.step);
            changeNotes = `Added troubleshooting step: ${params.step.id}`;
            resultMessage = `Successfully added troubleshooting step "${params.step.id}".`;
            break;
          }
          case 'update': {
            if (!params.step_id) {
              throw new Error('step_id is required for update action');
            }
            const updateIndex = parsed.troubleshooting.findIndex((s: any) => s.id === params.step_id);
            if (updateIndex === -1) {
              throw new Error(`Troubleshooting step '${params.step_id}' not found`);
            }
            // Merge updates
            parsed.troubleshooting[updateIndex] = {
              ...parsed.troubleshooting[updateIndex],
              ...params.step
            };
            changeNotes = `Updated troubleshooting step: ${params.step_id}`;
            resultMessage = `Successfully updated troubleshooting step "${params.step_id}".`;
            break;
          }
          case 'remove': {
            if (!params.step_id) {
              throw new Error('step_id is required for remove action');
            }
            const removeIndex = parsed.troubleshooting.findIndex((s: any) => s.id === params.step_id);
            if (removeIndex === -1) {
              throw new Error(`Troubleshooting step '${params.step_id}' not found`);
            }
            parsed.troubleshooting.splice(removeIndex, 1);
            changeNotes = `Removed troubleshooting step: ${params.step_id}`;
            resultMessage = `Successfully removed troubleshooting step "${params.step_id}".`;
            break;
          }
          case 'clear': {
            const count = parsed.troubleshooting.length;
            parsed.troubleshooting = [];
            changeNotes = `Cleared all ${count} troubleshooting steps`;
            resultMessage = `Successfully cleared all ${count} troubleshooting steps.`;
            break;
          }
          default:
            throw new Error(`Invalid action: ${params.action}. Use add, update, remove, or clear.`);
        }

        // Convert back to YAML
        const newYamlContent = yaml.dump(parsed);

        // Create new version
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes,
          setAsActive: false,
          userId: userContext.userId,
          orgId: userContext.orgId
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create workflow version');
        }

        console.log('[SERVER-WORKFLOW-EDIT] Troubleshooting updated successfully, version:', result.version?.version_number);

        return {
          success: true,
          message: resultMessage,
          action: params.action,
          total_troubleshooting_steps: parsed.troubleshooting.length,
          version_id: result.version?.id,
          version_number: result.version?.version_number,
          workflow_updated: true,
          workflow_data: {
            id: params.workflow_id,
            yaml_content: newYamlContent,
            step_count: (parsed.steps || []).length,
            last_modified: new Date().toISOString()
          }
        };
      } catch (error) {
        console.error('[SERVER-WORKFLOW-EDIT] Error:', error);
        throw error;
      }
    }
  }
};

/**
 * Get workflow tool declarations for Vertex AI
 * Full declarations with descriptions and schemas for native function calling
 */
export function getWorkflowToolDeclarations() {
  return Object.entries(serverSideWorkflowTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

/**
 * Execute a workflow editing tool by name
 */
export async function executeWorkflowTool(
  name: string,
  args: any,
  userContext: { userId: string; orgId: string | null; email?: string | null }
) {
  const tool = serverSideWorkflowTools[name as keyof typeof serverSideWorkflowTools];
  if (!tool) {
    throw new Error(`Unknown workflow tool: ${name}`);
  }
  return await tool.execute(args, userContext);
}

/**
 * Check if a tool is a workflow editing tool
 */
export function isWorkflowEditingTool(name: string): boolean {
  return name in serverSideWorkflowTools;
}