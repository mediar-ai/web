import { invoke } from "@tauri-apps/api/core";
import { useRef, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

// Auto-sync interval: once per day (24 hours in ms)
const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Remote check interval: every 10 minutes
const REMOTE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

interface PublishResult {
  success: boolean;
  workflow_id: number;
  version: string;
  step_count: number;
}

interface PullResult {
  success: boolean;
  workflow_id: string;
  version: string;
  files_updated: number;
}

interface SyncMetadata {
  last_synced_at: string | null;
  cloud_workflow_id: number | null;
  cloud_version: string | null;
}

interface RemoteSyncStatus {
  has_remote: boolean;
  remote_updated_at: string | null;
  local_synced_at: string | null;
  needs_pull: boolean;
  remote_version: string | null;
  local_version: string | null;
  is_owner: boolean;
}

export type SyncAction = "push" | "pull" | "conflict" | "up_to_date" | "no_remote" | "not_owner";

interface SyncState {
  action: SyncAction;
  remoteVersion: string | null;
  localVersion: string | null;
}

/**
 * Hook to handle TypeScript workflow sync with cloud.
 * - Smart sync: checks cloud first, then pulls or pushes
 * - Auto-pulls on load if remote is newer
 * - Auto-pulls every 10 minutes if remote changes detected
 * - Auto-publishes daily
 */
export function useWorkflowPublish(
  workflowId: string | undefined,
  workflowName: string,
  description?: string,
  enabled: boolean = true
) {
  const [needsPull, setNeedsPull] = useState(false);
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  // Refs to prevent duplicate calls and track initialization
  const isSyncingRef = useRef(false);
  const hasInitializedRef = useRef<string | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store latest values in refs for use in callbacks without adding dependencies
  const latestValuesRef = useRef({ workflowName, description });
  latestValuesRef.current = { workflowName, description };

  const isTypescriptWorkflow = typeof workflowId === "string";

  // Internal pull function (doesn't check isSyncingRef to allow being called from checkRemoteStatus)
  const doPull = useCallback(async () => {
    if (!isTypescriptWorkflow || !workflowId) {
      return { success: false, error: "Not a TypeScript workflow" };
    }

    try {
      console.log(`[Pull] Pulling workflow ${workflowId} from cloud...`);

      const result = await invoke<PullResult>("pull_typescript_workflow", {
        workflowId: String(workflowId),
      });

      if (result.success) {
        toast.success(`Pulled from cloud (v${result.version})`, {
          description: `Updated ${result.files_updated} files`,
        });
        setNeedsPull(false);
        setSyncState({ action: "up_to_date", remoteVersion: result.version, localVersion: result.version });
        return { success: true, result };
      }

      return { success: false, error: "Unknown error" };
    } catch (error) {
      console.error("[Pull] Failed:", error);
      toast.error(`Failed to pull: ${error}`);
      return { success: false, error: String(error) };
    }
  }, [isTypescriptWorkflow, workflowId]);

  // Check remote status and optionally auto-pull if remote is newer
  const checkRemoteStatus = useCallback(
    async (autoPull: boolean = false): Promise<SyncState | null> => {
      if (!enabled || !isTypescriptWorkflow || !workflowId) return null;

      try {
        const status = await invoke<RemoteSyncStatus>("check_remote_workflow_status", {
          workflowId: String(workflowId),
        });

        let action: SyncAction;
        if (!status.has_remote) {
          action = "no_remote";
        } else if (!status.is_owner) {
          // Workflow exists but belongs to another user - don't sync
          action = "not_owner";
          console.log("[Sync] Workflow belongs to another user - sync disabled");
        } else if (status.needs_pull) {
          action = "pull";
          setNeedsPull(true);
          setRemoteUpdatedAt(status.remote_updated_at);
        } else {
          action = "up_to_date";
          setNeedsPull(false);
        }

        const state: SyncState = {
          action,
          remoteVersion: status.remote_version,
          localVersion: status.local_version,
        };
        setSyncState(state);

        // Auto-pull if remote is newer and autoPull is enabled
        if (autoPull && action === "pull" && !isSyncingRef.current) {
          console.log("[Sync] Auto-pulling remote changes...");
          isSyncingRef.current = true;
          try {
            await doPull();
          } finally {
            isSyncingRef.current = false;
          }
        }

        return state;
      } catch (error) {
        console.error("[Sync] Failed to check remote status:", error);
        return null;
      }
    },
    [enabled, isTypescriptWorkflow, workflowId, doPull]
  );

  // Pull from cloud (download remote changes) - public API with guard
  const pullFromCloud = useCallback(async () => {
    if (!isTypescriptWorkflow || !workflowId) {
      return { success: false, error: "Not a TypeScript workflow" };
    }

    if (isSyncingRef.current) {
      console.log("[Pull] Already syncing, skipping");
      return { success: false, error: "Already syncing" };
    }

    isSyncingRef.current = true;
    try {
      return await doPull();
    } finally {
      isSyncingRef.current = false;
    }
  }, [isTypescriptWorkflow, workflowId, doPull]);

  // Push to cloud (publish local changes)
  const pushToCloud = useCallback(async () => {
    if (!isTypescriptWorkflow || !workflowId) {
      return { success: false, error: "Not a TypeScript workflow" };
    }

    if (isSyncingRef.current) {
      console.log("[Push] Already syncing, skipping");
      return { success: false, error: "Already syncing" };
    }

    isSyncingRef.current = true;
    const { workflowName: name, description: desc } = latestValuesRef.current;

    try {
      console.log(`[Push] Pushing "${name}" to cloud...`);

      const result = await invoke<PublishResult>("publish_typescript_workflow", {
        input: {
          workflow_id: String(workflowId),
          name,
          description: desc,
        },
      });

      if (result.success) {
        toast.success(`Pushed to cloud (v${result.version})`);
        setNeedsPull(false);
        setSyncState({ action: "up_to_date", remoteVersion: result.version, localVersion: result.version });
        return { success: true, result };
      }

      return { success: false, error: "Unknown error" };
    } catch (error) {
      console.error("[Push] Failed:", error);
      toast.error(`Failed to push: ${error}`);
      return { success: false, error: String(error) };
    } finally {
      isSyncingRef.current = false;
    }
  }, [isTypescriptWorkflow, workflowId]);

  // Smart sync: check cloud first, then pull or push based on state
  const smartSync = useCallback(
    async (forceAction?: "pull" | "push") => {
      if (!isTypescriptWorkflow || !workflowId) {
        return { success: false, error: "Not a TypeScript workflow" };
      }

      if (isSyncingRef.current) {
        console.log("[SmartSync] Already syncing, skipping");
        return { success: false, error: "Already syncing" };
      }

      console.log("[SmartSync] Starting smart sync...");

      // If force action specified, do that
      if (forceAction === "pull") {
        return pullFromCloud();
      }
      if (forceAction === "push") {
        return pushToCloud();
      }

      // Check remote status first (without auto-pull since we handle it here)
      const status = await checkRemoteStatus(false);
      if (!status) {
        return { success: false, error: "Failed to check remote status" };
      }

      console.log("[SmartSync] Remote status:", status);

      switch (status.action) {
        case "no_remote":
          // No remote version exists, push local to cloud
          console.log("[SmartSync] No remote found, pushing...");
          return pushToCloud();

        case "not_owner":
          // Workflow belongs to another user - sync disabled
          console.log("[SmartSync] Workflow owned by another user - sync disabled");
          return { success: false, error: "Cannot sync workflow owned by another user" };

        case "pull":
          // Remote has newer version, pull it
          console.log("[SmartSync] Remote is newer, pulling...");
          return pullFromCloud();

        case "up_to_date":
          // Already in sync, but push anyway to ensure cloud has latest
          console.log("[SmartSync] Up to date, pushing local changes...");
          return pushToCloud();

        case "conflict":
          // Both have changes - let caller handle this
          console.log("[SmartSync] Conflict detected");
          return { success: false, action: "conflict", error: "Both local and remote have changes" };

        default:
          return { success: false, error: "Unknown sync state" };
      }
    },
    [isTypescriptWorkflow, workflowId, checkRemoteStatus, pullFromCloud, pushToCloud]
  );

  // Legacy publishNow - now wraps smartSync for backwards compatibility
  const publishNow = useCallback(async () => {
    return smartSync();
  }, [smartSync]);

  // Auto-sync on mount and periodic checks
  useEffect(() => {
    if (!enabled || !isTypescriptWorkflow || !workflowId) return;

    // Reset initialization flag when workflow changes
    const workflowKey = String(workflowId);
    if (hasInitializedRef.current === workflowKey) return;
    hasInitializedRef.current = workflowKey;

    const runInitialChecks = async () => {
      // Check for remote changes first (without auto-pull - we handle it below)
      console.log("[Sync] Initial check - checking remote status...");
      const status = await checkRemoteStatus(false);

      // Skip all sync operations for workflows owned by other users
      if (status?.action === "not_owner") {
        console.log("[Sync] Workflow owned by another user - skipping all sync");
        return;
      }

      // CRITICAL: If workflow doesn't exist in cloud, force push immediately
      // This ensures manually copied/cloned workflows get synced to cloud
      if (status?.action === "no_remote" && !isSyncingRef.current) {
        console.log("[Sync] No remote found - force pushing to create cloud record");
        await pushToCloud();
        return; // Done - no need for further checks
      }

      // Auto-pull if remote is newer
      if (status?.action === "pull" && !isSyncingRef.current) {
        console.log("[Sync] Remote is newer - auto-pulling...");
        isSyncingRef.current = true;
        try {
          await doPull();
        } finally {
          isSyncingRef.current = false;
        }
        return;
      }

      // Check if we should auto-push (more than 24h since last sync)
      try {
        const metadata = await invoke<SyncMetadata>("get_workflow_sync_metadata", {
          workflowId: workflowKey,
        });

        const shouldSync =
          !metadata.last_synced_at || Date.now() - new Date(metadata.last_synced_at).getTime() > AUTO_SYNC_INTERVAL_MS;

        if (shouldSync && !isSyncingRef.current) {
          console.log("[Sync] Auto-pushing (more than 24h since last sync)");
          await pushToCloud();
        }
      } catch {
        // Ignore metadata fetch errors
      }
    };

    runInitialChecks();

    // Set up 10-minute polling for remote changes with auto-pull
    checkIntervalRef.current = setInterval(() => {
      console.log("[Sync] Periodic check - will auto-pull if remote is newer");
      checkRemoteStatus(true); // autoPull = true
    }, REMOTE_CHECK_INTERVAL_MS);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [enabled, isTypescriptWorkflow, workflowId, checkRemoteStatus, pushToCloud, doPull]);

  return {
    // Smart sync (recommended)
    smartSync,
    pullFromCloud,
    pushToCloud,

    // State
    needsPull,
    remoteUpdatedAt,
    syncState,
    isTypescriptWorkflow,

    // Legacy
    publishNow,
    checkRemoteStatus,
  };
}
