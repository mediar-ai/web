import {
  DndContext,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  ChevronDown,
  Play,
  StopCircle,
  Loader2,
  Trash2,
  CopyPlus,
  Undo2,
  Redo2,
  X,
  Circle,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  FileCode,
  FolderOpen,
  Globe,
  Cloud,
  RefreshCw,
  ExternalLink,
  Database,
  Calendar,
  ArrowDownToLine,
  AlertTriangle,
  ArrowUpFromLine,
  MousePointer2,
  History,
  Bug,
  FolderClosed,
  List,
  Clock,
} from "lucide-react";
import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileContextMenu } from "@/components/ui/file-context-menu";
import { SchedulerDialog, type ScheduledWorkflow } from "@/components/ui/scheduler-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PoolStep } from "@/hooks/useStepPool";
import type { StepResult } from "@/hooks/useWorkflow";
import { trackRunWorkflowButton, trackWorkflowStepExecuted, trackWorkflowStopped } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { ChangeType } from "@/lib/workflow-diff";
import { getChangeIndicator } from "@/lib/workflow-diff";
import type { SequenceStep, CommandStep } from "@/lib/workflow-schema";
import type { Workflow, WorkflowExecutionLogs, TypeScriptWorkflowFile } from "./types";
import { SpotlightHint } from "@/components/onboarding";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { useWorkflowVersions } from "@/hooks/useWorkflowVersions";

export type SidebarSelection =
  | { type: "variables" }
  | { type: "raw-events" }
  | { type: "step"; index: number; parentIndex?: number }
  | { type: "troubleshoot"; index: number }
  | { type: "pool"; index: number }
  | { type: "output" }
  | { type: "inspect" }
  | { type: "state" }
  // TypeScript workflow file selections
  | { type: "file"; path: string } // Select a file (shows full file in editor)
  | { type: "ts-input"; file: string; lineStart?: number; lineEnd?: number } // Select input schema section
  | { type: "ts-onError"; file: string; lineStart?: number; lineEnd?: number } // Select onError handler
  | { type: "ts-onSuccess"; file: string; lineStart?: number; lineEnd?: number } // Select onSuccess handler
  | { type: "ts-trigger"; file: string; lineStart?: number; lineEnd?: number } // Select trigger/schedule section
  | { type: "ts-step"; file: string; index: number; lineStart?: number; lineEnd?: number } // Select a step in a TypeScript file
  | null;

// Range selection state for executing multiple steps
export interface RangeSelection {
  startIndex: number;
  endIndex: number;
  executeJumpsAtEnd: boolean;
  followFallback: boolean;
}

export interface RangeExecutionOptions {
  startIndex: number;
  endIndex: number;
  executeJumpsAtEnd?: boolean;
  followFallback?: boolean;
  providedInputs?: Record<string, unknown>;
}

interface WorkflowSidebarProps {
  workflow: Workflow;
  troubleshootingSteps?: SequenceStep[];
  hasOutput?: boolean;
  selection: SidebarSelection;
  onSelectionChange: (selection: SidebarSelection) => void;
  currentStep?: number;
  workflowState?: string;
  workflowExecutionLogs?: WorkflowExecutionLogs;
  className?: string;
  // Execution props
  isExecuting?: boolean;
  isPreparingWorkflow?: boolean;
  isMcpAvailable?: boolean;
  shortcutsEnabled?: boolean;
  stepResult?: StepResult;
  isFullWorkflowMode?: boolean;
  executingRange?: { start: number; end: number } | null;
  onExecuteFullWorkflow?: () => void;
  onExecuteStep?: (stepIndex?: number) => void;
  onExecuteStepRange?: (options: RangeExecutionOptions) => void;
  onJumpToStep?: (stepIndex: number) => void;
  onInterruptStep?: () => void;
  // NOTE: onDeleteStep/onDuplicateStep removed - YAML step operations deprecated
  onSetRuntimeExecutionOptions?: (options: { skip_preflight_check?: boolean }) => void;
  // Step pool props
  poolSteps?: PoolStep[];
  executingPoolStepId?: string | null;
  onExecutePoolStep?: (poolStep: PoolStep) => void;
  onDeletePoolStep?: (stepId: string) => Promise<void>;
  // Schedule props
  onScheduleChanged?: () => void;
  onClearPool?: () => Promise<void>;
  // Clone props
  onCloneWorkflow?: (workflowId: number | string) => Promise<void>;
  // Undo/Redo props
  onUndo?: () => Promise<unknown>;
  onRedo?: () => Promise<unknown>;
  canUndo?: boolean;
  canRedo?: boolean;
  // Visibility props
  onSetWorkflowVisibility?: (
    workflowId: number | string,
    isPublic: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  // TypeScript workflow file diff - affected step IDs from line-based diff detection
  affectedStepIds?: string[];
  onDismissFileDiff?: () => void;
  // Diff accept/reject props
  diffHighlight?: { files: Array<{ filePath: string; originalContent: string }> } | null;
  onAcceptAllDiffs?: () => void;
  onRejectAllDiffs?: () => void;
  // Drag-and-drop props
  onAddPoolStepToWorkflow?: (poolStepId: string, insertAtIndex: number) => Promise<void>;
  onAddWorkflowStepToPool?: (step: CommandStep, stepIndex: number, insertAtOrder?: number) => Promise<void>;
  onReorderWorkflowStep?: (fromIndex: number, toIndex: number) => Promise<void>;
  dragOperationLoading?: { type: "pool-to-workflow" | "workflow-to-pool" | "workflow-reorder"; id: string } | null;
  // Recording props
  onStartRecording?: () => void;
  // File loading
  loadFileContent?: (filePath: string) => Promise<TypeScriptWorkflowFile | null>;
  // File operations - refresh callback after file operations complete
  onRefreshFiles?: () => void;
  // Cloud sync props
  onSyncToCloud?: () => Promise<{ success: boolean; error?: string }>;
  isSyncing?: boolean;
  needsPull?: boolean;
  // Workflow execution state (for State view)
  workflowExecutionState?: {
    lastUpdated: string | null;
    lastStepIndex: number | null;
    env: Record<string, unknown>;
  };
  // Real-time step status from MCP notifications
  liveStepStatus?: {
    [stepIndex: number]: "pending" | "running" | "completed" | "failed";
  };
  // Onboarding hint for Run All button
  showRunAllHint?: boolean;
  // Version history props
  onVersionRestored?: (files: string[]) => void;
  versionHistoryOpen?: boolean;
  onVersionHistoryOpenChange?: (open: boolean) => void;
}

// Draggable wrapper for steps
interface DraggableStepProps {
  id: string;
  type: "workflow" | "pool";
  index: number;
  children: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
}

function DraggableStep({ id, type, index, children, disabled, isLoading }: DraggableStepProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { type, index },
    disabled: disabled || isLoading,
  });

  const style: React.CSSProperties = {
    ...(transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        }
      : {}),
    opacity: isDragging || isLoading ? 0.5 : 1,
    cursor: disabled || isLoading ? "default" : isDragging ? "grabbing" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn("relative", isDragging && "z-50 shadow-lg rounded")}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10 rounded">
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
      )}
      {children}
    </div>
  );
}

