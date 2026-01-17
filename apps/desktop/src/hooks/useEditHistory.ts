import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect } from "react";

export interface EditHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  historyCount: number;
  currentIndex: number;
}

export interface RestoredFile {
  path: string;
  content: string;
  originalContent: string; // Content before restore - for merge view diff
}

export interface UndoRedoResult {
  success: boolean;
  error: string | null;
  restoredFiles: RestoredFile[];
  canUndo: boolean;
  canRedo: boolean;
}

interface UseEditHistoryOptions {
  workflowId: string | null;
  onFilesRestored?: (files: RestoredFile[]) => void;
}

/**
 * Hook for managing edit history (undo/redo) for workflow files.
 * Integrates with the Rust backend for persistent history storage.
 */
export function useEditHistory({ workflowId, onFilesRestored }: UseEditHistoryOptions) {
  const [state, setState] = useState<EditHistoryState>({
    canUndo: false,
    canRedo: false,
    historyCount: 0,
    currentIndex: -1,
  });
  const [isLoading, setIsLoading] = useState(false);

  // Initialize edit history when workflow changes
  useEffect(() => {
    if (!workflowId) {
      setState({
        canUndo: false,
        canRedo: false,
        historyCount: 0,
        currentIndex: -1,
      });
      return;
    }

    const initHistory = async () => {
      try {
        const result = await invoke<{
          can_undo: boolean;
          can_redo: boolean;
          history_count: number;
          current_index: number;
        }>("init_edit_history", { workflowId });

        setState({
          canUndo: result.can_undo,
          canRedo: result.can_redo,
          historyCount: result.history_count,
          currentIndex: result.current_index,
        });

        console.log(`📜 [EDIT_HISTORY] Initialized: canUndo=${result.can_undo}, canRedo=${result.can_redo}`);
      } catch (error) {
        console.error("Failed to initialize edit history:", error);
      }
    };

    initHistory();
  }, [workflowId]);

  // Record a file edit (called by file watcher)
  const recordEdit = useCallback(
    async (changes: { path: string; beforeContent: string; afterContent: string }[]) => {
      if (!workflowId || changes.length === 0) return;

      console.log(
        `📝 [EDIT_HISTORY_HOOK] Starting record_file_edit invoke for ${workflowId} with ${changes.length} changes`
      );
      console.log(
        `📝 [EDIT_HISTORY_HOOK] First change: path=${changes[0]?.path}, before=${changes[0]?.beforeContent?.length ?? "null"} bytes, after=${changes[0]?.afterContent?.length ?? "null"} bytes`
      );

      try {
        const result = await invoke<{
          can_undo: boolean;
          can_redo: boolean;
          history_count: number;
          current_index: number;
        }>("record_file_edit", {
          workflowId,
          changes: changes.map(c => ({
            path: c.path,
            before_content: c.beforeContent,
            after_content: c.afterContent,
          })),
        });

        console.log(`📝 [EDIT_HISTORY_HOOK] record_file_edit invoke returned successfully`);

        setState({
          canUndo: result.can_undo,
          canRedo: result.can_redo,
          historyCount: result.history_count,
          currentIndex: result.current_index,
        });

        console.log(`📝 [EDIT_HISTORY] Recorded edit: ${changes.length} files, history=${result.history_count}`);
      } catch (error) {
        console.error("❌ [EDIT_HISTORY_HOOK] Failed to record edit:", error);
      }
    },
    [workflowId]
  );

  // Undo the last edit
  const undo = useCallback(async (): Promise<UndoRedoResult | null> => {
    if (!workflowId || !state.canUndo || isLoading) return null;

    setIsLoading(true);
    try {
      const result = await invoke<{
        success: boolean;
        error: string | null;
        restored_files: Array<{
          path: string;
          content: string;
          original_content: string; // Content before restore (what we're undoing from)
        }>;
        can_undo: boolean;
        can_redo: boolean;
      }>("undo_file_edit", { workflowId });

      const mappedResult: UndoRedoResult = {
        success: result.success,
        error: result.error,
        restoredFiles: result.restored_files.map(f => ({
          path: f.path,
          content: f.content,
          originalContent: f.original_content,
        })),
        canUndo: result.can_undo,
        canRedo: result.can_redo,
      };

      setState(prev => ({
        ...prev,
        canUndo: result.can_undo,
        canRedo: result.can_redo,
      }));

      if (result.success && onFilesRestored) {
        onFilesRestored(mappedResult.restoredFiles);
      }

      console.log(`⏪ [EDIT_HISTORY] Undo: success=${result.success}, files=${result.restored_files.length}`);
      return mappedResult;
    } catch (error) {
      console.error("Failed to undo:", error);
      return {
        success: false,
        error: String(error),
        restoredFiles: [],
        canUndo: state.canUndo,
        canRedo: state.canRedo,
      };
    } finally {
      setIsLoading(false);
    }
  }, [workflowId, state.canUndo, state.canRedo, isLoading, onFilesRestored]);

  // Redo the last undone edit
  const redo = useCallback(async (): Promise<UndoRedoResult | null> => {
    if (!workflowId || !state.canRedo || isLoading) return null;

    setIsLoading(true);
    try {
      const result = await invoke<{
        success: boolean;
        error: string | null;
        restored_files: Array<{
          path: string;
          content: string;
          original_content: string; // Content before restore (what we're redoing from)
        }>;
        can_undo: boolean;
        can_redo: boolean;
      }>("redo_file_edit", { workflowId });

      const mappedResult: UndoRedoResult = {
        success: result.success,
        error: result.error,
        restoredFiles: result.restored_files.map(f => ({
          path: f.path,
          content: f.content,
          originalContent: f.original_content,
        })),
        canUndo: result.can_undo,
        canRedo: result.can_redo,
      };

      setState(prev => ({
        ...prev,
        canUndo: result.can_undo,
        canRedo: result.can_redo,
      }));

      if (result.success && onFilesRestored) {
        onFilesRestored(mappedResult.restoredFiles);
      }

      console.log(`⏩ [EDIT_HISTORY] Redo: success=${result.success}, files=${result.restored_files.length}`);
      return mappedResult;
    } catch (error) {
      console.error("Failed to redo:", error);
      return {
        success: false,
        error: String(error),
        restoredFiles: [],
        canUndo: state.canUndo,
        canRedo: state.canRedo,
      };
    } finally {
      setIsLoading(false);
    }
  }, [workflowId, state.canUndo, state.canRedo, isLoading, onFilesRestored]);

  // Capture baseline (called when workflow is first loaded)
  const captureBaseline = useCallback(
    async (files: { path: string; content: string }[]) => {
      if (!workflowId) return;

      try {
        await invoke("capture_edit_history_baseline", {
          workflowId,
          files: files.map(f => ({
            path: f.path,
            content: f.content,
          })),
        });
        console.log(`📸 [EDIT_HISTORY] Captured baseline: ${files.length} files`);
      } catch (error) {
        console.error("Failed to capture baseline:", error);
      }
    },
    [workflowId]
  );

  return {
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    historyCount: state.historyCount,
    currentIndex: state.currentIndex,
    isLoading,
    undo,
    redo,
    recordEdit,
    captureBaseline,
  };
}
