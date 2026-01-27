import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { syntaxTree } from "@codemirror/language";
import { linter, lintGutter, Diagnostic } from "@codemirror/lint";
import { unifiedMergeView, getChunks } from "@codemirror/merge";
import { search } from "@codemirror/search";
import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { Copy, Check, Loader2, Code, ScrollText, Database, X, ChevronDown, ChevronUp, Eye, Pencil } from "lucide-react";
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { SchedulerPanel } from "@/components/ui/scheduler-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PoolStep } from "@/hooks/useStepPool";
import { useTypescriptEditor, shouldUseTypeScript } from "@/hooks/useTypescriptEditor";
import { cn, formatResultForDisplay } from "@/lib/utils";
import { getChangeIndicator, formatFieldChange } from "@/lib/workflow-diff";
import type { StepChange } from "@/lib/workflow-diff";
import type { ConsoleLogEntry } from "@/lib/workflow-progress-parser";
import type { SequenceStep, CommandStep } from "@/lib/workflow-schema";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { workflowLinter, workflowLinterTheme } from "@/lib/workflow-linter";
import { InspectView } from "./InspectView";
import type { Workflow, WorkflowExecutionLogs, StepExecutionLog } from "./types";
import type { SidebarSelection } from "./WorkflowSidebar";

// Configure search extension
const searchExtension = search({
  top: true, // Show search panel at top
});

// Line highlight decoration for step lines
const highlightLineDecoration = Decoration.line({ class: "cm-highlighted-line" });

// Theme for highlighted lines (step selection)
const highlightLineTheme = EditorView.baseTheme({
  ".cm-highlighted-line": {
    backgroundColor: "rgba(59, 130, 246, 0.04)", // blue-500 with 4% opacity
    borderLeft: "2px solid rgba(59, 130, 246, 0.3)", // subtle border
  },
});

// Theme for merge view diff highlighting
const mergeViewTheme = EditorView.baseTheme({
  ".cm-mergeView": {
    fontSize: "inherit",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(239, 68, 68, 0.1)", // red-500 with 10% opacity
    // Style accept/reject buttons to match sidebar
    "& button": {
      fontWeight: "500",
      fontSize: "11px",
      padding: "2px 8px",
      borderRadius: "4px",
      border: "1px solid transparent",
      cursor: "pointer",
    },
    "& button[name=accept]": {
      backgroundColor: "white !important",
      borderColor: "black !important",
      color: "black !important",
    },
    "& button[name=reject]": {
      backgroundColor: "#dc2626 !important", // red-600 (destructive)
      borderColor: "#dc2626 !important",
      color: "white !important",
    },
  },
  // Hover states as flat selectors
  ".cm-deletedChunk button[name=accept]:hover": {
    backgroundColor: "#f3f4f6 !important", // gray-100
  },
  ".cm-deletedChunk button[name=reject]:hover": {
    backgroundColor: "#b91c1c !important", // red-700
  },
  ".cm-changedLine": {
    backgroundColor: "rgba(34, 197, 94, 0.1)", // green-500 with 10% opacity
  },
});

// JavaScript/TypeScript syntax linter - detects parse errors
const jsLinter = linter(view => {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter: node => {
      // ⚠ is the error node type in Lezer
      if (node.type.isError) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: "Syntax error",
        });
      }
    },
  });

  return diagnostics;
});

// Create line highlight extension
function createLineHighlightExtension(startLine: number, endLine: number) {
  // Helper to build decorations for the given line range
  const buildDecorations = (doc: { lines: number; line: (n: number) => { from: number } }) => {
    const builder = new RangeSetBuilder<Decoration>();
    for (let line = startLine; line <= endLine && line <= doc.lines; line++) {
      const lineInfo = doc.line(line);
      builder.add(lineInfo.from, lineInfo.from, highlightLineDecoration);
    }
    return builder.finish();
  };

  const highlightField = StateField.define<DecorationSet>({
    create(state) {
      // Build decorations on initial creation
      return buildDecorations(state.doc);
    },
    update(decorations, tr) {
      // Rebuild if document changed
      if (tr.docChanged) {
        return buildDecorations(tr.state.doc);
      }
      return decorations;
    },
    provide: f => EditorView.decorations.from(f),
  });

  return [highlightField, highlightLineTheme];
}

// Create mergeControls callback that notifies when all chunks are accepted
function createMergeControls(
  editorRef: React.RefObject<ReactCodeMirrorRef>,
  filePath: string,
  onFileAccepted?: (filePath: string) => void
): (type: "reject" | "accept", action: (e: MouseEvent) => void) => HTMLElement {
  return (type, action) => {
    const btn = document.createElement("button");
    btn.name = type;
    btn.textContent = type === "accept" ? "Accept" : "Reject";
    btn.onclick = (e: MouseEvent) => {
      // Call the original action first
      action(e);

      // After action, check if there are remaining chunks
      // Use setTimeout to let CodeMirror update its state
      setTimeout(() => {
        const view = editorRef.current?.view;
        if (!view) return;

        const chunksInfo = getChunks(view.state);
        console.log(
          `[MergeControls] ${type} clicked for ${filePath}, remaining chunks:`,
          chunksInfo?.chunks?.length ?? 0
        );

        // If no chunks remain, notify that this file's diff is fully accepted
        if (chunksInfo && chunksInfo.chunks.length === 0 && onFileAccepted) {
          console.log(
            `[MergeControls] All chunks ${type === "accept" ? "accepted" : "rejected"} for ${filePath}, notifying parent`
          );
          onFileAccepted(filePath);
        }
      }, 50);
    };
    return btn;
  };
}

// Single file diff info
export interface FileDiff {
  filePath: string;
  originalContent: string; // The "before" content for merge view
  currentContent: string; // The "after" content for computing affected line ranges
}

// Accumulated diff highlight state - accumulates until dismissed
export interface DiffHighlight {
  // All file diffs accumulated
  files: FileDiff[];
  // Step IDs that were affected by the diffs (computed from line ranges)
  affectedStepIds: string[];
}

interface StepDetailsPanelProps {
  workflow: Workflow;
  poolSteps?: PoolStep[];
  outputCode?: string;
  selection: SidebarSelection;
  workflowExecutionState?: {
    lastUpdated: string | null;
    lastStepIndex: number | null;
    env: Record<string, unknown>;
  } | null;
  logsRefreshKey?: number; // Counter to trigger logs reload after step execution
  loadedScripts?: Record<number, string>;
  onVariablesChange?: (variables: Record<string, any>) => void;
  onSelectorsChange?: (selectors: Record<string, string>) => void;
  onOutputChange?: (code: string) => void;
  onFileChange?: (filePath: string, content: string) => void;
  className?: string;
  // Undo/redo and external file change diff highlighting
  diffHighlight?: DiffHighlight | null;
  onDismissDiff?: () => void;
  onFileAccepted?: (filePath: string) => void; // Called when all chunks in a file are accepted via CodeMirror
  // Scheduler props
  onScheduleChanged?: () => void;
}

interface WorkflowMetadataViewProps {
  workflow: Workflow;
}

