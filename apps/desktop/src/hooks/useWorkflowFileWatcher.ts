import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useCallback } from "react";
import ignore, { type Ignore } from "ignore";

// Diff highlight info for external file changes - uses original content for merge view
export interface ExternalFileDiff {
  filePath: string;
  originalContent: string; // The "before" content for merge view to compute diff
  currentContent: string; // The "after" content for computing affected line ranges
}

interface UseWorkflowFileWatcherOptions {
  workflowId: string | null;
  workflowPath: string | null;
  enabled: boolean;
  debounceMs?: number;
  // Called when terminator.ts changes - triggers workflow structure re-parse
  // Also receives fresh files list for accurate step enrichment
  onTerminatorTsChange?: (
    newContent: string,
    files: Array<{ path: string; content: string; is_step: boolean }>
  ) => void;
  // Called when a step file changes - triggers step re-parse
  onStepFileChange?: (filePath: string, newContent: string) => void;
  // Called when any other file changes - updates file content view
  onFileContentChange?: (filePath: string, newContent: string) => void;
  // Called when file tree structure changes (file added/deleted)
  onFileTreeChange?: () => void;
  // Called when state.json changes (execution state updated)
  onStateFileChange?: () => void;
  // Called to record file edits for undo/redo history
  onRecordEdit?: (changes: { path: string; beforeContent: string; afterContent: string }[]) => void;
  // Called when external file changes are detected with diff info for highlighting
  onExternalDiff?: (diff: ExternalFileDiff) => void;
}

interface WorkflowFileChangedEvent {
  workflowId: string;
  changedPath: string;
  eventType: string;
}

type FileChangeType = "terminator" | "step" | "content" | "tree" | "state" | "ignore";

/**
 * Determines the type of file change based on the changed path and event type.
 */
function classifyFileChange(changedPath: string, eventType: string): FileChangeType {
  const normalizedPath = changedPath.replace(/\\/g, "/");
  const filename = normalizedPath.split("/").pop() || "";

  // state.json - execution state (handle before tree check so we can detect both create and modify)
  if (filename === "state.json") {
    return "state";
  }

  // File create/delete events affect the file tree
  if (eventType.includes("Create") || eventType.includes("Remove")) {
    return "tree";
  }

  // Folder changes (recordings, src) - debounced "Any" events need tree refresh
  // These folders get new files during recording/synthesis that need to appear in sidebar
  // Detect folders by: path is in recordings/ or src/ AND filename has no extension
  const lowerPath = normalizedPath.toLowerCase();
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(filename);
  const isInTargetFolder =
    lowerPath === "recordings" ||
    lowerPath === "src" ||
    lowerPath.startsWith("recordings/") ||
    lowerPath.startsWith("src/") ||
    lowerPath.includes("/recordings/") ||
    lowerPath.includes("/recordings") ||
    lowerPath.includes("/src/") ||
    lowerPath.includes("/src");

  if (isInTargetFolder && !hasExtension && filename && !filename.startsWith(".")) {
    console.log(`[FILE_WATCHER] Folder change detected: ${normalizedPath} (${eventType})`);
    return "tree";
  }

  // terminator.ts - workflow structure
  if (filename === "terminator.ts") {
    return "terminator";
  }

  // Step files in src/steps/ (handles both absolute and relative paths)
  if (normalizedPath.includes("src/steps/") && filename.endsWith(".ts")) {
    return "step";
  }

  // Other content files
  if (
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    filename.endsWith(".js") ||
    filename.endsWith(".json") ||
    filename.endsWith(".md")
  ) {
    return "content";
  }

  return "ignore";
}

/**
 * Watches a workflow's folder for file changes using Rust backend.
 * Handles different file types appropriately:
 * - terminator.ts: Re-parse workflow structure
 * - step files: Re-parse individual step
 * - other files: Update file content view
 * - file tree changes: Refresh sidebar
 */
