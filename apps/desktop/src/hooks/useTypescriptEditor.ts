/**
 * Hook for TypeScript CodeMirror Extensions
 *
 * Provides VSCode-level TypeScript type checking in CodeMirror editors.
 * Loads type definitions from workflow's node_modules via Tauri.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { lintGutter } from "@codemirror/lint";
import { Extension } from "@codemirror/state";
import {
  getTypeScriptEnvironment,
  createTsLinter,
  createTsAutocomplete,
  createTsHover,
  syncToTypeScript,
  tsConfigFacet,
} from "@/lib/typescript";

export interface UseTypescriptEditorOptions {
  /** Workflow ID for loading type definitions */
  workflowId?: string | number | null;
  /** Virtual file name for this editor (e.g., "/src/terminator.ts") */
  fileName: string;
  /** Enable TypeScript type checking (default: true) */
  enableTypeChecking?: boolean;
  /** Enable autocomplete (default: true) */
  enableAutocomplete?: boolean;
  /** Enable hover tooltips (default: true) */
  enableHover?: boolean;
}

export interface UseTypescriptEditorResult {
  /** CodeMirror extensions to use */
  extensions: Extension[];
  /** Whether TypeScript environment is ready */
  isReady: boolean;
  /** Whether initialization is in progress */
  isLoading: boolean;
  /** Error message if initialization failed */
  error: string | null;
  /** Sync current content to TypeScript environment */
  syncContent: (content: string) => void;
}

/**
 * Hook for integrating TypeScript type checking into CodeMirror editors
 *
 * @example
 * ```tsx
 * const { extensions, isReady } = useTypescriptEditor({
 *   workflowId: workflow.id,
 *   fileName: '/src/terminator.ts',
 * });
 *
 * return <CodeMirror extensions={extensions} />;
 * ```
 */
export function useTypescriptEditor(options: UseTypescriptEditorOptions): UseTypescriptEditorResult {
  const { workflowId, fileName, enableTypeChecking = true, enableAutocomplete = true, enableHover = true } = options;

  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initAttemptedRef = useRef(false);
  const workflowIdRef = useRef<string | number | null>(null);

  // Initialize TypeScript environment when workflowId changes
  useEffect(() => {
    // Skip if no workflowId or type checking disabled
    if (!workflowId || !enableTypeChecking) {
      return;
    }

    // Skip if already initialized for this workflow
    if (workflowIdRef.current === workflowId && initAttemptedRef.current) {
      return;
    }

    const initTs = async () => {
      setIsLoading(true);
      setError(null);
      initAttemptedRef.current = true;
      workflowIdRef.current = workflowId;

      try {
        const env = getTypeScriptEnvironment();

        // Only initialize if not already ready
        if (!env.isReady()) {
          await env.initialize(String(workflowId));
        } else {
          // If already initialized, just load types for this workflow
          await env.loadWorkflowTypes(String(workflowId));
        }

        setIsReady(true);
      } catch (err) {
        console.error("[useTypescriptEditor] Failed to initialize:", err);
        setError(err instanceof Error ? err.message : "Failed to initialize TypeScript");
        setIsReady(false);
      } finally {
        setIsLoading(false);
      }
    };

    initTs();
  }, [workflowId, enableTypeChecking]);

  // Build extensions based on state
  const extensions = useMemo(() => {
    const exts: Extension[] = [javascript({ typescript: true }), lintGutter()];

    console.log("[useTypescriptEditor] Building extensions:", { isReady, enableTypeChecking, fileName });

    // Add TypeScript type checking extensions when ready
    if (isReady && enableTypeChecking) {
      // IMPORTANT: Must add tsConfigFacet with the fileName for linter/autocomplete/hover to work
      console.log("[useTypescriptEditor] Adding tsConfigFacet with fileName:", fileName);
      exts.push(tsConfigFacet.of({ fileName }));
      exts.push(createTsLinter());

      if (enableAutocomplete) {
        exts.push(createTsAutocomplete());
      }

      if (enableHover) {
        exts.push(createTsHover());
      }
    }

    return exts;
  }, [isReady, enableTypeChecking, enableAutocomplete, enableHover, fileName]);

  // Function to sync content to TypeScript environment
  const syncContent = useMemo(
    () => (content: string) => {
      if (isReady) {
        syncToTypeScript(fileName, content);
      }
    },
    [isReady, fileName]
  );

  return {
    extensions,
    isReady,
    isLoading,
    error,
    syncContent,
  };
}

/**
 * Check if a file should use TypeScript type checking
 */
export function shouldUseTypeScript(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext === "ts" || ext === "tsx";
}