function WorkflowMetadataView({ workflow }: WorkflowMetadataViewProps) {
  const isReadOnly = workflow.userAccessLevel === "read" || workflow.userAccessLevel === "public_read";
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          {workflow.name || "Untitled Workflow"}
          {isReadOnly && (
            <span className="font-mono text-[10px] text-orange-600 font-normal px-1.5 py-0.5 border border-orange-400 rounded bg-orange-50">
              READ-ONLY
            </span>
          )}
        </h2>
        {workflow.description && <p className="text-sm text-gray-600 mt-1">{workflow.description}</p>}
      </div>

      <div className="space-y-1 text-sm">
        {workflow.lastModified && (
          <div>
            <span className="font-medium">Last Modified:</span>
            <span className="ml-2">{new Date(workflow.lastModified).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500">Select an item from the sidebar to view details.</div>
    </div>
  );
}

interface RawEventsViewProps {
  workflowId: string;
  recordingFiles: string[]; // JSON file paths like "Recordings/0001.json"
}

const RawEventItem = ({ event, index }: { event: any; index: number }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="p-3 rounded-md bg-muted/50 border text-xs font-mono cursor-pointer hover:bg-muted transition-colors"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">
          {event.Mouse && "Mouse"}
          {event.Keyboard && "Keyboard"}
          {event.Click && "Click"}
          {event.TextInputCompleted && "Text Input"}
          {event.ApplicationSwitch && "App Switch"}
          {event.BrowserTabNavigation && "Tab Navigation"}
          {event.Hotkey && "Hotkey"}
          {event.Clipboard && "Clipboard"}
          {event.TextSelection && "Text Selection"}
          {event.DragDrop && "Drag & Drop"}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">{isExpanded ? "▾" : "▸"} View JSON</span>
          <span className="text-muted-foreground">#{index + 1}</span>
        </div>
      </div>
      {isExpanded && (
        <pre className="mt-2 p-2 bg-background rounded overflow-x-auto text-xs">{JSON.stringify(event, null, 2)}</pre>
      )}
    </div>
  );
};

function RawEventsView({ workflowId, recordingFiles }: RawEventsViewProps) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rawEvents, setRawEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedFilesKey, setLoadedFilesKey] = useState<string>("");

  // Load events from Recordings/*.json files - use serialized key to prevent duplicate loads
  const filesKey = useMemo(() => `${workflowId}:${recordingFiles.join(",")}`, [workflowId, recordingFiles]);

  useEffect(() => {
    // Skip if we already loaded these exact files
    if (filesKey === loadedFilesKey) {
      console.log("[RawEventsView] Skipping load - files unchanged");
      return;
    }

    const loadEvents = async () => {
      console.log("[RawEventsView] Loading events from disk:", recordingFiles.length, "files, key:", filesKey);
      setLoading(true);
      setError(null);

      try {
        const allEvents: any[] = [];

        // Sort files to ensure order (0001.json, 0002.json, etc.)
        const sortedFiles = [...recordingFiles].sort();

        for (const filePath of sortedFiles) {
          try {
            const result = await invoke<{ content: string; is_binary: boolean }>("read_workflow_file", {
              workflowId,
              filePath,
            });

            if (!result.is_binary && result.content) {
              const events = JSON.parse(result.content);
              if (Array.isArray(events)) {
                allEvents.push(...events);
              }
            }
          } catch (fileErr) {
            console.warn(`[RawEventsView] Failed to load ${filePath}:`, fileErr);
          }
        }

        console.log("[RawEventsView] Loaded", allEvents.length, "events from disk");
        setRawEvents(allEvents);
        setLoadedFilesKey(filesKey); // Mark these files as loaded
      } catch (err) {
        console.error("[RawEventsView] Failed to load events:", err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    if (recordingFiles.length > 0) {
      loadEvents();
    } else {
      setLoading(false);
      setLoadedFilesKey(filesKey);
    }
  }, [filesKey, loadedFilesKey, recordingFiles.length]);

  const copyAllToClipboard = async () => {
    try {
      const rawEventsJson = JSON.stringify(rawEvents, null, 2);
      await navigator.clipboard.writeText(rawEventsJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy raw events:", err);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading events...</span>
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-center text-red-500">Failed to load events: {error}</div>;
  }

  if (rawEvents.length === 0) {
    return <div className="p-4 text-center text-gray-500">No events found in Recordings folder.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Raw Events</h3>
          <p className="text-xs text-gray-500">{rawEvents.length} events captured during recording</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={copyAllToClipboard}
          className="h-7 text-xs px-2"
          title="Copy all raw events as JSON"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          <span className="ml-1">{copied ? "Copied!" : "Copy All"}</span>
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {rawEvents.map((event: any, index: number) => (
            <RawEventItem key={index} event={event} index={index} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface StepViewProps {
  step: SequenceStep;
  index: number;
  executionLog?: WorkflowExecutionLogs[number];
  executionState?: {
    lastUpdated: string | null;
    lastStepIndex: number | null;
    env: Record<string, unknown>;
  } | null;
  loadedScript?: string;
  onChange?: (step: SequenceStep) => void;
  // Diff props
  stepChange?: StepChange;
  // TypeScript file diff highlighting
  diffHighlight?: DiffHighlight | null;
  onDismissDiff?: () => void;
  onFileAccepted?: (filePath: string) => void; // Called when all chunks in a file are accepted via CodeMirror
  // TypeScript workflow fields
  workflowId?: string | number | null;
  workflowFiles?: import("./types").TypeScriptWorkflowFile[];
  // Callback after file is saved (for triggering cloud publish)
  onAfterSave?: () => void;
  // For pool steps: don't auto-switch to logs tab, default to definition
  isPoolStep?: boolean;
  // TypeScript definition content for pool steps (from .ts file)
  poolDefinition?: string;
}

function StepView({
  step,
  index,
  executionLog,
  executionState,
  loadedScript,
  onChange,
  stepChange,
  diffHighlight,
  onDismissDiff,
  onFileAccepted,
  workflowId,
  workflowFiles,
  onAfterSave,
  isPoolStep = false,
  poolDefinition,
}: StepViewProps) {
  const commandStep = step as CommandStep;
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  // Controlled tab state - auto-switch to logs when new execution log arrives (only for workflow steps)
  const [activeTab, setActiveTab] = useState<string>("definition");
  const prevExecutionLogRef = useRef<typeof executionLog>(undefined);

  useEffect(() => {
    // Auto-switch to logs tab when executionLog is newly set or updated
    // Skip auto-switch for pool steps - they always have executionLog but should stay on definition
    if (!isPoolStep && executionLog && executionLog !== prevExecutionLogRef.current) {
      setActiveTab("logs");
    }
    prevExecutionLogRef.current = executionLog;
  }, [executionLog, isPoolStep]);

  // File-loaded execution log state (fallback when in-memory log is not available)
  const [fileExecutionLog, setFileExecutionLog] = useState<WorkflowExecutionLogs[number] | null>(null);
  const [fileLogLoading, setFileLogLoading] = useState(false);

  // Load execution log from file when in-memory log is not available
  useEffect(() => {
    // If we have in-memory log, use it - no need to load from file
    if (executionLog) {
      setFileExecutionLog(null);
      setFileLogLoading(false);
      return;
    }

    // Need workflowId and stepId to load from file
    const stepId = step?.id;
    if (!workflowId || !stepId) {
      setFileExecutionLog(null);
      setFileLogLoading(false);
      return;
    }

    const loadFromFile = async () => {
      setFileLogLoading(true);
      try {
        const result = await invoke<{
          found: boolean;
          file_path: string | null;
          content: string | null;
          timestamp: string | null;
        }>("get_step_execution_log", {
          workflowId: String(workflowId),
          stepId,
        });
        if (result.found && result.content) {
          try {
            const parsed = JSON.parse(result.content);
            // Convert file format to in-memory format
            const response = parsed.response || {};
            const request = parsed.request || {};
            const isSuccess = response.status !== "failed";
            const fileLog: WorkflowExecutionLogs[number] = {
              stepName: request.start_from_step || request.end_at_step || stepId || "unknown",
              tool: request.tool_name || "execute_sequence",
              startTime: parsed.timestamp ? new Date(parsed.timestamp).getTime() : Date.now(),
              endTime: Date.now(),
              consoleLogs: parsed.logs || [],
              result: { success: isSuccess, output: response },
              error: !isSuccess ? response.error || "Step failed" : undefined,
            };
            setFileExecutionLog(fileLog);
          } catch {
            setFileExecutionLog(null);
          }
        } else {
          setFileExecutionLog(null);
        }
      } catch (error) {
        console.warn("[StepView] Failed to load execution log from file:", error);
        setFileExecutionLog(null);
      } finally {
        setFileLogLoading(false);
      }
    };

    loadFromFile();
  }, [executionLog, workflowId, step?.id]);

  // Effective execution log - prefer in-memory, fall back to file-loaded
  const effectiveExecutionLog = executionLog || fileExecutionLog;

  // Get full file content and line info for this step
  const { fileContent, lineStart, lineEnd, fileName } = useMemo(() => {
    const sourceFile = commandStep.sourceFile;
    const start = commandStep.lineStart;
    const end = commandStep.lineEnd;

    console.log(
      "[StepView] Step:",
      commandStep.id || commandStep.name,
      "sourceFile:",
      sourceFile,
      "lineStart:",
      start,
      "lineEnd:",
      end,
      "isPoolStep:",
      isPoolStep
    );
    console.log(
      "[StepView] workflowFiles:",
      workflowFiles?.map(f => f.path)
    );

    // For pool steps (standalone tool executions), show TypeScript definition or fallback to JSON
    if (isPoolStep) {
      if (poolDefinition) {
        return {
          fileContent: poolDefinition,
          lineStart: undefined,
          lineEnd: undefined,
          fileName: `${commandStep.tool_name || "tool"}.ts`,
        };
      }
      // Fallback to JSON if no .ts file available
      const toolCall = {
        tool: commandStep.tool_name,
        arguments: commandStep.arguments,
      };
      return {
        fileContent: JSON.stringify(toolCall, null, 2),
        lineStart: undefined,
        lineEnd: undefined,
        fileName: `${commandStep.tool_name || "tool"}.json`,
      };
    }

    if (sourceFile && workflowFiles) {
      // Normalize path for comparison (handle Windows backslashes)
      const normalizedSource = sourceFile.replace(/\\/g, "/");
      const file = workflowFiles.find(f => {
        const normalizedPath = f.path.replace(/\\/g, "/");
        const matches =
          normalizedPath === normalizedSource ||
          normalizedPath.endsWith(normalizedSource) ||
          normalizedSource.endsWith(normalizedPath);
        console.log("[StepView] Comparing file", normalizedPath, "vs", normalizedSource, "=", matches);
        return matches;
      });

      if (file) {
        console.log(
          "[StepView] Found file for step, returning with lineStart:",
          start,
          "lineEnd:",
          end,
          "path:",
          file.path
        );
        return {
          fileContent: file.content,
          lineStart: start,
          lineEnd: end,
          // Use full file path for TypeScript (needed for module resolution), not just basename
          fileName: file.path,
        };
      }
    }

    // Fallback: show step metadata as comment
    console.log("[StepView] Fallback - no file found or no workflowFiles");
    return {
      fileContent: `// Step: ${commandStep.name || commandStep.id || "unnamed"}\n// Source: ${sourceFile || "unknown"}`,
      lineStart: undefined,
      lineEnd: undefined,
      fileName: sourceFile || "unknown",
    };
  }, [commandStep, workflowFiles, isPoolStep, poolDefinition]);

  // Local state for editing
  const [editedCode, setEditedCode] = useState(fileContent);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>(fileContent);

  // Sync editedCode when fileContent changes (fixes undo/redo race condition)
  useEffect(() => {
    console.log(`🔄 [StepView] fileContent changed, syncing editedCode for ${commandStep.id || commandStep.name}`);
    setEditedCode(fileContent);
    lastSavedContentRef.current = fileContent;
    setSaveStatus("idle");
  }, [fileContent, commandStep.id, commandStep.name]);

  // Find matching file diff for this step's source file
  const matchingFileDiff = useMemo(() => {
    if (!diffHighlight?.files?.length) {
      console.log(`🎨 [StepView] No diffHighlight files for step ${commandStep.id || commandStep.name}`);
      return null;
    }
    const sourceFile = commandStep.sourceFile;
    if (!sourceFile) {
      console.log(`🎨 [StepView] No sourceFile for step ${commandStep.id || commandStep.name}`);
      return null;
    }
    const normalizedSourceFile = sourceFile.replace(/\\/g, "/");
    const match = diffHighlight.files.find(f => {
      const normalizedDiffPath = f.filePath.replace(/\\/g, "/");
      return normalizedSourceFile.endsWith(normalizedDiffPath) || normalizedDiffPath.endsWith(normalizedSourceFile);
    });
    console.log(
      `🎨 [StepView] Diff match for ${commandStep.id || commandStep.name}: sourceFile=${sourceFile}, diffFiles=${diffHighlight.files.map(f => f.filePath).join(",")}, match=${!!match}`
    );
    return match || null;
  }, [diffHighlight, commandStep.sourceFile, commandStep.id, commandStep.name]);

  // Check if diff highlight applies to this step's file
  const diffHighlightApplies = matchingFileDiff !== null;

  // Ref to track if diff highlight is active (for dismissing on edit)
  const diffHighlightActiveRef = useRef(false);
  // Track previous diff state to detect when diff is newly applied
  const prevDiffHighlightAppliesRef = useRef(false);

  useEffect(() => {
    diffHighlightActiveRef.current = diffHighlightApplies;
    if (diffHighlightApplies) {
      console.log(`🎨 [StepView] Diff highlight active for step ${commandStep.id || commandStep.name}`);
    }
  }, [diffHighlightApplies, commandStep.id, commandStep.name]);

  // Scroll to top when diff highlight is newly applied (merge view shows diff inline)
  useEffect(() => {
    const wasActive = prevDiffHighlightAppliesRef.current;
    prevDiffHighlightAppliesRef.current = diffHighlightApplies;

    // Only scroll when diff is newly applied (false -> true), not on every render
    if (!wasActive && diffHighlightApplies && matchingFileDiff && editorRef.current?.view) {
      const view = editorRef.current.view;
      // Scroll to top - the merge view will show deleted chunks inline
      view.dispatch({
        effects: EditorView.scrollIntoView(0, { y: "start" }),
      });
      console.log(`🎨 [StepView] Scrolled to top for merge view diff`);
    }
  }, [diffHighlightApplies, matchingFileDiff]);

  // TypeScript type checking hook - provides full type checking for .ts/.tsx files
  const isTypeScriptFile = shouldUseTypeScript(fileName);
  const { extensions: tsExtensions, syncContent } = useTypescriptEditor({
    workflowId,
    // Virtual path must match what read_workflow_source_files returns (e.g., "/src/terminator.ts")
    fileName: `/${fileName}`,
    enableTypeChecking: isTypeScriptFile,
  });

  // Create extensions including line highlighting, merge view diff, and workflow linting
  const extensions = useMemo(() => {
    // Use TypeScript extensions for .ts/.tsx files, fallback to basic JS for others
    // Always include lintGutter and workflowLinter for dangerous key detection
    const exts = isTypeScriptFile
      ? [...tsExtensions, searchExtension, lintGutter(), workflowLinter(), workflowLinterTheme]
      : [
          javascript({ typescript: true }),
          searchExtension,
          lintGutter(),
          jsLinter,
          workflowLinter(),
          workflowLinterTheme,
        ];

    if (lineStart !== undefined && lineEnd !== undefined) {
      exts.push(...createLineHighlightExtension(lineStart, lineEnd));
    }
    // Add merge view diff if applicable - shows deleted content as widgets
    if (diffHighlightApplies && matchingFileDiff?.originalContent) {
      console.log(`🎨 [StepView] Adding unifiedMergeView for diff`);
      exts.push(
        unifiedMergeView({
          original: matchingFileDiff.originalContent,
          highlightChanges: true,
          gutter: true,
          syntaxHighlightDeletions: true,
          mergeControls: createMergeControls(editorRef, matchingFileDiff.filePath, onFileAccepted),
        }),
        mergeViewTheme
      );
    }
    return exts;
  }, [isTypeScriptFile, tsExtensions, lineStart, lineEnd, diffHighlightApplies, matchingFileDiff, onFileAccepted]);

  // Scroll to highlighted lines when editor is created
  const handleEditorCreate = useCallback(
    (view: EditorView) => {
      if (lineStart !== undefined) {
        // Small delay to ensure editor is fully rendered
        setTimeout(() => {
          const lineNum = Math.min(lineStart, view.state.doc.lines);
          const lineInfo = view.state.doc.line(lineNum);
          view.dispatch({
            effects: EditorView.scrollIntoView(lineInfo.from, { y: "start", yMargin: 50 }),
          });
        }, 50);
      }
    },
    [lineStart]
  );

  // Autosave function
  const saveFile = useCallback(
    async (content: string) => {
      if (!workflowId || !fileName) {
        console.warn("[StepView] Cannot save: missing workflowId or fileName");
        return;
      }

      // Don't save if content hasn't changed from last saved
      if (content === lastSavedContentRef.current) {
        return;
      }

      setSaveStatus("saving");
      try {
        await invoke("write_typescript_workflow_file", {
          input: {
            workflow_id: String(workflowId),
            file_path: fileName,
            content,
          },
        });
        lastSavedContentRef.current = content;
        setSaveStatus("saved");
        // Reset to idle after showing "saved" briefly
        setTimeout(() => setSaveStatus("idle"), 1500);
        // Trigger cloud publish (debounced)
        onAfterSave?.();
      } catch (error) {
        console.error("[StepView] Failed to save file:", error);
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [workflowId, fileName, onAfterSave]
  );

  // Reset local state when step/file changes
  useEffect(() => {
    setEditedCode(fileContent);
    lastSavedContentRef.current = fileContent;
    setSaveStatus("idle");
  }, [fileContent]);

  // Debounced autosave on editor change
  const handleEditorChange = useCallback(
    (value: string) => {
      setEditedCode(value);

      // Sync to TypeScript environment for type checking
      syncContent(value);

      // Auto-dismiss diff highlighting when user starts editing
      if (diffHighlightActiveRef.current && onDismissDiff) {
        onDismissDiff();
      }

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Only trigger save if content actually changed
      if (value !== lastSavedContentRef.current) {
        // Debounce: save 1 second after typing stops
        saveTimeoutRef.current = setTimeout(() => {
          saveFile(value);
        }, 1000);
      }
    },
    [saveFile, onDismissDiff, syncContent]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Check if this is a JavaScript step
  const isJsStep =
    commandStep.tool_name === "run_command" &&
    commandStep.arguments &&
    ((commandStep.arguments as any).engine === "javascript" ||
      (commandStep.arguments as any).engine === "js" ||
      (commandStep.arguments as any).engine === "node");

  const scriptContent = isJsStep ? (commandStep.arguments as any).run || loadedScript || "" : null;

  // Ref for collapsible logs panel - persist to localStorage
  const logsPanelRef = useRef<ImperativePanelHandle>(null);
  const [isLogsCollapsed, setIsLogsCollapsed] = useState(() => {
    const saved = localStorage.getItem("mediar:logsPanel:collapsed");
    return saved === "true";
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem("mediar:logsPanel:collapsed", String(isLogsCollapsed));
  }, [isLogsCollapsed]);

  // Sync panel state on mount based on saved preference
  useEffect(() => {
    const panel = logsPanelRef.current;
    if (!panel) return;
    if (isLogsCollapsed) {
      panel.collapse();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleLogsPanel = useCallback(() => {
    const panel = logsPanelRef.current;
    if (!panel) return;
    if (isLogsCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [isLogsCollapsed]);

  // Pool step layout: split view with definition (70%) top, logs (30%) bottom - resizable
  if (isPoolStep) {
    return (
      <PanelGroup direction="vertical" className="h-full">
        {/* Definition section */}
        <Panel defaultSize={70} minSize={20}>
          <div className="h-full flex flex-col">
            <div className="flex-shrink-0 px-3 py-1.5 bg-gray-50 border-b flex items-center gap-2 text-xs">
              <Code className="w-3 h-3 text-gray-500" />
              <span className="font-medium">{commandStep.name || commandStep.tool_name || `Step ${index + 1}`}</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-500 font-mono">{commandStep.tool_name}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <CodeMirror
                key={`pool-${commandStep.id}`}
                ref={editorRef}
                value={editedCode}
                theme={githubLight}
                extensions={extensions}
                className="h-full min-h-0 text-xs"
                readOnly
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLineGutter: false,
                  highlightActiveLine: false,
                }}
              />
            </div>
          </div>
        </Panel>
        {!isLogsCollapsed && (
          <PanelResizeHandle className="h-1 bg-gray-200 hover:bg-gray-300 transition-colors cursor-row-resize" />
        )}
        {/* Logs header - always visible */}
        <div
          className="flex-shrink-0 px-3 py-1.5 bg-gray-50 border-y flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={toggleLogsPanel}
          title={isLogsCollapsed ? "Expand logs" : "Collapse logs"}
        >
          <ScrollText className="w-3 h-3 text-gray-500" />
          <span className="font-medium">Logs</span>
          {effectiveExecutionLog && (
            <>
              <span className="text-gray-400">|</span>
              <span className={cn(effectiveExecutionLog.error ? "text-red-600" : "text-green-600")}>
                {effectiveExecutionLog.error ? "Failed" : "Success"}
              </span>
              {effectiveExecutionLog.startTime && effectiveExecutionLog.endTime && (
                <span className="text-gray-500">
                  {((effectiveExecutionLog.endTime - effectiveExecutionLog.startTime) / 1000).toFixed(2)}s
                </span>
              )}
            </>
          )}
          <div className="flex-1" />
          {isLogsCollapsed ? (
            <ChevronUp className="w-3 h-3 text-gray-400" />
          ) : (
            <ChevronDown className="w-3 h-3 text-gray-400" />
          )}
        </div>
        {/* Logs section - collapsible */}
        <Panel
          ref={logsPanelRef}
          defaultSize={30}
          minSize={5}
          collapsible
          collapsedSize={0}
          onCollapse={() => setIsLogsCollapsed(true)}
          onExpand={() => setIsLogsCollapsed(false)}
        >
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
              {effectiveExecutionLog ? (
                <div className="h-full flex flex-col">
                  {/* For regular steps, always show logs section. For pool steps, only show when logs exist */}
                  {(!isPoolStep ||
                    (effectiveExecutionLog.consoleLogs && effectiveExecutionLog.consoleLogs.length > 0)) && (
                    <div className="flex-1 min-h-0 overflow-auto p-2 border-b">
                      {effectiveExecutionLog.consoleLogs && effectiveExecutionLog.consoleLogs.length > 0 ? (
                        <div className="border rounded bg-white font-mono text-xs overflow-auto h-full">
                          {effectiveExecutionLog.consoleLogs.map((log, i) => {
                            const entry = typeof log === "string" ? { message: log, level: "log", timestamp: 0 } : log;
                            const levelColor =
                              entry.level === "error" || entry.level === "ERROR"
                                ? "text-red-600"
                                : entry.level === "warn" || entry.level === "WARN"
                                  ? "text-yellow-600"
                                  : "text-gray-900";
                            const levelLabel = (entry.level || "log").toUpperCase();
                            const time = entry.timestamp
                              ? (() => {
                                  const date = new Date(entry.timestamp);
                                  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
                                })()
                              : "";
                            return (
                              <div key={i} className="px-2 py-0.5 hover:bg-gray-50 flex gap-2 whitespace-nowrap">
                                {time && <span className="text-gray-400 flex-shrink-0">{time}</span>}
                                <span className={cn("w-12 flex-shrink-0", levelColor)}>[{levelLabel}]</span>
                                <span className="text-gray-900">{entry.message || JSON.stringify(entry)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : effectiveExecutionLog.error ? (
                        <pre className="p-2 bg-red-50 rounded text-red-700 text-xs whitespace-pre overflow-auto">
                          {effectiveExecutionLog.error}
                        </pre>
                      ) : (
                        <div className="text-gray-400 text-xs">No console output</div>
                      )}
                    </div>
                  )}
                  {/* Result JSON - full height when no logs, 50% when logs present */}
                  <div className="flex-1 min-h-0 overflow-auto">
                    {effectiveExecutionLog.result?.output ? (
                      <CodeMirror
                        value={(() => {
                          const {
                            json: jsonStr,
                            uiTree,
                            browserDom,
                            ocrTree,
                            omniparserTree,
                            uiDiff,
                          } = formatResultForDisplay(effectiveExecutionLog.result.output);
                          let v = jsonStr;
                          if (uiTree) v += `\n\n// ui_tree:\n${uiTree}`;
                          if (browserDom) v += `\n\n// browser_dom:\n${browserDom}`;
                          if (ocrTree) v += `\n\n// ocr_tree:\n${ocrTree}`;
                          if (omniparserTree) v += `\n\n// omniparser_tree:\n${omniparserTree}`;
                          if (uiDiff) v += `\n\n// ui_diff:\n${uiDiff}`;
                          return v;
                        })()}
                        theme={githubLight}
                        extensions={[json(), searchExtension]}
                        className="h-full text-xs"
                        readOnly
                        basicSetup={{ lineNumbers: false, foldGutter: true, highlightActiveLineGutter: false }}
                      />
                    ) : (
                      <div className="p-2 text-gray-400 text-xs">No result data</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-xs">No logs</div>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    );
  }

  // Regular step layout with tabs
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b bg-gray-50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-sm">
              {stepChange && (
                <span
                  className={cn(
                    "font-mono text-xs mr-2",
                    stepChange.type === "added" && "text-green-600",
                    stepChange.type === "removed" && "text-red-600",
                    stepChange.type === "modified" && "text-yellow-600",
                    stepChange.type === "reordered" && "text-blue-600"
                  )}
                >
                  {getChangeIndicator(stepChange.type)}
                </span>
              )}
              {commandStep.name || commandStep.tool_name || `Step ${index + 1}`}
            </h3>
            <div className="text-xs text-gray-500">
              {commandStep.id && (
                <>
                  <span className="text-gray-400">id:</span> {commandStep.id}
                </>
              )}
              {commandStep.name && (
                <>
                  {commandStep.id && ", "}
                  <span className="text-gray-400">name:</span> {commandStep.name}
                </>
              )}
              {commandStep.tool_name && (
                <>
                  {(commandStep.id || commandStep.name) && ", "}
                  <span className="text-gray-400">tool_name:</span> {commandStep.tool_name}
                </>
              )}
            </div>
            {fileName && (
              <div className="text-xs text-gray-400 mt-0.5">
                <span className="text-gray-400">{fileName}</span>
                {lineStart !== undefined && lineEnd !== undefined && (
                  <span className="ml-1 text-blue-500">
                    :{lineStart}-{lineEnd}
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Autosave status indicator */}
          {saveStatus === "saving" && (
            <span className="text-xs text-gray-500 flex items-center">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-xs text-green-600 flex items-center">
              <Check className="w-3 h-3 mr-1" />
              Saved
            </span>
          )}
          {saveStatus === "error" && <span className="text-xs text-red-600">Save failed</span>}
        </div>
      </div>

      {/* Diff Details Banner */}
      {stepChange && (
        <div
          className={cn(
            "px-4 py-2 border-b text-xs flex-shrink-0",
            stepChange.type === "added" && "bg-green-50",
            stepChange.type === "removed" && "bg-red-50",
            stepChange.type === "modified" && "bg-yellow-50",
            stepChange.type === "reordered" && "bg-blue-50"
          )}
        >
          <div
            className={cn(
              "font-medium mb-1",
              stepChange.type === "added" && "text-green-700",
              stepChange.type === "removed" && "text-red-700",
              stepChange.type === "modified" && "text-yellow-700",
              stepChange.type === "reordered" && "text-blue-700"
            )}
          >
            {stepChange.type === "added" && "Step added"}
            {stepChange.type === "removed" && "Step removed"}
            {stepChange.type === "modified" && "Step modified"}
            {stepChange.type === "reordered" && (
              <>
                Step moved from position {(stepChange.fromIndex ?? 0) + 1} to {(stepChange.toIndex ?? 0) + 1}
              </>
            )}
          </div>
          {stepChange.fieldChanges && stepChange.fieldChanges.length > 0 && (
            <div className="space-y-0.5 text-gray-600 font-mono">
              {stepChange.fieldChanges.map((fc, i) => (
                <div key={i}>{formatFieldChange(fc)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0">
          <TabsTrigger value="definition" className="text-xs">
            <Code className="w-3 h-3 mr-1" />
            Definition
          </TabsTrigger>
          {isJsStep && scriptContent && (
            <TabsTrigger value="script" className="text-xs">
              <Code className="w-3 h-3 mr-1" />
              Script
            </TabsTrigger>
          )}
          <TabsTrigger value="logs" className="text-xs">
            <ScrollText className="w-3 h-3 mr-1" />
            Logs
            {fileLogLoading && <Loader2 className="w-3 h-3 ml-1 animate-spin" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="definition" className="flex-1 min-h-0 overflow-hidden m-0 p-0 flex flex-col">
          {/* External file change banner */}
          {diffHighlightApplies && matchingFileDiff && (
            <div className="flex-shrink-0 px-3 py-1.5 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
              <span className="text-xs text-blue-700 flex items-center gap-2">
                <span className="font-medium">File modified</span>
                <span className="text-gray-500">(showing diff)</span>
              </span>
              {onDismissDiff && (
                <button onClick={onDismissDiff} className="text-blue-500 hover:text-blue-700 text-xs" title="Dismiss">
                  ✕
                </button>
              )}
            </div>
          )}
          <CodeMirror
            key={`${fileName}-${lineStart}-${lineEnd}-diff-${diffHighlightApplies}`}
            ref={editorRef}
            value={editedCode}
            onChange={handleEditorChange}
            onCreateEditor={handleEditorCreate}
            theme={githubLight}
            extensions={extensions}
            className="h-full min-h-0 text-xs flex-1"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
            }}
          />
        </TabsContent>

        {isJsStep && scriptContent && (
          <TabsContent value="script" className="flex-1 min-h-0 overflow-hidden m-0 p-0">
            <CodeMirror
              value={scriptContent}
              theme={githubLight}
              extensions={[javascript(), searchExtension]}
              className="h-full min-h-0 text-xs"
              readOnly
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLineGutter: false,
              }}
            />
          </TabsContent>
        )}

        <TabsContent value="logs" className="flex-1 min-h-0 overflow-hidden m-0 p-4 flex flex-col gap-3">
          {fileLogLoading ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading execution log...
            </div>
          ) : effectiveExecutionLog ? (
            <>
              {/* Logs section - 50% */}
              <div className="flex-1 min-h-0 min-w-0 border rounded p-3 overflow-auto">
                <div className="space-y-3 text-xs min-w-0">
                  <div>
                    <span className="font-medium">Status:</span>
                    <span className={cn("ml-2", effectiveExecutionLog.error ? "text-red-600" : "text-green-600")}>
                      {effectiveExecutionLog.error ? "Failed" : "Success"}
                    </span>
                  </div>

                  {effectiveExecutionLog.startTime && effectiveExecutionLog.endTime && (
                    <div>
                      <span className="font-medium">Duration:</span>
                      <span className="ml-2">
                        {((effectiveExecutionLog.endTime - effectiveExecutionLog.startTime) / 1000).toFixed(2)}s
                      </span>
                    </div>
                  )}

                  {effectiveExecutionLog.consoleLogs && effectiveExecutionLog.consoleLogs.length > 0 && (
                    <div>
                      <span className="font-medium">Console Output:</span>
                      <div
                        style={{
                          position: "relative",
                          width: "100vw",
                          maxWidth: "100%",
                          marginLeft: "calc(-50vw + 50%)",
                          overflow: "auto",
                          boxSizing: "border-box",
                        }}
                      >
                        <pre className="mt-1 p-2 bg-gray-100 rounded text-xs font-mono inline-block">
                          {effectiveExecutionLog.consoleLogs.map((log, i) => (
                            <div key={i} className="whitespace-pre">
                              {typeof log === "string" ? log : log.message || JSON.stringify(log)}
                            </div>
                          ))}
                        </pre>
                      </div>
                    </div>
                  )}

                  {effectiveExecutionLog.error && (
                    <div>
                      <span className="font-medium text-red-600">Error:</span>
                      <div
                        style={{
                          position: "relative",
                          width: "100vw",
                          maxWidth: "100%",
                          marginLeft: "calc(-50vw + 50%)",
                          overflow: "auto",
                          boxSizing: "border-box",
                        }}
                      >
                        <pre className="mt-1 p-2 bg-red-50 rounded text-xs text-red-700 inline-block">
                          {effectiveExecutionLog.error}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Result section - 50% */}
              {effectiveExecutionLog.result?.output && (
                <div className="flex-1 min-h-0 min-w-0 flex flex-col">
                  <span className="font-medium text-xs flex-shrink-0">Result:</span>
                  {(() => {
                    const {
                      json: jsonStr,
                      uiTree,
                      browserDom,
                      ocrTree,
                      omniparserTree,
                      uiDiff,
                    } = formatResultForDisplay(effectiveExecutionLog.result.output);
                    let displayValue = jsonStr;
                    if (uiTree) displayValue += `\n\n// ui_tree:\n${uiTree}`;
                    if (browserDom) displayValue += `\n\n// browser_dom:\n${browserDom}`;
                    if (ocrTree) displayValue += `\n\n// ocr_tree:\n${ocrTree}`;
                    if (omniparserTree) displayValue += `\n\n// omniparser_tree:\n${omniparserTree}`;
                    if (uiDiff) displayValue += `\n\n// ui_diff:\n${uiDiff}`;
                    return (
                      <div className="flex-1 flex flex-col min-h-0 min-w-0 mt-1 overflow-hidden rounded border">
                        <CodeMirror
                          value={displayValue}
                          theme={githubLight}
                          extensions={[json(), searchExtension]}
                          className="h-full text-xs overflow-auto"
                          readOnly
                          basicSetup={{
                            lineNumbers: false,
                            foldGutter: true,
                            highlightActiveLineGutter: false,
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
              No execution logs available. Execute this step to see logs.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// FileView component for editing workflow files with autosave
interface FileViewProps {
  file: { path: string; content: string };
  workflowId?: string | number | null;
  onChange?: (filePath: string, content: string) => void;
  diffHighlight?: DiffHighlight | null;
  onDismissDiff?: () => void;
  onFileAccepted?: (filePath: string) => void;
}

function FileView({ file, workflowId, onChange, diffHighlight, onDismissDiff, onFileAccepted }: FileViewProps) {
  const [editedCode, setEditedCode] = useState(file.content);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>(file.content);

  const isJson = file.path.endsWith(".json");
  const isTypeScript = file.path.endsWith(".ts") || file.path.endsWith(".tsx");
  const isMarkdown = file.path.endsWith(".md");
  const [markdownPreview, setMarkdownPreview] = useState(true);

  // TypeScript type checking hook - provides full type checking for .ts/.tsx files
  const { extensions: tsExtensions, syncContent } = useTypescriptEditor({
    workflowId,
    // Virtual path must match what read_workflow_source_files returns (e.g., "/src/terminator.ts")
    fileName: `/${file.path}`,
    enableTypeChecking: isTypeScript,
  });

  // Reset local state when file changes
  useEffect(() => {
    setEditedCode(file.content);
    lastSavedContentRef.current = file.content;
    setSaveStatus("idle");
  }, [file.path, file.content]);

  // Autosave function
  const saveFile = useCallback(
    async (content: string) => {
      if (!workflowId) {
        console.warn("[FileView] Cannot save: missing workflowId");
        return;
      }

      // Don't save if content hasn't changed from last saved
      if (content === lastSavedContentRef.current) {
        return;
      }

      setSaveStatus("saving");
      try {
        await invoke("write_typescript_workflow_file", {
          input: {
            workflow_id: String(workflowId),
            file_path: file.path,
            content,
          },
        });
        lastSavedContentRef.current = content;
        setSaveStatus("saved");
        // Notify parent of change
        onChange?.(file.path, content);
        // Reset to idle after showing "saved" briefly
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch (error) {
        console.error("[FileView] Failed to save file:", error);
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [workflowId, file.path, onChange]
  );

  // Ref to track if diff highlight applies (for use in handleEditorChange)
  const diffHighlightActiveRef = useRef(false);

  // Debounced autosave on editor change
  const handleEditorChange = useCallback(
    (value: string) => {
      setEditedCode(value);

      // Sync to TypeScript environment for type checking
      syncContent(value);

      // Auto-dismiss diff highlighting when user starts editing
      if (diffHighlightActiveRef.current && onDismissDiff) {
        onDismissDiff();
      }

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Only trigger save if content actually changed
      if (value !== lastSavedContentRef.current) {
        // Debounce: save 1 second after typing stops
        saveTimeoutRef.current = setTimeout(() => {
          saveFile(value);
        }, 1000);
      }
    },
    [saveFile, onDismissDiff, syncContent]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Get CodeMirror language extension (only used for non-TypeScript files)
  const languageExtension = useMemo(() => {
    if (isJson) return json();
    return javascript();
  }, [isJson]);

  // Find the matching file diff from accumulated diffs
  const matchingFileDiff = useMemo(() => {
    if (!diffHighlight?.files?.length) return null;
    const normalizedFilePath = file.path.replace(/\\/g, "/");
    return (
      diffHighlight.files.find(f => {
        const normalizedDiffPath = f.filePath.replace(/\\/g, "/");
        return normalizedFilePath.endsWith(normalizedDiffPath) || normalizedDiffPath.endsWith(normalizedFilePath);
      }) || null
    );
  }, [diffHighlight, file.path]);

  // Check if diff highlight applies to this file
  const diffHighlightApplies = matchingFileDiff !== null;

  // Keep ref in sync with diffHighlightApplies for use in callbacks
  useEffect(() => {
    diffHighlightActiveRef.current = diffHighlightApplies;
    if (diffHighlightApplies) {
      console.log(`🎨 [FileView] Diff highlight active for ${file.path}`);
    }
  }, [diffHighlightApplies, file.path]);

  // Ref for editor to scroll to first highlighted line
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  // Build extensions with optional merge view diff and linting
  const extensions = useMemo(() => {
    // Use TypeScript extensions for .ts/.tsx files (includes linting, autocomplete, hover)
    // Use basic language extension + jsLinter for .js files
    // Use just JSON extension for .json files
    // Always include workflowLinter for dangerous key detection in code files
    const exts = isTypeScript
      ? [...tsExtensions, searchExtension, lintGutter(), workflowLinter(), workflowLinterTheme]
      : isJson
        ? [languageExtension, searchExtension]
        : isMarkdown
          ? [searchExtension]
          : [languageExtension, searchExtension, lintGutter(), jsLinter, workflowLinter(), workflowLinterTheme];

    // Add merge view diff if applicable - shows deleted content as widgets
    if (diffHighlightApplies && matchingFileDiff?.originalContent) {
      console.log(`🎨 [FileView] Adding unifiedMergeView for diff`);
      exts.push(
        unifiedMergeView({
          original: matchingFileDiff.originalContent,
          highlightChanges: true,
          gutter: true,
          syntaxHighlightDeletions: true,
          mergeControls: createMergeControls(editorRef, matchingFileDiff.filePath, onFileAccepted),
        }),
        mergeViewTheme
      );
    }
    return exts;
  }, [
    isTypeScript,
    tsExtensions,
    isJson,
    isMarkdown,
    languageExtension,
    diffHighlightApplies,
    matchingFileDiff,
    onFileAccepted,
  ]);

  // Scroll to top when diff highlight is applied (merge view shows diff inline)
  useEffect(() => {
    if (diffHighlightApplies && matchingFileDiff && editorRef.current?.view) {
      const view = editorRef.current.view;
      view.dispatch({
        effects: EditorView.scrollIntoView(0, { y: "start" }),
      });
      console.log(`🎨 [FileView] Scrolled to top for merge view diff`);
    }
  }, [diffHighlightApplies, matchingFileDiff]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{file.path}</span>
        {/* Save status indicator */}
        <div className="flex items-center gap-2">
          {isMarkdown && (
            <button
              onClick={() => setMarkdownPreview(!markdownPreview)}
              className="p-1 hover:bg-gray-200 rounded text-gray-600"
              title={markdownPreview ? "Edit" : "Preview"}
            >
              {markdownPreview ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          {saveStatus === "saving" && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Check className="w-3 h-3" />
              Saved
            </span>
          )}
          {saveStatus === "error" && <span className="text-xs text-red-600">Save failed</span>}
        </div>
      </div>
      {/* External file change banner */}
      {diffHighlightApplies && matchingFileDiff && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
          <span className="text-xs text-blue-700 flex items-center gap-2">
            <span className="font-medium">File changed externally</span>
            <span className="text-gray-500">(showing diff)</span>
          </span>
          {onDismissDiff && (
            <button
              onClick={onDismissDiff}
              className="p-0.5 hover:bg-blue-100 rounded text-blue-600"
              title="Dismiss highlighting"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {isMarkdown && markdownPreview ? (
          <ScrollArea className="h-full p-4">
            <MarkdownRenderer content={file.content} />
          </ScrollArea>
        ) : (
          <CodeMirror
            key={`${file.path}-diff-${diffHighlightApplies}`}
            ref={editorRef}
            value={editedCode}
            onChange={handleEditorChange}
            theme={githubLight}
            extensions={extensions}
            editable={true}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLineGutter: false,
              highlightActiveLine: true,
            }}
            className="h-full text-xs"
          />
        )}
      </div>
    </div>
  );
}

// SectionView component for viewing workflow sections (input, onError, onSuccess) with line highlighting
interface SectionViewProps {
  file: { path: string; content: string };
  sectionType: "input" | "onError" | "onSuccess" | "step";
  lineStart?: number;
  lineEnd?: number;
  workflowId?: string | number | null;
  onChange?: (filePath: string, content: string) => void;
  // Execution data for Logs/State tabs
  stepIndex?: number;
  stepId?: string; // Step ID for looking up execution logs from file
  logsRefreshKey?: number; // Counter to trigger logs reload after step execution
  workflowExecutionState?: {
    lastUpdated: string | null;
    lastStepIndex: number | null;
    env: Record<string, unknown>;
  } | null; // Execution state to trigger state tab reload
  // Diff highlighting for TypeScript workflow steps
  diffHighlight?: DiffHighlight | null;
  onDismissDiff?: () => void;
  onFileAccepted?: (filePath: string) => void;
}

function SectionView({
  file,
  sectionType,
  lineStart,
  lineEnd,
  workflowId,
  onChange,
  stepIndex,
  stepId,
  logsRefreshKey,
  workflowExecutionState,
  diffHighlight,
  onDismissDiff,
  onFileAccepted,
}: SectionViewProps) {
  const [editedCode, setEditedCode] = useState(file.content);

  // TypeScript type checking hook - SectionView always handles .ts files
  const isTypeScriptFile = shouldUseTypeScript(file.path);
  const { extensions: tsExtensions, syncContent } = useTypescriptEditor({
    workflowId,
    // Virtual path must match what read_workflow_source_files returns (e.g., "/src/terminator.ts")
    fileName: `/${file.path}`,
    enableTypeChecking: isTypeScriptFile,
  });

  // File-based state for Logs and State tabs
  const [stateFileContent, setStateFileContent] = useState<string | null>(null);
  const [stateFileLoading, setStateFileLoading] = useState(false);
  const [executionLogContent, setExecutionLogContent] = useState<string | null>(null);
  const [executionLogLoading, setExecutionLogLoading] = useState(false);

  // Collapsible logs panel state - persist to localStorage
  const sectionLogsPanelRef = useRef<ImperativePanelHandle>(null);
  const [isSectionLogsCollapsed, setIsSectionLogsCollapsed] = useState(() => {
    const saved = localStorage.getItem("mediar:logsPanel:collapsed");
    return saved === "true";
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem("mediar:logsPanel:collapsed", String(isSectionLogsCollapsed));
  }, [isSectionLogsCollapsed]);

  // Sync panel state on mount based on saved preference
  useEffect(() => {
    const panel = sectionLogsPanelRef.current;
    if (!panel) return;
    if (isSectionLogsCollapsed) {
      panel.collapse();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSectionLogsPanel = useCallback(() => {
    const panel = sectionLogsPanelRef.current;
    if (!panel) return;
    if (isSectionLogsCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [isSectionLogsCollapsed]);

  // Load state.json file when component mounts or workflowId changes
  useEffect(() => {
    if (sectionType !== "step" || !workflowId) return;

    console.log(
      "[DEBUG stateRefresh] Loading state.json for step view, lastUpdated:",
      workflowExecutionState?.lastUpdated
    );

    const loadStateFile = async () => {
      setStateFileLoading(true);
      try {
        const result = await invoke<{ path: string; content: string; is_binary: boolean }>("read_workflow_file", {
          workflowId: String(workflowId),
          filePath: "state.json",
        });
        setStateFileContent(result.content);
      } catch (error) {
        console.warn("[SectionView] Failed to load state.json:", error);
        setStateFileContent(null);
      } finally {
        setStateFileLoading(false);
      }
    };

    loadStateFile();
    // workflowExecutionState?.lastUpdated triggers reload when step execution completes
  }, [sectionType, workflowId, workflowExecutionState?.lastUpdated]);

  // Load execution log from file when component mounts or stepId/logsRefreshKey changes
  useEffect(() => {
    if (sectionType !== "step" || !workflowId || !stepId) return;

    const loadExecutionLog = async () => {
      console.log("[SectionView] Loading log from file:", { stepId, logsRefreshKey });
      setExecutionLogLoading(true);
      try {
        const result = await invoke<{
          found: boolean;
          file_path: string | null;
          content: string | null;
          timestamp: string | null;
        }>("get_step_execution_log", {
          workflowId: String(workflowId),
          stepId,
        });
        if (result.found && result.content) {
          // Pretty-print the JSON for display
          try {
            const parsed = JSON.parse(result.content);
            setExecutionLogContent(JSON.stringify(parsed, null, 2));
          } catch {
            setExecutionLogContent(result.content);
          }
        } else {
          setExecutionLogContent(null);
        }
      } catch (error) {
        console.warn("[SectionView] Failed to load execution log:", error);
        setExecutionLogContent(null);
      } finally {
        setExecutionLogLoading(false);
      }
    };

    loadExecutionLog();
    // logsRefreshKey triggers reload when step execution completes
  }, [sectionType, workflowId, stepId, logsRefreshKey]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>(file.content);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  // Find the matching file diff from accumulated diffs
  const matchingFileDiff = useMemo(() => {
    if (!diffHighlight?.files?.length) return null;
    const normalizedFilePath = file.path.replace(/\\/g, "/");
    return (
      diffHighlight.files.find(f => {
        const normalizedDiffPath = f.filePath.replace(/\\/g, "/");
        return normalizedFilePath.endsWith(normalizedDiffPath) || normalizedDiffPath.endsWith(normalizedFilePath);
      }) || null
    );
  }, [diffHighlight, file.path]);

  // Check if diff highlight applies to this file
  const diffHighlightApplies = matchingFileDiff !== null;
  const diffHighlightActiveRef = useRef(false);

  // Keep ref in sync with diffHighlightApplies for use in callbacks
  useEffect(() => {
    diffHighlightActiveRef.current = diffHighlightApplies;
    if (diffHighlightApplies) {
      console.log(`🎨 [SectionView] Diff highlight active for ${file.path}`);
    }
  }, [diffHighlightApplies, file.path]);

  // Scroll to top when diff highlight is applied (merge view shows diff inline)
  useEffect(() => {
    if (diffHighlightApplies && matchingFileDiff && editorRef.current?.view) {
      const view = editorRef.current.view;
      view.dispatch({
        effects: EditorView.scrollIntoView(0, { y: "start" }),
      });
      console.log(`🎨 [SectionView] Scrolled to top for merge view diff`);
    }
  }, [diffHighlightApplies, matchingFileDiff]);

  const sectionLabel =
    sectionType === "input"
      ? "Workflow Input"
      : sectionType === "onError"
        ? "Troubleshooting"
        : sectionType === "step"
          ? "Step"
          : "Workflow Output";

  // Reset local state when file changes
  useEffect(() => {
    setEditedCode(file.content);
    console.log(`🎨 [SectionView] DEBUG: editedCode updated from file.content (${file.content.length}b)`);
    lastSavedContentRef.current = file.content;
    setSaveStatus("idle");
  }, [file.path, file.content]);

  // Autosave function
  const saveFile = useCallback(
    async (content: string) => {
      if (!workflowId) {
        return;
      }

      if (content === lastSavedContentRef.current) {
        return;
      }

      setSaveStatus("saving");
      try {
        await invoke("write_typescript_workflow_file", {
          input: {
            workflow_id: String(workflowId),
            file_path: file.path,
            content,
          },
        });
        lastSavedContentRef.current = content;
        setSaveStatus("saved");
        onChange?.(file.path, content);

        setTimeout(() => {
          setSaveStatus("idle");
        }, 2000);
      } catch (error) {
        console.error("[SectionView] Failed to save file:", error);
        setSaveStatus("error");
      }
    },
    [workflowId, file.path, onChange]
  );

  // Handle editor changes with debounced autosave
  const handleEditorChange = useCallback(
    (value: string) => {
      setEditedCode(value);

      // Sync to TypeScript environment for type checking
      syncContent(value);

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        saveFile(value);
      }, 1000);
    },
    [saveFile, syncContent]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Create extensions including line highlighting, merge view diff, and workflow linting
  const extensions = useMemo(() => {
    // Use TypeScript extensions for .ts/.tsx files, fallback to basic JS for others
    // Always include lintGutter and workflowLinter for dangerous key detection
    const exts = isTypeScriptFile
      ? [...tsExtensions, searchExtension, lintGutter(), workflowLinter(), workflowLinterTheme]
      : [
          javascript({ typescript: true }),
          searchExtension,
          lintGutter(),
          jsLinter,
          workflowLinter(),
          workflowLinterTheme,
        ];

    if (lineStart !== undefined && lineEnd !== undefined) {
      exts.push(...createLineHighlightExtension(lineStart, lineEnd));
    }
    // Add merge view diff if applicable - shows deleted content as widgets
    if (diffHighlightApplies && matchingFileDiff?.originalContent) {
      console.log(`🎨 [SectionView] Adding unifiedMergeView for diff (key will include diff-true to force remount)`);
      console.log(
        `🎨 [SectionView] DEBUG: original=${matchingFileDiff.originalContent.length}b, current=${editedCode.length}b, same=${matchingFileDiff.originalContent === editedCode}`
      );
      exts.push(
        unifiedMergeView({
          original: matchingFileDiff.originalContent,
          highlightChanges: true,
          gutter: true,
          syntaxHighlightDeletions: true,
          mergeControls: createMergeControls(editorRef, matchingFileDiff.filePath, onFileAccepted),
        }),
        mergeViewTheme
      );
    }
    return exts;
  }, [isTypeScriptFile, tsExtensions, lineStart, lineEnd, diffHighlightApplies, matchingFileDiff, onFileAccepted]);

  // Scroll to highlighted lines when editor is created
  const handleEditorCreate = useCallback(
    (view: EditorView) => {
      if (lineStart !== undefined) {
        setTimeout(() => {
          const lineNum = Math.min(lineStart, view.state.doc.lines);
          const lineInfo = view.state.doc.line(lineNum);
          view.dispatch({
            effects: EditorView.scrollIntoView(lineInfo.from, { y: "start", yMargin: 50 }),
          });
        }, 50);
      }
    },
    [lineStart]
  );

  // For step sections, show tabs (Definition/Logs/State) like StepView
  const showTabs = sectionType === "step";
  const index = stepIndex ?? 0;

  const editorContent = (
    <CodeMirror
      key={`${file.path}-${lineStart}-${lineEnd}-diff-${diffHighlightApplies}`}
      ref={editorRef}
      value={editedCode}
      onChange={handleEditorChange}
      theme={githubLight}
      extensions={extensions}
      onCreateEditor={handleEditorCreate}
      editable={true}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLineGutter: false,
        highlightActiveLine: true,
      }}
      className="h-full min-h-0 text-xs"
    />
  );

  const headerContent = (
    <div className="flex-shrink-0 px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">{sectionLabel}</span>
        <span className="text-sm text-gray-400">{sectionType}</span>
        {lineStart !== undefined && lineEnd !== undefined && (
          <span className="text-xs text-gray-400">
            :{lineStart}-{lineEnd}
          </span>
        )}
        {/* Diff highlight badge */}
        {diffHighlightApplies && matchingFileDiff && (
          <span className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded flex items-center gap-1">
            <span>modified</span>
          </span>
        )}
      </div>
      {/* Save status indicator */}
      <div className="flex items-center gap-2">
        {saveStatus === "saving" && (
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving...
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <Check className="w-3 h-3" />
            Saved
          </span>
        )}
        {saveStatus === "error" && <span className="text-xs text-red-600">Save failed</span>}
      </div>
    </div>
  );

  // Parse execution log for step sections (must be before early return to maintain hook order)
  const parsedLog = useMemo(() => {
    if (!executionLogContent) return null;
    try {
      const log = JSON.parse(executionLogContent);

      // Check if this is in-memory format (StepExecutionLog) or file format
      if (log.stepName && log.tool !== undefined) {
        // In-memory format (StepExecutionLog)
        const hasError = !!(log.error || log.result?.error);
        const status = hasError ? "error" : log.result?.success ? "success" : "unknown";
        const durationMs = log.startTime && log.endTime ? log.endTime - log.startTime : undefined;

        // Extract detailed error data from in-memory log (new fields: stderr, stdout, errorLogs, exitCode)
        const stderr = log.stderr as string | undefined;
        const stdout = log.stdout as string | undefined;
        const errorLogs = log.errorLogs as Array<{ timestamp: string; level: string; message: string }> | undefined;
        const exitCode = log.exitCode as number | undefined;

        // Convert consoleLogs to capturedLogs format
        let capturedLogs: Array<{ timestamp: string; level: string; message: string }> | undefined = undefined;

        // First, try to use consoleLogs if they exist and have content
        if (log.consoleLogs && Array.isArray(log.consoleLogs) && log.consoleLogs.length > 0) {
          capturedLogs = log.consoleLogs.map((entry: any) => {
            if (typeof entry === "string") {
              return {
                timestamp: new Date(log.startTime || Date.now()).toISOString(),
                level: "LOG",
                message: entry,
              };
            }
            return {
              timestamp: entry.timestamp
                ? new Date(entry.timestamp).toISOString()
                : new Date(log.startTime || Date.now()).toISOString(),
              level: entry.level?.toUpperCase() || "LOG",
              message: entry.message || String(entry),
            };
          });
        }

        // Merge errorLogs into capturedLogs if present
        if (errorLogs?.length) {
          capturedLogs = [...(capturedLogs || []), ...errorLogs];
        }

        // If no logs from consoleLogs (undefined or empty), try to extract logs from fullResult (response structure)
        // This handles cases where logs are in the response but weren't captured into consoleLogs during execution
        if (!capturedLogs && log.fullResult) {
          const fullResult = log.fullResult;
          let extractedLogs: Array<{ timestamp: string; level: string; message: string }> = [];

          // Helper to extract logs from any object
          const extractLogsFromObject = (obj: any, baseTimestamp: number) => {
            if (!obj || typeof obj !== "object") return;

            // Check for direct logs array
            if (obj.logs && Array.isArray(obj.logs)) {
              obj.logs.forEach((logMessage: string) => {
                extractedLogs.push({
                  timestamp: new Date(baseTimestamp).toISOString(),
                  level: "LOG",
                  message: logMessage,
                });
              });
            }

            // Check for results array with logs (execute_sequence format)
            if (obj.results && Array.isArray(obj.results)) {
              obj.results.forEach((result: any) => {
                if (result.logs && Array.isArray(result.logs)) {
                  result.logs.forEach((logMessage: string) => {
                    extractedLogs.push({
                      timestamp: new Date(baseTimestamp).toISOString(),
                      level: "LOG",
                      message: logMessage,
                    });
                  });
                }
              });
            }

            // Check for action === "execute_sequence" format (MCP response structure)
            if (obj.action === "execute_sequence" && obj.results && Array.isArray(obj.results)) {
              obj.results.forEach((result: any) => {
                if (result.logs && Array.isArray(result.logs)) {
                  result.logs.forEach((logMessage: string) => {
                    extractedLogs.push({
                      timestamp: new Date(baseTimestamp).toISOString(),
                      level: "LOG",
                      message: logMessage,
                    });
                  });
                }
              });
            }
          };

          const baseTimestamp = log.startTime || Date.now();

          // Check fullResult directly
          extractLogsFromObject(fullResult, baseTimestamp);

          // Check fullResult.content (MCP wraps content in content field)
          if (fullResult.content) {
            let content = fullResult.content;

            // Handle array-wrapped content
            if (Array.isArray(content) && content.length > 0) {
              content = content[0];
            }

            // Handle text-wrapped JSON responses
            if (content && typeof content === "object" && content.type === "text" && content.text) {
              try {
                content = JSON.parse(content.text);
              } catch (e) {
                // Not JSON, skip
              }
            }

            // Extract logs from the parsed content
            if (content && typeof content === "object") {
              extractLogsFromObject(content, baseTimestamp);
            }
          }

          // Check result.output (logs might be in the output)
          if (log.result?.output && typeof log.result.output === "object") {
            extractLogsFromObject(log.result.output, baseTimestamp);
          }

          if (extractedLogs.length > 0) {
            capturedLogs = extractedLogs;
          }
        }

        // Ensure capturedLogs is at least an empty array (not undefined)
        if (!capturedLogs) {
          capturedLogs = [];
        }

        // Format result content
        let resultContent = "";
        if (log.result?.output) {
          try {
            resultContent =
              typeof log.result.output === "string" ? log.result.output : JSON.stringify(log.result.output, null, 2);
          } catch {
            resultContent = String(log.result.output);
          }
        }

        // Add error to result content if present
        if (log.error || log.result?.error) {
          const errorMsg = log.error || log.result.error;
          if (resultContent) {
            resultContent = `Error: ${errorMsg}\n\n${resultContent}`;
          } else {
            resultContent = `Error: ${errorMsg}`;
          }
        }

        // Append stderr/stdout to result content for detailed error viewing
        if (stderr) {
          resultContent = resultContent ? `${resultContent}\n\n--- stderr ---\n${stderr}` : `--- stderr ---\n${stderr}`;
        }
        if (stdout && !resultContent.includes(stdout)) {
          resultContent = resultContent ? `${resultContent}\n\n--- stdout ---\n${stdout}` : `--- stdout ---\n${stdout}`;
        }
        if (exitCode !== undefined && exitCode !== 0) {
          resultContent = resultContent ? `${resultContent}\n\n[Exit code: ${exitCode}]` : `[Exit code: ${exitCode}]`;
        }

        return {
          status,
          durationMs,
          capturedLogs,
          resultContent,
          error: log.error || log.result?.error,
          stderr,
          stdout,
          exitCode,
        };
      } else {
        // File format (original parsing logic)
        const response = log.response || {};
        const status = response.status || "unknown";
        const durationMs = response.duration_ms;
        const results = response.result || [];
        let capturedLogs = log.logs as Array<{ timestamp: string; level: string; message: string }> | undefined;

        // Extract error details from response.error (it's a JSON string with stderr, exit_code, etc.)
        let stderr: string | undefined;
        let stdout: string | undefined;
        let exitCode: number | undefined;
        let errorMessage: string | undefined;

        if ((status === "error" || status === "executed_with_error") && response.error) {
          try {
            const errorJson = JSON.parse(response.error);
            console.log("[SectionView] Parsed error JSON from file:", {
              hasData: !!errorJson.data,
              exitCode: errorJson.data?.exit_code,
            });
            errorMessage = errorJson.message;
            if (errorJson.data) {
              stderr = errorJson.data.stderr;
              stdout = errorJson.data.stdout;
              exitCode = errorJson.data.exit_code;
              if (errorJson.data.logs?.length) {
                capturedLogs = [...(capturedLogs || []), ...errorJson.data.logs];
              }
            }
          } catch {}
        }

        let resultContent = "";
        for (const item of results) {
          if (item.type === "text" && item.text) {
            try {
              resultContent = JSON.stringify(JSON.parse(item.text), null, 2);
            } catch {
              resultContent = item.text;
            }
          }
        }
        return { status, durationMs, capturedLogs, resultContent, error: errorMessage, stderr, stdout, exitCode };
      }
    } catch {
      return { status: "unknown", rawContent: executionLogContent };
    }
  }, [executionLogContent]);

  if (!showTabs) {
    // Original layout for non-step sections (input, onError, onSuccess)
    return (
      <div className="h-full flex flex-col">
        {headerContent}
        <div className="flex-1 overflow-hidden">{editorContent}</div>
      </div>
    );
  }

  // Step sections: split view with definition (70%) top, logs (30%) bottom - resizable
  return (
    <PanelGroup direction="vertical" className="h-full">
      {/* Definition section */}
      <Panel defaultSize={70} minSize={20}>
        <div className="h-full flex flex-col">
          <div className="flex-shrink-0 px-3 py-1.5 bg-gray-50 border-b flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Code className="w-3 h-3 text-gray-500 flex-shrink-0" />
              <span className="font-medium">{sectionLabel}</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-400 truncate">{file.path}</span>
              {lineStart !== undefined && lineEnd !== undefined && (
                <span className="text-blue-500">
                  :{lineStart}-{lineEnd}
                </span>
              )}
            </div>
            <div className="flex-shrink-0 ml-2 flex items-center gap-2">
              {saveStatus === "saving" && (
                <span className="text-gray-500 flex items-center">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Saving...
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="text-green-600 flex items-center">
                  <Check className="w-3 h-3 mr-1" />
                  Saved
                </span>
              )}
              {saveStatus === "error" && <span className="text-red-600">Save failed</span>}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">{editorContent}</div>
        </div>
      </Panel>
      {!isSectionLogsCollapsed && (
        <PanelResizeHandle className="h-1 bg-gray-200 hover:bg-gray-300 transition-colors cursor-row-resize" />
      )}
      {/* Logs header - always visible */}
      <div
        className="flex-shrink-0 px-3 py-1.5 bg-gray-50 border-y flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={toggleSectionLogsPanel}
        title={isSectionLogsCollapsed ? "Expand logs" : "Collapse logs"}
      >
        <ScrollText className="w-3 h-3 text-gray-500" />
        <span className="font-medium">Logs</span>
        {executionLogLoading && <Loader2 className="w-3 h-3 animate-spin" />}
        {parsedLog && parsedLog.status !== "unknown" && (
          <>
            <span className="text-gray-400">|</span>
            <span className={cn(parsedLog.status === "executed_without_error" ? "text-green-600" : "text-red-600")}>
              {parsedLog.status}
            </span>
            {parsedLog.durationMs !== undefined && (
              <span className="text-gray-500">{(parsedLog.durationMs / 1000).toFixed(2)}s</span>
            )}
          </>
        )}
        <div className="flex-1" />
        {isSectionLogsCollapsed ? (
          <ChevronUp className="w-3 h-3 text-gray-400" />
        ) : (
          <ChevronDown className="w-3 h-3 text-gray-400" />
        )}
      </div>
      {/* Logs section - collapsible */}
      <Panel
        ref={sectionLogsPanelRef}
        defaultSize={30}
        minSize={5}
        collapsible
        collapsedSize={0}
        onCollapse={() => setIsSectionLogsCollapsed(true)}
        onExpand={() => setIsSectionLogsCollapsed(false)}
      >
        <div className="h-full flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto">
            {executionLogLoading ? (
              <div className="h-full flex items-center justify-center text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading...
              </div>
            ) : parsedLog ? (
              <div className="h-full flex flex-col">
                {/* Console logs */}
                <div className="flex-1 min-h-0 overflow-auto p-2 border-b">
                  {parsedLog.capturedLogs && parsedLog.capturedLogs.length > 0 ? (
                    <div className="border rounded bg-white font-mono text-xs overflow-auto h-full">
                      {parsedLog.capturedLogs.map((entry, i) => {
                        const levelColor =
                          entry.level === "ERROR"
                            ? "text-red-600"
                            : entry.level === "WARN"
                              ? "text-yellow-600"
                              : "text-gray-900";
                        const date = new Date(entry.timestamp);
                        const time = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
                        return (
                          <div key={i} className="px-2 py-0.5 hover:bg-gray-50 flex gap-2 whitespace-nowrap">
                            <span className="text-gray-400 flex-shrink-0">{time}</span>
                            <span className={cn("w-12 flex-shrink-0", levelColor)}>[{entry.level}]</span>
                            <span className="text-gray-900">{entry.message}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-gray-400 text-xs">No console output</div>
                  )}
                </div>
                {/* Result JSON - 50% */}
                <div className="flex-1 min-h-0 overflow-auto">
                  {parsedLog.resultContent || (parsedLog as any).rawContent ? (
                    <CodeMirror
                      value={parsedLog.resultContent || (parsedLog as any).rawContent || ""}
                      theme={githubLight}
                      extensions={[json(), searchExtension]}
                      className="h-full text-xs"
                      readOnly
                      basicSetup={{ lineNumbers: false, foldGutter: true, highlightActiveLineGutter: false }}
                    />
                  ) : (
                    <div className="p-2 text-gray-400 text-xs">No result data</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-xs">
                No logs - execute the step to generate logs
              </div>
            )}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}

export function StepDetailsPanel({
  workflow,
  poolSteps = [],
  outputCode = "",
  selection,
  workflowExecutionState,
  logsRefreshKey,
  loadedScripts = {},
  onVariablesChange,
  onSelectorsChange,
  onOutputChange,
  onFileChange,
  className,
  diffHighlight,
  onDismissDiff,
  onFileAccepted,
  onScheduleChanged,
}: StepDetailsPanelProps) {
  const steps = workflow.content?.steps || [];
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  // Memoize jsonFiles to prevent infinite re-render loop in RawEventsView
  const recordingJsonFiles = useMemo(() => {
    const recordingsFolder = workflow.files?.find(f => f.name.toLowerCase() === "recordings" && f.isDirectory);
    const files = recordingsFolder?.children?.filter(f => f.name.endsWith(".json")).map(f => f.path) || [];
    console.log("[StepDetailsPanel] memoized recordingJsonFiles:", files.length, "files");
    return files;
  }, [workflow.files]);

  const renderContent = () => {
    if (!selection) {
      return <WorkflowMetadataView workflow={workflow} />;
    }

    switch (selection.type) {
      case "raw-events": {
        // Use memoized recordingJsonFiles to prevent infinite re-render loop
        console.log("[StepDetailsPanel] raw-events render, files:", recordingJsonFiles.length);

        return recordingJsonFiles.length > 0 && workflow.id ? (
          <RawEventsView workflowId={String(workflow.id)} recordingFiles={recordingJsonFiles} />
        ) : (
          <div className="p-4 text-center text-gray-500">
            No raw events captured. Raw events are only available for workflows created via recording.
          </div>
        );
      }

      case "pool": {
        const poolStep = poolSteps[selection.index];
        if (!poolStep) {
          return <div className="p-4 text-gray-500">Pool step not found</div>;
        }

        // Adapter: map PoolStep to CommandStep-like structure for StepView
        const stepAsCommand = {
          name: poolStep.step_name,
          id: poolStep.step_id,
          tool_name: poolStep.tool_name,
          arguments: poolStep.arguments,
        } as CommandStep;

        // Convert pool step logs to ConsoleLogEntry format
        const poolConsoleLogs: ConsoleLogEntry[] = (poolStep.logs || []).map((log, i) => ({
          timestamp: log.timestamp ? new Date(log.timestamp).getTime() : Date.now() + i,
          message: log.message,
          level: (log.level || "log") as "log" | "error" | "warn" | "info",
        }));

        // Create executionLog from pool step data for the Logs tab
        // Format to match StepExecutionLog interface that StepView expects
        const now = Date.now();
        console.log("[POOL-LOGS] poolStep.logs:", poolStep.logs);
        console.log("[POOL-LOGS] poolConsoleLogs:", poolConsoleLogs);
        const poolExecutionLog = {
          stepName: poolStep.step_name || poolStep.tool_name,
          tool: poolStep.tool_name,
          consoleLogs: poolConsoleLogs,
          result: {
            success: poolStep.succeeded,
            output: poolStep.result,
            error: poolStep.error ? String(poolStep.error) : undefined,
          },
          startTime: new Date(poolStep.created_at).getTime() || now,
          endTime: (new Date(poolStep.created_at).getTime() || now) + poolStep.duration_ms,
          error: poolStep.error ? String(poolStep.error) : undefined,
        };

        return (
          <StepView
            step={stepAsCommand}
            index={selection.index}
            executionState={workflowExecutionState}
            executionLog={poolExecutionLog as unknown as StepExecutionLog}
            workflowId={workflow.id}
            workflowFiles={workflow.files}
            isPoolStep={true}
            poolDefinition={poolStep.definition}
            onFileAccepted={onFileAccepted}
          />
        );
      }

      case "inspect":
        return (
          <div className="w-full min-w-0 max-w-full overflow-x-hidden h-full">
            <InspectView />
          </div>
        );

      case "state":
        return (
          <div className="w-full min-w-0 max-w-full overflow-x-hidden h-full p-4">
            <h2 className="text-sm font-medium mb-4">Workflow State</h2>
            <div className="space-y-3 text-xs">
              {workflowExecutionState?.lastUpdated && (
                <div>
                  <span className="font-medium">Last Updated:</span>
                  <span className="ml-2 text-gray-600">
                    {new Date(workflowExecutionState.lastUpdated).toLocaleString()}
                  </span>
                </div>
              )}

              {(() => {
                const env = workflowExecutionState?.env || {};
                const filteredEntries = Object.entries(env).filter(
                  ([key]) => !key.endsWith("_result") && !key.endsWith("_status")
                );

                if (filteredEntries.length === 0) {
                  return (
                    <div className="text-gray-500 italic">
                      No state variables (inputs, variables, or set_env) found.
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    {filteredEntries.map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span>
                        <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-48">
                          {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
                        </pre>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        );

      case "file": {
        // Helper to find file in tree
        const findInTree = (
          nodes: typeof workflow.files,
          predicate: (f: NonNullable<typeof workflow.files>[number]) => boolean
        ): NonNullable<typeof workflow.files>[number] | undefined => {
          if (!nodes) return undefined;
          for (const node of nodes) {
            if (!node.isDirectory && predicate(node)) return node;
            if (node.children) {
              const found = findInTree(node.children, predicate);
              if (found) return found;
            }
          }
          return undefined;
        };

        const file = findInTree(workflow.files, f => f.path === selection.path);
        if (!file || !file.content) {
          return <div className="p-4 text-gray-500">File not found or content not loaded: {selection.path}</div>;
        }

        // Check if file is an image by mimeType
        if (file.mimeType?.startsWith("image/")) {
          const imgSrc = `data:${file.mimeType};base64,${file.content}`;
          console.log("[StepDetailsPanel] rendering image:", file.path, file.mimeType);
          return (
            <div className="flex flex-col h-full">
              <div className="flex-1 flex items-center justify-center p-4 bg-gray-50 overflow-auto">
                <img
                  src={imgSrc}
                  alt={file.name}
                  className="max-w-full max-h-full object-contain cursor-pointer hover:opacity-90 transition-opacity border border-gray-200 rounded"
                  onClick={() => setExpandedImage(imgSrc)}
                />
              </div>
              <div className="px-4 py-2 border-t border-gray-200 text-xs text-gray-500">{file.path}</div>
            </div>
          );
        }

        return (
          <FileView
            file={{ path: file.path, content: file.content }}
            workflowId={workflow.id}
            onChange={onFileChange}
            diffHighlight={diffHighlight}
            onDismissDiff={onDismissDiff}
            onFileAccepted={onFileAccepted}
          />
        );
      }

      case "ts-trigger": {
        // Helper to find file in tree
        const findInTree = (
          nodes: typeof workflow.files,
          predicate: (f: NonNullable<typeof workflow.files>[number]) => boolean
        ): NonNullable<typeof workflow.files>[number] | undefined => {
          if (!nodes) return undefined;
          for (const node of nodes) {
            if (!node.isDirectory && predicate(node)) return node;
            if (node.children) {
              const found = findInTree(node.children, predicate);
              if (found) return found;
            }
          }
          return undefined;
        };

        // Find terminator.ts content
        const mainFile = findInTree(workflow.files, f => f.path.endsWith("terminator.ts"));

        // Show inline scheduler panel
        return (
          <SchedulerPanel
            workflow={
              workflow.localPath
                ? {
                    id: String(workflow.id || ""),
                    name: workflow.name || "Unnamed Workflow",
                    path: workflow.localPath,
                  }
                : null
            }
            onScheduled={onScheduleChanged}
            onFileChange={onFileChange}
            triggerFromCode={workflow.trigger}
            terminatorContent={mainFile?.content}
          />
        );
      }

      case "ts-input":
      case "ts-onError":
      case "ts-onSuccess": {
        // Helper to find file in tree
        const findInTree = (
          nodes: typeof workflow.files,
          predicate: (f: NonNullable<typeof workflow.files>[number]) => boolean
        ): NonNullable<typeof workflow.files>[number] | undefined => {
          if (!nodes) return undefined;
          for (const node of nodes) {
            if (!node.isDirectory && predicate(node)) return node;
            if (node.children) {
              const found = findInTree(node.children, predicate);
              if (found) return found;
            }
          }
          return undefined;
        };

        // Find the main terminator.ts file
        const mainFile = findInTree(workflow.files, f => f.path.endsWith("terminator.ts"));
        if (!mainFile || !mainFile.content) {
          return <div className="p-4 text-gray-500">Main workflow file not found</div>;
        }
        const sectionType =
          selection.type === "ts-input" ? "input" : selection.type === "ts-onError" ? "onError" : "onSuccess";
        return (
          <SectionView
            file={{ path: mainFile.path, content: mainFile.content }}
            sectionType={sectionType}
            lineStart={selection.lineStart}
            lineEnd={selection.lineEnd}
            workflowId={workflow.id}
            onChange={onFileChange}
            diffHighlight={diffHighlight}
            onDismissDiff={onDismissDiff}
            onFileAccepted={onFileAccepted}
          />
        );
      }

      case "ts-step": {
        // Helper to find file in tree
        const findInTree = (
          nodes: typeof workflow.files,
          predicate: (f: NonNullable<typeof workflow.files>[number]) => boolean
        ): NonNullable<typeof workflow.files>[number] | undefined => {
          if (!nodes) return undefined;
          for (const node of nodes) {
            if (!node.isDirectory && predicate(node)) return node;
            if (node.children) {
              const found = findInTree(node.children, predicate);
              if (found) return found;
            }
          }
          return undefined;
        };

        // Find the step's source file
        const stepFile = findInTree(workflow.files, f => f.path === selection.file);
        if (!stepFile || !stepFile.content) {
          return <div className="p-4 text-gray-500">Step file not found: {selection.file}</div>;
        }

        // Get the step ID for looking up execution logs from file
        // FIX: Use same fallback logic as getStepIdByIndex in useWorkflow.ts
        // If step.id is not set, generate it from step.name (snake_case)
        const step = steps[selection.index];
        let stepId = step?.id;
        if (!stepId && step && "name" in step && typeof step.name === "string") {
          stepId = step.name
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9_]/g, "");
        }

        return (
          <SectionView
            file={{ path: stepFile.path, content: stepFile.content }}
            sectionType="step"
            lineStart={selection.lineStart}
            lineEnd={selection.lineEnd}
            workflowId={workflow.id}
            onChange={onFileChange}
            stepIndex={selection.index}
            stepId={stepId}
            logsRefreshKey={logsRefreshKey}
            workflowExecutionState={workflowExecutionState}
            diffHighlight={diffHighlight}
            onDismissDiff={onDismissDiff}
            onFileAccepted={onFileAccepted}
          />
        );
      }

      default:
        return <WorkflowMetadataView workflow={workflow} />;
    }
  };

  return (
    <>
      <div className={cn("h-full overflow-x-auto bg-white", className)}>
        <div
          className={cn(
            "h-full flex flex-col",
            ![
              "inspect",
              "step",
              "variables",
              "ts-input",
              "ts-onError",
              "ts-onSuccess",
              "ts-trigger",
              "ts-step",
              "pool",
            ].includes(selection?.type ?? "") && "min-w-max"
          )}
        >
          {renderContent()}
        </div>
      </div>

      {/* Expanded image modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setExpandedImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={expandedImage}
              alt="Expanded view"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <button
              className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white hover:bg-black/70"
              onClick={() => setExpandedImage(null)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