// Drop zone indicator between steps
interface DropZoneProps {
  id: string;
  isOver?: boolean;
}

function DropZone({ id, isOver }: DropZoneProps) {
  const { setNodeRef, isOver: isOverThis } = useDroppable({ id });
  const showIndicator = isOver || isOverThis;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-1 mx-2 rounded-full transition-all duration-150",
        showIndicator ? "bg-blue-500 h-1" : "bg-transparent hover:bg-gray-200"
      )}
    />
  );
}

interface StepTreeItemProps {
  step: SequenceStep;
  index: number;
  depth: number;
  isSelected: boolean;
  isExecuting: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  isCurrent: boolean;
  hasNestedSteps: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onExecuteStep?: () => void;
  onInterruptStep?: () => void;
  onDeleteStep?: () => void; // For pool steps deletion
  isMcpAvailable?: boolean;
  isPreparingWorkflow?: boolean;
  shortcutsEnabled?: boolean;
  isNextToExecute?: boolean; // Show Tab shortcut badge on this step
  children?: React.ReactNode;
  // Diff props
  changeType?: ChangeType;
  // Range selection props
  isInRange?: boolean;
  isSelectingRange?: boolean;
  onRangeSelectStart?: (index: number) => void;
  onRangeSelectEnd?: (index: number, event?: React.MouseEvent) => void;
  onRangeHover?: (index: number) => void;
}

