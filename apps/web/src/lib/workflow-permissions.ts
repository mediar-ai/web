/**
 * Workflow Permission Helpers
 *
 * Centralized permission checking for workflow operations.
 * Uses the `get_workflow_access_level` RPC function in Supabase.
 *
 * Access levels:
 * - 'owner': Organization owns the workflow (full access)
 * - 'admin': Shared with admin access (can edit, delete, change visibility)
 * - 'write': Shared with write access (can edit/sync)
 * - 'read': Shared with read access (can download only)
 * - 'public_read': Workflow is public (read-only)
 * - null: No access
 */

import { createServerClient } from './supabase-server';
import { mapClerkIdToDbId } from './orgIdMapping';

export type AccessLevel = 'owner' | 'admin' | 'write' | 'read' | 'public_read' | null;

export interface WorkflowAccessResult {
  hasAccess: boolean;
  accessLevel: AccessLevel;
  canRead: boolean;
  canWrite: boolean;
  canAdmin: boolean;
  isOwner: boolean;
}

/**
 * Check workflow access level for an organization.
 *
 * @param orgId - Clerk organization ID
 * @param workflowUuid - Workflow UUID (github_folder or uuid column)
 * @returns Access result with level and permission flags
 */
export async function checkWorkflowAccess(
  orgId: string,
  workflowUuid: string
): Promise<WorkflowAccessResult> {
  const supabase = createServerClient();

  // Map Clerk org ID to database org ID (for dev environments)
  const dbOrgId = mapClerkIdToDbId(orgId);

  const { data: accessLevel, error } = await supabase.rpc(
    'get_workflow_access_level',
    {
      p_org_id: dbOrgId,
      p_workflow_uuid: workflowUuid,
    }
  );

  if (error) {
    console.error('[workflow-permissions] RPC error:', error);
    return {
      hasAccess: false,
      accessLevel: null,
      canRead: false,
      canWrite: false,
      canAdmin: false,
      isOwner: false,
    };
  }

  const level = accessLevel as AccessLevel;

  return {
    hasAccess: level !== null,
    accessLevel: level,
    canRead: level !== null, // Any access level can read
    canWrite: level === 'owner' || level === 'admin' || level === 'write',
    canAdmin: level === 'owner' || level === 'admin',
    isOwner: level === 'owner',
  };
}

/**
 * Check if organization can write to a workflow.
 * Use this for publish/sync operations.
 */
export async function canWriteWorkflow(
  orgId: string,
  workflowUuid: string
): Promise<boolean> {
  const result = await checkWorkflowAccess(orgId, workflowUuid);
  return result.canWrite;
}

/**
 * Check if organization can perform admin operations on a workflow.
 * Use this for visibility changes, deletion, etc.
 */
export async function canAdminWorkflow(
  orgId: string,
  workflowUuid: string
): Promise<boolean> {
  const result = await checkWorkflowAccess(orgId, workflowUuid);
  return result.canAdmin;
}

/**
 * Get workflow UUID from numeric ID or github_folder.
 * Helper to resolve workflow identifiers to UUID for permission checks.
 */
export async function getWorkflowUuid(
  workflowIdOrFolder: string | number
): Promise<string | null> {
  const supabase = createServerClient();

  // If it's already a UUID format, return as-is
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof workflowIdOrFolder === 'string' && uuidRegex.test(workflowIdOrFolder)) {
    return workflowIdOrFolder;
  }

  // Try to find by numeric ID or github_folder
  const isNumeric = typeof workflowIdOrFolder === 'number' ||
    /^\d+$/.test(String(workflowIdOrFolder));

  let query = supabase
    .from('deployed_workflows')
    .select('uuid');

  if (isNumeric) {
    query = query.eq('id', Number(workflowIdOrFolder));
  } else {
    query = query.eq('github_folder', workflowIdOrFolder);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    console.error('[workflow-permissions] Failed to resolve workflow UUID:', error);
    return null;
  }

  return data.uuid;
}

/**
 * Combined helper: resolve workflow ID and check write access.
 * Returns both the UUID and access result.
 */
export async function checkWorkflowWriteAccess(
  orgId: string,
  workflowIdOrFolder: string | number
): Promise<{ uuid: string | null; access: WorkflowAccessResult }> {
  const uuid = await getWorkflowUuid(workflowIdOrFolder);

  if (!uuid) {
    return {
      uuid: null,
      access: {
        hasAccess: false,
        accessLevel: null,
        canRead: false,
        canWrite: false,
        canAdmin: false,
        isOwner: false,
      },
    };
  }

  const access = await checkWorkflowAccess(orgId, uuid);
  return { uuid, access };
}
