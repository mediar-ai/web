/**
 * Workflow Run Preferences - localStorage utility for remembering last run settings per org+workflow
 */

export interface WorkflowRunPreferences {
  inputs: Record<string, unknown>;
  machineId: string;
  executorType: 'python' | 'rust';
  versionNumber: string;
  lastUsed: number; // timestamp
}

const STORAGE_PREFIX = 'workflow-run-prefs';

function getStorageKey(orgId: string, workflowId: number): string {
  return `${STORAGE_PREFIX}:${orgId}:${workflowId}`;
}

export function getWorkflowRunPreferences(
  orgId: string,
  workflowId: number
): WorkflowRunPreferences | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = getStorageKey(orgId, workflowId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as WorkflowRunPreferences;
    return parsed;
  } catch (e) {
    console.error('[workflow-run-preferences] Failed to load preferences:', e);
    return null;
  }
}

export function saveWorkflowRunPreferences(
  orgId: string,
  workflowId: number,
  preferences: Omit<WorkflowRunPreferences, 'lastUsed'>
): void {
  if (typeof window === 'undefined') return;

  try {
    const key = getStorageKey(orgId, workflowId);
    const data: WorkflowRunPreferences = {
      ...preferences,
      lastUsed: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
    console.log('[workflow-run-preferences] Saved preferences for', key);
  } catch (e) {
    console.error('[workflow-run-preferences] Failed to save preferences:', e);
  }
}

export function clearWorkflowRunPreferences(
  orgId: string,
  workflowId: number
): void {
  if (typeof window === 'undefined') return;

  try {
    const key = getStorageKey(orgId, workflowId);
    localStorage.removeItem(key);
  } catch (e) {
    console.error('[workflow-run-preferences] Failed to clear preferences:', e);
  }
}