function StepTreeItem({
  step,
  index,
  depth,
  isSelected,
  isExecuting,
  isCompleted,
  isFailed,
  isCurrent,
  hasNestedSteps,
  isExpanded,
  onToggleExpand,
  onSelect,
  onExecuteStep,
  onInterruptStep,
  isMcpAvailable,
  isPreparingWorkflow,
  shortcutsEnabled,
  isNextToExecute,
  children,
  changeType,
  isInRange,
  isSelectingRange,
  onRangeSelectStart,
  onRangeSelectEnd,
  onRangeHover,
}: StepTreeItemProps) {
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [floatingPosition, setFloatingPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const commandStep = step as CommandStep;
  const stepName = commandStep.name;
  const stepId = commandStep.id;

  const toolName = commandStep.tool_name;
  // Display name for title/tooltip
  const displayName = stepName || stepId;
  const autoHideTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (autoHideTimeoutRef.current) {
        clearTimeout(autoHideTimeoutRef.current);
      }
    };
  }, []);

  // Reset hover state when execution starts
  React.useEffect(() => {
    if (isExecuting) {
      setIsCardHovered(false);
      setFloatingPosition(null);
    }
  }, [isExecuting]);

  // Auto-hide floating panel after 3 seconds of inactivity
  React.useEffect(() => {
    if (isCardHovered && floatingPosition) {
      // console.log('[HOVER_DEBUG] Panel shown, starting 3s auto-hide timer');
      autoHideTimeoutRef.current = setTimeout(() => {
        // console.log('[HOVER_DEBUG] Auto-hiding panel after 3s');
        setIsCardHovered(false);
        setFloatingPosition(null);
      }, 3000);
      return () => {
        if (autoHideTimeoutRef.current) {
          clearTimeout(autoHideTimeoutRef.current);
        }
      };
    }
  }, [isCardHovered, floatingPosition]);

  // NOTE: handleDelete/handleCopy removed - YAML step operations deprecated

  const handleRowClick = (e: React.MouseEvent) => {
    if (isSelectingRange) {
      e.stopPropagation();
      onRangeSelectEnd?.(index, e);
    } else if (e.shiftKey && onRangeSelectStart) {
      // Shift+click to start range selection (common UX pattern)
      e.stopPropagation();
      onRangeSelectStart(index);
    } else {
      onSelect();
      // Auto-expand when clicking anywhere on the row
      if (hasNestedSteps && !isExpanded) {
        onToggleExpand();
      }
    }
  };

  return (
    <div>
      <div
        ref={cardRef}
        className={cn(
          "flex items-center gap-0.5 py-0 pr-2 hover:bg-gray-100 text-sm group w-full overflow-hidden cursor-grab active:cursor-grabbing",
          isSelected && "bg-gray-200",
          isExecuting && "bg-blue-50",
          isCompleted && !isSelected && "text-gray-500",
          isFailed && "text-red-600",
          // Range selection styling
          isInRange && !isSelected && "bg-blue-100",
          isSelectingRange && "cursor-pointer",
          // Diff styling
          changeType === "added" && "bg-green-50 border-l-2 border-green-500",
          changeType === "removed" && "bg-red-50 border-l-2 border-red-500 line-through opacity-60",
          changeType === "modified" && "bg-yellow-50 border-l-2 border-yellow-500",
          changeType === "reordered" && "bg-blue-50 border-l-2 border-blue-500"
        )}
        style={{ paddingLeft: `${depth * 4 + 12}px` }}
        onClick={handleRowClick}
        onMouseEnter={() => onRangeHover?.(index)}
        title={`${displayName || toolName || ""} (Shift+click to select range start)`}
      >
        {isExecuting ? (
          <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin text-black" />
        ) : isFailed ? (
          <XCircle className="w-3 h-3 flex-shrink-0 text-red-500" />
        ) : isCompleted ? (
          <CheckCircle className="w-3 h-3 flex-shrink-0 text-black" />
        ) : (
          <Circle className="w-3 h-3 flex-shrink-0 text-gray-300" />
        )}

        <span className="text-xs text-gray-500 font-mono w-4 flex-shrink-0 text-right">{index + 1}</span>

        {hasNestedSteps && (
          <button
            onClick={e => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="p-0 hover:bg-gray-200 rounded flex-shrink-0"
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}

        <span className="truncate w-0 flex-1 ml-1">
          {changeType && <span className="font-mono text-xs mr-1 text-gray-600">{getChangeIndicator(changeType)}</span>}
          {stepName && <span className="text-black">{stepName}</span>}
          {stepName && stepId && <span className="text-gray-400 ml-1">{stepId}</span>}
          {!stepName && stepId && <span className="text-black">{stepId}</span>}
        </span>

        {/* Play button - always visible, highlights on hover */}
        {onExecuteStep && !isExecuting && !isSelectingRange && (
          <Button
            size="sm"
            onClick={e => {
              e.stopPropagation();
              // Shift+click starts range selection instead of running
              if (e.shiftKey && onRangeSelectStart) {
                onRangeSelectStart(index);
                return;
              }
              onSelect(); // Auto-select step when running
              onExecuteStep();
            }}
            disabled={!isMcpAvailable || isPreparingWorkflow}
            className="px-0.5 py-0.5 h-4 w-6 text-xs relative flex-shrink-0 [.theme-classic_&]:bg-transparent [.theme-inverted_&]:bg-transparent [.theme-classic_&]:hover:bg-transparent [.theme-inverted_&]:hover:bg-transparent border [.theme-classic_&]:border-gray-400 [.theme-inverted_&]:border-gray-400 [.theme-classic_&]:hover:border-black [.theme-inverted_&]:hover:border-black group/play"
            title={
              isPreparingWorkflow
                ? "Installing dependencies..."
                : isNextToExecute
                  ? "Run this step (Tab)"
                  : "Run this step"
            }
            onMouseEnter={e => {
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setIsCardHovered(true);
              // Position above the button, not covering it
              setFloatingPosition({ top: rect.top - 28, left: rect.right - 100, width: rect.width });
            }}
            onMouseLeave={e => {
              const relatedTarget = e.relatedTarget;
              if (
                relatedTarget &&
                typeof (relatedTarget as HTMLElement).closest === "function" &&
                (relatedTarget as HTMLElement).closest("[data-step-actions-floating]")
              )
                return;
              hoverTimeoutRef.current = setTimeout(() => {
                setIsCardHovered(false);
                setFloatingPosition(null);
              }, 150);
            }}
          >
            <Play
              className="w-2 h-2 [.theme-classic_&]:stroke-gray-400 [.theme-inverted_&]:stroke-gray-400 [.theme-classic_.group\/play:hover_&]:stroke-black [.theme-inverted_.group\/play:hover_&]:stroke-black fill-none"
              strokeWidth={1.5}
            />
            {isNextToExecute && shortcutsEnabled && (
              <span className="absolute -top-1.5 -right-1.5 bg-white text-black px-0.5 py-0 rounded border border-black text-[7px] leading-none font-medium">
                Tab
              </span>
            )}
          </Button>
        )}

        {/* Stop button when this step is executing */}
        {isExecuting && onInterruptStep && (
          <Button
            size="sm"
            variant="destructive"
            onClick={e => {
              e.stopPropagation();
              onInterruptStep();
            }}
            className="px-0.5 py-0.5 h-4 w-6 text-xs relative flex-shrink-0"
            title="Stop execution (Space)"
          >
            <StopCircle className="w-2 h-2" />
            {shortcutsEnabled && (
              <span className="absolute -top-1.5 -right-1.5 bg-white text-black px-0.5 py-0 rounded border border-black text-[7px] leading-none font-medium">
                Space
              </span>
            )}
          </Button>
        )}
      </div>

      {/* Floating action panel via portal - shows Copy, Delete, Run range */}
      {isCardHovered &&
        floatingPosition &&
        !isExecuting &&
        !isSelectingRange &&
        createPortal(
          <div
            data-step-actions-floating
            className="fixed z-[9999] bg-white border border-gray-300 rounded shadow-lg flex items-center gap-0.5 p-1"
            style={{
              top: floatingPosition.top,
              left: floatingPosition.left,
            }}
            onMouseEnter={() => {
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
              }
              setIsCardHovered(true);
            }}
            onMouseLeave={() => {
              setIsCardHovered(false);
              setFloatingPosition(null);
            }}
          >
            {/* NOTE: Copy button removed - YAML step operations deprecated */}

            {/* NOTE: Delete button removed - YAML step operations deprecated */}
          </div>,
          document.body
        )}

      {hasNestedSteps && isExpanded && children}
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  className?: string;
  hasChanges?: boolean;
}

function CollapsibleSection({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  count,
  action,
  className,
  hasChanges,
}: CollapsibleSectionProps) {
  return (
    <div className={cn("border-b border-gray-200", className)}>
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 px-3 py-0 hover:bg-gray-50 text-sm font-medium"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          {icon}
          <span className="text-left">{title}</span>
          {hasChanges && <span className="w-2 h-2 rounded-full bg-yellow-400 ml-1 flex-shrink-0" title="AI edited" />}
          {count !== undefined && <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{count}</span>}
        </button>
        {action && <div className="pr-2">{action}</div>}
      </div>
      {isExpanded && children}
    </div>
  );
}

// CloudActionsButton moved to ./CloudActionsButton.tsx

function getNestedSteps(step: SequenceStep): SequenceStep[] | undefined {
  const args = (step as CommandStep).arguments;
  if (!args) return undefined;

  // Check for execute_sequence with inline steps
  if (args.steps && Array.isArray(args.steps)) {
    return args.steps as SequenceStep[];
  }

  return undefined;
}

export function WorkflowSidebar({
  workflow,
  troubleshootingSteps = [],
  hasOutput = false,
  selection,
  onSelectionChange,
  currentStep = -1,
  workflowState = "idle",
  workflowExecutionLogs,
  className,
  // Execution props
  isExecuting = false,
  isPreparingWorkflow = false,
  isMcpAvailable = false,
  shortcutsEnabled = false,
  stepResult,
  isFullWorkflowMode = false,
  executingRange = null,
  onExecuteFullWorkflow,
  onExecuteStep,
  onExecuteStepRange,
  onJumpToStep,
  onInterruptStep,
  // NOTE: onDeleteStep/onDuplicateStep removed from destructuring
  onSetRuntimeExecutionOptions,
  // Step pool props
  poolSteps = [],
  executingPoolStepId,
  onExecutePoolStep,
  onDeletePoolStep,
  onClearPool,
  // Schedule props
  onScheduleChanged,
  // Clone props
  onCloneWorkflow,
  // Undo/Redo props
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  // Visibility props
  onSetWorkflowVisibility,
  // TypeScript workflow file diff props
  affectedStepIds,
  onDismissFileDiff,
  // Diff accept/reject props
  diffHighlight,
  onAcceptAllDiffs,
  onRejectAllDiffs,
  // Drag-and-drop props
  onAddPoolStepToWorkflow,
  onAddWorkflowStepToPool,
  onReorderWorkflowStep,
  dragOperationLoading,
  // Recording props
  onStartRecording,
  // File loading
  loadFileContent,
  // File operations - refresh callback after file operations complete
  onRefreshFiles,
  // Cloud sync props
  onSyncToCloud,
  isSyncing = false,
  needsPull = false,
  // Workflow execution state (for State view)
  workflowExecutionState,
  // Real-time step status from MCP notifications
  liveStepStatus = {},
  // Onboarding hint for Run All button
  showRunAllHint = false,
  // Version history props
  onVersionRestored,
  versionHistoryOpen = false,
  onVersionHistoryOpenChange,
}: WorkflowSidebarProps) {
  // Load expanded sections from localStorage, default to ["steps"]
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("sidebar-expanded-sections");
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch {
      // Ignore parse errors
    }
    return new Set(["steps"]);
  });

  // Persist expanded sections to localStorage
  useEffect(() => {
    localStorage.setItem("sidebar-expanded-sections", JSON.stringify([...expandedSections]));
  }, [expandedSections]);

  // Auto-expand step pool section when AI executes tools
  useEffect(() => {
    const handleStepPoolUpdated = (event: CustomEvent) => {
      if (event.detail?.source === "ai-execution") {
        setExpandedSections(prev => {
          if (prev.has("stepPool")) return prev;
          const next = new Set(prev);
          next.add("stepPool");
          return next;
        });
      }
    };

    window.addEventListener("step-pool-updated", handleStepPoolUpdated as EventListener);
    return () => {
      window.removeEventListener("step-pool-updated", handleStepPoolUpdated as EventListener);
    };
  }, []);

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Auto-expand path to selected step when selection changes
  useEffect(() => {
    if (selection?.type === "ts-step" && selection.file) {
      // Expand "files" section
      setExpandedSections(prev => new Set([...prev, "files"]));

      // Expand all parent folders + the file itself
      const pathParts = selection.file.split("/");
      const nodesToExpand: string[] = [];
      for (let i = 0; i < pathParts.length; i++) {
        nodesToExpand.push(`tree-${pathParts.slice(0, i + 1).join("/")}`);
      }
      setExpandedSteps(prev => new Set([...prev, ...nodesToExpand]));
    } else if (selection?.type === "step") {
      // Ensure "steps" section is expanded for YAML workflows
      setExpandedSections(prev => new Set([...prev, "steps"]));
    }
  }, [selection]);

  // Auto-expand terminator.ts, state.json, and recordings when workflow loads
  useEffect(() => {
    if (workflow?.id) {
      console.log("[Sidebar] Auto-expanding terminator.ts, state.json, recordings for workflow:", workflow.id);
      setExpandedSteps(
        // Support both old "Recordings" and new "recordings" folder names
        prev =>
          new Set([
            ...prev,
            "tree-src",
            "tree-src/terminator.ts",
            "tree-state.json",
            "tree-recordings",
            "tree-Recordings",
          ])
      );
      setExpandedSections(prev => new Set([...prev, "files"]));
    }
  }, [workflow?.id]);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDropId, setActiveDropId] = useState<string | null>(null);

  // Configure sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before starting drag
      },
    })
  );
  const [isClearingPool, setIsClearingPool] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [existingSchedule, setExistingSchedule] = useState<ScheduledWorkflow | null>(null);

  // Version history hook
  const {
    versions,
    isLoading: isLoadingVersions,
    isSaving: isSavingVersion,
    isRestoring: isRestoringVersion,
    saveVersion,
    restoreVersion,
    deleteVersion,
  } = useWorkflowVersions({
    workflowId: workflow.id ? String(workflow.id) : null,
    workflowPath: workflow.localPath || null,
    onVersionRestored,
  });

  // Load existing schedule on mount and when workflow changes
  const loadExistingSchedule = useCallback(async () => {
    if (!workflow.id) return;

    try {
      const schedules = await invoke<ScheduledWorkflow[]>("get_scheduled_workflows");
      const existing = schedules.find(s => s.workflow_id === String(workflow.id));
      setExistingSchedule(existing || null);
    } catch (err) {
      console.error("Failed to load existing schedule:", err);
      setExistingSchedule(null);
    }
  }, [workflow.id]);

  // Load schedule on mount
  useEffect(() => {
    loadExistingSchedule();
  }, [loadExistingSchedule]);

  // Open scheduler dialog (reload schedule first to get latest)
  const openSchedulerDialog = useCallback(async () => {
    await loadExistingSchedule();
    setSchedulerOpen(true);
  }, [loadExistingSchedule]);

  // Range selection state for executing multiple steps
  const [rangeSelection, setRangeSelection] = useState<RangeSelection | null>(null);
  const [isSelectingRange, setIsSelectingRange] = useState(false);
  const [rangeStartIndex, setRangeStartIndex] = useState<number | null>(null);
  const [hoveredStepIndex, setHoveredStepIndex] = useState<number | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const stepsContainerRef = React.useRef<HTMLDivElement>(null);
  const rangePopoverHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle Escape key to cancel range selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSelectingRange || rangeSelection) {
          setIsSelectingRange(false);
          setRangeStartIndex(null);
          setHoveredStepIndex(null);
          setRangeSelection(null);
          setPopoverPosition(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSelectingRange, rangeSelection]);

  // Clear range selection when workflow execution starts
  useEffect(() => {
    if (isExecuting) {
      setRangeSelection(null);
      setPopoverPosition(null);
    }
  }, [isExecuting]);

  const steps = workflow.content?.steps || [];
  const variables = workflow.content?.variables || {};
  const selectors = workflow.content?.selectors || {};
  const hasSteps = steps.length > 0;

  // TypeScript workflow detection - string ID means local TypeScript workflow
  const isTypescriptWorkflow = typeof workflow.id === "string";
  const workflowFiles = workflow.files || [];

  // Drag-and-drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setActiveDropId(event.over?.id?.toString() || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setActiveDropId(null);

    if (!over) return;

    const dragData = active.data.current as { type: "workflow" | "pool"; index: number } | undefined;
    if (!dragData) return;

    const dropId = over.id as string;

    // Parse drop zone ID: format is "workflow-drop-{index}" or "pool-drop-{index}"
    const workflowDropMatch = dropId.match(/^workflow-drop-(\d+)$/);
    const poolDropMatch = dropId.match(/^pool-drop-(\d+)$/);

    if (dragData.type === "pool" && workflowDropMatch && onAddPoolStepToWorkflow) {
      // Dragging from pool to workflow
      const poolStepId = active.id as string;
      const insertAtIndex = parseInt(workflowDropMatch[1], 10);
      console.log("[DND] Pool step to workflow:", poolStepId, "at index:", insertAtIndex);
      await onAddPoolStepToWorkflow(poolStepId, insertAtIndex);
    } else if (dragData.type === "workflow" && workflowDropMatch && onReorderWorkflowStep) {
      // Reordering within workflow
      const fromIndex = dragData.index;
      const toIndex = parseInt(workflowDropMatch[1], 10);
      // Skip if dropping at the same position or immediately after (no actual move)
      if (fromIndex !== toIndex && fromIndex + 1 !== toIndex) {
        console.log("[DND] Reorder workflow step from:", fromIndex, "to:", toIndex);
        await onReorderWorkflowStep(fromIndex, toIndex);
      }
    } else if (dragData.type === "workflow" && poolDropMatch && onAddWorkflowStepToPool) {
      // Dragging from workflow to pool
      const stepIndex = dragData.index;
      const step = steps[stepIndex] as CommandStep;
      const insertAtOrder = parseInt(poolDropMatch[1], 10);
      console.log("[DND] Workflow step to pool:", step, "at order:", insertAtOrder);
      await onAddWorkflowStepToPool(step, stepIndex, insertAtOrder);
    }
  };

  // Handle step execution
  const handleExecuteStep = (stepIndex: number) => {
    if (!isMcpAvailable || !onExecuteStep) return;

    const step = steps[stepIndex];
    const commandStep = step as CommandStep;

    // Track the step execution
    trackRunWorkflowButton(
      String(workflow.id || "unknown"),
      workflow.name || "Unnamed Workflow",
      "button",
      "single_step",
      stepIndex,
      String(commandStep?.id || stepIndex)
    );

    trackWorkflowStepExecuted(
      String(workflow.id || "unknown"),
      String(commandStep?.id || stepIndex),
      commandStep?.tool_name || "unknown",
      stepIndex
    );

    // Set runtime execution options based on Settings
    const savedSkipPreflight = localStorage.getItem("mediar-skip-preflight-check");
    const skipPreflight = savedSkipPreflight === null ? true : savedSkipPreflight === "true";
    if (skipPreflight) {
      onSetRuntimeExecutionOptions?.({ skip_preflight_check: true });
    } else {
      onSetRuntimeExecutionOptions?.({ skip_preflight_check: undefined });
    }

    // Execute step directly with the step index
    onExecuteStep(stepIndex);
  };

  // Handle stop
  const handleStop = () => {
    if (!onInterruptStep) return;
    trackWorkflowStopped(
      String(workflow.id || "unknown"),
      workflow.name || "Unnamed Workflow",
      currentStep,
      steps.length
    );
    onInterruptStep();
  };

  // NOTE: handleDeleteStep/handleDuplicateStep removed - YAML step operations deprecated

  // Range selection handlers
  const handleRangeSelectStart = (stepIndex: number) => {
    setIsSelectingRange(true);
    setRangeStartIndex(stepIndex);
    setHoveredStepIndex(stepIndex);
    setRangeSelection(null);
  };

  const handleRangeSelectHover = (stepIndex: number) => {
    if (isSelectingRange && rangeStartIndex !== null) {
      setHoveredStepIndex(stepIndex);
    }
  };

  const handleRangeSelectEnd = (stepIndex: number, _event?: React.MouseEvent) => {
    if (!isSelectingRange || rangeStartIndex === null) return;

    const start = Math.min(rangeStartIndex, stepIndex);
    const end = Math.max(rangeStartIndex, stepIndex);

    // If same step, just execute single step instead
    if (start === end) {
      setIsSelectingRange(false);
      setRangeStartIndex(null);
      setHoveredStepIndex(null);
      handleExecuteStep(start);
      return;
    }

    // Clear selection state
    setIsSelectingRange(false);
    setRangeStartIndex(null);
    setHoveredStepIndex(null);

    // Auto-execute the range immediately (simpler UX)
    if (onExecuteStepRange) {
      // Set runtime execution options
      const savedSkipPreflight = localStorage.getItem("mediar-skip-preflight-check");
      const skipPreflight = savedSkipPreflight === null ? true : savedSkipPreflight === "true";
      if (skipPreflight) {
        onSetRuntimeExecutionOptions?.({ skip_preflight_check: true });
      }

      onExecuteStepRange({
        startIndex: start,
        endIndex: end,
        executeJumpsAtEnd: false,
        followFallback: false,
      });
    }
  };

  const handleRangeSelectCancel = () => {
    if (rangePopoverHideTimeoutRef.current) {
      clearTimeout(rangePopoverHideTimeoutRef.current);
      rangePopoverHideTimeoutRef.current = null;
    }
    setIsSelectingRange(false);
    setRangeStartIndex(null);
    setHoveredStepIndex(null);
    setRangeSelection(null);
    setPopoverPosition(null);
  };

  const handleRangePopoverMouseLeave = () => {
    rangePopoverHideTimeoutRef.current = setTimeout(() => {
      handleRangeSelectCancel();
    }, 300);
  };

  const handleRangePopoverMouseEnter = () => {
    if (rangePopoverHideTimeoutRef.current) {
      clearTimeout(rangePopoverHideTimeoutRef.current);
      rangePopoverHideTimeoutRef.current = null;
    }
  };

  const handleExecuteRange = () => {
    if (!rangeSelection || !onExecuteStepRange) return;

    // Set runtime execution options
    const savedSkipPreflight = localStorage.getItem("mediar-skip-preflight-check");
    const skipPreflight = savedSkipPreflight === null ? true : savedSkipPreflight === "true";
    if (skipPreflight) {
      onSetRuntimeExecutionOptions?.({ skip_preflight_check: true });
    }

    onExecuteStepRange({
      startIndex: rangeSelection.startIndex,
      endIndex: rangeSelection.endIndex,
      executeJumpsAtEnd: rangeSelection.executeJumpsAtEnd,
      followFallback: rangeSelection.followFallback,
    });

    setRangeSelection(null);
    setPopoverPosition(null);
  };

  const isStepInRange = (stepIndex: number): boolean => {
    // Check if in finalized range selection
    if (rangeSelection) {
      return stepIndex >= rangeSelection.startIndex && stepIndex <= rangeSelection.endIndex;
    }
    // Check if in active range selection
    if (isSelectingRange && rangeStartIndex !== null && hoveredStepIndex !== null) {
      const start = Math.min(rangeStartIndex, hoveredStepIndex);
      const end = Math.max(rangeStartIndex, hoveredStepIndex);
      return stepIndex >= start && stepIndex <= end;
    }
    return false;
  };

  const hasVariables = Object.keys(variables).length > 0 || Object.keys(selectors).length > 0;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const toggleStepExpand = (stepKey: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepKey)) {
        next.delete(stepKey);
      } else {
        next.add(stepKey);
      }
      return next;
    });
  };

  const isStepSelected = (index: number, parentIndex?: number) => {
    if (!selection) return false;

    // Handle both "step" (YAML) and "ts-step" (TypeScript) selection types
    if (selection.type === "step") {
      if (parentIndex !== undefined) {
        return selection.index === index && selection.parentIndex === parentIndex;
      }
      return selection.index === index && selection.parentIndex === undefined;
    }

    if (selection.type === "ts-step") {
      // For TypeScript workflows, match by index (parentIndex not used)
      return selection.index === index && parentIndex === undefined;
    }

    return false;
  };

  const getStepStatus = (index: number) => {
    // Priority 1: Real-time status from MCP notifications (most accurate during execution)
    const liveStatus = liveStepStatus[index];
    if (liveStatus) {
      switch (liveStatus) {
        case "running":
          return { isExecuting: true, isCompleted: false, isFailed: false };
        case "completed":
          return { isExecuting: false, isCompleted: true, isFailed: false };
        case "failed":
          return { isExecuting: false, isCompleted: true, isFailed: true };
        case "pending":
          // Continue to other checks - pending means not started yet
          break;
      }
    }

    // In full workflow mode, show all steps from currentStep onwards as executing
    if (isFullWorkflowMode && isExecuting && index >= currentStep) {
      return { isExecuting: true, isCompleted: false, isFailed: false };
    }

    // In range execution mode, show only steps within the range as executing
    if (executingRange && isExecuting && index >= executingRange.start && index <= executingRange.end) {
      return { isExecuting: true, isCompleted: false, isFailed: false };
    }

    // Current step - check stepResult for immediate feedback
    if (index === currentStep) {
      if (workflowState === "executing") {
        return { isExecuting: true, isCompleted: false, isFailed: false };
      }
      if (stepResult) {
        const failed = !stepResult.success || !!stepResult.error;
        return { isExecuting: false, isCompleted: true, isFailed: failed };
      }
      // Current step but no result yet - check logs as fallback
      const log = workflowExecutionLogs?.[index];
      if (log) {
        const failed = log.error !== undefined || log.result?.success === false;
        return { isExecuting: false, isCompleted: true, isFailed: failed };
      }
      return { isExecuting: false, isCompleted: false, isFailed: false };
    }

    // Steps before current - check execution logs
    if (index < currentStep) {
      const log = workflowExecutionLogs?.[index];
      if (log) {
        const failed = log.error !== undefined || log.result?.success === false;
        return { isExecuting: false, isCompleted: true, isFailed: failed };
      }
      return { isExecuting: false, isCompleted: false, isFailed: false };
    }

    // Steps after current - check if they have logs (could be from previous run)
    const log = workflowExecutionLogs?.[index];
    if (log) {
      const failed = log.error !== undefined || log.result?.success === false;
      return { isExecuting: false, isCompleted: true, isFailed: failed };
    }

    return { isExecuting: false, isCompleted: false, isFailed: false };
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        className={cn(
          "flex flex-col h-full bg-white border-r overflow-visible select-none [&_*]:select-none",
          className
        )}
      >
        {/* Toolbar buttons moved to App.tsx top bar */}
        <ScrollArea className="flex-1 select-none">
          {/* Files Section Header - TypeScript workflows only */}
          {isTypescriptWorkflow && workflowFiles.length > 0 && (
            <>
              <div className="px-3 py-0.5 bg-gray-50 border-b border-gray-200 flex items-center gap-1.5">
                <FolderClosed className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Files</span>
              </div>
              <div className="pb-0 select-none">
                {/* Recursive file tree rendering */}
                {(() => {
                  // Find section line numbers from workflow.sections
                  const inputSection = workflow.sections?.find(s => s.type === "input");
                  const onErrorSection = workflow.sections?.find(s => s.type === "onError");
                  const onSuccessSection = workflow.sections?.find(s => s.type === "onSuccess");
                  const triggerSection = workflow.sections?.find(s => s.type === "trigger");

                  const renderTreeNode = (node: TypeScriptWorkflowFile, depth: number): React.ReactNode => {
                    const nodeKey = `tree-${node.path}`;
                    const isNodeExpanded = expandedSteps.has(nodeKey);
                    const paddingLeft = 12 + depth * 4;

                    if (node.isDirectory) {
                      // Render folder
                      const hasChildren = node.children && node.children.length > 0;
                      return (
                        <div key={node.path}>
                          <FileContextMenu
                            filePath={node.path}
                            fileName={node.name}
                            isDirectory={true}
                            workflowPath={workflow.localPath}
                            onRefresh={onRefreshFiles}
                          >
                            <div
                              className="flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-sm"
                              style={{ paddingLeft: `${paddingLeft}px` }}
                              onClick={() => toggleStepExpand(nodeKey)}
                            >
                              <button className="w-3 h-3 flex-shrink-0">
                                {isNodeExpanded ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </button>
                              <FolderOpen className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                              <span className="truncate">{node.name}</span>
                            </div>
                          </FileContextMenu>
                          {isNodeExpanded && (
                            <div>
                              {/* Raw Events virtual row under recordings folder - check for JSON files on disk */}
                              {(() => {
                                if (node.name.toLowerCase() !== "recordings") return null;
                                const jsonFileCount = node.children?.filter(f => f.name.endsWith(".json")).length || 0;
                                if (jsonFileCount === 0) return null;
                                return (
                                  <div
                                    className={cn(
                                      "flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-xs text-gray-600",
                                      selection?.type === "raw-events" && "bg-gray-200"
                                    )}
                                    style={{ paddingLeft: `${paddingLeft + 24}px` }}
                                    onClick={() => {
                                      console.log("[Sidebar] Raw Events clicked from recordings folder");
                                      onSelectionChange({ type: "raw-events" });
                                    }}
                                  >
                                    <List className="w-3 h-3 flex-shrink-0 text-gray-400" />
                                    <span>Raw Events</span>
                                    <span className="text-gray-400 ml-auto">{jsonFileCount} files</span>
                                  </div>
                                );
                              })()}
                              {hasChildren && node.children!.map(child => renderTreeNode(child, depth + 1))}
                            </div>
                          )}
                        </div>
                      );
                    }

                    // Render file
                    const isFileSelected = selection?.type === "file" && selection.path === node.path;
                    const normalizedFilePath = node.path.replace(/\\/g, "/");

                    // Check if this file has pending changes in diffHighlight
                    const fileHasChanges = diffHighlight?.files.some(f => {
                      const normalizedDiffPath = f.filePath.replace(/\\/g, "/");
                      return (
                        normalizedFilePath === normalizedDiffPath ||
                        normalizedFilePath.endsWith(normalizedDiffPath) ||
                        normalizedDiffPath.endsWith(normalizedFilePath)
                      );
                    });

                    // Check if this is a .ts file that might have special content
                    const isTypescriptFile = node.name.endsWith(".ts");
                    const isMainFile = node.path === "src/terminator.ts";
                    const isStepFile = normalizedFilePath.includes("/steps/");
                    const isStateFile = node.name === "state.json";

                    // node IS the file - check if content is loaded
                    const hasContent = node.content !== undefined;

                    // Get steps defined in this file (only for .ts files with content)
                    const stepsInFile =
                      isTypescriptFile && hasContent
                        ? steps.filter(step => {
                            const stepSourceFile = (step as CommandStep).sourceFile?.replace(/\\/g, "/");
                            return stepSourceFile === normalizedFilePath;
                          })
                        : [];

                    // Check for input/onError/onSuccess/trigger sections in terminator.ts
                    const hasInput = isMainFile && workflow.inputs && workflow.inputs.length > 0;
                    const hasOnError = isMainFile && workflow.hasOnError;
                    const hasOnSuccess = isMainFile && workflow.hasOnSuccess;
                    const hasTrigger = isMainFile && workflow.trigger;
                    // Always show Schedule section for TypeScript workflows (even without trigger in code)
                    const showScheduleSection = isMainFile;

                    const hasChildren =
                      stepsInFile.length > 0 ||
                      hasInput ||
                      hasOnError ||
                      hasOnSuccess ||
                      showScheduleSection ||
                      isStateFile;
                    const isFileExpanded = expandedSteps.has(nodeKey);

                    return (
                      <div key={node.path}>
                        {/* File item */}
                        <FileContextMenu
                          filePath={node.path}
                          fileName={node.name}
                          isDirectory={false}
                          workflowPath={workflow.localPath}
                          onRefresh={onRefreshFiles}
                        >
                          <div
                            className={cn(
                              "flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-sm",
                              isFileSelected && "bg-gray-200"
                            )}
                            style={{ paddingLeft: `${paddingLeft}px` }}
                            onClick={async () => {
                              // Lazy load file content if not cached
                              if (!hasContent && loadFileContent) {
                                await loadFileContent(node.path);
                              }
                              onSelectionChange({ type: "file", path: node.path });
                              // Auto-expand when clicking anywhere on the row
                              if (hasChildren && !isFileExpanded) {
                                toggleStepExpand(nodeKey);
                              }
                            }}
                          >
                            {hasChildren ? (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  toggleStepExpand(nodeKey);
                                }}
                                className="w-3 h-3 flex-shrink-0"
                              >
                                {isFileExpanded ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </button>
                            ) : (
                              <span className="w-3" />
                            )}
                            <FileCode className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                            <span className="truncate">{node.name}</span>
                            {fileHasChanges && (
                              <span
                                className="w-2 h-2 rounded-full bg-yellow-400 ml-1 flex-shrink-0"
                                title="Has pending changes"
                              />
                            )}
                            {stepsInFile.length > 0 && (
                              <span className="text-xs text-gray-400 ml-auto">{stepsInFile.length}</span>
                            )}
                          </div>
                        </FileContextMenu>

                        {/* Nested items under file (for .ts files) */}
                        {isFileExpanded && hasChildren && (
                          <div>
                            {/* Input section */}
                            {hasInput && (
                              <div
                                className={cn(
                                  "flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-xs text-gray-600",
                                  selection?.type === "ts-input" && selection.file === node.path && "bg-gray-200"
                                )}
                                style={{ paddingLeft: `${paddingLeft + 24}px` }}
                                onClick={() =>
                                  onSelectionChange({
                                    type: "ts-input",
                                    file: node.path,
                                    lineStart: inputSection?.lineStart,
                                    lineEnd: inputSection?.lineEnd,
                                  })
                                }
                              >
                                <ArrowDownToLine className="w-3 h-3 flex-shrink-0 text-gray-400" />
                                <span>Workflow Input</span>
                                <span className="text-gray-400 ml-auto">input</span>
                              </div>
                            )}

                            {/* Steps in this file */}
                            {stepsInFile.map(step => {
                              const actualIndex = steps.indexOf(step);
                              const stepKey = `ts-step-${actualIndex}`;

                              // Use same execution state logic as main renderStepTree
                              const {
                                isExecuting: stepIsExecuting,
                                isCompleted,
                                isFailed,
                              } = getStepStatus(actualIndex);
                              const isCurrent = actualIndex === currentStep;
                              const isNextToExecute = actualIndex === 0 && workflowState === "idle" && !isExecuting;

                              // Check if step is affected by TypeScript file diff (using step ID)
                              const commandStep = step as CommandStep;
                              const isAffectedByFileDiff = affectedStepIds?.includes(commandStep.id);

                              return (
                                <StepTreeItem
                                  key={stepKey}
                                  step={step}
                                  index={actualIndex}
                                  depth={depth + 1}
                                  isSelected={isStepSelected(actualIndex, undefined)}
                                  isExecuting={stepIsExecuting}
                                  isCompleted={isCompleted}
                                  isFailed={isFailed}
                                  isCurrent={isCurrent}
                                  hasNestedSteps={false}
                                  isExpanded={false}
                                  onToggleExpand={() => {}}
                                  onSelect={() =>
                                    onSelectionChange({
                                      type: "ts-step",
                                      file: node.path,
                                      index: actualIndex,
                                      lineStart: (step as CommandStep).lineStart,
                                      lineEnd: (step as CommandStep).lineEnd,
                                    })
                                  }
                                  onExecuteStep={() => handleExecuteStep(actualIndex)}
                                  onInterruptStep={handleStop}
                                  isMcpAvailable={isMcpAvailable}
                                  isPreparingWorkflow={isPreparingWorkflow}
                                  shortcutsEnabled={shortcutsEnabled}
                                  isNextToExecute={isNextToExecute}
                                  changeType={isAffectedByFileDiff ? "modified" : undefined}
                                  isInRange={isStepInRange(actualIndex)}
                                  isSelectingRange={isSelectingRange}
                                  onRangeSelectStart={handleRangeSelectStart}
                                  onRangeSelectEnd={handleRangeSelectEnd}
                                  onRangeHover={handleRangeSelectHover}
                                />
                              );
                            })}

                            {/* trigger/schedule section - shows scheduler in main panel (always visible for TS workflows) */}
                            {showScheduleSection && (
                              <div
                                className={cn(
                                  "flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-xs text-gray-600",
                                  selection?.type === "ts-trigger" && selection.file === node.path && "bg-gray-200"
                                )}
                                style={{ paddingLeft: `${paddingLeft + 24}px` }}
                                onClick={() => {
                                  // Select trigger to show scheduler in main panel
                                  onSelectionChange({
                                    type: "ts-trigger",
                                    file: node.path,
                                    lineStart: triggerSection?.lineStart,
                                    lineEnd: triggerSection?.lineEnd,
                                  });
                                }}
                              >
                                <Calendar className="w-3 h-3 flex-shrink-0 text-gray-400" />
                                <span>Schedule</span>
                                <span className="text-gray-400 ml-auto">
                                  {hasTrigger
                                    ? workflow.trigger?.type === "cron"
                                      ? workflow.trigger.schedule
                                      : workflow.trigger?.type
                                    : "not configured"}
                                </span>
                                {/* Show enabled/disabled indicator */}
                                {existingSchedule && (
                                  <span
                                    className={cn(
                                      "ml-auto w-2 h-2 rounded-full",
                                      existingSchedule.enabled ? "bg-green-500" : "bg-gray-300"
                                    )}
                                    title={existingSchedule.enabled ? "Schedule active" : "Schedule paused"}
                                  />
                                )}
                              </div>
                            )}

                            {/* onError section */}
                            {hasOnError && (
                              <div
                                className={cn(
                                  "flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-xs text-gray-600",
                                  selection?.type === "ts-onError" && selection.file === node.path && "bg-gray-200"
                                )}
                                style={{ paddingLeft: `${paddingLeft + 24}px` }}
                                onClick={() =>
                                  onSelectionChange({
                                    type: "ts-onError",
                                    file: node.path,
                                    lineStart: onErrorSection?.lineStart,
                                    lineEnd: onErrorSection?.lineEnd,
                                  })
                                }
                              >
                                <AlertTriangle className="w-3 h-3 flex-shrink-0 text-gray-400" />
                                <span>Troubleshooting</span>
                                <span className="text-gray-400 ml-auto">onError</span>
                              </div>
                            )}

                            {/* onSuccess section */}
                            {hasOnSuccess && (
                              <div
                                className={cn(
                                  "flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-xs text-gray-600",
                                  selection?.type === "ts-onSuccess" && selection.file === node.path && "bg-gray-200"
                                )}
                                style={{ paddingLeft: `${paddingLeft + 24}px` }}
                                onClick={() =>
                                  onSelectionChange({
                                    type: "ts-onSuccess",
                                    file: node.path,
                                    lineStart: onSuccessSection?.lineStart,
                                    lineEnd: onSuccessSection?.lineEnd,
                                  })
                                }
                              >
                                <ArrowUpFromLine className="w-3 h-3 flex-shrink-0 text-gray-400" />
                                <span>Workflow Output</span>
                                <span className="text-gray-400">onSuccess</span>
                              </div>
                            )}

                            {/* State section under state.json */}
                            {isStateFile && (
                              <div
                                className={cn(
                                  "flex items-center gap-0.5 py-0 px-2 cursor-pointer hover:bg-gray-100 text-xs text-gray-600",
                                  selection?.type === "state" && "bg-gray-200"
                                )}
                                style={{ paddingLeft: `${paddingLeft + 24}px` }}
                                onClick={() => onSelectionChange({ type: "state" })}
                              >
                                <Database className="w-3 h-3 flex-shrink-0 text-gray-400" />
                                <span>State</span>
                                <span className="text-gray-400 ml-auto text-[10px]">env variables</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  };

                  // Sort files: src first, then state.json, then directories, then files (dotfiles first)
                  const sortedFiles = [...workflowFiles].sort((a, b) => {
                    // src folder always first
                    if (a.name === "src") return -1;
                    if (b.name === "src") return 1;

                    // state.json second
                    if (a.name === "state.json") return -1;
                    if (b.name === "state.json") return 1;

                    // Then directories before files
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;

                    // Alphabetically (dotfiles naturally sort first)
                    return a.name.localeCompare(b.name);
                  });
                  return sortedFiles.map(node => renderTreeNode(node, 0));
                })()}
              </div>
            </>
          )}
          {/* Debug Section Header */}
          <div className="px-3 py-0.5 bg-gray-50 border-y border-gray-200 flex items-center gap-1.5">
            <Bug className="w-3 h-3 text-gray-400" />
            <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Debug</span>
          </div>

          {/* Tool History (formerly Buffer) */}
          <CollapsibleSection
            title="Tool History"
            icon={<History className="w-3 h-3 flex-shrink-0 text-gray-400" />}
            isExpanded={expandedSections.has("stepPool")}
            onToggle={() => toggleSection("stepPool")}
            count={poolSteps.length}
            action={
              poolSteps.length > 0 &&
              onClearPool && (
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    if (isClearingPool) return;
                    setIsClearingPool(true);
                    try {
                      await onClearPool();
                    } finally {
                      setIsClearingPool(false);
                    }
                  }}
                  disabled={isClearingPool}
                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                  title="Clear tool history"
                >
                  {isClearingPool ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                </button>
              )
            }
          >
            <div className="pb-0">
              {poolSteps.length > 0 ? (
                <>
                  {/* Initial drop zone for pool */}
                  <DropZone id="pool-drop-0" isOver={activeDropId === "pool-drop-0"} />
                  {poolSteps.map((poolStep, idx) => {
                    const isSelected = selection?.type === "pool" && selection.index === idx;
                    // Adapter: map PoolStep fields to CommandStep-like structure
                    const stepAsCommand = {
                      name: poolStep.step_name,
                      id: poolStep.step_id,
                      tool_name: poolStep.tool_name,
                      arguments: poolStep.arguments,
                    } as CommandStep;

                    // Check for nested steps (e.g., execute_sequence)
                    const nestedSteps = getNestedSteps(stepAsCommand);
                    const hasNested = nestedSteps && nestedSteps.length > 0;
                    const poolStepKey = `pool-${idx}`;

                    const isPoolStepLoading =
                      dragOperationLoading?.type === "pool-to-workflow" && dragOperationLoading.id === poolStep.id;
                    return (
                      <React.Fragment key={poolStep.id}>
                        <DraggableStep id={poolStep.id} type="pool" index={idx} isLoading={isPoolStepLoading}>
                          <StepTreeItem
                            step={stepAsCommand}
                            index={idx}
                            depth={0}
                            isSelected={isSelected}
                            isExecuting={executingPoolStepId === poolStep.id}
                            isCompleted={poolStep.succeeded}
                            isFailed={!poolStep.succeeded}
                            isCurrent={false}
                            hasNestedSteps={hasNested || false}
                            isExpanded={expandedSteps.has(poolStepKey)}
                            onToggleExpand={() => toggleStepExpand(poolStepKey)}
                            onSelect={() => onSelectionChange({ type: "pool", index: idx })}
                            onExecuteStep={onExecutePoolStep ? () => onExecutePoolStep(poolStep) : undefined}
                            onDeleteStep={onDeletePoolStep ? () => onDeletePoolStep(poolStep.id) : undefined}
                            isMcpAvailable={isMcpAvailable}
                            isPreparingWorkflow={isPreparingWorkflow}
                            shortcutsEnabled={false}
                          >
                            {/* Render nested steps for execute_sequence */}
                            {hasNested &&
                              nestedSteps!.map((subStep, subIdx) => {
                                const subStepAsCommand = {
                                  name: (subStep as CommandStep).name,
                                  id: (subStep as CommandStep).id,
                                  tool_name: (subStep as CommandStep).tool_name,
                                  arguments: (subStep as CommandStep).arguments,
                                } as CommandStep;
                                return (
                                  <StepTreeItem
                                    key={`${poolStepKey}-${subIdx}`}
                                    step={subStepAsCommand}
                                    index={subIdx}
                                    depth={1}
                                    isSelected={false}
                                    isExecuting={false}
                                    isCompleted={false}
                                    isFailed={false}
                                    isCurrent={false}
                                    hasNestedSteps={false}
                                    isExpanded={false}
                                    onToggleExpand={() => {}}
                                    onSelect={() => {}}
                                    isMcpAvailable={isMcpAvailable}
                                    shortcutsEnabled={false}
                                  />
                                );
                              })}
                          </StepTreeItem>
                        </DraggableStep>
                        {/* Drop zone after each pool step */}
                        <DropZone id={`pool-drop-${idx + 1}`} isOver={activeDropId === `pool-drop-${idx + 1}`} />
                      </React.Fragment>
                    );
                  })}
                </>
              ) : (
                <>
                  {/* Drop zone even when pool is empty */}
                  <DropZone id="pool-drop-0" isOver={activeDropId === "pool-drop-0"} />
                  <div className="text-xs text-gray-400 px-6 py-0">No executed tools</div>
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* Inspect Section - Single line, aligned with other sections */}
          <div
            className={cn(
              "flex items-center gap-1 py-0 hover:bg-gray-100 text-sm cursor-pointer",
              selection?.type === "inspect" && "bg-gray-200"
            )}
            style={{ paddingLeft: "12px" }}
            onClick={() => onSelectionChange({ type: "inspect" })}
            title="See what the AI sees. Explore the UI tree to debug selectors or understand why a step failed."
          >
            <MousePointer2 className="w-3 h-3 flex-shrink-0 text-gray-400" />
            <span>Inspect</span>
            <span className="text-xs text-gray-400 ml-auto">UI elements</span>
          </div>
        </ScrollArea>
      </div>

      {/* Range Selection Indicator - shows when user is selecting a range */}
      {isSelectingRange && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[9999] bg-black text-white px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2">
          <Play className="w-4 h-4" />
          <span>Click another step to run range (Esc to cancel)</span>
        </div>
      )}

      {/* Scheduler Dialog */}
      <SchedulerDialog
        isOpen={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        workflow={
          workflow.localPath
            ? {
                id: String(workflow.id || ""),
                name: workflow.name || "Unnamed Workflow",
                path: workflow.localPath,
              }
            : null
        }
        existingSchedule={existingSchedule}
        onScheduled={() => {
          setSchedulerOpen(false);
          loadExistingSchedule(); // Reload to update button state
          onScheduleChanged?.();
        }}
      />

      {/* Version History Panel */}
      <VersionHistoryPanel
        isOpen={versionHistoryOpen}
        onClose={() => onVersionHistoryOpenChange?.(false)}
        versions={versions}
        isLoading={isLoadingVersions}
        isSaving={isSavingVersion}
        isRestoring={isRestoringVersion}
        onSaveVersion={saveVersion}
        onRestoreVersion={restoreVersion}
        onDeleteVersion={deleteVersion}
      />
    </DndContext>
  );
}
