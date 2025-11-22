/**
 * Server-side workflow editing tools that use shared version service
 * Ensures GitHub sync happens automatically for all modifications
 *
 * These tools use the WorkflowVersionService directly for fast execution
 * while maintaining GitHub sync and avoiding API overhead.
 */

import { Type } from '@google/genai';

// Alias for backward compatibility
const SchemaType = Type;
import * as yaml from 'js-yaml';
import { workflowVersionService } from '@/lib/services/workflow-version-service';

// Types matching the client-side workflow schema
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
}

interface _WorkflowSequence {
  steps?: CommandStep[];
  [key: string]: any;
}

interface StepUpdate {
  name?: string;
  tool_name?: string;
  arguments?: Record<string, any>;
  description?: string;
  delay_ms?: number;
  continue_on_error?: boolean;
  retries?: number;
  timeout_ms?: number;
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
 * Find step by identifier (ID, name, or index)
 */
function findStepIndex(steps: CommandStep[], identifier: string | number): number {
  // Numeric index (including negative indices)
  if (typeof identifier === 'number') {
    const index = identifier < 0 ? steps.length + identifier : identifier;
    return index >= 0 && index < steps.length ? index : -1;
  }

  // Parse string as number if possible
  const numId = parseInt(identifier as string, 10);
  if (!isNaN(numId)) {
    const index = numId < 0 ? steps.length + numId : numId;
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
          description: 'Step ID, name, or numeric index (as string)'
        },
        updates: {
          type: SchemaType.OBJECT,
          description: 'Fields to update in the step (all optional)',
          properties: {
            name: { type: SchemaType.STRING, description: 'New step name' },
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

        // Update the step
        steps[stepIndex] = { ...steps[stepIndex], ...params.updates };
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
   * Remove a step from the workflow
   */
  remove_workflow_step: {
    description: 'Remove a step from the currently focused workflow',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        step_identifier: {
          type: SchemaType.STRING,
          description: 'Step ID, name, or numeric index (supports negative indices)'
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
    description: 'Get the current workflow YAML content',
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

        // Return content based on preferred format
        let content: string;

        if (currentVersion.preferredFormat === 'jsonb' && currentVersion.jsonContent) {
          // For jsonb format, convert to YAML for consistency
          content = yaml.dump(currentVersion.jsonContent);
        } else {
          // For yaml format, return YAML directly, or convert JSON to YAML as fallback
          content = currentVersion.yamlContent ||
                   yaml.dump(currentVersion.jsonContent);
        }

        return { content, version_number: currentVersion.versionNumber };
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
    description: 'Get a specific step from the workflow',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        step_identifier: {
          type: SchemaType.STRING,
          description: 'Step ID, name, or numeric index'
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

        return {
          step: steps[stepIndex],
          index: stepIndex
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
    description: 'Reorder steps in the currently focused workflow',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from_index: {
          type: SchemaType.NUMBER,
          description: 'Current position of step (0-based)'
        },
        to_index: {
          type: SchemaType.NUMBER,
          description: 'Target position for step (0-based)'
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

        if (params.from_index < 0 || params.from_index >= steps.length ||
            params.to_index < 0 || params.to_index >= steps.length) {
          throw new Error('Invalid step indices');
        }

        // Reorder steps
        const [movedStep] = steps.splice(params.from_index, 1);
        steps.splice(params.to_index, 0, movedStep);
        setSteps(parsed, steps);

        // Convert back to YAML (always use YAML for GitHub sync)
        const newYamlContent = yaml.dump(parsed);

        // Create new version using the service (direct call, no API overhead)
        const result = await workflowVersionService.createVersion({
          workflowId: params.workflow_id,
          yamlContent: newYamlContent,
          changeNotes: `Reordered steps: moved from ${params.from_index} to ${params.to_index}`,
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
          message: `Successfully moved step "${movedStep.name || movedStep.id || 'unnamed'}" from position ${params.from_index + 1} to position ${params.to_index + 1}.`,
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
  }
};

/**
 * Get workflow tool declarations for Vertex AI
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