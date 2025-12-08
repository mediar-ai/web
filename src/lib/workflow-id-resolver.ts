/**
 * Workflow ID Resolver
 *
 * Handles hybrid workflow identification - supports both numeric IDs (legacy)
 * and UUIDs (TypeScript workflows from desktop app).
 *
 * Database schema:
 * - `id` (bigint): Auto-increment primary key, used by web dashboard
 * - `github_folder` (text): UUID from desktop app, used as folder name
 * - `uuid` (uuid): Database-generated UUID
 */

import { SupabaseClient } from '@supabase/supabase-js';

// UUID v4 pattern: 8-4-4-4-12 hex characters
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Purely numeric pattern
const NUMERIC_PATTERN = /^\d+$/;

export type WorkflowIdType = 'numeric' | 'uuid' | 'unknown';

/**
 * Detect the type of workflow ID
 */
export function detectWorkflowIdType(workflowId: string): WorkflowIdType {
  if (NUMERIC_PATTERN.test(workflowId)) {
    return 'numeric';
  }
  if (UUID_PATTERN.test(workflowId)) {
    return 'uuid';
  }
  return 'unknown';
}

/**
 * Check if the workflow ID is a valid UUID
 */
export function isUUID(workflowId: string): boolean {
  return UUID_PATTERN.test(workflowId);
}

/**
 * Check if the workflow ID is purely numeric
 */
export function isNumericId(workflowId: string): boolean {
  return NUMERIC_PATTERN.test(workflowId);
}

export interface ResolvedWorkflow {
  id: number;
  name: string;
  created_by: string;
  organization_id: string | null;
  status?: string;
  github_folder?: string | null;
  github_path?: string | null;
  is_public?: boolean | null;
  // Additional optional fields that routes may request
  total_versions?: number;
  current_version_id?: number | null;
  preferred_format?: string;
  typescript_metadata?: {
    steps?: Array<{
      id?: string;
      name?: string;
      description?: string;
      type?: string;
    }>;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown; // Allow additional fields from select
}

export interface ResolveResult {
  workflow: ResolvedWorkflow | null;
  error: string | null;
  idType: WorkflowIdType;
}

/**
 * Resolve a workflow by either numeric ID or UUID (github_folder)
 *
 * @param supabase - Supabase client
 * @param workflowId - Either a numeric ID string or UUID string
 * @param selectFields - Fields to select (default: common fields)
 * @returns The resolved workflow or error
 */
export async function resolveWorkflowId(
  supabase: SupabaseClient,
  workflowId: string,
  selectFields: string = 'id, name, created_by, organization_id, status, github_folder, github_path, is_public'
): Promise<ResolveResult> {
  const idType = detectWorkflowIdType(workflowId);

  if (idType === 'uuid') {
    // UUID - look up by github_folder (TypeScript workflow from desktop)
    console.log(`🔍 Resolving workflow by UUID (github_folder): ${workflowId}`);
    const { data, error } = await supabase
      .from('deployed_workflows')
      .select(selectFields)
      .eq('github_folder', workflowId)
      .single();

    if (error || !data) {
      return {
        workflow: null,
        error: `Workflow with UUID ${workflowId} not found`,
        idType,
      };
    }

    return { workflow: data as unknown as ResolvedWorkflow, error: null, idType };
  }

  if (idType === 'numeric') {
    // Numeric - look up by id
    const numericId = parseInt(workflowId, 10);
    console.log(`🔍 Resolving workflow by numeric ID: ${numericId}`);
    const { data, error } = await supabase
      .from('deployed_workflows')
      .select(selectFields)
      .eq('id', numericId)
      .single();

    if (error || !data) {
      return {
        workflow: null,
        error: `Workflow ${numericId} not found`,
        idType,
      };
    }

    return { workflow: data as unknown as ResolvedWorkflow, error: null, idType };
  }

  // Unknown format - try github_folder first (could be a non-standard UUID or hex string)
  console.log(
    `🔍 Unknown ID format, trying github_folder lookup: ${workflowId}`
  );
  const { data, error } = await supabase
    .from('deployed_workflows')
    .select(selectFields)
    .eq('github_folder', workflowId)
    .single();

  if (error || !data) {
    return {
      workflow: null,
      error: `Workflow ${workflowId} not found (tried github_folder lookup)`,
      idType,
    };
  }

  return { workflow: data as unknown as ResolvedWorkflow, error: null, idType };
}

/**
 * Get the numeric workflow ID from either format
 * Useful when you need the numeric ID for related table queries
 */
export async function getNumericWorkflowId(
  supabase: SupabaseClient,
  workflowId: string
): Promise<{ id: number | null; error: string | null }> {
  const idType = detectWorkflowIdType(workflowId);

  if (idType === 'numeric') {
    return { id: parseInt(workflowId, 10), error: null };
  }

  // Need to look up the numeric ID
  const result = await resolveWorkflowId(supabase, workflowId, 'id');
  if (result.error || !result.workflow) {
    return { id: null, error: result.error };
  }

  return { id: result.workflow.id, error: null };
}