export function useWorkflowFileWatcher({
  workflowId,
  workflowPath,
  enabled,
  debounceMs = 500,
  onTerminatorTsChange,
  onStepFileChange,
  onFileContentChange,
  onFileTreeChange,
  onStateFileChange,
  onRecordEdit,
  onExternalDiff,
}: UseWorkflowFileWatcherOptions) {
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentWorkflowIdRef = useRef<string | null>(null);

  // Content caches to detect actual changes and for history tracking
  const terminatorContentRef = useRef<string | null>(null);
  const stepContentCacheRef = useRef<Map<string, string>>(new Map());
  const otherContentCacheRef = useRef<Map<string, string>>(new Map());

  // Pending AI edits - files marked by AI chat before edit, triggers diff when change detected
  const pendingAIEditsRef = useRef<Set<string>>(new Set());

  // Active diff files - files currently showing diff to user (cache frozen until accept/reject)
  const activeDiffFilesRef = useRef<Set<string>>(new Set());

  // Gitignore instance for filtering file events
  const gitignoreRef = useRef<Ignore | null>(null);

  // Stable callback refs
  const onTerminatorTsChangeRef = useRef(onTerminatorTsChange);
  const onStepFileChangeRef = useRef(onStepFileChange);
  const onFileContentChangeRef = useRef(onFileContentChange);
  const onFileTreeChangeRef = useRef(onFileTreeChange);
  const onStateFileChangeRef = useRef(onStateFileChange);
  const onRecordEditRef = useRef(onRecordEdit);
  const onExternalDiffRef = useRef(onExternalDiff);

  useEffect(() => {
    onTerminatorTsChangeRef.current = onTerminatorTsChange;
    onStepFileChangeRef.current = onStepFileChange;
    onFileContentChangeRef.current = onFileContentChange;
    onFileTreeChangeRef.current = onFileTreeChange;
    onStateFileChangeRef.current = onStateFileChange;
    onRecordEditRef.current = onRecordEdit;
    onExternalDiffRef.current = onExternalDiff;
  }, [
    onTerminatorTsChange,
    onStepFileChange,
    onFileContentChange,
    onFileTreeChange,
    onStateFileChange,
    onRecordEdit,
    onExternalDiff,
  ]);

  // Pending changes to batch during debounce
  const pendingChangesRef = useRef<Map<string, { type: FileChangeType; path: string; eventType: string }>>(new Map());

  const startWatching = useCallback(async () => {
    if (!workflowPath || !workflowId || !enabled) {
      return;
    }

    // Stop existing watcher if any
    if (currentWorkflowIdRef.current) {
      try {
        await invoke("stop_workflow_watcher", { workflowId: currentWorkflowIdRef.current });
      } catch {
        // Ignore errors stopping previous watcher
      }
    }
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    try {
      console.log(`👁️ [FILE_WATCHER] Starting watcher for: ${workflowId}`);

      // Start the Rust file watcher
      await invoke("start_workflow_watcher", { workflowId });
      currentWorkflowIdRef.current = workflowId;

      // Initialize content caches to prevent false-positive changes
      try {
        const files = await invoke<{
          id: string;
          terminator_ts: string;
          steps: Array<{ path: string; content: string; is_step: boolean }>;
          package_json: string;
        }>("read_typescript_workflow_files", { workflowId });

        terminatorContentRef.current = files.terminator_ts;
        stepContentCacheRef.current.clear();
        for (const step of files.steps) {
          if (step.is_step) {
            stepContentCacheRef.current.set(step.path.replace(/\\/g, "/"), step.content);
          }
        }
        console.log(
          `📋 [FILE_WATCHER] Initialized caches: terminator=${files.terminator_ts.length} chars, ${stepContentCacheRef.current.size} step files`
        );
      } catch (err) {
        console.warn(`⚠️ [FILE_WATCHER] Could not initialize content caches:`, err);
      }

      // Load .gitignore patterns for filtering
      try {
        const result = await invoke<{ content: string }>("read_workflow_file", {
          workflowId,
          filePath: ".gitignore",
        });
        gitignoreRef.current = ignore().add(result.content);
        console.log(`📋 [FILE_WATCHER] Loaded .gitignore patterns`);
      } catch {
        // No .gitignore file - use default patterns
        gitignoreRef.current = ignore().add(["node_modules/", "dist/", "*.log", ".DS_Store"]);
        console.log(`📋 [FILE_WATCHER] No .gitignore found, using default patterns`);
      }

      // Listen for file change events from Rust
      const unlisten = await listen<WorkflowFileChangedEvent>("workflow-file-changed", event => {
        // Only handle events for our workflow
        if (event.payload.workflowId !== workflowId) {
          return;
        }

        const { changedPath, eventType } = event.payload;
        const normalizedPath = changedPath.replace(/\\/g, "/");
        const filename = normalizedPath.split("/").pop() || "unknown";

        // Check gitignore patterns first
        if (gitignoreRef.current?.ignores(normalizedPath)) {
          console.log(`⏭️ [FILE_WATCHER] Gitignore: ${filename}`);
          return;
        }

        const changeType = classifyFileChange(changedPath, eventType);

        if (changeType === "ignore") {
          console.log(`⏭️ [FILE_WATCHER] Ignoring ${filename}: ${eventType}`);
          return;
        }

        console.log(`📝 [FILE_WATCHER] ${filename} (${changeType}): ${eventType}`);

        // Add to pending changes
        pendingChangesRef.current.set(changedPath, { type: changeType, path: changedPath, eventType });

        // Debounce to batch rapid changes
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(async () => {
          const changes = new Map(pendingChangesRef.current);
          pendingChangesRef.current.clear();

          try {
            // Determine what needs to be done
            let needsTerminatorReparse = false;
            let needsFileTreeRefresh = false;
            let needsStateRefresh = false;
            const stepFilesToReparse: string[] = [];
            const contentFilesToUpdate: string[] = [];

            for (const [, change] of changes) {
              switch (change.type) {
                case "terminator":
                  needsTerminatorReparse = true;
                  break;
                case "step":
                  stepFilesToReparse.push(change.path);
                  break;
                case "content":
                  contentFilesToUpdate.push(change.path);
                  break;
                case "tree":
                  needsFileTreeRefresh = true;
                  break;
                case "state":
                  needsStateRefresh = true;
                  break;
              }
            }

            // Handle state.json changes (execution state updated)
            if (needsStateRefresh && onStateFileChangeRef.current) {
              try {
                console.log(`📊 [FILE_WATCHER] state.json changed, refreshing execution state`);
                onStateFileChangeRef.current();
              } catch (stateErr) {
                console.error(`❌ [FILE_WATCHER] State refresh failed (non-fatal):`, stateErr);
              }
            }

            // Handle file tree changes first (may affect other operations)
            if (needsFileTreeRefresh && onFileTreeChangeRef.current) {
              try {
                console.log(`🌳 [FILE_WATCHER] Refreshing file tree`);
                onFileTreeChangeRef.current();
              } catch (treeErr) {
                console.error(`❌ [FILE_WATCHER] File tree refresh failed (non-fatal):`, treeErr);
              }
            }

            // Read files once for all operations (optimization)
            let files: {
              id: string;
              terminator_ts: string;
              steps: Array<{ path: string; content: string; is_step: boolean }>;
              package_json: string;
            };
            try {
              files = await invoke("read_typescript_workflow_files", { workflowId });
            } catch (readErr) {
              console.error(`❌ [FILE_WATCHER] Failed to read workflow files:`, readErr);
              return; // Can't continue without files
            }

            // Collect all edits for history recording
            const editChanges: { path: string; beforeContent: string; afterContent: string }[] = [];

            // Handle terminator.ts changes
            if (needsTerminatorReparse) {
              try {
                const beforeContent = terminatorContentRef.current;
                const afterContent = files.terminator_ts;

                if (afterContent !== beforeContent) {
                  console.log(`🔄 [FILE_WATCHER] terminator.ts changed, triggering re-parse`);

                  // Check if this is a pending AI edit - trigger diff highlighting
                  const isPendingAIEdit =
                    pendingAIEditsRef.current.has("terminator.ts") ||
                    pendingAIEditsRef.current.has("src/terminator.ts");

                  // Check if this file already has an active diff (cache frozen)
                  const hasActiveDiff =
                    activeDiffFilesRef.current.has("terminator.ts") ||
                    activeDiffFilesRef.current.has("src/terminator.ts");

                  // Track if we're triggering a new diff (cache should freeze)
                  let triggeredNewDiff = false;

                  if (isPendingAIEdit && beforeContent !== null && onExternalDiffRef.current) {
                    console.log(`🎨 [FILE_WATCHER] AI edit detected, triggering diff for terminator.ts`);
                    onExternalDiffRef.current({
                      filePath: "src/terminator.ts",
                      originalContent: beforeContent,
                      currentContent: afterContent,
                    });
                    pendingAIEditsRef.current.delete("terminator.ts");
                    pendingAIEditsRef.current.delete("src/terminator.ts");
                    // Mark as active diff - cache will be frozen until accept/reject
                    activeDiffFilesRef.current.add("src/terminator.ts");
                    triggeredNewDiff = true;
                  }

                  // Record edit if we have before content
                  if (beforeContent !== null) {
                    editChanges.push({
                      path: "src/terminator.ts",
                      beforeContent,
                      afterContent,
                    });
                  }

                  // Only update cache if no active diff AND didn't just trigger one
                  // (preserve baseline for cumulative diff)
                  if (!hasActiveDiff && !triggeredNewDiff) {
                    terminatorContentRef.current = afterContent;
                    console.log(`📝 [FILE_WATCHER] Cache updated for terminator.ts`);
                  } else {
                    console.log(`🔒 [FILE_WATCHER] Cache frozen for terminator.ts (active diff)`);
                  }
                  if (onTerminatorTsChangeRef.current) {
                    onTerminatorTsChangeRef.current(afterContent, files.steps);
                  }
                } else {
                  console.log(`⏭️ [FILE_WATCHER] terminator.ts content unchanged`);
                }
              } catch (terminatorErr) {
                console.error(`❌ [FILE_WATCHER] Terminator.ts handling failed (non-fatal):`, terminatorErr);
              }
            }

            // Handle step file changes
            for (const stepPath of stepFilesToReparse) {
              try {
                const normalizedPath = stepPath.replace(/\\/g, "/");
                const stepFile = files.steps.find(s => s.path.replace(/\\/g, "/") === normalizedPath);

                if (stepFile) {
                  const beforeContent = stepContentCacheRef.current.get(normalizedPath);
                  const afterContent = stepFile.content;

                  if (afterContent !== beforeContent) {
                    console.log(`🔄 [FILE_WATCHER] Step file changed: ${normalizedPath.split("/").pop()}`);

                    // Check if this is a pending AI edit - trigger diff highlighting
                    const isPendingAIEdit =
                      pendingAIEditsRef.current.has(normalizedPath) ||
                      pendingAIEditsRef.current.has(`src/${normalizedPath}`) ||
                      pendingAIEditsRef.current.has(normalizedPath.replace(/^src\//, ""));

                    // Check if this file already has an active diff (cache frozen)
                    const hasActiveDiff =
                      activeDiffFilesRef.current.has(normalizedPath) ||
                      activeDiffFilesRef.current.has(`src/${normalizedPath}`) ||
                      activeDiffFilesRef.current.has(normalizedPath.replace(/^src\//, ""));

                    // Track if we're triggering a new diff (cache should freeze)
                    let triggeredNewDiff = false;

                    if (isPendingAIEdit && beforeContent !== undefined && onExternalDiffRef.current) {
                      console.log(`🎨 [FILE_WATCHER] AI edit detected, triggering diff for ${normalizedPath}`);
                      onExternalDiffRef.current({
                        filePath: normalizedPath,
                        originalContent: beforeContent,
                        currentContent: afterContent,
                      });
                      // Clear all variations of this path from pending set
                      pendingAIEditsRef.current.delete(normalizedPath);
                      pendingAIEditsRef.current.delete(`src/${normalizedPath}`);
                      pendingAIEditsRef.current.delete(normalizedPath.replace(/^src\//, ""));
                      // Mark as active diff - cache will be frozen until accept/reject
                      activeDiffFilesRef.current.add(normalizedPath);
                      triggeredNewDiff = true;
                    }

                    // Record edit if we have before content
                    if (beforeContent !== undefined) {
                      // Use normalizedPath directly - it's already relative from workflow root (e.g., "src/steps/01-main.ts")
                      editChanges.push({
                        path: normalizedPath,
                        beforeContent,
                        afterContent,
                      });
                    }

                    // Only update cache if no active diff AND didn't just trigger one
                    // (preserve baseline for cumulative diff)
                    if (!hasActiveDiff && !triggeredNewDiff) {
                      stepContentCacheRef.current.set(normalizedPath, afterContent);
                      console.log(`📝 [FILE_WATCHER] Cache updated for ${normalizedPath}`);
                    } else {
                      console.log(`🔒 [FILE_WATCHER] Cache frozen for ${normalizedPath} (active diff)`);
                    }
                    if (onStepFileChangeRef.current) {
                      onStepFileChangeRef.current(normalizedPath, afterContent);
                    }
                  } else {
                    console.log(`⏭️ [FILE_WATCHER] Step file content unchanged: ${normalizedPath.split("/").pop()}`);
                  }
                }
              } catch (stepErr) {
                console.error(`❌ [FILE_WATCHER] Step file handling failed (non-fatal):`, stepErr);
              }
            }

            // Handle other content file changes
            for (const contentPath of contentFilesToUpdate) {
              try {
                const normalizedPath = contentPath.replace(/\\/g, "/");
                const filename = normalizedPath.split("/").pop() || "";

                // Find the content from available sources
                let afterContent: string | null = null;
                if (filename === "package.json") {
                  afterContent = files.package_json;
                } else if (normalizedPath.endsWith("terminator.ts")) {
                  afterContent = files.terminator_ts;
                } else {
                  const stepFile = files.steps.find(s => s.path.replace(/\\/g, "/") === normalizedPath);
                  if (stepFile) {
                    afterContent = stepFile.content;
                  }
                }

                if (afterContent !== null) {
                  const beforeContent = otherContentCacheRef.current.get(normalizedPath);

                  // Check if this file already has an active diff (cache frozen)
                  const hasActiveDiff =
                    activeDiffFilesRef.current.has(normalizedPath) ||
                    activeDiffFilesRef.current.has(`src/${normalizedPath}`) ||
                    activeDiffFilesRef.current.has(normalizedPath.replace(/^src\//, ""));

                  // Record edit if content actually changed and we have before content
                  if (beforeContent !== undefined && afterContent !== beforeContent) {
                    const relativePath = normalizedPath.includes("/src/")
                      ? normalizedPath.substring(normalizedPath.indexOf("/src/") + 1)
                      : filename;
                    editChanges.push({
                      path: relativePath,
                      beforeContent,
                      afterContent,
                    });
                  }

                  // Only update cache if no active diff (preserve baseline for cumulative diff)
                  if (!hasActiveDiff) {
                    otherContentCacheRef.current.set(normalizedPath, afterContent);
                    console.log(`📄 [FILE_WATCHER] Content file changed: ${filename}`);
                  } else {
                    console.log(`🔒 [FILE_WATCHER] Cache frozen for ${filename} (active diff)`);
                  }
                  if (onFileContentChangeRef.current) {
                    onFileContentChangeRef.current(normalizedPath, afterContent);
                  }
                }
              } catch (contentErr) {
                console.error(`❌ [FILE_WATCHER] Content file handling failed (non-fatal):`, contentErr);
              }
            }

            // Record all edits to history (non-critical, wrapped in try-catch)
            if (editChanges.length > 0 && onRecordEditRef.current) {
              try {
                console.log(`📜 [FILE_WATCHER] Recording ${editChanges.length} edit(s) to history`);
                onRecordEditRef.current(editChanges);
              } catch (historyErr) {
                console.error(`❌ [FILE_WATCHER] Failed to record history (non-fatal):`, historyErr);
              }
            }

            // NOTE: Diff highlighting is triggered for files marked via markPendingAIEdit().
            // AI chat calls markPendingAIEdit() before edit, then file watcher triggers diff
            // with correct before/after content when the change is detected.
          } catch (err) {
            console.error(`❌ [FILE_WATCHER] Failed to process file changes:`, err);
          }
        }, debounceMs);
      });

      unlistenRef.current = unlisten;
      console.log(`✅ [FILE_WATCHER] Watcher started successfully`);
    } catch (err) {
      console.error(`❌ [FILE_WATCHER] Failed to start watcher:`, err);
    }
  }, [workflowPath, workflowId, enabled, debounceMs]);

  // Start/stop watcher based on workflow and enabled state
  useEffect(() => {
    if (enabled && workflowPath && workflowId) {
      startWatching();
    }

    return () => {
      if (unlistenRef.current) {
        console.log(`🛑 [FILE_WATCHER] Stopping event listener`);
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (currentWorkflowIdRef.current) {
        console.log(`🛑 [FILE_WATCHER] Stopping Rust watcher`);
        invoke("stop_workflow_watcher", { workflowId: currentWorkflowIdRef.current }).catch(() => {
          // Ignore errors on cleanup
        });
        currentWorkflowIdRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      terminatorContentRef.current = null;
      stepContentCacheRef.current.clear();
      otherContentCacheRef.current.clear();
      pendingChangesRef.current.clear();
    };
  }, [enabled, workflowPath, workflowId, startWatching]);

  // Manual refresh function
  const refreshNow = useCallback(async () => {
    if (!workflowId) return;

    try {
      const files = await invoke<{
        id: string;
        terminator_ts: string;
        steps: Array<{ path: string; content: string; is_step: boolean }>;
        package_json: string;
      }>("read_typescript_workflow_files", { workflowId });

      terminatorContentRef.current = files.terminator_ts;
      if (onTerminatorTsChangeRef.current) {
        onTerminatorTsChangeRef.current(files.terminator_ts, files.steps);
      }
    } catch (err) {
      console.error(`❌ [FILE_WATCHER] Manual refresh failed:`, err);
    }
  }, [workflowId]);

  // Mark a file as pending AI edit - when file watcher detects change, it will trigger diff
  const markPendingAIEdit = useCallback((filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    // Also add common path variations to catch the file regardless of how it's reported
    pendingAIEditsRef.current.add(normalized);
    if (!normalized.startsWith("src/")) {
      pendingAIEditsRef.current.add(`src/${normalized}`);
    }
    if (normalized.startsWith("src/")) {
      pendingAIEditsRef.current.add(normalized.slice(4));
    }
    console.log(`🎯 [FILE_WATCHER] Marked pending AI edit: ${normalized}`);
  }, []);

  // Accept diff for a file - unfreeze cache and update to current content
  const acceptDiff = useCallback((filePath: string, currentContent: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    console.log(`[FILE_WATCHER] Accepting diff for ${normalized}`);

    // Remove from active diff set
    activeDiffFilesRef.current.delete(normalized);
    activeDiffFilesRef.current.delete(`src/${normalized}`);
    activeDiffFilesRef.current.delete(normalized.replace(/^src\//, ""));

    // Update cache to current content (new baseline)
    if (normalized === "src/terminator.ts" || normalized === "terminator.ts") {
      terminatorContentRef.current = currentContent;
      console.log(`[FILE_WATCHER] Cache updated for terminator.ts after accept`);
    } else if (normalized.includes("/steps/") || normalized.startsWith("steps/")) {
      stepContentCacheRef.current.set(normalized, currentContent);
      console.log(`[FILE_WATCHER] Cache updated for step ${normalized} after accept`);
    } else {
      otherContentCacheRef.current.set(normalized, currentContent);
      console.log(`[FILE_WATCHER] Cache updated for ${normalized} after accept`);
    }
  }, []);

  // Accept all diffs - unfreeze all caches
  const acceptAllDiffs = useCallback(
    (files: Array<{ filePath: string; currentContent: string }>) => {
      console.log(`[FILE_WATCHER] Accepting all diffs (${files.length} files)`);
      for (const file of files) {
        acceptDiff(file.filePath, file.currentContent);
      }
    },
    [acceptDiff]
  );

  // Clear active diff for a file without updating cache (for reject - cache already has baseline)
  const clearActiveDiff = useCallback((filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    activeDiffFilesRef.current.delete(normalized);
    activeDiffFilesRef.current.delete(`src/${normalized}`);
    activeDiffFilesRef.current.delete(normalized.replace(/^src\//, ""));
    console.log(`[FILE_WATCHER] Cleared active diff for ${normalized} (cache preserved as baseline)`);
  }, []);

  // Clear all active diffs (for reject all)
  const clearAllActiveDiffs = useCallback(() => {
    console.log(`[FILE_WATCHER] Clearing all active diffs (${activeDiffFilesRef.current.size} files)`);
    activeDiffFilesRef.current.clear();
  }, []);

  return { refreshNow, markPendingAIEdit, acceptDiff, acceptAllDiffs, clearActiveDiff, clearAllActiveDiffs };
}
