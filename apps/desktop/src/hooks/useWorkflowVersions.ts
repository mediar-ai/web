import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect } from "react";

/**
 * Represents a saved version/snapshot of a workflow
 */
export interface WorkflowVersion {
  id: string; // UUID
  workflowId: string;
  versionNumber: number;
  message: string | null; // User-provided or auto-generated message
  authorType: "user" | "ai" | "auto"; // Who created this version
  createdAt: string; // ISO timestamp
  changedFiles: string[]; // List of file paths that changed
  diffSummary: string | null; // AI-generated summary of changes (future)
}

/**
 * Result of listing workflow versions
 */
export interface ListVersionsResult {
  versions: WorkflowVersion[];
  totalCount: number;
}

/**
 * Result of restoring a version
 */
export interface RestoreVersionResult {
  success: boolean;
  error: string | null;
  restoredFiles: string[];
}

interface UseWorkflowVersionsOptions {
  workflowId: string | null;
  workflowPath: string | null;
  onVersionRestored?: (files: string[]) => void;
}

/**
 * Hook for managing workflow version history.
 * Provides save, list, and restore functionality for workflow snapshots.
 */
export function useWorkflowVersions({ workflowId, workflowPath, onVersionRestored }: UseWorkflowVersionsOptions) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load versions when workflow changes
  useEffect(() => {
    if (!workflowId || !workflowPath) {
      setVersions([]);
      return;
    }

    const loadVersions = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await invoke<ListVersionsResult>("list_workflow_versions", {
          workflowPath,
        });
        setVersions(result.versions);
      } catch (err) {
        console.error("[VERSION_HISTORY] Failed to load versions:", err);
        setError(String(err));
        setVersions([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadVersions();
  }, [workflowId, workflowPath]);

  /**
   * Save current workflow state as a new version
   */
  const saveVersion = useCallback(
    async (message?: string, authorType: "user" | "ai" | "auto" = "user"): Promise<WorkflowVersion | null> => {
      if (!workflowId || !workflowPath) return null;

      setIsSaving(true);
      setError(null);
      try {
        const version = await invoke<WorkflowVersion>("save_workflow_version", {
          workflowPath,
          message: message || null,
          authorType,
        });

        // Prepend new version to list
        setVersions(prev => [version, ...prev]);

        console.log(`📸 [VERSION_HISTORY] Saved version ${version.versionNumber}: ${message || "(auto)"}`);
        return version;
      } catch (err) {
        console.error("[VERSION_HISTORY] Failed to save version:", err);
        setError(String(err));
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [workflowId, workflowPath]
  );

  /**
   * Restore workflow to a specific version.
   * Auto-saves current state before restoring (Notion-like behavior).
   */
  const restoreVersion = useCallback(
    async (versionId: string): Promise<RestoreVersionResult> => {
      if (!workflowId || !workflowPath) {
        return { success: false, error: "No workflow loaded", restoredFiles: [] };
      }

      // Find the target version to get its version number for the message
      const targetVersion = versions.find(v => v.id === versionId);
      const targetVersionNum = targetVersion?.versionNumber ?? "?";

      setIsRestoring(true);
      setError(null);
      try {
        // Auto-save current state before restoring (so user can always go back)
        const savedVersion = await invoke<WorkflowVersion>("save_workflow_version", {
          workflowPath,
          message: `Before restoring to v${targetVersionNum}`,
          authorType: "auto",
        });
        console.log(`📸 [VERSION_HISTORY] Auto-saved v${savedVersion.versionNumber} before restore`);

        // Now restore the target version
        const result = await invoke<RestoreVersionResult>("restore_workflow_version", {
          workflowPath,
          versionId,
        });

        if (result.success) {
          // Refresh versions list to show the new auto-saved version
          const refreshResult = await invoke<ListVersionsResult>("list_workflow_versions", {
            workflowPath,
          });
          setVersions(refreshResult.versions);

          if (onVersionRestored) {
            onVersionRestored(result.restoredFiles);
          }
        }

        console.log(`⏪ [VERSION_HISTORY] Restored to v${targetVersionNum}: ${result.restoredFiles.length} files`);
        return result;
      } catch (err) {
        console.error("[VERSION_HISTORY] Failed to restore version:", err);
        const errorMsg = String(err);
        setError(errorMsg);
        return { success: false, error: errorMsg, restoredFiles: [] };
      } finally {
        setIsRestoring(false);
      }
    },
    [workflowId, workflowPath, versions, onVersionRestored]
  );

  /**
   * Delete a specific version
   */
  const deleteVersion = useCallback(
    async (versionId: string): Promise<boolean> => {
      if (!workflowPath) return false;

      try {
        await invoke("delete_workflow_version", {
          workflowPath,
          versionId,
        });

        // Remove from local state
        setVersions(prev => prev.filter(v => v.id !== versionId));

        console.log(`🗑️ [VERSION_HISTORY] Deleted version ${versionId}`);
        return true;
      } catch (err) {
        console.error("[VERSION_HISTORY] Failed to delete version:", err);
        setError(String(err));
        return false;
      }
    },
    [workflowPath]
  );

  /**
   * Refresh versions list
   */
  const refreshVersions = useCallback(async () => {
    if (!workflowPath) return;

    setIsLoading(true);
    try {
      const result = await invoke<ListVersionsResult>("list_workflow_versions", {
        workflowPath,
      });
      setVersions(result.versions);
    } catch (err) {
      console.error("[VERSION_HISTORY] Failed to refresh versions:", err);
    } finally {
      setIsLoading(false);
    }
  }, [workflowPath]);

  return {
    versions,
    isLoading,
    isSaving,
    isRestoring,
    error,
    saveVersion,
    restoreVersion,
    deleteVersion,
    refreshVersions,
    hasVersions: versions.length > 0,
  };
}
