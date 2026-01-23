import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";

// Expose invoke for console testing (dev only)
if (import.meta.env.DEV) {
  (window as any).tauriInvoke = invoke;
  console.log("[DEV] window.tauriInvoke available for testing");
}
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { saveWindowState, StateFlags } from "@tauri-apps/plugin-window-state";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Cloud,
  Columns,
  Copy,
  FolderOpen,
  GalleryHorizontal,
  GripVertical,
  Info,
  LayoutGrid,
  List,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  Monitor,
  PanelLeft,
  PanelRight,
  Pencil,
  Play,
  Plus,
  Redo2,
  Send,
  Settings,
  Square,
  StopCircle,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { toast, Toaster } from "sonner";
import { ChatHistoryDropdown } from "@/components/chat/ChatHistoryDropdown";
import { WorkflowTable } from "@/components/features/WorkflowTable";
import { WorkflowMarketplace } from "@/components/marketplace";
import type { WorkflowCardData } from "@/components/marketplace";
import { AutoExpandTextarea } from "@/components/ui/auto-expand-textarea";
import { Button } from "@/components/ui/button";
import { ChatMessage as ChatMessageComponent } from "@/components/ui/chat-message";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DebugContextMenu, useChatDebugItems } from "@/components/ui/debug-context-menu";
import { JsonHighlighter } from "@/components/ui/json-highlighter";
import { LiveExecutionConsole } from "@/components/ui/live-execution-console";
import { LoadingStatusIndicator } from "@/components/ui/loading-status-indicator";
import { WorkflowProgressIndicator } from "@/components/ui/workflow-progress-indicator";
import { McpStatusBanner } from "@/components/ui/mcp-status-banner";
import { NameInputDialog } from "@/components/ui/name-input-dialog";
import { WorkflowInputDialog } from "@/components/ui/workflow-input-dialog";
import { AIGeneratedComponent } from "@/components/ui/ai-generated-component";
import { AIComponentProvider } from "@/contexts/AIComponentContext";
import type { ScheduledWorkflow } from "@/components/ui/scheduler-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SuggestedActions } from "@/components/ui/suggested-actions";
import { getHomepageQuickActions } from "@/lib/workflow-suggestions";
import { RecordingModeDialog, type RecordingMode } from "@/components/ui/recording-mode-dialog";
import { TargetAppDialog, type ApplicationInfo } from "@/components/ui/target-app-dialog";
import { getToolInlineHint } from "@/components/ui/tool-results";
import { UpdateModal, type UpdateInfo } from "@/components/ui/update-modal";
import { ValidationErrorDialog } from "@/components/ui/validation-error-dialog";
import { ProcessingModal } from "@/components/ui/processing-modal";
import {
  WorkflowExecutionErrorDialog,
  parseWorkflowExecutionError,
  type WorkflowExecutionErrorDetails,
} from "@/components/ui/workflow-execution-error-dialog";
import { WrongAppDialog } from "@/components/ui/wrong-app-dialog";
import { CloudActionsButton } from "@/components/workflow/CloudActionsButton";
import { StepDetailsPanel, type DiffHighlight, type FileDiff } from "@/components/workflow/StepDetailsPanel";
import { WorkflowSidebar, type SidebarSelection } from "@/components/workflow/WorkflowSidebar";
import { trackMcpRestartInitiated } from "@/lib/analytics";
import { getAppMode, shouldShowChatUI } from "@/lib/features";
import { formatResultForDisplay } from "@/lib/utils";
import { LoginPrompt } from "./components/auth/LoginPrompt";
import ErrorBoundary, { ChatErrorFallback, WorkflowErrorFallback } from "./components/ErrorBoundary";
import { ElicitationModal, InlineElicitation } from "./components/elicitation";
import { useElicitation } from "./contexts/ElicitationContext";
import {
  useOnboarding,
  WelcomeModal,
  FirstRecordingSuccess,
  OnboardingDemoModal,
  ONBOARDING_WORKFLOW_UUID,
  RECORDING_DEMO_WORKFLOW_UUID,
  SpotlightHint,
} from "./components/onboarding";
import { CrispChat } from "./components/providers/CrispChat";
import { useMcp } from "./contexts/McpContext";
import { useAuth } from "./hooks/useAuth";
import { useEditHistory } from "./hooks/useEditHistory";
import { useStepPool, type PoolStep } from "./hooks/useStepPool";
import { useWebAppChat as useChat } from "./hooks/useWebAppChat"; // Calls web app /api/ai endpoint (native Vertex AI on server)
import { useWorkflow, type TypeScriptWorkflowFile, type Workflow } from "./hooks/useWorkflow";
import { useWorkflowFileWatcher, type ExternalFileDiff } from "./hooks/useWorkflowFileWatcher";
import { useRecordingProgress, formatDuration } from "./hooks/useRecordingProgress";
import { useWorkflowPublish } from "./hooks/useWorkflowPublish";
import { useWorkflowVersions } from "./hooks/useWorkflowVersions";
import {
  trackRecordingStarted,
  trackRecordingStopped,
  trackWorkflowStarted,
  trackWorkflowOpened,
  trackBackButtonClicked,
  trackSettingsOpened,
  trackNewChatStarted,
  trackRunWorkflowButton,
} from "./lib/analytics";
import { clearWorkflowSession } from "./lib/session-storage";
// import { useAiSdkChat as useChat } from './hooks/useAiSdkChat'; // OLD: Direct Vertex AI from frontend
// import { useChat } from './hooks/useChat'; // Old implementation
// import { useMastraChat as useChat } from './hooks/useMastraChat'; // Server-based Mastra
// import { useDirectMastraChat as useChat } from './hooks/useDirectMastraChat'; // Client-side Mastra (doesn't work - Node.js deps)
// NOTE: parseWorkflowYaml removed - YAML workflows deprecated
import type { CommandStep } from "./lib/workflow-schema";
// NOTE: stringifyWorkflow removed - YAML workflows deprecated

// Lazy load heavy components to reduce initial bundle size
const SettingsPage = lazy(() => import("./settings/SettingsPage"));

// Compact tool call display component with expandable details
function ToolCallBlock({
  toolCall,
  contextDisplay,
}: {
  toolCall: any;
  contextDisplay?: string; // e.g., "492,220t (49.2%)" - only shown on last completed tool call
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [showFullModal, setShowFullModal] = useState(false);

  // Memoize onAction to prevent AIGeneratedComponent re-renders on parent re-render
  const handleComponentAction = useCallback((action: string, data: unknown) => {
    console.log("[CHAT] Component action:", action, data);
  }, []);
  const isServer = toolCall.source === "server";
  const status = toolCall.status;

  // Calculate response stats
  let resultStr = "";
  let resultTokens = 0;
  if (toolCall.result) {
    resultStr = typeof toolCall.result === "string" ? toolCall.result : JSON.stringify(toolCall.result, null, 2);
    resultTokens = Math.ceil(resultStr.length / 4); // Rough estimate: ~4 chars per token
  }

  // Calculate args tokens
  let argsTokens = 0;
  if (toolCall.arguments && Object.keys(toolCall.arguments).length > 0) {
    const argsStr = JSON.stringify(toolCall.arguments);
    argsTokens = Math.ceil(argsStr.length / 4);
  }

  const totalTokens = argsTokens + resultTokens;

  // Format number (1.2k, 15k, etc.)
  const formatNum = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  // Status icon
  const StatusIcon = () => {
    switch (status) {
      case "running":
      case "call":
        return <Loader2 className="w-3 h-3 animate-spin text-black" />;
      case "completed":
      case "result":
        return <CheckCircle className="w-3 h-3 text-black" />;
      case "failed":
      case "error":
        return <XCircle className="w-3 h-3 text-red-500" />;
      default:
        return <Circle className="w-3 h-3 text-gray-300" />;
    }
  };

  const isComplete = status === "completed" || status === "result";
  const isFailed = status === "failed" || status === "error" || status === "executed_with_error";
  const isRunning = status === "running" || status === "call";
  const hasDetails = toolCall.arguments || toolCall.result;

  // Special handling for render_component - render the component inline
  if (toolCall.name === "render_component" && toolCall.arguments?.jsx) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden my-2">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-gray-50 border-b border-gray-200">
          <Monitor className="w-3 h-3 text-gray-400" />
          <span className="font-medium text-gray-700">{toolCall.arguments.title || "Component"}</span>
          {isComplete && <CheckCircle className="w-3 h-3 text-black" />}
          {isRunning && <Loader2 className="w-3 h-3 animate-spin text-black" />}
        </div>
        {/* Rendered component */}
        <div className="p-3 bg-white">
          <AIGeneratedComponent jsx={toolCall.arguments.jsx} onAction={handleComponentAction} />
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Compact header row */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 text-xs bg-gray-50/50 ${hasDetails ? "cursor-pointer hover:bg-gray-100/50" : ""}`}
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
      >
        {/* Expand chevron */}
        {hasDetails ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
          )
        ) : (
          <div className="w-3 h-3 flex-shrink-0" />
        )}

        {/* Source icon */}
        {isServer ? (
          <Cloud className="w-3 h-3 text-gray-400 flex-shrink-0" />
        ) : (
          <Monitor className="w-3 h-3 text-gray-400 flex-shrink-0" />
        )}

        {/* Tool name */}
        <span className="font-medium text-gray-700 truncate">{toolCall.name}</span>

        {/* Inline hint */}
        {(() => {
          const hint = getToolInlineHint(toolCall.name, toolCall.arguments, toolCall.result);
          return hint ? (
            <span className="text-gray-500 truncate max-w-[180px]" title={hint}>
              {hint}
            </span>
          ) : null;
        })()}

        {/* Status icon */}
        <StatusIcon />

        {/* Stats (only when complete) */}
        {isComplete && (
          <span className="text-gray-400 flex-shrink-0">
            {toolCall.elapsedMs && `${toolCall.elapsedMs}ms`}
            {toolCall.elapsedMs && totalTokens > 0 && " · "}
            {totalTokens > 0 && `~${formatNum(totalTokens)}t`}
          </span>
        )}

        {/* Running indicator */}
        {isRunning && <span className="text-gray-400">running...</span>}

        {/* Error message (truncated) */}
        {isFailed && toolCall.error && <span className="text-red-500 truncate flex-1">{toolCall.error}</span>}

        {/* Context display (only on last completed tool, not if failed) */}
        {contextDisplay && isComplete && !isFailed && (
          <span className="text-gray-400 flex-shrink-0 ml-auto">{contextDisplay}</span>
        )}

        {/* Expand to modal button */}
        {hasDetails && (
          <button
            className="ml-auto p-0.5 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 flex-shrink-0"
            onClick={e => {
              e.stopPropagation();
              setShowFullModal(true);
            }}
            title="Open in modal"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Expanded details */}
      {isExpanded && hasDetails && (
        <div className="px-3 py-2 bg-white border-t border-gray-100 text-xs space-y-2 overflow-x-auto">
          {/* Arguments */}
          {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
            <div>
              <div className="font-medium text-gray-600 mb-1">Arguments:</div>
              {/* Special handling for run_command to show JS code with proper formatting */}
              {toolCall.name.endsWith("run_command") && toolCall.arguments?.run ? (
                <div className="space-y-2">
                  {toolCall.arguments.engine && (
                    <div className="text-xs text-gray-500">
                      engine: <code className="bg-gray-100 px-1 rounded">{toolCall.arguments.engine}</code>
                    </div>
                  )}
                  <JsonHighlighter
                    content={
                      typeof toolCall.arguments.run === "string"
                        ? toolCall.arguments.run.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"')
                        : String(toolCall.arguments.run)
                    }
                    language="javascript"
                    theme="light"
                    maxHeight="24rem"
                  />
                  {/* Show other args if present */}
                  {Object.keys(toolCall.arguments).filter(k => k !== "run" && k !== "engine").length > 0 && (
                    <JsonHighlighter
                      content={JSON.stringify(
                        Object.fromEntries(
                          Object.entries(toolCall.arguments).filter(([k]) => k !== "run" && k !== "engine")
                        ),
                        null,
                        2
                      )}
                      maxHeight="10rem"
                    />
                  )}
                </div>
              ) : (
                <JsonHighlighter content={JSON.stringify(toolCall.arguments, null, 2)} maxHeight="10rem" />
              )}
            </div>
          )}

          {/* Result */}
          {toolCall.result &&
            (() => {
              const { json, content, uiTree, browserDom, ocrTree, omniparserTree, uiDiff, images } =
                formatResultForDisplay(toolCall.result);
              return (
                <div>
                  <div className="font-medium text-gray-600 mb-1">Result:</div>
                  {content ? (
                    <div>
                      <div className="text-[10px] text-gray-500 mb-1">content:</div>
                      <JsonHighlighter content={content} language="text" />
                    </div>
                  ) : (
                    json && <JsonHighlighter content={json} />
                  )}
                  {uiTree && (
                    <div className="mt-2">
                      <div className="text-[10px] text-gray-500 mb-1">ui_tree:</div>
                      <JsonHighlighter content={uiTree} language="uitree" />
                    </div>
                  )}
                  {browserDom && (
                    <div className="mt-2">
                      <div className="text-[10px] text-gray-500 mb-1">browser_dom:</div>
                      <JsonHighlighter content={browserDom} language="markup" />
                    </div>
                  )}
                  {ocrTree && (
                    <div className="mt-2">
                      <div className="text-[10px] text-gray-500 mb-1">ocr_tree:</div>
                      <JsonHighlighter content={ocrTree} language="text" />
                    </div>
                  )}
                  {omniparserTree && (
                    <div className="mt-2">
                      <div className="text-[10px] text-gray-500 mb-1">omniparser_tree:</div>
                      <JsonHighlighter content={omniparserTree} language="text" />
                    </div>
                  )}
                  {uiDiff && (
                    <div className="mt-2">
                      <div className="text-[10px] text-gray-500 mb-1">ui_diff:</div>
                      <JsonHighlighter content={uiDiff} language="diff" />
                    </div>
                  )}
                  {images && images.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] text-gray-500 mb-1">screenshots ({images.length}):</div>
                      <div className="flex flex-wrap gap-2">
                        {images.map((img, idx) => {
                          const imgSrc = img.data.startsWith("data:")
                            ? img.data
                            : `data:${img.mimeType};base64,${img.data}`;
                          return (
                            <img
                              key={idx}
                              src={imgSrc}
                              alt={`Screenshot ${idx + 1}`}
                              className="max-w-[300px] max-h-[200px] rounded border border-gray-200 object-contain cursor-pointer hover:opacity-80 transition-opacity pointer-events-auto select-none"
                              onMouseDown={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                console.log(
                                  "[DEBUG] Screenshot mousedown, setting expandedImage:",
                                  imgSrc.substring(0, 50)
                                );
                                setExpandedImage(imgSrc);
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          {/* Full error */}
          {isFailed && toolCall.error && (
            <div>
              <div className="font-medium text-red-600 mb-1">Error:</div>
              <pre className="p-2 bg-red-50 rounded border border-red-200 overflow-x-auto text-[10px] leading-tight text-red-700">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Expanded image modal - using portal to escape overflow:hidden containers */}
      {expandedImage &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
            onClick={() => setExpandedImage(null)}
          >
            <div className="relative max-w-[90vw] max-h-[90vh]">
              <img
                src={expandedImage}
                alt="Expanded screenshot"
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
              <button
                className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white hover:bg-black/70"
                onClick={() => setExpandedImage(null)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Full tool details modal */}
      {showFullModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
            onClick={() => setShowFullModal(false)}
          >
            <div
              className="relative bg-white rounded-lg shadow-xl w-[90vw] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50">
                {isServer ? <Cloud className="w-4 h-4 text-gray-500" /> : <Monitor className="w-4 h-4 text-gray-500" />}
                <span className="font-medium text-gray-800">{toolCall.name}</span>
                <StatusIcon />
                {isComplete && totalTokens > 0 && (
                  <span className="text-xs text-gray-400 ml-2">~{formatNum(totalTokens)}t</span>
                )}
                <button
                  className="ml-auto p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-700"
                  onClick={() => setShowFullModal(false)}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal content */}
              <div className="flex-1 overflow-auto p-4 space-y-4 text-sm">
                {/* Arguments */}
                {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
                  <div>
                    <div className="font-medium text-gray-700 mb-2">Arguments</div>
                    {toolCall.name.endsWith("run_command") && toolCall.arguments?.run ? (
                      <div className="space-y-2">
                        {toolCall.arguments.engine && (
                          <div className="text-xs text-gray-500">
                            engine: <code className="bg-gray-100 px-1 rounded">{toolCall.arguments.engine}</code>
                          </div>
                        )}
                        <JsonHighlighter
                          content={
                            typeof toolCall.arguments.run === "string"
                              ? toolCall.arguments.run.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"')
                              : String(toolCall.arguments.run)
                          }
                          language="javascript"
                          theme="light"
                          maxHeight="30rem"
                        />
                      </div>
                    ) : (
                      <JsonHighlighter content={JSON.stringify(toolCall.arguments, null, 2)} maxHeight="30rem" />
                    )}
                  </div>
                )}

                {/* Result */}
                {toolCall.result && (
                  <div>
                    <div className="font-medium text-gray-700 mb-2">Result</div>
                    <JsonHighlighter
                      content={
                        typeof toolCall.result === "string" ? toolCall.result : JSON.stringify(toolCall.result, null, 2)
                      }
                      maxHeight="30rem"
                    />
                  </div>
                )}

                {/* Error */}
                {isFailed && toolCall.error && (
                  <div>
                    <div className="font-medium text-red-600 mb-2">Error</div>
                    <pre className="p-3 bg-red-50 rounded border border-red-200 overflow-x-auto text-xs text-red-700 whitespace-pre-wrap">
                      {toolCall.error}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default function App() {
  // Initialize theme and font scale from localStorage on app startup
  useEffect(() => {
    // Initialize theme (preserves other classes like 'solid-background')
    const savedTheme = localStorage.getItem("theme") || "classic";
    document.documentElement.classList.remove("theme-classic", "theme-inverted");
    document.documentElement.classList.add(savedTheme === "classic" ? "theme-classic" : "theme-inverted");

    // Initialize font scale
    const savedScale = localStorage.getItem("fontScale");
    if (savedScale) {
      const scale = parseFloat(savedScale);
      document.documentElement.style.setProperty("--font-scale", scale.toString());
    }
  }, []);

  // Periodically save window state (position, size) to persist across restarts
  useEffect(() => {
    const saveInterval = setInterval(() => {
      saveWindowState(StateFlags.ALL).catch(() => {
        // Silently ignore errors - window state saving is best-effort
      });
    }, 30000); // Save every 30 seconds

    return () => clearInterval(saveInterval);
  }, []);

  // Authentication state
  const { authStatus, isLoading: authLoading, isPolling: authPolling, error: authError, login, logout } = useAuth();

  // Onboarding state
  const {
    showSuccessModal,
    showOnboardingBooking,
    showOnboardingButton,
    tutorialStep,
    completeFirstRecording,
    completeFirstRun,
    completeCalBooking,
    startTutorial,
    advanceTutorial,
    goBackTutorial,
    closeSuccessModal,
    openOnboardingBooking,
    closeOnboardingBooking,
    declineOnboarding,
    resetOnboarding,
  } = useOnboarding();

  // Elicitation state (for inline ask_user rendering)
  const { state: elicitationState, respond: elicitationRespond, close: closeElicitation } = useElicitation();

  // CLOUD PROCESSING DISABLED - local processing only
  // const {
  //   progress: recordingProgress,
  //   synthesisProgress,
  //   error: recordingProgressError,
  //   isPolling: isPollingProgress,
  //   isSynthesizing,
  //   startPolling: startProgressPolling,
  //   stopPolling: stopProgressPolling,
  //   stopAndSynthesize,
  //   isProcessingComplete,
  // } = useRecordingProgress();

  // Stub values for disabled cloud processing
  const recordingProgress = null;
  const synthesisProgress = null;
  const recordingProgressError = null;
  const isPollingProgress = false;
  const isSynthesizing = false;
  const startProgressPolling = () => {};
  const stopProgressPolling = () => {};
  const stopAndSynthesize = async (_userId: string) => {};
  const isProcessingComplete = true;

  // Local Gemini processing progress tracking
  const [localProcessingProgress, setLocalProcessingProgress] = useState<{
    stage: string;
    current: number;
    total: number;
    message: string;
    stageIndex: number;
    totalStages: number;
    stageTotals: number[];
  } | null>(null);
  const [isLocalProcessing, setIsLocalProcessing] = useState(false);
  const [isProcessingModalDismissed, setIsProcessingModalDismissed] = useState(false);
  const processingSessionActiveRef = useRef(false);

  // Listen for local processing progress events
  useEffect(() => {
    const setupLocalProcessingListener = async () => {
      const unlisten = await listen<{
        stage: string;
        current: number;
        total: number;
        message: string;
        stageIndex: number;
        totalStages: number;
        stageTotals: number[];
      }>("local-processing-progress", event => {
        setLocalProcessingProgress(event.payload);
        // Reset modal dismissed state when processing starts (first event of session)
        if (!processingSessionActiveRef.current) {
          processingSessionActiveRef.current = true;
          setIsProcessingModalDismissed(false);
        }
        setIsLocalProcessing(true);
        // Auto-clear after completion (generation stage 2/2)
        if (event.payload.stage === "generation" && event.payload.current === event.payload.total) {
          setTimeout(() => {
            setIsLocalProcessing(false);
            setLocalProcessingProgress(null);
            setIsProcessingModalDismissed(false);
            processingSessionActiveRef.current = false;
          }, 2000);
        }
      });
      return unlisten;
    };

    const unlistenPromise = setupLocalProcessingListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // Listen for local-processing-started to show modal immediately (don't wait for progress events)
  useEffect(() => {
    console.log("[LOCAL_PROCESSING] Setting up local-processing-started listener...");
    const setupListener = async () => {
      const unlisten = await listen<{ workflowFolder: string }>("local-processing-started", event => {
        console.log("[LOCAL_PROCESSING] Received local-processing-started event, showing modal", event);
        // Reset modal state and show immediately
        if (!processingSessionActiveRef.current) {
          processingSessionActiveRef.current = true;
          setIsProcessingModalDismissed(false);
        }
        setIsLocalProcessing(true);
      });
      console.log("[LOCAL_PROCESSING] local-processing-started listener registered");
      return unlisten;
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  const [overlayVisible, setOverlayVisible] = useState(true);
  const [_appMode, setAppMode] = useState<"tray-only" | "full-ui" | "service">("full-ui");
  const [showChatUI, setShowChatUI] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");
  const [showFeedbackNotification, setShowFeedbackNotification] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    workflowId: string | null;
    workflowName: string;
  }>({ isOpen: false, workflowId: null, workflowName: "" });
  const [isDeletingWorkflow, setIsDeletingWorkflow] = useState(false); // Track deletion loading state

  // Autoclone dialog state - for cloning read-only public workflows when AI tries to edit
  const [autocloneDialog, setAutocloneDialog] = useState<{
    isOpen: boolean;
    workflowId: string | null;
    workflowName: string;
    resolve: ((confirmed: boolean) => void) | null;
  }>({ isOpen: false, workflowId: null, workflowName: "", resolve: null });
  const [isAutocloning, setIsAutocloning] = useState(false);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false); // Track workflow creation loading state
  const [isNavigatingBack, setIsNavigatingBack] = useState(false); // Track back navigation loading state
  const [showNameInputDialog, setShowNameInputDialog] = useState(false); // Track name input dialog state
  // Workflow input dialog state - for collecting inputs before execution
  const [workflowInputDialog, setWorkflowInputDialog] = useState<{
    isOpen: boolean;
    onConfirm: ((inputs: Record<string, unknown>) => void) | null;
  }>({ isOpen: false, onConfirm: null });
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [editedWorkflowName, setEditedWorkflowName] = useState<string>("");
  const [downloadingWorkflowId, setDownloadingWorkflowId] = useState<string | null>(null); // Track cloud-only workflow download
  const [pullingWorkflowId, setPullingWorkflowId] = useState<string | null>(null); // Track workflow update pull
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null); // Track workflow deletion
  const [useCardView, setUseCardView] = useState(() => {
    try {
      // Default to list view (false) for onboarding - step 1 highlights "Cards" button
      return localStorage.getItem("workflow_view_mode") === "card";
    } catch {
      return false;
    }
  }); // Toggle between card and list view

  const [hasViewPreference, setHasViewPreference] = useState(() => {
    try {
      return localStorage.getItem("workflow_view_mode") !== null;
    } catch {
      return false;
    }
  }); // Track if user has explicitly chosen a view mode

  // Community workflows toggle state
  const [showCommunityWorkflows, setShowCommunityWorkflows] = useState(false);
  const [communityWorkflows, setCommunityWorkflows] = useState<WorkflowCardData[]>([]);
  const [isLoadingCommunityWorkflows, setIsLoadingCommunityWorkflows] = useState(false);

  // Update modal state
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(0);
  const [isUpdateReadyToInstall, setIsUpdateReadyToInstall] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isWindowsArranged, setIsWindowsArranged] = useState(false);

  // Validation error dialog state
  const [validationError, setValidationError] = useState<
    import("@/components/ui/validation-error-dialog").ValidationErrorDetails | null
  >(null);
  const [showValidationErrorDialog, setShowValidationErrorDialog] = useState(false);

  // Workflow execution error dialog state (module errors, syntax errors, etc.)
  const [workflowExecutionError, setWorkflowExecutionError] = useState<WorkflowExecutionErrorDetails | null>(null);
  const [workflowExecutionErrorRaw, setWorkflowExecutionErrorRaw] = useState<any>(null); // Raw errorData for AI troubleshooting
  const [showWorkflowExecutionErrorDialog, setShowWorkflowExecutionErrorDialog] = useState(false);

  // Recording mode selection state
  const [showRecordingModeDialog, setShowRecordingModeDialog] = useState(false);
  const [selectedRecordingMode, setSelectedRecordingMode] = useState<RecordingMode>("continuous");

  // Target app selection state for recording
  const [showTargetAppDialog, setShowTargetAppDialog] = useState(false);
  const [targetApp, setTargetApp] = useState<ApplicationInfo | null>(null);
  const [pendingRecordingParams, setPendingRecordingParams] = useState<{
    workflowName?: string;
    appendToExisting?: boolean;
  } | null>(null);

  // Wrong app dialog state
  const [showWrongAppDialog, setShowWrongAppDialog] = useState(false);
  const [wrongAppInfo, setWrongAppInfo] = useState<{
    targetAppName: string;
    actualAppName: string;
  } | null>(null);

  // Scheduled workflows state - for showing schedule indicators in WorkflowTable
  const [scheduledWorkflows, setScheduledWorkflows] = useState<ScheduledWorkflow[]>([]);

  // Experimental features - individual toggles for experimental functionality
  type ExperimentalFeatures = { xModeEnabled: boolean; generativeUIEnabled: boolean };
  const [experimentalFeatures, setExperimentalFeatures] = useState<ExperimentalFeatures>(() => {
    try {
      // Try to load new format first
      const stored = localStorage.getItem("experimental_features");
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log("[App] Loaded experimental features:", parsed);
        return parsed;
      }
      // Migrate from old format - turn off generativeUI for everyone
      const oldValue = localStorage.getItem("experimental_mode");
      if (oldValue === "true") {
        console.log("[App] Migrating experimental_mode=true -> xModeEnabled=true, generativeUIEnabled=false");
        const migrated = { xModeEnabled: true, generativeUIEnabled: false };
        localStorage.setItem("experimental_features", JSON.stringify(migrated));
        localStorage.removeItem("experimental_mode");
        return migrated;
      }
      // Default: both off
      return { xModeEnabled: false, generativeUIEnabled: false };
    } catch {
      return { xModeEnabled: false, generativeUIEnabled: false };
    }
  });

  // Persist experimental features to localStorage
  const handleExperimentalFeaturesChange = (features: ExperimentalFeatures) => {
    console.log("[App] Experimental features changed:", features);
    setExperimentalFeatures(features);
    localStorage.setItem("experimental_features", JSON.stringify(features));
  };

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Ref for autoclone confirmation - allows useChat to call it before it's defined
  const requestAutocloneConfirmationRef = useRef<
    ((workflowId: number | string, workflowName: string) => Promise<boolean>) | null
  >(null);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const workflowPanelRef = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const [panelSizes, setPanelSizes] = useState<number[]>([20, 40, 40]);

  // Track collapsed state for panels
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);

  // Individual panel visibility states (IDE-style toggle buttons)
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem("mediar-panel-sidebar");
    return saved !== null ? saved === "true" : true;
  });
  const [detailsVisible, setDetailsVisible] = useState(() => {
    const saved = localStorage.getItem("mediar-panel-details");
    return saved !== null ? saved === "true" : true;
  });
  const [chatVisible, setChatVisible] = useState(() => {
    const saved = localStorage.getItem("mediar-panel-chat");
    return saved !== null ? saved === "true" : true;
  });
  const [isVerticalLayout, setIsVerticalLayout] = useState(() => {
    const saved = localStorage.getItem("mediar-panel-vertical");
    return saved === "true";
  });

  // Persist panel visibility to localStorage
  useEffect(() => {
    localStorage.setItem("mediar-panel-sidebar", String(sidebarVisible));
  }, [sidebarVisible]);
  useEffect(() => {
    localStorage.setItem("mediar-panel-details", String(detailsVisible));
  }, [detailsVisible]);
  useEffect(() => {
    localStorage.setItem("mediar-panel-chat", String(chatVisible));
  }, [chatVisible]);
  useEffect(() => {
    localStorage.setItem("mediar-panel-vertical", String(isVerticalLayout));
  }, [isVerticalLayout]);

  // Count visible panels (for hiding toggle when panel is only one visible)
  const visiblePanelCount = [sidebarVisible, detailsVisible, chatVisible].filter(Boolean).length;

  // Toggle functions
  const toggleSidebar = useCallback(() => setSidebarVisible(v => !v), []);
  const toggleDetails = useCallback(() => setDetailsVisible(v => !v), []);
  const toggleChat = useCallback(() => setChatVisible(v => !v), []);
  const toggleOrientation = useCallback(() => setIsVerticalLayout(v => !v), []);

  const [sidebarSelection, setSidebarSelection] = useState<SidebarSelection>(null);
  const [diffHighlight, setDiffHighlight] = useState<DiffHighlight | null>(null);
  const diffHighlightRef = useRef<DiffHighlight | null>(null);

  // Keep diffHighlightRef in sync with state for async access
  useEffect(() => {
    diffHighlightRef.current = diffHighlight;
  }, [diffHighlight]);

  // Create refs to avoid circular dependencies
  const sendMessageRef = useRef<((message: string) => Promise<void>) | null>(null);
  const startWorkflowRef = useRef<((workflowId: string | null) => Promise<void>) | null>(null);

  // Refs for file watcher functions (populated after hook call)
  const acceptWatcherDiffRef = useRef<((filePath: string, currentContent: string) => void) | null>(null);
  const acceptWatcherDiffsRef = useRef<((files: Array<{ filePath: string; currentContent: string }>) => void) | null>(
    null
  );
  const clearAllActiveDiffsRef = useRef<(() => void) | null>(null);

  // Workflow management with sendMessage via ref - initialized first
  const {
    workflows,
    currentWorkflow,
    currentStep,
    stepResult,
    workflowState,
    isExecuting,
    isRecording,
    isStopping,
    isLoading: isLoadingWorkflows,
    loadingWorkflowId,
    isModifyingWorkflow,
    highlightState,
    workflowExecutionLogs,
    workflowExecutionState,
    liveStepStatus,
    logsRefreshKey,
    isFullWorkflowMode,
    executingRange,
    isPreparingWorkflow,
    loadWorkflows,
    loadCommunityWorkflows,
    initializeWorkflow,
    startWorkflow,
    startRecordingWorkflow,
    updateRecordingSteps,
    saveRecordedWorkflow,
    toggleRecording,
    stopRecording,
    interruptStep,
    backToList,
    resetWorkflowExecutionState,
    reloadExecutionState,
    executeStep,
    executeFullWorkflow,
    executeStepRange,
    jumpToStep,
    deleteWorkflow,
    cloneWorkflow,
    updateWorkflowName,
    revertWorkflowVersion,
    updateCurrentWorkflow,
    // NOTE: saveYamlContent removed - YAML workflows deprecated
    setRuntimeExecutionOptions,
    handleToolExecutionResult,
    stepProgress,
    canEditWorkflow,
    loadFileContent,
  } = useWorkflow({
    sendMessage: async (message: string) => {
      if (sendMessageRef.current) {
        return sendMessageRef.current(message);
      }
    },
  });

  // Watch workflow files for external changes (AI agents, etc.)

  // Handle terminator.ts changes - re-parse workflow structure
  // Receives fresh files from file watcher to handle newly created step files
  const handleTerminatorTsChange = useCallback(
    async (newContent: string, freshFiles?: Array<{ path: string; content: string; is_step: boolean }>) => {
      if (!currentWorkflow) return;

      try {
        const { TypeScriptWorkflowParser } = await import("@/lib/typescript-workflow-parser");
        const parser = new TypeScriptWorkflowParser();
        const parsed = parser.parseWorkflow(newContent);

        // Enrich steps with line numbers and actual IDs from step files
        // Use fresh files from watcher if available (includes newly created files)
        // Otherwise fall back to cached currentWorkflow.files
        let flatFiles: Array<{ path: string; content: string }> = [];

        if (freshFiles && freshFiles.length > 0) {
          // Use fresh files from file watcher - these include newly created files
          flatFiles = freshFiles.map(f => ({ path: f.path, content: f.content }));
          console.log(`📂 [APP] Using ${flatFiles.length} fresh files from watcher for enrichment`);
        } else if (currentWorkflow.files) {
          // Fall back to cached files
          const collectFiles = (files: typeof currentWorkflow.files) => {
            if (!files) return;
            for (const f of files) {
              if (!f.isDirectory && f.content) {
                flatFiles.push({ path: f.path, content: f.content });
              }
              if (f.children) {
                collectFiles(f.children);
              }
            }
          };
          collectFiles(currentWorkflow.files);
        }

        if (flatFiles.length > 0) {
          parser.enrichStepsWithLineNumbers(parsed.steps, flatFiles);
        }

        console.log(`🔄 [APP] Re-parsed workflow structure, found ${parsed.steps.length} steps`);

        // Build updated file tree, merging new step files from fresh data
        let updatedFiles = currentWorkflow.files;
        if (freshFiles && freshFiles.length > 0 && currentWorkflow.files) {
          // Deep clone the files tree
          updatedFiles = JSON.parse(JSON.stringify(currentWorkflow.files));

          // Find the src/steps directory in the tree
          const findStepsDir = (files: typeof currentWorkflow.files): (typeof currentWorkflow.files)[0] | null => {
            if (!files) return null;
            for (const f of files) {
              if (f.isDirectory && f.path === "src/steps") return f;
              if (f.isDirectory && f.children) {
                const found = findStepsDir(f.children);
                if (found) return found;
              }
            }
            return null;
          };

          const stepsDir = findStepsDir(updatedFiles);
          if (stepsDir) {
            // Get existing step file paths
            const existingPaths = new Set(stepsDir.children?.map(c => c.path) || []);

            // Add any new step files from fresh data
            for (const freshFile of freshFiles) {
              const normalizedPath = freshFile.path.replace(/\\/g, "/");
              if (freshFile.is_step && !existingPaths.has(normalizedPath)) {
                const fileName = normalizedPath.split("/").pop() || "";
                console.log(`📁 [APP] Adding new step file to tree: ${fileName}`);
                if (!stepsDir.children) stepsDir.children = [];
                stepsDir.children.push({
                  name: fileName,
                  path: normalizedPath,
                  isDirectory: false,
                  content: freshFile.content,
                  isStepFile: true,
                });
              } else if (freshFile.is_step) {
                // Update content of existing step file
                const existing = stepsDir.children?.find(c => c.path === normalizedPath);
                if (existing) {
                  existing.content = freshFile.content;
                }
              }
            }

            // Sort step files by name
            if (stepsDir.children) {
              stepsDir.children.sort((a, b) => a.name.localeCompare(b.name));
            }
          }

          // Update terminator.ts content
          const updateTerminatorContent = (files: typeof currentWorkflow.files) => {
            if (!files) return;
            for (const f of files) {
              if (f.path === "src/terminator.ts") {
                f.content = newContent;
              }
              if (f.isDirectory && f.children) {
                updateTerminatorContent(f.children);
              }
            }
          };
          updateTerminatorContent(updatedFiles);

          console.log(`🌳 [APP] Updated file tree with fresh step files`);
        } else if (currentWorkflow.files) {
          // Just update terminator.ts content
          updatedFiles = currentWorkflow.files.map(f =>
            f.path.endsWith("terminator.ts") ? { ...f, content: newContent } : f
          );
        }

        updateCurrentWorkflow({
          content: {
            ...currentWorkflow.content,
            steps: parsed.steps as unknown as typeof currentWorkflow.content.steps,
          },
          stepCount: parsed.steps.length,
          inputs: parsed.inputSchema,
          hasOnSuccess: parsed.hasOnSuccess,
          hasOnError: parsed.hasOnError,
          trigger: parsed.trigger,
          sections: parsed.sections,
          files: updatedFiles,
        });
      } catch (err) {
        console.error("❌ [APP] Failed to re-parse workflow:", err);
      }
    },
    [currentWorkflow, updateCurrentWorkflow]
  );

  // Handle step file changes - re-parse individual steps and update in workflow
  const handleStepFileChange = useCallback(
    async (filePath: string, newContent: string) => {
      if (!currentWorkflow?.content.steps) return;

      try {
        const { TypeScriptWorkflowParser } = await import("@/lib/typescript-workflow-parser");
        const parser = new TypeScriptWorkflowParser();

        // Parse all steps from this step file
        const parsedSteps = parser.parseAllStepsFromFile(newContent);
        if (parsedSteps.length === 0) {
          console.warn(`⚠️ [APP] No steps found in ${filePath}`);
          // Still update the file content even if no steps found (file might be empty/invalid temporarily)
        }

        const normalizedFilePath = filePath.replace(/\\/g, "/");
        const fileName = normalizedFilePath.split("/").pop() || "";
        console.log(`🔄 [APP] Re-parsed step file ${fileName}, found ${parsedSteps.length} steps`);

        // Update existing steps and add new ones
        const existingSteps = currentWorkflow.content.steps as Array<{ id: string; [key: string]: unknown }>;
        const existingStepIds = new Set(existingSteps.map(s => s.id));

        // Update existing steps that match parsed steps
        const updatedSteps = existingSteps.map(step => {
          const matchingParsed = parsedSteps.find(p => p.id === step.id);
          if (matchingParsed) {
            return { ...step, ...matchingParsed };
          }
          return step;
        });

        // Add new steps that don't exist yet
        for (const parsedStep of parsedSteps) {
          if (!existingStepIds.has(parsedStep.id)) {
            console.log(`➕ [APP] Adding new step from file: ${parsedStep.id}`);
            updatedSteps.push(parsedStep as unknown as (typeof existingSteps)[0]);
          }
        }

        // Helper to update file content in the tree (or add if not exists)
        const updateOrAddFile = (files: typeof currentWorkflow.files): typeof currentWorkflow.files => {
          if (!files) return files;

          // First, try to update existing file
          let found = false;
          const updated = files.map(f => {
            if (f.path.replace(/\\/g, "/") === normalizedFilePath) {
              found = true;
              return { ...f, content: newContent };
            }
            if (f.children) {
              const updatedChildren = updateOrAddFile(f.children);
              if (updatedChildren !== f.children) {
                found = true;
                return { ...f, children: updatedChildren };
              }
            }
            return f;
          });

          // If file is in src/steps and wasn't found, add it to steps directory
          if (!found && normalizedFilePath.startsWith("src/steps/")) {
            return updated.map(f => {
              if (f.path === "src/steps" && f.isDirectory) {
                console.log(`➕ [APP] Adding new file to tree: ${fileName}`);
                const newChildren = [
                  ...(f.children || []),
                  {
                    name: fileName,
                    path: normalizedFilePath,
                    isDirectory: false,
                    content: newContent,
                    isStepFile: true,
                  },
                ].sort((a, b) => a.name.localeCompare(b.name));
                return { ...f, children: newChildren };
              }
              if (f.path === "src" && f.isDirectory && f.children) {
                // Recurse into src directory
                return { ...f, children: updateOrAddFile(f.children) };
              }
              return f;
            });
          }

          return updated;
        };

        updateCurrentWorkflow({
          content: {
            ...currentWorkflow.content,
            steps: updatedSteps as typeof currentWorkflow.content.steps,
          },
          files: updateOrAddFile(currentWorkflow.files),
        });
      } catch (err) {
        console.error("❌ [APP] Failed to re-parse step file:", err);
      }
    },
    [currentWorkflow, updateCurrentWorkflow]
  );

  // Handle other file content changes - just update the file view
  const handleFileContentChange = useCallback(
    (filePath: string, newContent: string) => {
      if (!currentWorkflow?.files) return;

      const normalizedFilePath = filePath.replace(/\\/g, "/");
      const fileName = normalizedFilePath.split("/").pop() || "";
      console.log(`📄 [APP] Updating file content: ${fileName}`);

      // Helper to update file content in the tree (or add if not exists)
      const updateOrAddFile = (files: typeof currentWorkflow.files): typeof currentWorkflow.files => {
        if (!files) return files;

        let found = false;
        const updated = files.map(f => {
          if (f.path.replace(/\\/g, "/") === normalizedFilePath) {
            found = true;
            return { ...f, content: newContent };
          }
          if (f.children) {
            const updatedChildren = updateOrAddFile(f.children);
            if (updatedChildren !== f.children) {
              found = true;
              return { ...f, children: updatedChildren };
            }
          }
          return f;
        });

        // If file wasn't found, try to add it to the appropriate directory
        if (!found) {
          const pathParts = normalizedFilePath.split("/");
          const parentPath = pathParts.slice(0, -1).join("/");

          return updated.map(f => {
            // Check if this is the parent directory
            if (f.path === parentPath && f.isDirectory) {
              console.log(`➕ [APP] Adding new file to tree: ${fileName} in ${parentPath}`);
              const newChildren = [
                ...(f.children || []),
                {
                  name: fileName,
                  path: normalizedFilePath,
                  isDirectory: false,
                  content: newContent,
                },
              ].sort((a, b) => a.name.localeCompare(b.name));
              return { ...f, children: newChildren };
            }
            // Recurse into directories to find parent
            if (f.isDirectory && f.children && normalizedFilePath.startsWith(f.path + "/")) {
              return { ...f, children: updateOrAddFile(f.children) };
            }
            return f;
          });
        }

        return updated;
      };

      updateCurrentWorkflow({
        files: updateOrAddFile(currentWorkflow.files),
      });
    },
    [currentWorkflow, updateCurrentWorkflow]
  );

  // Ref to hold step mapping for use in handleExternalDiff (avoids circular dependency)
  const stepMappingRef = useRef<
    Array<{ id: string; name?: string; sourceFile?: string; lineStart?: number; lineEnd?: number }>
  >([]);

  // Ref to hold sections for use in handleExternalDiff
  const sectionsRef = useRef<
    Array<{ type: "input" | "steps" | "onError" | "onSuccess" | "trigger"; lineStart: number; lineEnd: number }>
  >([]);

  // Handle external file diff - accumulate diff highlighting for changed files
  // Calls Rust to compute affected steps based on line-level diff
  // Result type from Rust compute_affected_steps
  interface AffectedStepsResult {
    stepIds: string[];
    changeStart: number | null;
    changeEnd: number | null;
  }

  const handleExternalDiff = useCallback(
    async (diff: ExternalFileDiff) => {
      console.log(
        `[APP] External diff received: ${diff.filePath} (${diff.originalContent.length} bytes original, ${diff.currentContent.length} bytes current)`
      );

      const newFileDiff: FileDiff = {
        filePath: diff.filePath,
        originalContent: diff.originalContent,
        currentContent: diff.currentContent,
      };

      // Get current state to compute updated files
      const existingFiles = diffHighlightRef.current?.files || [];
      const normalizedNewPath = newFileDiff.filePath.replace(/\\/g, "/");
      const existingFileIndex = existingFiles.findIndex(f => {
        const normalizedExisting = f.filePath.replace(/\\/g, "/");
        return normalizedExisting === normalizedNewPath;
      });

      let updatedFiles: FileDiff[];
      if (existingFileIndex >= 0) {
        updatedFiles = existingFiles.map((f, i) => (i === existingFileIndex ? newFileDiff : f));
      } else {
        updatedFiles = [...existingFiles, newFileDiff];
      }

      // Skip non-code files for auto-navigation (but still show in diff)
      const isJsonFile = normalizedNewPath.endsWith(".json");
      if (isJsonFile) {
        console.log(`[APP] Skipping auto-navigation for JSON file: ${normalizedNewPath}`);
        setDiffHighlight({ files: updatedFiles, affectedStepIds: [] });
        return;
      }

      // Compute affected steps using Rust for each file diff
      // Filter steps to only those in the changed file, then call Rust
      const allAffectedIds = new Set<string>();

      // Track navigation target - could be step, section, or file
      type NavTarget =
        | { type: "ts-step"; file: string; index: number; lineStart?: number; lineEnd?: number }
        | {
            type: "ts-input" | "ts-onError" | "ts-onSuccess" | "ts-trigger";
            file: string;
            lineStart?: number;
            lineEnd?: number;
          }
        | { type: "file"; path: string };
      let navTarget: NavTarget | null = null;

      // Track the changed file path and line range for fallback navigation
      let changedFilePath: string | null = null;
      let changeStart: number | undefined;
      let changeEnd: number | undefined;

      for (const fileDiff of updatedFiles) {
        const normalizedDiffPath = fileDiff.filePath.replace(/\\/g, "/");

        // Get steps that are in this file
        const stepsInFile = (stepMappingRef.current || []).filter(step => {
          if (!step.sourceFile) return false;
          const normalizedStepPath = step.sourceFile.replace(/\\/g, "/");
          return normalizedDiffPath.endsWith(normalizedStepPath) || normalizedStepPath.endsWith(normalizedDiffPath);
        });

        // Check if this is the main.ts file (where sections are)
        const isMainFile = normalizedDiffPath.endsWith("/main.ts") || normalizedDiffPath.endsWith("\\main.ts");

        // Try to get affected steps if there are any steps in this file
        if (stepsInFile.length > 0) {
          try {
            // Call Rust to compute affected steps with line range
            const result = await invoke<AffectedStepsResult>("compute_affected_steps", {
              oldContent: fileDiff.originalContent,
              newContent: fileDiff.currentContent,
              steps: stepsInFile.map(s => ({
                id: s.id,
                lineStart: s.lineStart,
                lineEnd: s.lineEnd,
              })),
            });

            // Track changed lines for section/file fallback
            if (result.changeStart !== null) {
              changedFilePath = normalizedDiffPath;
              changeStart = result.changeStart ?? undefined;
              changeEnd = result.changeEnd ?? undefined;
            }

            for (const id of result.stepIds) {
              allAffectedIds.add(id);

              // Track first affected step for auto-navigation (only if not already set)
              if (!navTarget) {
                const stepInfo = stepsInFile.find(s => s.id === id);
                if (stepInfo) {
                  // Find the index of this step in the full step mapping
                  const stepIndex = (stepMappingRef.current || []).findIndex(s => s.id === id);
                  navTarget = {
                    type: "ts-step",
                    file: stepInfo.sourceFile || "",
                    index: stepIndex >= 0 ? stepIndex : 0,
                    lineStart: result.changeStart ?? undefined,
                    lineEnd: result.changeEnd ?? undefined,
                  };
                }
              }
            }
          } catch (err) {
            console.error(`[APP] Error computing affected steps:`, err);
            // Fallback: mark all steps in file as affected
            for (const step of stepsInFile) {
              allAffectedIds.add(step.id);
            }
          }
        } else {
          // No steps in file - get changed lines for fallback navigation
          try {
            const result = await invoke<AffectedStepsResult>("compute_affected_steps", {
              oldContent: fileDiff.originalContent,
              newContent: fileDiff.currentContent,
              steps: [], // Empty - just need the line range
            });
            if (result.changeStart !== null) {
              changedFilePath = normalizedDiffPath;
              changeStart = result.changeStart ?? undefined;
              changeEnd = result.changeEnd ?? undefined;
            }
          } catch (err) {
            console.error(`[APP] Error computing line changes:`, err);
            changedFilePath = normalizedDiffPath;
          }
        }

        // If no step matched but we have changes, check for section match (only in main.ts)
        if (!navTarget && changeStart !== undefined && isMainFile) {
          const sections = sectionsRef.current || [];
          for (const section of sections) {
            // Skip "steps" section - that's handled by step matching
            if (section.type === "steps") continue;

            // Check if changed lines overlap with section
            if (section.lineStart <= (changeEnd ?? changeStart) && changeStart <= section.lineEnd) {
              const sectionTypeMap = {
                input: "ts-input",
                onError: "ts-onError",
                onSuccess: "ts-onSuccess",
                trigger: "ts-trigger",
              } as const;
              const navType = sectionTypeMap[section.type as keyof typeof sectionTypeMap];
              if (navType) {
                console.log(`[APP] Change in ${section.type} section (lines ${section.lineStart}-${section.lineEnd})`);
                navTarget = {
                  type: navType,
                  file: normalizedDiffPath,
                  lineStart: changeStart,
                  lineEnd: changeEnd,
                };
                break;
              }
            }
          }
        }
      }

      // If still no navigation target, fall back to file-level selection
      if (!navTarget && changedFilePath) {
        // Extract relative path from full path for file selection
        // The path format is like: C:/Users/.../workflows/{id}/src/terminator.ts
        // We need: src/terminator.ts
        const pathParts = changedFilePath.split("/");
        const srcIndex = pathParts.findIndex(p => p === "src");
        const relativePath = srcIndex >= 0 ? pathParts.slice(srcIndex).join("/") : pathParts[pathParts.length - 1];
        console.log(`[APP] Fallback to file selection: ${relativePath}`);
        navTarget = { type: "file", path: relativePath };
      }

      const affectedStepIds = Array.from(allAffectedIds);
      console.log(`[APP] Affected steps: ${affectedStepIds.join(", ") || "none"}`);

      setDiffHighlight({
        files: updatedFiles,
        affectedStepIds,
      });

      // Auto-navigate to the determined target
      if (navTarget) {
        console.log(`[APP] Auto-navigating to ${navTarget.type}:`, navTarget);
        if (navTarget.type === "ts-step") {
          setSidebarSelection({
            type: "ts-step",
            file: navTarget.file,
            index: navTarget.index,
            lineStart: navTarget.lineStart,
            lineEnd: navTarget.lineEnd,
          });
        } else if (navTarget.type === "file") {
          setSidebarSelection({
            type: "file",
            path: navTarget.path,
          });
        } else {
          // Section types: ts-input, ts-onError, ts-onSuccess, ts-trigger
          setSidebarSelection({
            type: navTarget.type,
            file: navTarget.file,
            lineStart: navTarget.lineStart,
            lineEnd: navTarget.lineEnd,
          });
        }
      }
    },
    [setSidebarSelection]
  );

  // Accept all diffs - clears the diff UI and updates file watcher cache
  const handleAcceptAllDiffs = useCallback(() => {
    console.log("[DIFF] Accepting all diffs - keeping current content");
    // Update file watcher caches so subsequent edits have new baseline
    if (diffHighlight?.files.length && acceptWatcherDiffsRef.current) {
      acceptWatcherDiffsRef.current(
        diffHighlight.files.map(f => ({ filePath: f.filePath, currentContent: f.currentContent }))
      );
    }
    setDiffHighlight(null);
  }, [diffHighlight]);

  // Handle single file accepted via CodeMirror merge view - remove it from diffHighlight
  const handleFileAccepted = useCallback(
    (filePath: string) => {
      console.log(`[DIFF] File accepted via CodeMirror: ${filePath}`);
      const normalizedPath = filePath.replace(/\\/g, "/");

      // Find the file to get its current content for cache update
      const acceptedFile = diffHighlight?.files.find(f => {
        const normalizedFilePath = f.filePath.replace(/\\/g, "/");
        return (
          normalizedFilePath === normalizedPath ||
          normalizedFilePath.endsWith(normalizedPath) ||
          normalizedPath.endsWith(normalizedFilePath)
        );
      });

      // Update file watcher cache for this file
      if (acceptedFile && acceptWatcherDiffRef.current) {
        acceptWatcherDiffRef.current(acceptedFile.filePath, acceptedFile.currentContent);
      }

      setDiffHighlight(prev => {
        if (!prev) return null;

        const remainingFiles = prev.files.filter(f => {
          const normalizedFilePath = f.filePath.replace(/\\/g, "/");
          return (
            normalizedFilePath !== normalizedPath &&
            !normalizedFilePath.endsWith(normalizedPath) &&
            !normalizedPath.endsWith(normalizedFilePath)
          );
        });

        // If no files remain, clear the diff highlight entirely
        if (remainingFiles.length === 0) {
          console.log("[DIFF] All files accepted - clearing diff highlight");
          return null;
        }

        // Otherwise, keep remaining files and recalculate affected steps would be ideal,
        // but for now just clear affectedStepIds since it's complex to recalculate
        console.log(`[DIFF] ${remainingFiles.length} file(s) still have pending diffs`);
        return {
          files: remainingFiles,
          affectedStepIds: [], // Clear affected steps since we'd need to recalculate
        };
      });
    },
    [diffHighlight]
  );

  // Reject all diffs - restores original content for each file
  const handleRejectAllDiffs = useCallback(async () => {
    if (!diffHighlight?.files.length || !currentWorkflow?.id) return;

    console.log(`[DIFF] Rejecting all diffs - restoring ${diffHighlight.files.length} file(s)`);

    for (const file of diffHighlight.files) {
      try {
        // Write original content back to disk
        await invoke("write_typescript_workflow_file", {
          input: {
            workflow_id: String(currentWorkflow.id),
            file_path: file.filePath,
            content: file.originalContent,
          },
        });
        console.log(`[DIFF] Restored: ${file.filePath}`);

        // Update UI with restored content
        if (file.filePath.includes("terminator.ts")) {
          handleTerminatorTsChange(file.originalContent, []);
        } else if (file.filePath.includes("/steps/") || file.filePath.includes("\\steps\\")) {
          handleStepFileChange(file.filePath, file.originalContent);
        }
      } catch (err) {
        console.error(`[DIFF] Failed to restore ${file.filePath}:`, err);
      }
    }

    // Clear active diffs - cache already has baseline (original content)
    clearAllActiveDiffsRef.current?.();
    setDiffHighlight(null);
  }, [diffHighlight, currentWorkflow?.id, handleTerminatorTsChange, handleStepFileChange]);

  // Handle file tree changes (file added/deleted) - refresh the file tree
  const handleFileTreeChange = useCallback(async () => {
    if (!currentWorkflow?.id || typeof currentWorkflow.id !== "string") return;

    console.log(`🌳 [APP] Refreshing file tree for tree change`);

    try {
      // Re-read file tree from backend
      const treeResult = await invoke<{
        root: Array<{
          path: string;
          name: string;
          isDirectory: boolean;
          children?: Array<{
            path: string;
            name: string;
            isDirectory: boolean;
            children?: unknown[];
          }>;
        }>;
      }>("read_workflow_file_tree", {
        workflowId: currentWorkflow.id,
      });

      // Build a map of existing file content to preserve (including mimeType for images)
      const existingContentMap = new Map<string, { content?: string; isStepFile?: boolean; mimeType?: string }>();
      const collectContent = (files: TypeScriptWorkflowFile[] | undefined) => {
        if (!files) return;
        for (const file of files) {
          if (!file.isDirectory && file.content !== undefined) {
            existingContentMap.set(file.path.replace(/\\/g, "/"), {
              content: file.content,
              isStepFile: file.isStepFile,
              mimeType: file.mimeType,
            });
          }
          if (file.children) {
            collectContent(file.children);
          }
        }
      };
      collectContent(currentWorkflow.files);

      // Convert raw tree nodes to TypeScriptWorkflowFile, preserving existing content
      const convertNodes = (
        nodes: Array<{
          path: string;
          name: string;
          isDirectory: boolean;
          children?: unknown[];
        }>
      ): TypeScriptWorkflowFile[] => {
        return nodes.map(node => {
          const normalizedPath = node.path.replace(/\\/g, "/");
          const existing = existingContentMap.get(normalizedPath);
          return {
            name: node.name,
            path: normalizedPath,
            isDirectory: node.isDirectory,
            content: existing?.content,
            isStepFile: existing?.isStepFile ?? normalizedPath.includes("/steps/"),
            mimeType: existing?.mimeType,
            children: node.children
              ? convertNodes(
                  node.children as Array<{
                    path: string;
                    name: string;
                    isDirectory: boolean;
                    children?: unknown[];
                  }>
                )
              : undefined,
          };
        });
      };

      const newFiles = convertNodes(treeResult.root);
      console.log(
        `✅ [APP] File tree refreshed: ${treeResult.root.length} root items, preserved ${existingContentMap.size} file contents`
      );

      // Update the workflow files state
      updateCurrentWorkflow({ files: newFiles });
    } catch (err) {
      console.error("❌ [APP] Failed to refresh file tree:", err);
    }
  }, [currentWorkflow?.id, currentWorkflow?.files, updateCurrentWorkflow]);

  // Edit history for undo/redo
  const {
    canUndo,
    canRedo,
    undo: undoFileEdit,
    redo: redoFileEdit,
    recordEdit,
  } = useEditHistory({
    workflowId: typeof currentWorkflow?.id === "string" ? currentWorkflow.id : null,
    onFilesRestored: files => {
      // When files are restored by undo/redo, refresh the UI
      if (files.length > 0) {
        console.log(
          `📜 [EDIT_HISTORY] Files restored:`,
          files.map(f => f.path)
        );
        // Trigger a re-parse of the workflow
        if (files.some(f => f.path.includes("terminator.ts"))) {
          const terminatorFile = files.find(f => f.path.includes("terminator.ts"));
          if (terminatorFile) {
            handleTerminatorTsChange(terminatorFile.content);
          }
        }
        // For step files, trigger individual re-parses
        for (const file of files) {
          if (file.path.includes("/steps/")) {
            handleStepFileChange(file.path, file.content);
          }
        }

        // Set diff highlight for restored files - use originalContent for merge view
        const filesWithChanges = files.filter(f => f.originalContent && f.originalContent !== f.content);
        if (filesWithChanges.length > 0) {
          // Accumulate all file diffs from undo/redo
          for (const file of filesWithChanges) {
            handleExternalDiff({
              filePath: file.path,
              originalContent: file.originalContent,
              currentContent: file.content,
            });
          }
        }
      }
    },
  });

  const {
    markPendingAIEdit,
    acceptDiff: acceptWatcherDiff,
    acceptAllDiffs: acceptWatcherDiffs,
    clearAllActiveDiffs,
  } = useWorkflowFileWatcher({
    workflowId: typeof currentWorkflow?.id === "string" ? currentWorkflow.id : null,
    workflowPath: currentWorkflow?.localPath ?? null,
    enabled: !!currentWorkflow?.localPath, // Only watch TypeScript workflows
    debounceMs: 500,
    onTerminatorTsChange: handleTerminatorTsChange,
    onStepFileChange: handleStepFileChange,
    onFileContentChange: handleFileContentChange,
    onFileTreeChange: handleFileTreeChange,
    onStateFileChange: reloadExecutionState, // Reload state.json when it changes externally
    onRecordEdit: recordEdit,
    onExternalDiff: handleExternalDiff,
  });

  // Populate refs for handlers defined before the hook
  acceptWatcherDiffRef.current = acceptWatcherDiff;
  acceptWatcherDiffsRef.current = acceptWatcherDiffs;
  clearAllActiveDiffsRef.current = clearAllActiveDiffs;

  // Listen for recording-files-created event to refresh file tree after recording finishes
  // This handles files created by process_recording_locally (e.g., recordings/analysis.md)
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      unlisten = await listen<{ workflowId: string }>("recording-files-created", event => {
        console.log("[APP] recording-files-created event received:", event.payload);
        // Only refresh if it's for the current workflow
        if (event.payload.workflowId === currentWorkflow?.id) {
          console.log("[APP] Refreshing file tree after recording files created");
          handleFileTreeChange();
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [currentWorkflow?.id, handleFileTreeChange]);

  // Apply panel visibility states (must be after useWorkflow since it depends on currentWorkflow)
  useEffect(() => {
    const sidebar = sidebarPanelRef.current;
    const details = workflowPanelRef.current;
    const chat = chatPanelRef.current;

    // Small delay to ensure panels are mounted
    setTimeout(() => {
      console.log("[Layout] Applying visibility:", { sidebarVisible, detailsVisible, chatVisible, isVerticalLayout });

      // Sidebar only exists when workflow is open
      if (currentWorkflow) {
        if (sidebarVisible) sidebar?.expand();
        else sidebar?.collapse();
      }

      // Details and chat panels always exist (on home page and workflow view)
      if (detailsVisible) details?.expand();
      else details?.collapse();

      if (chatVisible) chat?.expand();
      else chat?.collapse();
    }, 50);
  }, [sidebarVisible, detailsVisible, chatVisible, currentWorkflow]);

  // Derive TypeScript workflow context for AI chat
  const workflowTsContext = useMemo(() => {
    if (!currentWorkflow?.files || !currentWorkflow?.content?.steps) {
      return { terminatorTsContent: undefined, stepMapping: undefined, workflowFiles: undefined };
    }

    // Find terminator.ts content
    const findFile = (files: typeof currentWorkflow.files, targetPath: string): string | undefined => {
      if (!files) return undefined;
      for (const file of files) {
        if (file.path === targetPath && file.content) return file.content;
        if (file.isDirectory && file.children) {
          const found = findFile(file.children, targetPath);
          if (found) return found;
        }
      }
      return undefined;
    };
    const terminatorTsContent = findFile(currentWorkflow.files, "src/terminator.ts");

    // Build step mapping from parsed steps
    const stepMapping = currentWorkflow.content.steps
      .filter((s: any) => s.id)
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        sourceFile: s.sourceFile,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
      }));

    // Build flat file list (exclude internal folders like .mediar, node_modules, etc.)
    const collectFiles = (files: typeof currentWorkflow.files, result: string[] = []): string[] => {
      if (!files) return result;
      for (const file of files) {
        // Skip internal/generated folders
        if (file.isDirectory && (file.name.startsWith(".") || file.name === "node_modules" || file.name === "dist")) {
          continue;
        }
        if (!file.isDirectory) result.push(file.path);
        if (file.isDirectory && file.children) collectFiles(file.children, result);
      }
      return result;
    };
    const workflowFiles = collectFiles(currentWorkflow.files);

    // Get sections from workflow (already parsed by typescript-workflow-parser)
    const sections = currentWorkflow.sections || [];

    return { terminatorTsContent, stepMapping, workflowFiles, sections };
  }, [currentWorkflow?.files, currentWorkflow?.content?.steps, currentWorkflow?.sections]);

  // Keep stepMappingRef in sync with workflowTsContext.stepMapping for use in handleExternalDiff
  useEffect(() => {
    stepMappingRef.current = workflowTsContext.stepMapping || [];
  }, [workflowTsContext.stepMapping]);

  // Keep sectionsRef in sync with workflowTsContext.sections for use in handleExternalDiff
  useEffect(() => {
    sectionsRef.current = workflowTsContext.sections || [];
  }, [workflowTsContext.sections]);

  // Chat state using custom hook with workflow integration
  const {
    messages,
    input,
    setInput,
    isLoading,
    loadingStatus,
    handleInputChange,
    sendMessage,
    reload,
    stop,
    updateMessage,
    regenerateMessage,
    forkFromMessage,
    addWelcomeMessage,
    dismissSuggestions,
    addWorkflowExecutionMessage,
    interruptTool,
    mcpState,
    isMcpAvailable,
    getMcpStatusMessage,
    // NOTE: regenerateSuggestions removed - YAML workflows deprecated
    selectedModel,
    setSelectedModel,
    thinkingLevel,
    setThinkingLevel,
    mode,
    setMode,
    triggerFailureAnalysis,
    triggerRecorderSession,
    sessionId,
    // Pasted images waiting to be sent
    pendingImages,
    setPendingImages,
    // Suggestions overlay state (separate from messages)
    suggestedActions,
    suggestionsWorkflowName,
    isGeneratingSuggestions,
    // Chat history functions
    listPreviousSessions,
    loadPreviousSession,
    // Context usage metrics
    contextMetrics,
    contextLimit,
  } = useChat({
    onError: error => {
      console.error("💥 Chat error:", error);
    },
    // Workflow context (use name for display, ID for persistence)
    focusedWorkflowName: currentWorkflow?.name,
    // TypeScript workflow context
    terminatorTsContent: workflowTsContext.terminatorTsContent,
    stepMapping: workflowTsContext.stepMapping,
    workflowFiles: workflowTsContext.workflowFiles,
    // Per-workflow session persistence
    workflowId: currentWorkflow?.id, // Folder name - used for local file operations
    cloudId: currentWorkflow?.cloudId, // Cloud UUID - used for cloud sync operations
    // TypeScript workflow local path (for file editing tools)
    localPath: currentWorkflow?.localPath,
    // Autoclone support for read-only public workflows
    currentWorkflow,
    canEditWorkflow,
    requestAutocloneConfirmation: async (workflowId: number | string, workflowName: string) => {
      if (requestAutocloneConfirmationRef.current) {
        return requestAutocloneConfirmationRef.current(workflowId, workflowName);
      }
      return false;
    },
    // Focus input when AI finishes streaming
    onStreamComplete: () => {
      console.log("🎯 [APP] AI stream complete, focusing input");
      // Small delay to ensure rendering is complete
      setTimeout(() => {
        if (inputRef.current && !inputRef.current.disabled) {
          inputRef.current.focus();
          console.log("✅ [APP] Input focused after AI response");
        }
      }, 100);
    },
    // Open a file in the app's file viewer (used by recorder to show README.md)
    onOpenFile: async (relativePath: string) => {
      console.log("[APP] Opening file in viewer:", relativePath);
      await loadFileContent(relativePath); // Load content first (lazy loading)
      setSidebarSelection({ type: "file", path: relativePath });
    },
    // Reload workflows when AI edits them (TypeScript workflows only - YAML deprecated)
    onWorkflowChanged: async () => {
      console.log("[APP] Workflow changed - reloading");

      // Clear selection before reload since we don't know what changed
      if (sidebarSelection?.type === "step") {
        console.log("[APP] Clearing selection before workflow reload");
        setSidebarSelection(null);
      }

      // Reload the workflows list
      await loadWorkflows();

      // If there's a current workflow open, reload it to show the updated steps
      if (currentWorkflow?.id) {
        console.log("[APP] Reloading current workflow:", currentWorkflow.id);
        await initializeWorkflow(currentWorkflow.id, false);
      }

      // After reload, scroll to the last step if a new one was added
      // Try multiple times to find the scrollable element
      const tryScroll = (attempts = 0) => {
        console.log("[APP] Trying to scroll, attempt:", attempts);

        if (attempts > 10) {
          console.warn("[APP] Failed to scroll after 10 attempts");
          return;
        }

        // Find the steps container
        const stepsContainer = document.querySelector("[data-workflow-steps]");
        if (!stepsContainer) {
          console.log("[APP] Steps container not found yet");
          setTimeout(() => tryScroll(attempts + 1), 150);
          return;
        }

        // Find all direct child divs that are step rows
        // Skip the header div (which has class bg-black/5)
        const allChildren = Array.from(stepsContainer.children);
        const stepDivs = allChildren.filter(el => el.tagName === "DIV" && !el.classList.contains("bg-black/5"));

        console.log("[APP] Found steps:", stepDivs.length);

        if (stepDivs.length > 0) {
          // Get the last step
          const lastStep = stepDivs[stepDivs.length - 1];
          console.log("[APP] Scrolling to last step");

          // Scroll to it
          lastStep.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
          console.log("[APP] Scrolled to last step!");
          return;
        }

        // Retry after a short delay
        setTimeout(() => tryScroll(attempts + 1), 150);
      };

      setTimeout(tryScroll, 300);
    },
    // Mark files for AI edit diff tracking (file watcher triggers diff when change detected)
    markPendingAIEdit,
    // Experimental: Allow AI to render interactive components in chat
    generativeUIEnabled: experimentalFeatures.generativeUIEnabled,
  });

  // Listen for recorder-session-ready events (emitted after local processing completes)
  useEffect(() => {
    const setupRecorderSessionListener = async () => {
      const unlisten = await listen<{
        workflowFolder: string;
        analysisMarkdown: string;
        synthesisResult: {
          workflows: Array<{
            title: string;
            description: string;
            steps: Array<{
              step_name: string;
              substeps: Array<{
                substep_name: string;
                inputs: string[];
                outputs: string[];
                business_logic: string[];
              }>;
            }>;
          }>;
        };
        stepAnalyses: Array<{
          step_title: string;
          step_summary: string;
          events_that_happened: string;
          how_content_changed: string;
          results_if_any: string;
          what_was_clicked: string;
          what_was_typed: string;
          user_intent: string;
          label?: string;
          timestamp: string;
          window_title?: string;
        }>;
        rawEvents: Array<Record<string, unknown>>;
      }>("recorder-session-ready", event => {
        console.log("[APP] Recorder session ready event received:", {
          workflowFolder: event.payload.workflowFolder,
          stepCount: event.payload.stepAnalyses.length,
          eventCount: event.payload.rawEvents.length,
        });

        // Trigger the recorder session to start implementing steps
        if (triggerRecorderSession) {
          triggerRecorderSession(event.payload);
        }
      });
      return unlisten;
    };

    const unlistenPromise = setupRecorderSessionListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [triggerRecorderSession]);

  // Debug context menu items for chat area
  const chatDebugItems = useChatDebugItems(messages, currentWorkflow?.id);

  // Step pool state
  const {
    steps: poolSteps,
    deleteStep: deletePoolStep,
    clearSession: clearPool,
    addToWorkflow,
    addFromWorkflow,
  } = useStepPool(currentWorkflow?.id ?? undefined);

  // Cloud sync for TypeScript workflows
  const { smartSync, needsPull, isTypescriptWorkflow } = useWorkflowPublish(
    typeof currentWorkflow?.id === "string" ? currentWorkflow.id : undefined,
    currentWorkflow?.name ?? "",
    currentWorkflow?.description,
    !!currentWorkflow // enabled when workflow is loaded
  );
  const [isSyncing, setIsSyncing] = useState(false);

  // Wrap smartSync with loading state - handles pull/push automatically
  const handleSyncToCloud = useCallback(async () => {
    if (!isTypescriptWorkflow) return { success: false, error: "Not a TypeScript workflow" };
    setIsSyncing(true);
    try {
      const result = await smartSync();
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [smartSync, isTypescriptWorkflow]);

  // Version history for top bar CloudActionsButton
  const { versions, saveVersion } = useWorkflowVersions({
    workflowId: currentWorkflow?.id,
    workflowPath: isTypescriptWorkflow ? currentWorkflow?.localPath : undefined,
  });
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  // Handle Dashboard click - opens web dashboard
  const handleDashboard = useCallback(async () => {
    try {
      await invoke("open_url_in_browser", {
        url: "https://app.mediar.ai/dashboard",
      });
    } catch (error) {
      console.error("Failed to open dashboard:", error);
    }
  }, []);

  // Track which pool step is currently executing
  const [executingPoolStepId, setExecutingPoolStepId] = useState<string | null>(null);

  // MCP tools for executing pool steps (use shared context to avoid duplicate connections)
  const { callTool } = useMcp();

  // Execute a pool step
  const executePoolStep = useCallback(
    async (poolStep: PoolStep) => {
      console.log("[APP] Executing pool step:", poolStep.tool_name, poolStep.arguments);
      setExecutingPoolStepId(poolStep.id);
      try {
        const result = await callTool(poolStep.tool_name, poolStep.arguments);
        console.log("[APP] Pool step result:", result);
      } catch (error) {
        console.error("[APP] Pool step execution failed:", error);
      } finally {
        setExecutingPoolStepId(null);
      }
    },
    [callTool]
  );

  // Drag-and-drop loading state
  const [dragOperationLoading, setDragOperationLoading] = useState<{
    type: "pool-to-workflow" | "workflow-to-pool" | "workflow-reorder";
    id: string;
  } | null>(null);

  // Drag-and-drop: Add pool step to workflow at specific position
  const handleAddPoolStepToWorkflow = useCallback(
    async (poolStepId: string, insertAtIndex: number) => {
      if (!currentWorkflow?.id) return;

      // CHECK PERMISSIONS BEFORE ALLOWING ADD
      if (!canEditWorkflow(currentWorkflow)) {
        console.error("🔒 [APP] Permission denied: cannot add step to read-only workflow");
        toast.error("Access Denied", {
          description: "You don't have permission to edit this workflow",
          duration: 5000,
        });
        return;
      }

      console.log("[APP] Adding pool step to workflow:", poolStepId, "at index:", insertAtIndex);
      setDragOperationLoading({ type: "pool-to-workflow", id: poolStepId });
      try {
        await addToWorkflow(currentWorkflow.id, [poolStepId], insertAtIndex);
        toast.success("Step added to workflow");
      } catch (error) {
        console.error("[APP] Failed to add pool step to workflow:", error);
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to add step to workflow", {
          description: errorMsg,
        });
      } finally {
        setDragOperationLoading(null);
      }
    },
    [currentWorkflow?.id, addToWorkflow, canEditWorkflow]
  );

  // Drag-and-drop: Copy workflow step to pool at specific position
  // NOTE: This used to delete from workflow (move), but YAML step operations were removed.
  // Now it just copies to pool.
  const handleAddWorkflowStepToPool = useCallback(
    async (
      step: { id?: string; name?: string; tool_name: string; arguments?: Record<string, unknown> },
      stepIndex: number,
      insertAtOrder?: number
    ) => {
      if (!currentWorkflow?.id || !currentWorkflow?.name) return;

      console.log("[APP] Copying workflow step to pool:", step, "at order:", insertAtOrder);
      const stepId = `workflow-step-${stepIndex}`;
      setDragOperationLoading({ type: "workflow-to-pool", id: stepId });
      try {
        // Add to pool (copy, not move)
        await addFromWorkflow(currentWorkflow.id, currentWorkflow.name, [step], insertAtOrder);
        toast.success("Step copied to pool");
      } catch (error) {
        console.error("[APP] Failed to copy workflow step to pool:", error);
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to copy step to pool", {
          description: errorMsg,
        });
      } finally {
        setDragOperationLoading(null);
      }
    },
    [currentWorkflow?.id, currentWorkflow?.name, addFromWorkflow]
  );

  // NOTE: handleReorderWorkflowStep was removed - YAML-only operation

  // Handle workflow tool results - using the one from useWorkflow
  // const handleToolExecutionResult = useCallback((result: any, success: boolean) => {
  //   console.log('🔧 Workflow tool result:', { result, success });
  // }, []);

  // Handle workflow interrupt (old code)
  const handleWorkflowInterrupt = useCallback(() => {
    console.log("🛑 Chat triggered workflow interrupt");
    interruptStep();
  }, [interruptStep]);

  // Update the refs whenever functions change
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Update startWorkflow ref
  useEffect(() => {
    startWorkflowRef.current = startWorkflow;
  }, [startWorkflow]);

  // Listen for workflow validation errors and show modal
  useEffect(() => {
    const handleValidationError = (event: Event) => {
      const customEvent = event as CustomEvent;
      const errorDetails = customEvent.detail;

      console.log("[APP] Workflow validation error:", errorDetails);

      setValidationError(errorDetails);
      setShowValidationErrorDialog(true);
    };

    window.addEventListener("workflow-validation-error", handleValidationError);

    return () => {
      window.removeEventListener("workflow-validation-error", handleValidationError);
    };
  }, []);

  // Listen for workflow execution errors (module errors, syntax errors, etc.) and show modal
  useEffect(() => {
    const handleExecutionError = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { errorData, workflowName, workflowId } = customEvent.detail;

      console.log("[APP] Workflow execution error:", errorData);

      // Parse and classify the error
      const parsedError = parseWorkflowExecutionError(errorData, workflowName, workflowId);
      if (parsedError) {
        setWorkflowExecutionError(parsedError);
        // Store raw errorData for AI troubleshooting
        setWorkflowExecutionErrorRaw({ errorData, workflowName, workflowId });
        setShowWorkflowExecutionErrorDialog(true);
      }
    };

    window.addEventListener("workflow-execution-error", handleExecutionError);

    return () => {
      window.removeEventListener("workflow-execution-error", handleExecutionError);
    };
  }, []);

  // Detect first recording completion for onboarding
  useEffect(() => {
    const steps = (currentWorkflow?.content?.arguments as any)?.steps;
    const hasSteps = currentWorkflow && steps && Array.isArray(steps) && steps.length > 0;
    const wasRecording = workflowState === "recording";
    const justStopped = !isRecording && hasSteps;

    // Trigger success modal when first recording is completed
    if (justStopped && hasSteps && !showSuccessModal) {
      const onboardingState = JSON.parse(
        localStorage.getItem("mediar_onboarding_state") || '{"hasCompletedFirstRecording":false}'
      );
      if (!onboardingState.hasCompletedFirstRecording) {
        console.log("🎉 [ONBOARDING] First recording detected! Showing success modal");
        completeFirstRecording();
      }
    }
  }, [isRecording, currentWorkflow, workflowState, showSuccessModal, completeFirstRecording]);

  // CLOUD PROCESSING DISABLED - local processing only
  // // Start progress polling when recording begins
  // useEffect(() => {
  //   console.log("[RECORDING_PROGRESS] isRecording changed:", isRecording);
  //   if (isRecording) {
  //     // Start polling when recording begins
  //     startProgressPolling();
  //   }
  //   // Note: Don't stop polling here - we keep polling until processing is complete
  // }, [isRecording, startProgressPolling]);

  // CLOUD PROCESSING DISABLED - local processing only
  // // Debug: Log polling state to diagnose 2-second re-renders
  // useEffect(() => {
  //   console.log(
  //     "[POLLING_DEBUG] isPollingProgress:",
  //     isPollingProgress,
  //     "isRecording:",
  //     isRecording,
  //     "isProcessingComplete:",
  //     isProcessingComplete
  //   );
  // }, [isPollingProgress, isRecording, isProcessingComplete]);

  // // Track whether we've triggered synthesis for current session
  // const synthesisTriggedRef = useRef(false);

  // // Reset synthesis trigger when recording starts
  // useEffect(() => {
  //   if (isRecording) {
  //     synthesisTriggedRef.current = false;
  //   }
  // }, [isRecording]);

  // // Auto-trigger synthesis when processing is complete
  // useEffect(() => {
  //   const userId = authStatus.user?.userId;

  //   // Only trigger if:
  //   // 1. Not recording anymore
  //   // 2. Processing is complete (pendingCount === 0)
  //   // 3. Not already synthesizing
  //   // 4. Haven't triggered synthesis for this session
  //   // 5. We have a userId
  //   if (!isRecording && isProcessingComplete && !isSynthesizing && !synthesisTriggedRef.current && userId) {
  //     console.log("[RECORDING_PROGRESS] Processing complete, auto-triggering synthesis...");
  //     synthesisTriggedRef.current = true;
  //     stopProgressPolling();

  //     // Trigger synthesis
  //     stopAndSynthesize(userId)
  //       .then(() => {
  //         console.log("[RECORDING_PROGRESS] Synthesis complete, reloading workflows...");
  //         // Reload workflows to show the newly synthesized workflow
  //         loadWorkflows?.();
  //       })
  //       .catch(err => {
  //         console.error("[RECORDING_PROGRESS] Synthesis failed:", err);
  //       });
  //   }
  // }, [
  //   isRecording,
  //   isProcessingComplete,
  //   isSynthesizing,
  //   authStatus.user?.userId,
  //   stopAndSynthesize,
  //   stopProgressPolling,
  //   loadWorkflows,
  // ]);

  // NOTE: useWorkflowSuggestions removed - YAML workflows deprecated, using default suggestions only

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input);
  };

  // Get placeholder text based on workflow state
  const getInputPlaceholder = () => {
    if (isLoading) {
      return "Type to interrupt AI and send new message...";
    }

    if (!isMcpAvailable()) {
      return "MCP server not available - check configuration";
    }

    return "Ask me anything about workflows and automation...";
  };

  // Get input styling based on workflow state
  const getInputStyling = () => {
    if (isLoading) {
      return "border-black focus:border-black focus:ring-black bg-white/5 backdrop-blur-md";
    }
    return "";
  };

  // Wrapper for input change that also handles notification hiding
  const handleInputChangeWithNotification = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(e);
    // Hide feedback notification when user starts typing
    if (showFeedbackNotification) {
      setShowFeedbackNotification(false);
    }
  };

  // Handle workflow step execution within chat
  // Update workflow execution message to show current state including loading states
  // Disabled - old implementation
  // useEffect(() => {
  //   if (currentWorkflow && currentStep >= 0 && currentWorkflow.content?.steps) {
  //     addWorkflowExecutionMessage({
  //       id: currentWorkflow.id,
  //       name: currentWorkflow.name,
  //       steps: currentWorkflow.content.steps
  //     }, currentStep);
  //   }
  // }, [currentWorkflow?.id, currentStep, stepResult, isExecuting, workflowState, addWorkflowExecutionMessage]);

  // Handle workflow action events from chat interface
  useEffect(() => {
    const handleWorkflowExecuteStep = () => {
      // console.log('📌 [APP] workflow-execute-step event received, calling executeStep()');
      executeStep();
    };

    const handleWorkflowStopExecution = () => {
      // Handle stop execution based on current state
      if (isExecuting) {
        interruptStep();
      } else if (isLoading) {
        stop(); // Stop AI response
        if (workflowState === "executing") {
          interruptStep(); // Also interrupt workflow step
        }
      }
    };

    const handleWorkflowRetryStep = () => {
      // Retry the current step by executing it again
      executeStep();
    };

    const handleWorkflowBackToList = async () => {
      setIsNavigatingBack(true);
      try {
        await backToList();
      } finally {
        setIsNavigatingBack(false);
      }
    };

    const handleWorkflowStart = (event: CustomEvent) => {
      const { workflowId } = event.detail;
      startWorkflow(workflowId);
    };

    window.addEventListener("workflow-execute-step", handleWorkflowExecuteStep);
    window.addEventListener("workflow-stop-execution", handleWorkflowStopExecution);
    window.addEventListener("workflow-retry-step", handleWorkflowRetryStep);
    window.addEventListener("workflow-back-to-list", handleWorkflowBackToList);
    window.addEventListener("workflow-start", handleWorkflowStart as EventListener);

    return () => {
      window.removeEventListener("workflow-execute-step", handleWorkflowExecuteStep);
      window.removeEventListener("workflow-stop-execution", handleWorkflowStopExecution);
      window.removeEventListener("workflow-retry-step", handleWorkflowRetryStep);
      window.removeEventListener("workflow-back-to-list", handleWorkflowBackToList);
      window.removeEventListener("workflow-start", handleWorkflowStart as EventListener);
    };
  }, [executeStep, backToList, startWorkflow, interruptStep, stop]);

  // Listen for Rust-level global Escape shortcut (always active, independent of frontend state)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen("workflow-stop-requested", () => {
        console.log("🛑 [App] Received workflow-stop-requested from Rust global shortcut");
        // Trigger the same stop logic as the frontend shortcut
        window.dispatchEvent(new CustomEvent("workflow-stop-execution"));
      });
    };

    setupListener();

    return () => {
      unlisten?.();
    };
  }, []);

  // Listen for "Ask AI to fix" events from the workflow linter
  useEffect(() => {
    const handleLintAskAI = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { prompt } = customEvent.detail || {};
      if (prompt) {
        console.log("[APP] Received lint ask-ai event, sending to chat");
        // Expand chat panel if collapsed
        chatPanelRef.current?.expand();
        // Set the prompt in the input and send it
        setInput(prompt);
        // Small delay to ensure input is set before sending
        setTimeout(() => {
          sendMessage(prompt);
        }, 100);
      }
    };

    // Listen at document level since event bubbles up from CodeMirror
    document.addEventListener("workflow-lint:ask-ai", handleLintAskAI);

    return () => {
      document.removeEventListener("workflow-lint:ask-ai", handleLintAskAI);
    };
  }, [setInput, sendMessage]);

  // Initialize workflows after MCP tools are ready
  const workflowsLoadedRef = useRef(false);
  const workflowRetryCount = useRef(0);
  const maxWorkflowRetries = 3;

  // Handler for reloading workflow after adding steps from pool
  const handleReloadWorkflow = useCallback(
    async (workflowId: number | string) => {
      console.log("[APP] Reloading workflow after step pool update:", workflowId);
      try {
        // Reload all workflows to get fresh data
        await loadWorkflows();

        // For the current workflow, we'll need to re-initialize it to get the updated content
        if (currentWorkflow?.id === workflowId) {
          console.log("[APP] Re-initializing current workflow to get updated content");
          // Re-initialize the workflow to load its updated content
          await initializeWorkflow(workflowId);
        }
      } catch (error) {
        console.error("[APP] Failed to reload workflow:", error);
        toast.error("Failed to reload workflow after adding steps");
      }
    },
    [loadWorkflows, currentWorkflow?.id, initializeWorkflow]
  );

  // NOTE: handleDeleteStep and handleDuplicateStep were removed - YAML-only operations

  // Function to load scheduled workflows
  const loadScheduledWorkflows = useCallback(async () => {
    try {
      const result = await invoke<ScheduledWorkflow[]>("get_scheduled_workflows");
      setScheduledWorkflows(result);
    } catch (error) {
      console.error("❌ [APP] Failed to load scheduled workflows:", error);
    }
  }, []);

  useEffect(() => {
    // Wait for MCP to be fully healthy (not just having tools) before loading workflows
    // isHealthy is only true after successful tool discovery and MCP initialization
    // Also ensure user is authenticated before loading workflows
    if (mcpState.isHealthy && authStatus.is_authenticated && !workflowsLoadedRef.current) {
      // console.log('🎯 [APP] MCP is healthy and user authenticated, loading workflows...');

      const initializeApp = async () => {
        try {
          workflowsLoadedRef.current = true;
          await loadWorkflows();
          await loadScheduledWorkflows(); // Also load scheduled workflows
          workflowRetryCount.current = 0; // Reset retry count on success
        } catch (error) {
          console.error("❌ [APP] Failed to load workflows:", error);
          workflowsLoadedRef.current = false; // Allow retry

          // Retry with exponential backoff if we haven't exceeded max retries
          if (workflowRetryCount.current < maxWorkflowRetries) {
            workflowRetryCount.current++;
            const retryDelay = Math.min(1000 * Math.pow(2, workflowRetryCount.current), 8000);
            // console.log(`🔄 [APP] Retrying workflow load in ${retryDelay}ms (attempt ${workflowRetryCount.current}/${maxWorkflowRetries})`);
            setTimeout(() => {
              if (mcpState.isHealthy && authStatus.is_authenticated && !workflowsLoadedRef.current) {
                initializeApp();
              }
            }, retryDelay);
          }
        }
      };
      initializeApp();
    }
  }, [mcpState.isHealthy, authStatus.is_authenticated, loadScheduledWorkflows]); // Depend on isHealthy and authentication status

  // Reset workflow state when user logs out
  useEffect(() => {
    if (!authStatus.is_authenticated && workflowsLoadedRef.current) {
      console.log("🔓 [APP] User logged out, clearing workflows");
      workflowsLoadedRef.current = false;
      // Workflow state will be managed by useWorkflow hook
    }
  }, [authStatus.is_authenticated]);

  // Update welcome message only when a workflow is opened (not on main page)
  // NOTE: YAML content removed - using default suggestions only
  useEffect(() => {
    if (currentWorkflow) {
      addWelcomeMessage(currentWorkflow.name, undefined, currentWorkflow.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkflow?.id]);

  // Auto-select first step when a workflow is opened
  useEffect(() => {
    if (currentWorkflow?.content?.steps?.length) {
      const firstStep = currentWorkflow.content.steps[0] as CommandStep;

      // TypeScript workflows use ts-step selection type
      if (currentWorkflow.localPath && firstStep.sourceFile) {
        setSidebarSelection({
          type: "ts-step",
          file: firstStep.sourceFile,
          index: 0,
          lineStart: firstStep.lineStart,
          lineEnd: firstStep.lineEnd,
        });
      } else {
        // YAML/cloud workflows use step selection type
        setSidebarSelection({ type: "step", index: 0 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkflow?.id]);

  // Debug MCP state
  useEffect(() => {}, [Object.keys(mcpState.tools).length, mcpState.serverInfo?.is_running, mcpState.error]);

  // Memoize the rendered messages list to prevent re-renders on input changes
  const renderedMessages = useMemo(() => {
    return messages
      .filter(message => message.role === "user" || message.role === "assistant")
      .map(message => {
        const toolCalls =
          message.toolInvocations?.map((inv: any) => ({
            name: inv.toolName,
            arguments: inv.args,
            status: inv.state,
            result: inv.result,
            error: inv.error?.message || inv.error,
            source: inv.source || "client",
            elapsedMs: inv.elapsedMs,
          })) ||
          message.toolCalls ||
          [];

        const isWaitingMessage = message.content === "Waiting for AI response...";
        const hasContent = message.content && message.content.trim() && !isWaitingMessage;

        // Separate server-side tools (executed before AI response) from client-side tools (executed after)
        const serverToolCalls = toolCalls.filter((tc: any) => tc.source === "server");
        const clientToolCalls = toolCalls.filter((tc: any) => tc.source !== "server");
        const hasServerToolCalls = serverToolCalls.length > 0;
        const hasClientToolCalls = clientToolCalls.length > 0;
        const hasToolCalls = toolCalls.length > 0;

        // Calculate context display for last completed tool (only if all tools complete)
        const allToolsComplete = toolCalls.every((tc: any) => tc.status === "completed" || tc.status === "result");
        const hasAnyError = toolCalls.some(
          (tc: any) => tc.status === "failed" || tc.status === "error" || tc.status === "executed_with_error"
        );
        const contextDisplayStr =
          contextMetrics && contextLimit && allToolsComplete && !hasAnyError
            ? `${contextMetrics.promptTokens.toLocaleString()}t (${((contextMetrics.promptTokens / contextLimit) * 100).toFixed(1)}%)`
            : undefined;

        // Check if this is a Claude Code message with parts array (interleaved rendering)
        const isClaudeCodeWithParts = message.source === "claude-code" && message.parts?.length > 0;

        return (
          <div key={message.id}>
            {/* Claude Code: Render parts in sequence (text and tools interleaved) */}
            {isClaudeCodeWithParts ? (
              <>
                {message.parts.map((part: any, partIdx: number) => {
                  if (part.type === "text" && part.content?.trim()) {
                    return (
                      <ChatMessageComponent
                        key={`${message.id}-part-${partIdx}`}
                        id={`${message.id}-part-${partIdx}`}
                        content={part.content}
                        role="assistant"
                        timestamp={message.timestamp}
                        isStreaming={message.isStreaming && partIdx === message.parts.length - 1}
                        onEdit={updateMessage}
                        onRegenerate={() => regenerateMessage(message.id)}
                        onFork={() => forkFromMessage(message.id)}
                      />
                    );
                  } else if (part.type === "tool" && part.invocation) {
                    const tc = {
                      name: part.invocation.toolName,
                      arguments: part.invocation.args,
                      status: part.invocation.state,
                      result: part.invocation.result,
                      error: part.invocation.error?.message || part.invocation.error,
                      source: part.invocation.source || "claude-code",
                      elapsedMs: part.invocation.elapsedMs,
                      kind: part.invocation.kind,
                      locations: part.invocation.locations,
                      content: part.invocation.content,
                    };
                    return (
                      <div
                        key={`${message.id}-part-${partIdx}`}
                        className="my-1 rounded border border-gray-200 overflow-hidden max-w-3xl mx-auto"
                      >
                        <ToolCallBlock
                          toolCall={tc}
                          contextDisplay={partIdx === message.parts.length - 1 ? contextDisplayStr : undefined}
                        />
                      </div>
                    );
                  }
                  return null;
                })}
              </>
            ) : (
              <>
                {/* 1. Render server-side tools FIRST (they execute before the AI sends the text response) */}
                {hasServerToolCalls && (
                  <div className="my-1 rounded border border-gray-200 overflow-hidden max-w-3xl mx-auto">
                    {serverToolCalls.map((tc: any, idx: number) => (
                      <ToolCallBlock
                        key={`${message.id}-server-tool-${idx}`}
                        toolCall={tc}
                        contextDisplay={
                          // Show context on last server tool only if no client tools
                          !hasClientToolCalls && idx === serverToolCalls.length - 1 ? contextDisplayStr : undefined
                        }
                      />
                    ))}
                  </div>
                )}
                {/* 2. Render text content (if any), or error messages (e.g., rate limit) */}
                {(hasContent || message.role === "user" || message.error) && (
                  <ChatMessageComponent
                    id={message.id}
                    content={message.content || ""}
                    role={message.role as "user" | "assistant"}
                    timestamp={message.timestamp}
                    isStreaming={isLoading && message.content === "" && !hasToolCalls}
                    images={message.images}
                    promptBreakdown={message.promptBreakdown}
                    promptTotalTokens={message.promptTotalTokens}
                    error={message.error}
                    onEdit={updateMessage}
                    onRegenerate={regenerateMessage}
                    onFork={forkFromMessage}
                  />
                )}
                {/* 3. Render client-side tools AFTER text (they execute after AI responds) */}
                {hasClientToolCalls && (
                  <div className="my-1 rounded border border-gray-200 overflow-hidden max-w-3xl mx-auto">
                    {clientToolCalls.map((tc: any, idx: number) => (
                      <ToolCallBlock
                        key={`${message.id}-client-tool-${idx}`}
                        toolCall={tc}
                        contextDisplay={
                          // Show context on last client tool
                          idx === clientToolCalls.length - 1 ? contextDisplayStr : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      });
  }, [messages, contextMetrics, contextLimit, isLoading, updateMessage, regenerateMessage, forkFromMessage]);

  // Auto-scroll to bottom when new messages arrive (only if user is near bottom)
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) {
      // Container not mounted yet, scroll anyway (initial load)
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isNearBottom = distanceFromBottom < 150;

    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Auto-scroll when workflow progress events occur
  useEffect(() => {
    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    window.addEventListener("workflow-progress", scrollToBottom);
    window.addEventListener("workflow-step-started", scrollToBottom);

    return () => {
      window.removeEventListener("workflow-progress", scrollToBottom);
      window.removeEventListener("workflow-step-started", scrollToBottom);
    };
  }, []);

  // Debug feedback notification state changes
  useEffect(() => {}, [showFeedbackNotification]);

  // Monitor window focus events for debugging
  useEffect(() => {
    const setupFocusMonitoring = async () => {
      try {
        const appWindow = getCurrentWindow();

        // Check initial maximize state
        const maximized = await appWindow.isMaximized();
        setIsMaximized(maximized);

        // Listen to focus changes
        const unlistenFocus = await appWindow.onFocusChanged(() => {
          // Focus change handler (no logging)
        });

        // Listen to window movements/changes
        const unlistenMoved = await appWindow.onMoved(() => {
          // Window move handler (no logging)
        });

        // Listen to window resize
        const unlistenResized = await appWindow.onResized(() => {
          // Window resize handler (no logging)
        });

        return () => {
          unlistenFocus();
          unlistenMoved();
          unlistenResized();
        };
      } catch (error) {
        // Silent fallback for focus monitoring setup
      }
    };

    const cleanup = setupFocusMonitoring();
    return () => {
      cleanup.then(fn => fn && fn());
    };
  }, []);

  // Monitor keyboard events for debugging input issues
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Allow text selection shortcuts in input fields
      const target = event.target as HTMLElement;
      const isInputField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isInputField && (event.ctrlKey || event.metaKey)) {
        // Allow Ctrl+A (select all), Ctrl+C (copy), Ctrl+V (paste), Ctrl+X (cut), etc.
        const key = event.key.toLowerCase();
        if (["a", "c", "v", "x", "z", "y"].includes(key)) {
          // Don't preventDefault - let the browser handle these
          return;
        }
      }

      // Add F12 handler to open DevTools
      if (event.key === "F12") {
        event.preventDefault();
        console.log("🔧 Opening DevTools...");
        invoke("open_devtools", { window: getCurrentWindow() }).catch(err => {
          console.error("Failed to open DevTools:", err);
        });
        return;
      }

      // Also handle Ctrl+Shift+I (Windows/Linux) or Cmd+Option+I (Mac)
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        console.log("🔧 Opening DevTools via keyboard shortcut...");
        invoke("open_devtools", { window: getCurrentWindow() }).catch(err => {
          console.error("Failed to open DevTools:", err);
        });
        return;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // Key up handling (logging disabled)
    };

    const handleInput = (event: Event) => {
      // Input event handling (logging disabled)
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("input", handleInput);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("input", handleInput);
    };
  }, [workflowState]);

  // Monitor document focus and visibility changes
  useEffect(() => {
    const handleDocumentFocus = () => {
      console.log("🎯 [DOCUMENT] Document gained focus");
      console.log("🎯 [DOCUMENT] Active element:", document.activeElement?.tagName);
    };

    const handleDocumentBlur = () => {
      console.log("🎯 [DOCUMENT] Document lost focus");
    };

    const handleVisibilityChange = () => {
      console.log("🎯 [DOCUMENT] Visibility changed:", document.visibilityState);
    };

    const handleWindowFocus = () => {
      // Window focus handler (no logging)
    };

    const handleWindowBlur = () => {
      // Window blur handler (no logging)
    };

    document.addEventListener("focus", handleDocumentFocus);
    document.addEventListener("blur", handleDocumentBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("focus", handleDocumentFocus);
      document.removeEventListener("blur", handleDocumentBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  // Persistent reference for registered shortcuts cleanup
  const registeredShortcutsRef = useRef<(() => void)[]>([]);

  // Add ref to track if recording toggle is in progress
  const isTogglingRecordingRef = useRef(false);

  // Global shortcuts management using frontend API
  useEffect(() => {
    let isMounted = true;
    let isSetupInProgress = false;

    const setupShortcuts = async () => {
      // Prevent multiple simultaneous setups
      if (isSetupInProgress) {
        return;
      }

      isSetupInProgress = true;

      try {
        const { register, unregister, unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");

        // More aggressive cleanup approach

        try {
          await unregisterAll();
        } catch (unregAllError) {
          // Silent cleanup
        }

        // Clear our tracking regardless of cleanup success
        registeredShortcutsRef.current = [];

        // Longer delay to ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 150));

        // Check if component is still mounted before proceeding
        if (!isMounted) {
          isSetupInProgress = false;
          return;
        }

        // Only setup shortcuts if enabled
        if (!shortcutsEnabled) {
          isSetupInProgress = false;
          return;
        }

        // Setup shortcuts based on current state

        // Recording workflow toggle - unified handler
        // Shift+Space for recording toggle
        try {
          await register("Shift+Space", () => {
            // Check MCP availability before attempting recording
            if (!isMcpAvailable()) {
              return;
            }

            // Prevent multiple simultaneous calls with debouncing
            if (isTogglingRecordingRef.current) {
              console.log("⏳ [RECORDING] Toggle already in progress, ignoring shortcut...");
              return;
            }

            isTogglingRecordingRef.current = true;

            // Use unified toggle - let MCP server handle state
            const workflowName = currentWorkflow?.name || "New Recording";
            const appendToExisting = !!currentWorkflow;

            // Call handleToggleRecording (with analytics tracking) and reset flag after completion
            handleToggleRecording(workflowName, appendToExisting).finally(() => {
              // Reset flag after a small delay to handle any trailing events
              setTimeout(() => {
                isTogglingRecordingRef.current = false;
              }, 500); // 500ms cooldown period
            });
          });
          registeredShortcutsRef.current.push(() => unregister("Shift+Space"));
        } catch (shortcutError) {
          // Already registered
        }

        // Check if we should register other shortcuts
        if (!currentWorkflow || (currentWorkflow && !isRecording && currentWorkflow.stepCount === 0)) {
          // If no workflow, also register digit keys for workflow selection
          if (!currentWorkflow) {
            // Register digit keys 1-9 for workflow selection
            const availableWorkflows = workflows.slice(0, 9); // First 9 workflows

            for (let i = 0; i < availableWorkflows.length; i++) {
              const workflowItem = availableWorkflows[i];
              const digit = (i + 1).toString();

              try {
                await register(digit, () => {
                  window.dispatchEvent(
                    new CustomEvent("workflow-start", {
                      detail: { workflowId: workflowItem.id },
                    })
                  );
                });
                registeredShortcutsRef.current.push(() => unregister(digit));
              } catch (regError) {
                // Already registered
              }
            }
          }
        }
        // STATE 1: Workflow ready to execute (has steps, not yet executing)
        // Register Tab when workflow has steps and is ready to execute first step
        else if (
          currentWorkflow &&
          workflowState === "idle" && // Workflow is idle
          !stepResult && // No step has been executed yet
          currentWorkflow.stepCount > 0 && // Has steps to execute
          !isExecuting
        ) {
          // Tab to execute first step
          try {
            await register("Tab", () => {
              // Track the Tab keyboard shortcut for single step execution
              if (currentWorkflow) {
                trackRunWorkflowButton(
                  String(currentWorkflow.id || "unknown"),
                  currentWorkflow.name || "Unnamed Workflow",
                  "keyboard_shortcut",
                  "single_step",
                  0, // First step
                  String(currentWorkflow.content?.steps[0]?.id || "0")
                );
              }
              window.dispatchEvent(new CustomEvent("workflow-execute-step"));
            });
            registeredShortcutsRef.current.push(() => unregister("Tab"));
          } catch (tabError) {
            // Already registered
          }
        }
        // STATE 2: During execution (stop execution)
        else if (isExecuting || isLoading) {
          // Space to stop execution (Escape is now handled by Rust-level global shortcut)
          try {
            await register("Space", () => {
              window.dispatchEvent(new CustomEvent("workflow-stop-execution"));
            });
            registeredShortcutsRef.current.push(() => unregister("Space"));
          } catch (spaceError) {
            // Already registered
          }
        }
        // STATE 3: Fallback (shouldn't reach here normally)
        else {
          // Fallback: If we have a workflow in idle state with steps, register Tab
          if (currentWorkflow && workflowState === "idle" && currentWorkflow.stepCount > 0) {
            try {
              await register("Tab", () => {
                // Track the Tab keyboard shortcut for single step execution
                trackRunWorkflowButton(
                  String(currentWorkflow.id || "unknown"),
                  currentWorkflow.name || "Unnamed Workflow",
                  "keyboard_shortcut",
                  "single_step",
                  0, // First step
                  String(currentWorkflow.content?.steps[0]?.id || "0")
                );
                window.dispatchEvent(new CustomEvent("workflow-execute-step"));
              });
              registeredShortcutsRef.current.push(() => unregister("Tab"));
            } catch (tabError) {
              // Already registered
            }
          }
        }
      } catch (error) {
        console.error("❌ Failed to register global shortcuts:", error);
      } finally {
        isSetupInProgress = false;
      }
    };

    const cleanupShortcuts = async () => {
      try {
        const { unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");

        try {
          await unregisterAll();
        } catch (unregAllError) {
          console.log("🔧 UnregisterAll cleanup note:", unregAllError);

          // Fallback to individual cleanup
          for (const unreg of registeredShortcutsRef.current) {
            try {
              await unreg();
            } catch (cleanupError) {
              console.log("🔧 Individual cleanup note:", cleanupError);
            }
          }
        }
        registeredShortcutsRef.current = [];
      } catch (error) {
        console.error("❌ Failed to unregister global shortcuts:", error);
      }
    };

    setupShortcuts();

    // Cleanup on unmount
    return () => {
      isMounted = false;
      cleanupShortcuts();
    };
  }, [
    currentWorkflow?.id,
    stepResult?.success,
    stepResult?.output,
    isExecuting,
    isLoading,
    workflows.length,
    workflowState,
    isRecording,
    isMcpAvailable(),
    shortcutsEnabled,
  ]);

  // Recording keyboard shortcut removed - using only global shortcut (backtick)

  // Check remote features to determine app mode and load compact view
  useEffect(() => {
    async function checkAppMode() {
      try {
        const mode = await getAppMode();
        setAppMode(mode);

        const chatUIEnabled = await shouldShowChatUI();
        setShowChatUI(chatUIEnabled);
      } catch (error) {
        console.warn("Failed to check app mode:", error);
        // Default to full UI on error
        setAppMode("full-ui");
        setShowChatUI(true);
      }
    }

    async function loadCompactViewState() {
      try {
        const settings = await invoke<{ compact_view: boolean }>("get_settings");
        if (settings.compact_view) {
          // Apply compact view classes on startup
          document.documentElement.classList.add("compact-view");
        }
      } catch (error) {
        console.warn("Failed to load compact view state:", error);
      }
    }

    async function loadShortcutsState() {
      try {
        const settings = await invoke<{ enable_shortcuts: boolean }>("get_settings");
        setShortcutsEnabled(settings.enable_shortcuts);
      } catch (error) {
        console.warn("Failed to load shortcuts state:", error);
      }
    }

    async function loadBackgroundModeState() {
      try {
        const settings = await invoke<{ background_transparent: boolean }>("get_settings");
        const shouldBeTransparent = settings.background_transparent ?? false;

        if (!shouldBeTransparent) {
          // Apply solid background class on startup
          document.documentElement.classList.add("solid-background");
        }
      } catch (error) {
        console.warn("Failed to load background mode state:", error);
      }
    }

    async function loadAppVersion() {
      try {
        const version = await invoke<string>("get_app_version");
        setAppVersion(version);
      } catch (error) {
        console.warn("Failed to load app version:", error);
      }
    }

    // Migration system for app updates
    async function runMigrations() {
      try {
        const storedVersion = localStorage.getItem("app_migration_version") || "0.0.0";

        // Migration 0.22.4: Reset settings to new defaults
        if (compareVersions(storedVersion, "0.22.4") < 0) {
          console.log("🔄 Running migration 0.22.4...");

          // Reset localStorage settings to new defaults
          localStorage.setItem("disable_app_minimization", "true");
          localStorage.setItem("disable_browser_script_logs", "true");
          localStorage.setItem("mediar-skip-preflight-check", "true");

          // Reset Rust settings
          await invoke("update_setting", { key: "enable_highlighting", value: true });

          // Resize window to new default size
          const appWindow = getCurrentWindow();
          await appWindow.setSize(new LogicalSize(1500, 1000));

          localStorage.setItem("app_migration_version", "0.22.4");
          console.log("✅ Migration 0.22.4 complete");
        }

        // Migration 0.23.0: Reset window size to 1500x1000
        if (compareVersions(storedVersion, "0.23.0") < 0) {
          console.log("🔄 Running migration 0.23.0...");

          const appWindow = getCurrentWindow();
          await appWindow.setSize(new LogicalSize(1500, 1000));

          localStorage.setItem("app_migration_version", "0.23.0");
          console.log("✅ Migration 0.23.0 complete");
        }

        // Migration 1.0.5: Reduce default window size to 1280x800 for smaller screens
        if (compareVersions(storedVersion, "1.0.5") < 0) {
          console.log("🔄 Running migration 1.0.5 - resize window to 1280x800...");

          const appWindow = getCurrentWindow();
          await appWindow.setSize(new LogicalSize(1280, 800));

          localStorage.setItem("app_migration_version", "1.0.5");
          console.log("✅ Migration 1.0.5 complete");
        }
      } catch (error) {
        console.warn("Failed to run migrations:", error);
      }
    }

    // Helper to compare semver versions (returns -1, 0, or 1)
    function compareVersions(v1: string, v2: string): number {
      const parts1 = v1.split(".").map(Number);
      const parts2 = v2.split(".").map(Number);
      for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
      }
      return 0;
    }

    checkAppMode();
    loadCompactViewState();
    loadShortcutsState();
    loadBackgroundModeState();
    loadAppVersion();
    runMigrations();
  }, []);

  // Listen for settings changes to update shortcuts state
  useEffect(() => {
    const handleSettingsChange = async () => {
      try {
        const settings = await invoke<{ enable_shortcuts: boolean }>("get_settings");
        setShortcutsEnabled(settings.enable_shortcuts);
        console.log("⌨️ Shortcuts updated:", settings.enable_shortcuts);
      } catch (error) {
        console.warn("Failed to reload shortcuts state:", error);
      }
    };

    // Listen for custom event when settings change (if we add it)
    window.addEventListener("settings-changed", handleSettingsChange);

    return () => {
      window.removeEventListener("settings-changed", handleSettingsChange);
    };
  }, []);

  // Handle new chat
  const handleNewChat = () => {
    trackNewChatStarted();

    // Stop any ongoing chat execution first
    stop();

    // Dismiss any pending elicitation (ask_user)
    closeElicitation();

    // Reset workflow execution state (keep the workflow selected, just reset execution)
    if (workflowState !== "idle") {
      resetWorkflowExecutionState();
    }

    reload();
    // Re-add welcome message only if a workflow is open
    // NOTE: YAML content removed - using default suggestions only
    setTimeout(() => {
      if (currentWorkflow) {
        addWelcomeMessage(currentWorkflow.name, undefined, currentWorkflow.id);
      }
    }, 100);
  };

  // Wrapped toggleRecording with analytics tracking
  const handleToggleRecording = async (workflowName?: string, appendToExisting?: boolean) => {
    // Store the recording state BEFORE toggling to determine what action will be taken
    // Use isRecording which is derived from workflowState in useWorkflow
    const wasRecording = isRecording;

    console.log("🎬 [APP] handleToggleRecording called, wasRecording:", wasRecording, "workflowState:", workflowState);

    // If starting recording, show mode selection dialog first
    if (!wasRecording) {
      console.log("🎬 [APP] Starting recording - showing mode selection dialog");
      setPendingRecordingParams({ workflowName, appendToExisting });
      setShowRecordingModeDialog(true);
      return null; // Don't start recording yet, wait for user to select mode and target app
    }

    // If stopping recording, proceed normally
    const result = await toggleRecording(workflowName, appendToExisting);

    console.log(
      "🎬 [APP] toggleRecording completed, result:",
      result ? "workflow data returned (stopped)" : "null (started or no-op)"
    );

    // Track analytics - we're stopping
    console.log("📊 [Analytics] Tracking recording stopped");
    trackRecordingStopped();

    // Clear target app state when stopping
    setTargetApp(null);

    return result;
  };

  // Handler for when user selects recording mode
  const handleRecordingModeSelected = async (mode: RecordingMode) => {
    console.log("🎬 [APP] Recording mode selected:", mode);
    setSelectedRecordingMode(mode);
    setShowRecordingModeDialog(false);

    if (mode === "continuous") {
      // Continuous mode: start recording immediately, no target app needed
      try {
        const isStepByStep = false;
        console.log("🎬 [APP] Setting recording mode: continuous, step_by_step:", isStepByStep);
        await invoke("set_recording_mode", { stepByStep: isStepByStep });

        const params = pendingRecordingParams;
        setPendingRecordingParams(null);

        await toggleRecording(params?.workflowName, params?.appendToExisting);
        console.log("📊 [Analytics] Tracking recording started (continuous)");
        trackRecordingStarted("manual");
      } catch (error) {
        console.error("❌ [APP] Failed to start continuous recording:", error);
        toast.error("Failed to start recording");
      }
    } else {
      // Step-by-step mode: show target app selection dialog
      setShowTargetAppDialog(true);
    }
  };

  // Handler for closing recording mode dialog
  const handleRecordingModeDialogClose = () => {
    setShowRecordingModeDialog(false);
    setPendingRecordingParams(null);
  };

  // Handler for when user confirms recording start (tree already captured in dialog)
  const handleTargetAppSelected = async (app: ApplicationInfo) => {
    console.log("🎯 [APP] Starting recording with target app:", app, "mode:", selectedRecordingMode);
    setTargetApp(app);
    setShowTargetAppDialog(false);

    try {
      // Set recording mode before starting
      const isStepByStep = selectedRecordingMode === "step-by-step";
      console.log("🎬 [APP] Setting recording mode:", selectedRecordingMode, "step_by_step:", isStepByStep);
      await invoke("set_recording_mode", { stepByStep: isStepByStep });

      // Tree is already captured in the dialog, just start recording
      const params = pendingRecordingParams;
      setPendingRecordingParams(null);

      await toggleRecording(params?.workflowName, params?.appendToExisting);
      console.log("📊 [Analytics] Tracking recording started");
      trackRecordingStarted("manual");
    } catch (error) {
      console.error("❌ [APP] Failed to start recording:", error);
      toast.error("Failed to start recording");
      setTargetApp(null);
    }
  };

  // Handler for closing target app dialog without starting
  const handleTargetAppDialogClose = () => {
    setShowTargetAppDialog(false);
    setPendingRecordingParams(null);
  };

  // Handler for wrong app dialog - restart recording
  const handleWrongAppRestart = () => {
    setShowWrongAppDialog(false);
    setWrongAppInfo(null);
    // Show target app selection again
    setShowTargetAppDialog(true);
  };

  // Handler for wrong app dialog - cancel recording
  const handleWrongAppCancel = async () => {
    setShowWrongAppDialog(false);
    setWrongAppInfo(null);
    setTargetApp(null);
    // Stop the recording
    try {
      await stopRecording(false);
      trackRecordingStopped();
    } catch (error) {
      console.error("❌ [APP] Failed to stop recording after wrong app:", error);
    }
  };

  // Dedicated stop recording handler for recording bar
  // This delegates to the proper stopRecording function from useWorkflow
  // NOTE: We dont check isRecording here - the backend is the source of truth.
  // Frontend state can become stale (e.g., if component re-mounts), but the backend
  // recorder keeps running. Calling stop is idempotent - backend handles not recording gracefully.
  const handleStopRecordingFromBar = useCallback(async () => {
    console.log("🛑 [APP] Stop recording triggered from recording bar");

    try {
      // Use the proper stopRecording function from useWorkflow
      // Pass true to indicate this was initiated from the recording bar
      console.log("🔄 [APP] Calling stopRecording with fromRecordingBar=true...");
      const result = await stopRecording(true);
      console.log("📊 [APP] Stop recording result:", result);

      // Track analytics
      trackRecordingStopped();

      if (result) {
        if (result.steps && result.steps.length > 0) {
          console.log("📁 [RECORDING] Recording stopped successfully with", result.steps.length, "steps");
        } else if (result.message) {
          console.log("📁 [RECORDING] Recording stopped:", result.message);
        } else {
          console.log("📁 [RECORDING] Recording stopped (no actionable events captured)");
        }
      } else {
        console.log("📁 [RECORDING] Recording stopped");
      }

      // NOTE: No need to call loadWorkflows() here - stopRecording → saveRecordedWorkflow already does it
      // Removing this duplicate call to prevent race conditions
    } catch (error) {
      console.error("❌ Failed to stop recording from bar:", error);
    }
  }, [stopRecording]); // Only stopRecording needed - we don't check isRecording anymore

  // Store handler in ref to prevent listener re-registration
  const handleStopRecordingFromBarRef = useRef(handleStopRecordingFromBar);
  useEffect(() => {
    handleStopRecordingFromBarRef.current = handleStopRecordingFromBar;
  }, [handleStopRecordingFromBar]);

  // Listen for Tauri events from recording bar
  // CRITICAL FIX: Properly handle async cleanup to prevent duplicate listeners in React.StrictMode
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isMounted = true; // Track if effect is still mounted
    const processedEventIds = new Set<string>();
    let isProcessing = false;

    const setupTauriListener = async () => {
      try {
        const unlistenFn = await listen("stop-recording-from-bar", async event => {
          console.log("📡 [APP] Received stop-recording-from-bar event:", event);

          // Extract eventId from payload for deduplication
          const payload = event.payload as { eventId?: string; action: string };
          const eventId = payload.eventId || event.id.toString();

          // Deduplicate events by ID
          if (processedEventIds.has(eventId)) {
            console.log("⏭️ [APP] Skipping duplicate event ID:", eventId);
            return;
          }

          // Prevent concurrent processing
          if (isProcessing) {
            console.log("⏳ [APP] Already processing stop request, ignoring duplicate");
            return;
          }

          // Mark this event as processed
          processedEventIds.add(eventId);
          isProcessing = true;

          try {
            // Call the latest handler via ref to avoid stale closures
            await handleStopRecordingFromBarRef.current();
          } finally {
            isProcessing = false;
            // Clean up old event IDs after 5 seconds to prevent memory leak
            setTimeout(() => {
              processedEventIds.delete(eventId);
            }, 5000);
          }
        });

        // If effect was unmounted while we were setting up, cleanup immediately
        if (!isMounted) {
          console.log("🔇 [APP] Effect unmounted during setup, cleaning up immediately");
          unlistenFn();
          return;
        }

        // Still mounted, save the unlisten function
        unlisten = unlistenFn;
        console.log("👂 [APP] Recording bar event listener registered");
      } catch (err) {
        console.error("❌ [APP] Failed to setup Tauri listener:", err);
      }
    };

    setupTauriListener();

    // Cleanup function
    return () => {
      console.log("🔇 [APP] Cleaning up recording bar listener");
      isMounted = false; // Mark as unmounted first
      if (unlisten) {
        unlisten();
      }
    };
  }, []); // Empty deps - only run once, properly cleanup with isMounted flag

  // Listen for step-by-step recording events (action-review-response and resume-recording-from-bar)
  useEffect(() => {
    let unlistenActionReview: (() => void) | null = null;
    let unlistenResume: (() => void) | null = null;
    let isMounted = true;
    const actionCountRef = { current: 0 };

    const setupStepByStepListeners = async () => {
      try {
        // Listen for action review responses
        interface ActionReviewResponse {
          action: string;
          rawEvent?: Record<string, unknown> | null; // Raw event for TypeScript generation
        }
        const unlistenActionReviewFn = await listen<ActionReviewResponse>("action-review-response", async event => {
          console.log("📡 [APP] Received action-review-response:", event.payload);

          const { action, rawEvent } = event.payload;

          // Hide action review window
          await invoke("hide_action_review");

          if (action === "save-continue") {
            // Save approved raw event to Rust state for TypeScript generation
            if (rawEvent) {
              console.log("[ts_gen] Saving approved raw event:", Object.keys(rawEvent));
              await invoke("save_step_by_step_action", { rawEvent });
            }

            // Save action and continue recording
            actionCountRef.current += 1;
            console.log("✅ [APP] Action saved, continuing recording. Count:", actionCountRef.current);

            // Update recording bar with action count
            await emit("recording-bar-action-count", { count: actionCountRef.current });

            // Resume recording
            await invoke("resume_step_recording");
          } else if (action === "save-stop") {
            // Save approved raw event to Rust state for TypeScript generation
            if (rawEvent) {
              console.log("[ts_gen] Saving approved raw event:", Object.keys(rawEvent));
              await invoke("save_step_by_step_action", { rawEvent });
            }

            // Save action and stop recording
            actionCountRef.current += 1;
            console.log("✅ [APP] Action saved, stopping recording. Count:", actionCountRef.current);

            // Update action count one last time
            await emit("recording-bar-action-count", { count: actionCountRef.current });

            // Stop recording via the existing handler
            if (handleStopRecordingFromBarRef.current) {
              await handleStopRecordingFromBarRef.current();
            }
          } else if (action === "discard-pause") {
            // Discard action, stay paused
            console.log("❌ [APP] Action discarded, staying paused");
            // Recording stays paused - user must click Resume in recording bar
          } else if (action === "discard-continue") {
            // Discard action, but continue recording
            console.log("❌ [APP] Action discarded, resuming recording");
            // Resume recording automatically
            await invoke("resume_step_recording");
          }
        });

        // Listen for resume recording from bar
        const unlistenResumeFn = await listen("resume-recording-from-bar", async () => {
          console.log("▶️ [APP] Received resume-recording-from-bar");
          await invoke("resume_step_recording");
        });

        if (!isMounted) {
          unlistenActionReviewFn();
          unlistenResumeFn();
          return;
        }

        unlistenActionReview = unlistenActionReviewFn;
        unlistenResume = unlistenResumeFn;
        console.log("👂 [APP] Step-by-step recording listeners registered");
      } catch (err) {
        console.error("❌ [APP] Failed to setup step-by-step listeners:", err);
      }
    };

    setupStepByStepListeners();

    return () => {
      console.log("🔇 [APP] Cleaning up step-by-step recording listeners");
      isMounted = false;
      if (unlistenActionReview) unlistenActionReview();
      if (unlistenResume) unlistenResume();
    };
  }, []);

  // Listen for wrong-app-detected event during step-by-step recording
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupWrongAppListener = async () => {
      interface WrongAppEvent {
        target_app_name: string;
        actual_app_name: string;
        target_pid: number;
        actual_pid: number;
      }

      const unlistenFn = await listen<WrongAppEvent>("wrong-app-detected", async event => {
        console.log("⚠️ [APP] Wrong app detected:", event.payload);

        // Hide recording bar and action review
        await invoke("hide_action_review").catch(() => {});

        // Show wrong app dialog
        setWrongAppInfo({
          targetAppName: event.payload.target_app_name,
          actualAppName: event.payload.actual_app_name,
        });
        setShowWrongAppDialog(true);
      });

      unlisten = unlistenFn;
      console.log("👂 [APP] Wrong app detection listener registered");
    };

    setupWrongAppListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for update events from Rust backend
  useEffect(() => {
    const setupUpdateListeners = async () => {
      // Listen for update available event
      const unlistenAvailable = await listen<UpdateInfo>("update-available", async event => {
        console.log("[UPDATE] update-available event received:", event.payload.version);

        // Check if update should be shown (respects skipped versions and remind-later)
        try {
          const shouldShow = await invoke<boolean>("should_show_update", { version: event.payload.version });
          console.log("[UPDATE] should_show_update returned:", shouldShow);

          if (!shouldShow) {
            console.log("[UPDATE] Update hidden (skipped or remind-later active)");
            return;
          }
        } catch (error) {
          console.error("[UPDATE] Failed to check should_show_update:", error);
          // Continue showing if check fails
        }

        setUpdateInfo(event.payload);
        // Show modal only when user is in main menu (no current workflow)
        if (!currentWorkflow) {
          setShowUpdateModal(true);
        }
      });

      // Listen for download progress
      const unlistenProgress = await listen<number>("update-download-progress", event => {
        setUpdateDownloadProgress(event.payload);
      });

      // Listen for download started
      const unlistenStarted = await listen("update-download-started", () => {
        setIsDownloadingUpdate(true);
      });

      // Listen for download complete
      const unlistenComplete = await listen("update-download-complete", () => {
        setIsDownloadingUpdate(false);
        setIsUpdateReadyToInstall(true);
      });

      // Listen for download error
      const unlistenError = await listen<string>("update-download-error", event => {
        console.error("❌ Update download error:", event.payload);
        setIsDownloadingUpdate(false);
        toast.error("Update download failed: " + event.payload);
      });

      return () => {
        unlistenAvailable();
        unlistenProgress();
        unlistenStarted();
        unlistenComplete();
        unlistenError();
      };
    };

    setupUpdateListeners().catch(console.error);
  }, [currentWorkflow]);

  // Show update modal when user returns to main menu (if update is pending)
  useEffect(() => {
    const checkAndShowUpdate = async () => {
      if (!currentWorkflow && updateInfo && !showUpdateModal && !isUpdateReadyToInstall) {
        // Double-check with backend if update should be shown
        try {
          const shouldShow = await invoke<boolean>("should_show_update", { version: updateInfo.version });
          console.log("[UPDATE] useEffect check: shouldShow =", shouldShow, "for version", updateInfo.version);
          if (shouldShow) {
            setShowUpdateModal(true);
          }
        } catch (error) {
          console.error("[UPDATE] useEffect: Failed to check should_show_update:", error);
          // Show anyway if check fails
          setShowUpdateModal(true);
        }
      }
    };
    checkAndShowUpdate();
  }, [currentWorkflow, updateInfo, showUpdateModal, isUpdateReadyToInstall]);

  // Listen for Tauri events from AI thinking bar
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const processedEventIds = new Set<string>();
    let isProcessing = false;

    const setupAiThinkingBarListener = async () => {
      unlisten = await listen("stop-ai-from-bar", async event => {
        console.log("📡 [APP] Received stop-ai-from-bar event:", event);

        const payload = event.payload as { eventId?: string; action: string };
        const eventId = payload.eventId || event.id.toString();

        // Deduplicate events by ID
        if (processedEventIds.has(eventId)) {
          console.log("⏭️ [APP] Skipping duplicate AI stop event ID:", eventId);
          return;
        }

        // Prevent concurrent processing
        if (isProcessing) {
          console.log("⏳ [APP] Already processing AI stop, ignoring duplicate");
          return;
        }

        // Mark this event as processed
        processedEventIds.add(eventId);
        isProcessing = true;

        try {
          console.log("🛑 [APP] Stopping AI from thinking bar");
          stop(); // Call the stop function from useChat
        } finally {
          isProcessing = false;
          setTimeout(() => {
            processedEventIds.delete(eventId);
          }, 5000);
        }
      });
    };

    setupAiThinkingBarListener().catch(err => {
      console.error("❌ [APP] Failed to setup AI thinking bar listener:", err);
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [stop]);

  // Listen for Tauri events from execution bar
  useEffect(() => {
    let unlistenStop: (() => void) | null = null;
    let unlistenPause: (() => void) | null = null;
    const processedEventIds = new Set<string>();
    let isProcessing = false;

    const setupExecutionBarListeners = async () => {
      // Listen for stop execution events
      unlistenStop = await listen("stop-execution-from-bar", async event => {
        console.log("📡 [APP] Received stop-execution-from-bar event:", event);

        const payload = event.payload as { eventId?: string; action: string };
        const eventId = payload.eventId || event.id.toString();

        // Deduplicate events by ID
        if (processedEventIds.has(eventId)) {
          console.log("⏭️ [APP] Skipping duplicate stop event ID:", eventId);
          return;
        }

        // Prevent concurrent processing
        if (isProcessing) {
          console.log("⏳ [APP] Already processing execution action, ignoring duplicate");
          return;
        }

        // Mark this event as processed
        processedEventIds.add(eventId);
        isProcessing = true;

        try {
          console.log("🛑 [APP] Stopping execution from execution bar");
          interruptStep();
        } finally {
          isProcessing = false;
          setTimeout(() => {
            processedEventIds.delete(eventId);
          }, 5000);
        }
      });

      // Listen for pause execution events
      unlistenPause = await listen("pause-execution-from-bar", async event => {
        console.log("📡 [APP] Received pause-execution-from-bar event:", event);

        const payload = event.payload as { eventId?: string; action: string };
        const eventId = payload.eventId || event.id.toString();

        // Deduplicate events by ID
        if (processedEventIds.has(eventId)) {
          console.log("⏭️ [APP] Skipping duplicate pause event ID:", eventId);
          return;
        }

        // Prevent concurrent processing
        if (isProcessing) {
          console.log("⏳ [APP] Already processing execution action, ignoring duplicate");
          return;
        }

        // Mark this event as processed
        processedEventIds.add(eventId);
        isProcessing = true;

        try {
          console.log("⏸️ [APP] Pausing execution from execution bar");
          interruptStep(); // For now, pause = interrupt. Can be enhanced later
        } finally {
          isProcessing = false;
          setTimeout(() => {
            processedEventIds.delete(eventId);
          }, 5000);
        }
      });
    };

    setupExecutionBarListeners().catch(err => {
      console.error("❌ [APP] Failed to setup execution bar listeners:", err);
    });

    return () => {
      if (unlistenStop) {
        unlistenStop();
      }
      if (unlistenPause) {
        unlistenPause();
      }
    };
  }, [interruptStep]); // Only depend on handleStopRecordingFromBar

  // Wrapped startWorkflow with analytics tracking
  const handleStartWorkflow = async (workflowId: string | null, freshWorkflows?: Workflow[]) => {
    // Use freshWorkflows if provided (e.g., after download), otherwise use current state
    const workflowsToSearch = freshWorkflows || workflows;
    const workflow = workflowsToSearch.find(w => w.id === workflowId);
    if (workflow && workflowId !== null) {
      trackWorkflowOpened(String(workflowId), workflow.name);
      trackWorkflowStarted(String(workflowId), workflow.name, "manual");
    }
    return startWorkflow(workflowId, freshWorkflows);
  };

  // Clone workflow and return to list
  const handleCloneWorkflow = async (workflowId: string | null) => {
    const result = await cloneWorkflow(workflowId);
    if (result.success && result.newWorkflowId) {
      console.log("✅ [APP] Cloned workflow with new ID:", result.newWorkflowId);
      // Return to workflow list to see the cloned workflow
      backToList();
      toast.success("Workflow cloned successfully");
    } else {
      console.error("❌ [APP] Failed to clone workflow:", result.error);
      toast.error(`Failed to clone workflow: ${result.error}`);
    }
  };

  // Set workflow visibility (public/private)
  const handleSetWorkflowVisibility = async (
    workflowId: string | number,
    isPublic: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Pass workflow ID as string (supports both numeric IDs and UUIDs)
      const workflowIdStr = String(workflowId);
      if (!workflowIdStr) {
        return { success: false, error: "Invalid workflow ID" };
      }

      console.log(`🌐 [APP] Setting workflow ${workflowIdStr} visibility to ${isPublic ? "public" : "private"}`);
      const result = await invoke<boolean>("set_workflow_visibility", {
        workflowId: workflowIdStr,
        isPublic,
      });

      // Update local state to reflect the change
      if (currentWorkflow && currentWorkflow.id === workflowIdStr) {
        // The workflow hook should handle the state update when we reload
        await loadWorkflows();
      }

      toast.success(`Workflow is now ${result ? "public" : "private"}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("❌ [APP] Failed to set visibility:", errorMessage);
      toast.error(`Failed to change visibility: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  };

  // Download cloud-only TypeScript workflow to local (using UUID-based zip download)
  // After download, auto-opens the workflow for better UX
  const handleDownloadCloudWorkflow = async (workflowUuid: string) => {
    console.log("☁️ [APP] Downloading cloud workflow (ZIP):", workflowUuid);
    setDownloadingWorkflowId(workflowUuid);
    try {
      const result = await invoke<{ success: boolean; workflow_id: string; name: string; path: string }>(
        "download_cloud_workflow",
        { workflowUuid }
      );
      console.log("[APP] Download complete, auto-opening workflow:", result.workflow_id);

      // Refresh workflow list and get the fresh list
      const freshWorkflows = await loadWorkflows();

      // Find the downloaded workflow and auto-open it
      const downloadedWorkflow = freshWorkflows.find(
        w => w.id === result.workflow_id || w.uuid === result.workflow_id || w.cloudId === result.workflow_id
      );

      if (downloadedWorkflow) {
        toast.success(`Downloaded "${result.name}" - opening now`);
        // Auto-open the workflow - pass freshWorkflows to avoid stale closure issue
        handleStartWorkflow(downloadedWorkflow.id, freshWorkflows);
      } else {
        // Fallback: just show success toast if workflow not found (shouldn't happen)
        toast.success(`Downloaded "${result.name}"`);
        console.warn("[APP] Downloaded workflow not found in list, skipping auto-open");
      }
    } catch (error) {
      console.error("❌ [APP] Failed to download workflow:", error);
      toast.error(`Failed to download workflow: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDownloadingWorkflowId(null);
    }
  };

  // Pull latest version of an existing local TypeScript workflow from cloud
  const handlePullWorkflow = async (workflowId: string) => {
    console.log("⬇️ [APP] Pulling workflow update:", workflowId);
    setPullingWorkflowId(workflowId);
    try {
      await invoke("pull_typescript_workflow", { workflowId });
      toast.success("Workflow updated successfully");
      await loadWorkflows();
    } catch (error) {
      console.error("❌ [APP] Failed to pull workflow:", error);
      toast.error(`Failed to update: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPullingWorkflowId(null);
    }
  };

  // Delete workflow from main page
  const handleDeleteWorkflow = async (workflowId: string) => {
    console.log("🗑️ [APP] Deleting workflow:", workflowId);
    setDeletingWorkflowId(workflowId);
    try {
      const result = await deleteWorkflow(workflowId);
      if (result.success) {
        toast.success("Workflow deleted");
      } else {
        toast.error(`Failed to delete: ${result.error}`);
      }
    } catch (error) {
      console.error("❌ [APP] Failed to delete workflow:", error);
      toast.error(`Failed to delete: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeletingWorkflowId(null);
    }
  };

  // Request autoclone confirmation - shows dialog and returns promise
  // Used when AI tries to edit a read-only public workflow
  const requestAutocloneConfirmation = useCallback((workflowId: string, workflowName: string): Promise<boolean> => {
    return new Promise(resolve => {
      setAutocloneDialog({
        isOpen: true,
        workflowId,
        workflowName,
        resolve,
      });
    });
  }, []);

  // Keep ref updated for useChat to call
  useEffect(() => {
    requestAutocloneConfirmationRef.current = requestAutocloneConfirmation;
  }, [requestAutocloneConfirmation]);

  // Handle autoclone dialog confirm
  const handleAutocloneConfirm = async () => {
    if (!autocloneDialog.workflowId || !autocloneDialog.resolve) return;

    setIsAutocloning(true);
    try {
      const result = await cloneWorkflow(autocloneDialog.workflowId);
      if (result.success && result.newWorkflowId) {
        console.log("✅ [APP] Autocloned workflow with new ID:", result.newWorkflowId);
        // Return to workflow list to see the cloned workflow
        backToList();
        toast.success("Workflow cloned - you can now edit your copy");
        autocloneDialog.resolve(true);
      } else {
        console.error("❌ [APP] Failed to autoclone workflow:", result.error);
        toast.error(`Failed to clone workflow: ${result.error}`);
        autocloneDialog.resolve(false);
      }
    } finally {
      setIsAutocloning(false);
      setAutocloneDialog({ isOpen: false, workflowId: null, workflowName: "", resolve: null });
    }
  };

  // Handle autoclone dialog cancel
  const handleAutocloneCancel = () => {
    if (autocloneDialog.resolve) {
      autocloneDialog.resolve(false);
    }
    setAutocloneDialog({ isOpen: false, workflowId: null, workflowName: "", resolve: null });
  };

  // Window control functions
  const handleMinimize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (error) {}
  };

  const handleMaximize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setIsMaximized(!isMaximized);
    } catch (error) {
      console.error("Maximize failed:", error);
    }
  };

  const handleClose = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch (error) {}
  };

  // Update modal handlers
  const handleDownloadUpdate = async () => {
    try {
      console.log("⬇️ Downloading update...");
      await invoke("download_update");
    } catch (error) {
      console.error("❌ Failed to download update:", error);
      toast.error("Failed to download update");
    }
  };

  const handleRemindLaterUpdate = async () => {
    console.log("[UPDATE] handleRemindLaterUpdate called");
    try {
      await invoke("set_update_remind_later");
      console.log("[UPDATE] set_update_remind_later succeeded - hiding for 1 hour");
    } catch (error) {
      console.error("[UPDATE] Failed to set remind later:", error);
    }
    setShowUpdateModal(false);
    setUpdateInfo(null); // Clear updateInfo so useEffect won't reopen modal
  };

  const handleSkipUpdate = async () => {
    if (updateInfo) {
      try {
        console.log("[UPDATE] handleSkipUpdate called for version:", updateInfo.version);
        await invoke("skip_update_version", { version: updateInfo.version });
        console.log("[UPDATE] skip_update_version succeeded - version permanently skipped");
        setShowUpdateModal(false);
        setUpdateInfo(null);
      } catch (error) {
        console.error("[UPDATE] Failed to skip update:", error);
      }
    }
  };

  const handleInstallAndRestart = async () => {
    try {
      console.log("🔄 Installing update and restarting...");
      await invoke("install_update_and_restart");
      // App will restart automatically
    } catch (error) {
      console.error("❌ Failed to install update:", error);
      toast.error("Failed to install update");
    }
  };

  // Listen for workflow events

  // Find onboarding workflow in user's list (local or cloud)
  // Check by id (folder name), uuid (cloud), or cloudId (synced local)
  const onboardingWorkflow = useMemo(() => {
    const found = workflows.find(
      w =>
        w.id === ONBOARDING_WORKFLOW_UUID ||
        w.uuid === ONBOARDING_WORKFLOW_UUID ||
        w.cloudId === ONBOARDING_WORKFLOW_UUID
    );
    console.log("[App] Looking for onboarding workflow:", ONBOARDING_WORKFLOW_UUID);
    console.log(
      "[App] Found:",
      !!found,
      "id:",
      found?.id,
      "uuid:",
      found?.uuid,
      "cloudId:",
      found?.cloudId,
      "localPath:",
      found?.localPath
    );
    // Debug: log first 3 local workflows
    const localWfs = workflows.filter(w => w.localPath).slice(0, 3);
    console.log(
      "[App] Sample local workflows:",
      localWfs.map(w => ({ name: w.name, id: w.id, uuid: w.uuid, cloudId: w.cloudId }))
    );
    return found;
  }, [workflows]);

  // Auto-skip step 3 (download) if workflow is already installed locally
  useEffect(() => {
    if (tutorialStep === 3 && onboardingWorkflow?.localPath) {
      console.log("[App] Onboarding workflow already installed locally, skipping download step");
      advanceTutorial();
    }
  }, [tutorialStep, onboardingWorkflow, advanceTutorial]);

  // Ensure workflow panel is visible when tutorial starts (step 1)
  // On homepage, we have mutually exclusive Workflows/Chat panels - onboarding needs Workflows visible
  useEffect(() => {
    if (tutorialStep === 1 && !currentWorkflow) {
      console.log("[App] Tutorial step 1: Ensuring workflow panel is visible for onboarding");
      setDetailsVisible(true);
      setChatVisible(false);
    }
  }, [tutorialStep, currentWorkflow]);

  // Switch to chat panel for step 9 (New Chat button) when returning to homepage
  // After step 8 (Back button), user returns to homepage and needs to see chat panel for New Chat hint
  useEffect(() => {
    if (tutorialStep === 9 && !currentWorkflow) {
      console.log("[App] Tutorial step 9: Switching to chat panel for New Chat button");
      setDetailsVisible(false);
      setChatVisible(true);
    }
  }, [tutorialStep, currentWorkflow]);

  // Homepage panel mutual exclusivity: ensure only one of workflows/chat is visible
  // This handles edge cases where both might be true (e.g., from localStorage)
  // Skip during tutorial steps 1 and 9 which explicitly set panel visibility
  useEffect(() => {
    // Don't interfere with tutorial-controlled panel visibility
    if (tutorialStep === 1 || tutorialStep === 9) {
      return;
    }
    if (!currentWorkflow && detailsVisible && chatVisible) {
      console.log("[App] Homepage: Both panels visible, defaulting to workflows only");
      setChatVisible(false);
    }
  }, [currentWorkflow, detailsVisible, chatVisible, tutorialStep]);

  // Auto-expand both panels when opening a workflow
  // Track previous workflow state to detect transition from homepage to workflow view
  const prevWorkflowRef = useRef<typeof currentWorkflow>(null);
  useEffect(() => {
    const wasOnHomepage = prevWorkflowRef.current === null;
    const nowHasWorkflow = currentWorkflow !== null;

    if (wasOnHomepage && nowHasWorkflow) {
      console.log("[App] Opening workflow: Expanding both details and chat panels");
      setDetailsVisible(true);
      setChatVisible(true);
    }

    prevWorkflowRef.current = currentWorkflow;
  }, [currentWorkflow]);

  // Track when waiting for AI response to complete (step 6 → 7 transition)
  // Using state so UI can react (e.g., highlight chat area instead of button)
  const [waitingForTutorialAI, setWaitingForTutorialAI] = useState(false);
  const tutorialAILoadingStartedRef = useRef(false);

  // Track when waiting for workflow execution to complete (step 7 → 8 transition)
  const [waitingForTutorialWorkflow, setWaitingForTutorialWorkflow] = useState(false);

  // Track when waiting for "open chrome" execution to complete (step 10 → 11 transition)
  const [waitingForTutorialOpenChrome, setWaitingForTutorialOpenChrome] = useState(false);
  const tutorialOpenChromeLoadingStartedRef = useRef(false);

  // Track when waiting for demo search AI response (step 13 → 14 transition)
  const [waitingForTutorialDemoSearchAI, setWaitingForTutorialDemoSearchAI] = useState(false);
  const tutorialDemoSearchLoadingStartedRef = useRef(false);

  // Track when waiting for workflow creation + deps install (step 17 → 18 transition)
  const [waitingForTutorialDepsInstall, setWaitingForTutorialDepsInstall] = useState(false);

  // Track when recording demo is in progress (step 20)
  const [isRunningOnboardingRecordingDemo, setIsRunningOnboardingRecordingDemo] = useState(false);

  // Advance from step 7 to step 8 when workflow completes successfully
  useEffect(() => {
    if (waitingForTutorialWorkflow && tutorialStep === 7 && workflowState === "completed") {
      console.log("[App] Workflow completed successfully, advancing from step 7 to 8 (Back button)");
      setWaitingForTutorialWorkflow(false);
      advanceTutorial();
    }
  }, [workflowState, tutorialStep, advanceTutorial, waitingForTutorialWorkflow]);

  // Track when loading starts for step 6 (so we only advance after loading completes, not before it starts)
  useEffect(() => {
    if (waitingForTutorialAI && tutorialStep === 6 && isLoading) {
      tutorialAILoadingStartedRef.current = true;
    }
  }, [waitingForTutorialAI, tutorialStep, isLoading]);

  // Advance from step 6 to step 7 when AI finishes responding (only after loading started)
  useEffect(() => {
    if (waitingForTutorialAI && tutorialStep === 6 && !isLoading && tutorialAILoadingStartedRef.current) {
      console.log("[App] AI response complete, advancing from step 6 to 7 (Run All)");
      setWaitingForTutorialAI(false);
      tutorialAILoadingStartedRef.current = false;
      advanceTutorial();
    }
  }, [isLoading, tutorialStep, advanceTutorial, waitingForTutorialAI]);

  // Track when loading starts for step 10 (so we only advance after loading completes, not before it starts)
  useEffect(() => {
    if (waitingForTutorialOpenChrome && tutorialStep === 10 && isLoading) {
      tutorialOpenChromeLoadingStartedRef.current = true;
    }
  }, [waitingForTutorialOpenChrome, tutorialStep, isLoading]);

  // Advance from step 10 to step 11 when "open chrome" AI execution finishes (only after loading started)
  useEffect(() => {
    if (
      waitingForTutorialOpenChrome &&
      tutorialStep === 10 &&
      !isLoading &&
      tutorialOpenChromeLoadingStartedRef.current
    ) {
      console.log("[App] Tutorial step 10: 'open chrome' execution complete, advancing to step 11 (Arrange Windows)");
      setWaitingForTutorialOpenChrome(false);
      tutorialOpenChromeLoadingStartedRef.current = false;
      advanceTutorial();
    }
  }, [isLoading, tutorialStep, advanceTutorial, waitingForTutorialOpenChrome]);

  // Track when loading starts for step 13 (demo search)
  useEffect(() => {
    if (waitingForTutorialDemoSearchAI && tutorialStep === 13 && isLoading) {
      tutorialDemoSearchLoadingStartedRef.current = true;
    }
  }, [waitingForTutorialDemoSearchAI, tutorialStep, isLoading]);

  // Advance from step 13 to step 14 when demo search AI finishes (only after loading started)
  useEffect(() => {
    if (
      waitingForTutorialDemoSearchAI &&
      tutorialStep === 13 &&
      !isLoading &&
      tutorialDemoSearchLoadingStartedRef.current
    ) {
      console.log("[App] Tutorial step 13: Demo search AI complete, advancing to step 14");
      setWaitingForTutorialDemoSearchAI(false);
      tutorialDemoSearchLoadingStartedRef.current = false;
      advanceTutorial();
    }
  }, [isLoading, tutorialStep, advanceTutorial, waitingForTutorialDemoSearchAI]);

  // Step 14: After AI responds, spotlight Workflows button (user must click it)
  // No auto-advance - user must click the Workflows button to proceed

  // Step 15: After clicking Workflows at step 14, switch to Workflows panel
  // Panel switching now happens in the Workflows button onClick handler, not automatically

  // Advance from step 17 to step 18 when workflow creation + deps install completes
  useEffect(() => {
    if (waitingForTutorialDepsInstall && tutorialStep === 17 && currentWorkflow && !isCreatingWorkflow) {
      console.log("[App] Tutorial step 17: Workflow created and deps installed, advancing to step 18 (Demo modal)");
      setWaitingForTutorialDepsInstall(false);
      advanceTutorial();
    }
  }, [waitingForTutorialDepsInstall, tutorialStep, currentWorkflow, isCreatingWorkflow, advanceTutorial]);

  // Step 18: Show demo modal - user must click "Start Demo" to proceed
  // No auto-advance - OnboardingDemoModal handles the click

  // Track when step 19/20 recording demo AI processing starts/completes
  const [waitingForTutorialRecordingAI, setWaitingForTutorialRecordingAI] = useState(false);
  const tutorialRecordingAIStartedRef = useRef(false);

  // Detect when step 19 AI processing starts (after recording completes)
  useEffect(() => {
    if (tutorialStep === 19 && isRunningOnboardingRecordingDemo === false && isLoading) {
      console.log("[App] Tutorial step 19: Recording demo AI processing started");
      tutorialRecordingAIStartedRef.current = true;
      setWaitingForTutorialRecordingAI(true);
    }
  }, [tutorialStep, isRunningOnboardingRecordingDemo, isLoading]);

  // Detect when step 19 AI processing completes -> advance to step 20 (done)
  useEffect(() => {
    if (waitingForTutorialRecordingAI && tutorialStep === 19 && !isLoading && tutorialRecordingAIStartedRef.current) {
      console.log("[App] Tutorial step 19: Recording demo AI processing complete, advancing to step 20");
      setWaitingForTutorialRecordingAI(false);
      tutorialRecordingAIStartedRef.current = false;
      advanceTutorial(); // Advance to step 20
    }
  }, [isLoading, tutorialStep, advanceTutorial, waitingForTutorialRecordingAI]);

  // Auto-complete tutorial at step 20
  useEffect(() => {
    if (tutorialStep === 20) {
      console.log("[App] Tutorial step 20: Completing tutorial!");
      advanceTutorial(); // This will mark the tutorial as "done"
    }
  }, [tutorialStep, advanceTutorial]);

  // Keyboard shortcuts for tutorial navigation (Esc = skip forward, Shift+Tab = go back)
  useEffect(() => {
    if (typeof tutorialStep !== "number") return; // Only active during tutorial steps 1-20

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        console.log("[App] Escape pressed during tutorial step", tutorialStep, "- skipping to next step");
        setWaitingForTutorialAI(false);
        setWaitingForTutorialWorkflow(false);
        setWaitingForTutorialOpenChrome(false);
        setWaitingForTutorialDemoSearchAI(false);
        setWaitingForTutorialDepsInstall(false);
        setWaitingForTutorialRecordingAI(false);
        tutorialAILoadingStartedRef.current = false;
        tutorialOpenChromeLoadingStartedRef.current = false;
        tutorialDemoSearchLoadingStartedRef.current = false;
        tutorialRecordingAIStartedRef.current = false;
        advanceTutorial();
      }
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault(); // Prevent normal shift+tab behavior
        console.log("[App] Shift+Tab pressed during tutorial step", tutorialStep, "- going back");
        setWaitingForTutorialAI(false);
        setWaitingForTutorialWorkflow(false);
        setWaitingForTutorialOpenChrome(false);
        setWaitingForTutorialDemoSearchAI(false);
        setWaitingForTutorialDepsInstall(false);
        setWaitingForTutorialRecordingAI(false);
        tutorialAILoadingStartedRef.current = false;
        tutorialOpenChromeLoadingStartedRef.current = false;
        tutorialDemoSearchLoadingStartedRef.current = false;
        tutorialRecordingAIStartedRef.current = false;
        goBackTutorial();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tutorialStep, advanceTutorial, goBackTutorial]);

  // Show login prompt if not authenticated
  if (!authStatus.is_authenticated && !authLoading) {
    return <LoginPrompt onLogin={login} isLoading={authLoading} isPolling={authPolling} error={authError} />;
  }

  // Show loading screen while auth is being validated
  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white/5 backdrop-blur-md">
        <div className="text-center">
          <div className="w-16 h-16 bg-white/5 backdrop-blur-md border border-black rounded-lg mx-auto mb-4 flex items-center justify-center animate-pulse">
            <img src="/icon-128.png" alt="Mediar" className="w-full h-full object-contain" />
          </div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Onboarding booking modal is now opt-in via "Book onboarding" button in top bar
  // No longer blocking - users can access the app immediately

  return (
    <AIComponentProvider
      isAuthenticated={authStatus.is_authenticated}
      userName={authStatus.user?.email}
      userEmail={authStatus.user?.email}
      mcpServerRunning={mcpState.isHealthy}
      mcpServerReady={mcpState.isHealthy && !mcpState.isDiscovering}
      currentWorkflowId={currentWorkflow?.id}
      currentWorkflowName={currentWorkflow?.name}
      workflows={workflows.map(w => ({ id: w.id, name: w.name }))}
    >
      <div className="h-screen w-screen bg-white/5 backdrop-blur-md overflow-hidden no-context-menu flex flex-col">
        {/* MCP Status Banner - Shows when disconnected */}
        <McpStatusBanner
          isHealthy={mcpState.isHealthy}
          isInitializing={
            mcpState.isDiscovering || !mcpState.isHealthy // Show loading whenever unhealthy (includes restart period)
          }
          error={mcpState.error}
          onRestart={async () => {
            console.log("🔄 Force restarting MCP server from status banner");
            trackMcpRestartInitiated();
            try {
              await invoke("restart_mcp_server_command");
              console.log("✅ MCP server restart initiated - auto-check will detect recovery");
            } catch (error) {
              console.error("❌ Failed to restart MCP server:", error);
            }
          }}
        />

        {overlayVisible && showChatUI && (
          <div className="flex-1 flex overflow-hidden">
            {/* Main Content - Chat Interface */}
            <div className="flex-1 min-h-0 min-w-0">
              {/* Main Panel */}
              <div className="flex flex-col bg-white/5 backdrop-blur-md h-full relative">
                {/* Overlay for tutorial AI wait - covers top bar too */}
                {(waitingForTutorialAI || waitingForTutorialOpenChrome) && (
                  <div className="absolute top-0 left-0 right-0 h-8 bg-black/10 z-40 pointer-events-auto" />
                )}
                {/* Draggable Top Bar */}
                <div
                  className="h-8 [.theme-classic_&]:bg-transparent [.theme-inverted_&]:bg-black border-b border-black flex items-center justify-between px-3 flex-shrink-0 cursor-grab active:cursor-grabbing"
                  onMouseDown={async e => {
                    // Don't drag if clicking on a button or interactive element
                    if ((e.target as HTMLElement).closest("button")) {
                      return;
                    }
                    e.preventDefault();
                    try {
                      const appWindow = getCurrentWindow();
                      await appWindow.startDragging();
                    } catch (error) {
                      console.error("Drag failed:", error);
                    }
                  }}
                >
                  {/* Left side - Workflow toolbar buttons (when workflow) or version display */}
                  <div className="flex items-center gap-1 pointer-events-auto">
                    {currentWorkflow ? (
                      <>
                        {/* Run All / Stop button */}
                        {workflowState !== "executing" ? (
                          <SpotlightHint
                            show={tutorialStep === 7}
                            tooltip="Click to run the workflow"
                            arrowPosition="top"
                          >
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={(e: React.MouseEvent) => {
                                if (tutorialStep === 7) {
                                  setWaitingForTutorialWorkflow(true);
                                }
                                // Check if workflow has inputs that need to be collected
                                const inputs = currentWorkflow?.inputs;
                                if (inputs && inputs.length > 0) {
                                  // Shift+Click: skip input dialog if all required inputs have defaults
                                  if (e.shiftKey) {
                                    const hasRequiredWithoutDefault = inputs.some(
                                      input => input.required && input.defaultValue === undefined
                                    );
                                    if (!hasRequiredWithoutDefault) {
                                      // Build inputs from defaults and run
                                      const defaultInputs: Record<string, unknown> = {};
                                      for (const input of inputs) {
                                        if (input.defaultValue !== undefined) {
                                          defaultInputs[input.name] = input.defaultValue;
                                        }
                                      }
                                      executeFullWorkflow(defaultInputs);
                                      return;
                                    }
                                    // Has required inputs without defaults, still need dialog
                                  }
                                  // Show input dialog and wait for user to fill them
                                  setWorkflowInputDialog({
                                    isOpen: true,
                                    onConfirm: collectedInputs => {
                                      setWorkflowInputDialog({ isOpen: false, onConfirm: null });
                                      executeFullWorkflow(collectedInputs);
                                    },
                                  });
                                } else {
                                  // No inputs, execute directly
                                  executeFullWorkflow();
                                }
                              }}
                              disabled={
                                isExecuting ||
                                !currentWorkflow?.content?.steps?.length ||
                                !isMcpAvailable() ||
                                isPreparingWorkflow
                              }
                              className="h-6 w-6 flex-shrink-0"
                              title={
                                isPreparingWorkflow
                                  ? "Installing dependencies..."
                                  : !isMcpAvailable()
                                    ? "MCP tools are not available"
                                    : "Run all workflow steps (Shift+Click to skip input dialog)"
                              }
                            >
                              <Play className="w-3 h-3" />
                            </Button>
                          </SpotlightHint>
                        ) : (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={interruptStep}
                            className="h-6 text-xs px-2 gap-1 flex-shrink-0"
                            title="Stop execution (Space)"
                          >
                            {workflowState === "executing" ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <StopCircle className="w-3 h-3" />
                            )}
                            Stop
                          </Button>
                        )}

                        {/* Record button */}
                        {workflowState !== "recording" ? (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleToggleRecording(currentWorkflow?.name, true)}
                            disabled={!isMcpAvailable()}
                            className="h-6 w-6 flex-shrink-0"
                            title={
                              !isMcpAvailable()
                                ? "MCP tools are not available"
                                : currentWorkflow?.content?.steps?.length
                                  ? "Record more steps (Shift+Space)"
                                  : "Start recording (Shift+Space)"
                            }
                          >
                            <Circle className="w-3 h-3 fill-red-500 text-red-500" />
                          </Button>
                        ) : (
                          <div className="flex items-center gap-1.5 px-2 py-0 bg-red-100 text-red-700 rounded text-xs flex-shrink-0">
                            <Circle className="w-2 h-2 fill-red-500 animate-pulse" />
                            Recording...
                          </div>
                        )}

                        {/* Cloud Actions Button */}
                        {currentWorkflow.id && !isExecuting && isTypescriptWorkflow && (
                          <CloudActionsButton
                            workflowId={currentWorkflow.id}
                            isPublic={currentWorkflow.isPublic}
                            isSyncing={isSyncing}
                            needsPull={needsPull}
                            hasSteps={!!currentWorkflow?.content?.steps?.length}
                            onSyncToCloud={handleSyncToCloud}
                            onCloneWorkflow={handleCloneWorkflow}
                            onSetWorkflowVisibility={handleSetWorkflowVisibility}
                            handleDashboard={handleDashboard}
                            workflowPath={currentWorkflow.localPath}
                            saveVersion={saveVersion}
                            onOpenVersionHistory={() => setVersionHistoryOpen(true)}
                            versionsCount={versions.length}
                          />
                        )}

                        {/* Undo Button */}
                        {currentWorkflow.id && !isExecuting && (
                          <Button
                            onClick={undoFileEdit}
                            disabled={!canUndo}
                            size="icon"
                            variant="outline"
                            className="h-6 w-6 flex-shrink-0"
                            title="Undo last edit (Ctrl+Z)"
                          >
                            <Undo2 className="w-3 h-3" />
                          </Button>
                        )}

                        {/* Redo Button */}
                        {currentWorkflow.id && !isExecuting && (
                          <Button
                            onClick={redoFileEdit}
                            disabled={!canRedo}
                            size="icon"
                            variant="outline"
                            className="h-6 w-6 flex-shrink-0"
                            title="Redo last undone edit (Ctrl+Y)"
                          >
                            <Redo2 className="w-3 h-3" />
                          </Button>
                        )}
                      </>
                    ) : appVersion ? (
                      <span className="text-[10px] text-gray-400 select-none">v{appVersion}</span>
                    ) : null}
                  </div>

                  {/* Center - Workflow Title or Empty draggable space */}
                  <div className="flex-1 min-w-0 select-none flex items-center justify-start px-4">
                    {currentWorkflow ? (
                      editingWorkflowId === currentWorkflow.id ? (
                        <div className="flex items-center gap-1 pointer-events-auto">
                          <input
                            type="text"
                            value={editedWorkflowName}
                            onChange={e => setEditedWorkflowName(e.target.value)}
                            onKeyDown={async e => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (editedWorkflowName.trim() && editedWorkflowName !== currentWorkflow.name) {
                                  await updateWorkflowName(currentWorkflow.id, editedWorkflowName.trim());
                                }
                                setEditingWorkflowId(null);
                              } else if (e.key === "Escape") {
                                setEditingWorkflowId(null);
                              }
                            }}
                            onBlur={async () => {
                              if (editedWorkflowName.trim() && editedWorkflowName !== currentWorkflow.name) {
                                await updateWorkflowName(currentWorkflow.id, editedWorkflowName.trim());
                              }
                              setEditingWorkflowId(null);
                            }}
                            className="text-sm font-medium bg-transparent border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-white [.theme-classic_&]:text-black [.theme-inverted_&]:text-white focus:outline-none px-1 max-w-[200px]"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 pointer-events-auto min-w-0">
                          <div className="flex items-center gap-1 group">
                            <span
                              className="text-sm font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white truncate"
                              title={currentWorkflow.name}
                            >
                              {currentWorkflow.name}
                            </span>
                            <button
                              onClick={() => {
                                setEditedWorkflowName(currentWorkflow.name);
                                setEditingWorkflowId(currentWorkflow.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/10 rounded transition-opacity flex-shrink-0"
                              title="Edit workflow name"
                            >
                              <Pencil className="w-3 h-3 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                            </button>
                          </div>
                          {currentWorkflow.id && (
                            <div className="flex items-center gap-1 group">
                              <span
                                className="text-xs font-mono text-gray-400 truncate flex-shrink"
                                title={currentWorkflow.id}
                              >
                                {currentWorkflow.id}
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(currentWorkflow.id || "");
                                  toast.success("Workflow ID copied to clipboard");
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/10 rounded transition-opacity flex-shrink-0"
                                title="Copy workflow ID"
                              >
                                <Copy className="w-3 h-3 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                              </button>
                            </div>
                          )}
                          {(currentWorkflow.userAccessLevel === "read" ||
                            currentWorkflow.userAccessLevel === "public_read") && (
                            <span className="font-mono text-[10px] text-orange-600 font-normal px-1.5 py-0.5 border border-orange-400 rounded bg-orange-50 flex-shrink-0">
                              READ-ONLY
                            </span>
                          )}
                        </div>
                      )
                    ) : (
                      <>{/* Empty space for dragging */}</>
                    )}
                  </div>

                  {/* Right side - Action Buttons */}
                  <div className="flex items-center gap-1">
                    {/* Back button - show for settings OR workflow, but not both */}
                    {showSettings ? (
                      // Back from settings takes priority
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          console.log("🔙 Going back to main view from settings...");
                          trackBackButtonClicked("settings");
                          setShowSettings(false);
                        }}
                        className="w-6 h-6 flex items-center justify-center border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm"
                        title="Go Back from Settings"
                      >
                        <ArrowLeft className="size-4" />
                      </Button>
                    ) : currentWorkflow ? (
                      // Back from workflow only when not in settings
                      <SpotlightHint
                        show={tutorialStep === 8}
                        tooltip="Click to go back to workflow list"
                        arrowPosition="bottom"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            trackBackButtonClicked("workflow");
                            // Advance tutorial when clicking back at step 8
                            if (tutorialStep === 8) {
                              advanceTutorial();
                            }
                            setIsNavigatingBack(true);
                            try {
                              await backToList();
                            } finally {
                              setIsNavigatingBack(false);
                            }
                          }}
                          disabled={isNavigatingBack}
                          className="w-6 h-6 flex items-center justify-center border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm"
                          title="Back to workflow list"
                        >
                          {isNavigatingBack ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <ArrowLeft className="size-4" />
                          )}
                        </Button>
                      </SpotlightHint>
                    ) : null}
                    {/* Panel Toggle Button - home page: switch between Workflows and Chat */}
                    {!currentWorkflow && (
                      <SpotlightHint
                        show={tutorialStep === 14 && !detailsVisible}
                        tooltip="Click to see your workflows"
                        arrowPosition="bottom"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            // Toggle between workflows and chat view
                            if (detailsVisible) {
                              // Currently showing workflows, switch to chat
                              setDetailsVisible(false);
                              setChatVisible(true);
                            } else {
                              // Currently showing chat, switch to workflows
                              setChatVisible(false);
                              setDetailsVisible(true);
                              // Step 14: User clicked Workflows button, advance to step 15
                              if (tutorialStep === 14) {
                                console.log("[App] Tutorial step 14: Workflows button clicked, advancing to step 15");
                                advanceTutorial();
                              }
                            }
                          }}
                          className="h-6 px-2 flex items-center justify-center gap-1 border shadow-sm [.theme-classic_&]:border-black [.theme-inverted_&]:border-white text-xs font-medium"
                          title={detailsVisible ? "Switch to chat" : "Switch to workflows"}
                        >
                          {detailsVisible ? (
                            <>
                              <MessageSquare className="size-3" />
                              <span>Chat</span>
                            </>
                          ) : (
                            <>
                              <Columns className="size-3" />
                              <span>Workflows</span>
                            </>
                          )}
                        </Button>
                      </SpotlightHint>
                    )}
                    {/* New Chat button - only show when chat is visible */}
                    {chatVisible && (
                      <SpotlightHint
                        show={tutorialStep === 9}
                        tooltip="Click to start a new chat"
                        arrowPosition="bottom"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            // Advance tutorial when clicking New Chat at step 9
                            if (tutorialStep === 9) {
                              console.log("[App] Tutorial step 9: New Chat clicked, setting up step 10...");
                              handleNewChat(); // Clear chat first
                              // Set input after handleNewChat clears it, then advance
                              setTimeout(() => {
                                setInput("open chrome");
                                advanceTutorial();
                              }, 50);
                              return; // Don't call handleNewChat again
                            }
                            handleNewChat();
                          }}
                          className="px-2 h-6 flex items-center justify-center gap-1 border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm text-xs font-medium"
                          title="New Chat / Reset Conversation"
                        >
                          <Plus className="size-3" />
                          <span>New Chat</span>
                        </Button>
                      </SpotlightHint>
                    )}
                    {/* Chat History dropdown - only show when chat is visible */}
                    {chatVisible && (
                      <ChatHistoryDropdown
                        onListSessions={listPreviousSessions}
                        onLoadSession={async (sessionId: string) => {
                          const success = await loadPreviousSession(sessionId);
                          if (success) {
                            // Scroll to bottom after loading session
                            setTimeout(() => {
                              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                            }, 100);
                          }
                          return success;
                        }}
                      />
                    )}
                    {/* Book onboarding button - shows until user books or declines */}
                    {showOnboardingButton && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={openOnboardingBooking}
                        className="px-2 h-6 flex items-center justify-center gap-1 border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm text-xs font-medium"
                        title="Book an onboarding call"
                      >
                        <Calendar className="size-3" />
                        <span>Book onboarding</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (!showSettings) {
                          trackSettingsOpened();
                        }
                        setShowSettings(!showSettings);
                      }}
                      className="w-6 h-6 flex items-center justify-center border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm"
                      title="Settings"
                    >
                      <Settings className="size-4" />
                    </Button>
                    {/* Panel Toggle Buttons - workflow view (3 panels) */}
                    {currentWorkflow && (
                      <>
                        {/* Sidebar Toggle - hide if only visible panel */}
                        {!(sidebarVisible && visiblePanelCount === 1) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleSidebar}
                            className={`w-6 h-6 flex items-center justify-center border shadow-sm ${
                              sidebarVisible
                                ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-classic_&]:border-black [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black [.theme-inverted_&]:border-white"
                                : "[.theme-classic_&]:border-black [.theme-inverted_&]:border-white opacity-50"
                            }`}
                            title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                          >
                            <PanelLeft className="size-4" />
                          </Button>
                        )}
                        {/* Details Toggle - hide if only visible panel */}
                        {!(detailsVisible && visiblePanelCount === 1) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleDetails}
                            className={`w-6 h-6 flex items-center justify-center border shadow-sm ${
                              detailsVisible
                                ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-classic_&]:border-black [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black [.theme-inverted_&]:border-white"
                                : "[.theme-classic_&]:border-black [.theme-inverted_&]:border-white opacity-50"
                            }`}
                            title={detailsVisible ? "Hide details" : "Show details"}
                          >
                            <Columns className="size-4" />
                          </Button>
                        )}
                        {/* Chat Toggle - hide if only visible panel */}
                        {!(chatVisible && visiblePanelCount === 1) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleChat}
                            className={`w-6 h-6 flex items-center justify-center border shadow-sm ${
                              chatVisible
                                ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-classic_&]:border-black [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black [.theme-inverted_&]:border-white"
                                : "[.theme-classic_&]:border-black [.theme-inverted_&]:border-white opacity-50"
                            }`}
                            title={chatVisible ? "Hide chat" : "Show chat"}
                          >
                            <PanelRight className="size-4" />
                          </Button>
                        )}
                        {/* Orientation Toggle */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={toggleOrientation}
                          className="w-6 h-6 flex items-center justify-center border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm"
                          title={isVerticalLayout ? "Switch to horizontal layout" : "Switch to vertical layout"}
                        >
                          <GripVertical className={`size-4 ${isVerticalLayout ? "" : "rotate-90"}`} />
                        </Button>
                      </>
                    )}
                    {/* Arrange Windows Button */}
                    <SpotlightHint show={tutorialStep === 11} tooltip="Click to arrange windows" arrowPosition="bottom">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          // Advance tutorial when clicking at step 11
                          if (tutorialStep === 11) {
                            console.log("[App] Tutorial step 11: Arrange Windows clicked, advancing to step 12...");
                            advanceTutorial();
                          }
                          try {
                            const arranged = await invoke<boolean>("arrange_windows");
                            setIsWindowsArranged(arranged);
                          } catch (e) {
                            toast.error("Failed to arrange windows");
                            console.error("Arrange windows error:", e);
                          }
                        }}
                        className={`w-6 h-6 flex items-center justify-center border shadow-sm ${
                          isWindowsArranged
                            ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-classic_&]:border-black [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black [.theme-inverted_&]:border-white"
                            : "[.theme-classic_&]:border-black [.theme-inverted_&]:border-white"
                        }`}
                        title={
                          isWindowsArranged
                            ? "Restore window positions"
                            : "Arrange side by side (your app left, Mediar right)"
                        }
                      >
                        <GalleryHorizontal className="size-4" />
                      </Button>
                    </SpotlightHint>

                    {/* Window Controls */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleMinimize}
                      className="w-6 h-6 flex items-center justify-center border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm"
                      title="Minimize"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleMaximize}
                      className="w-6 h-6 flex items-center justify-center border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm"
                      title={isMaximized ? "Restore" : "Maximize"}
                    >
                      {isMaximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClose}
                      className="w-6 h-6 flex items-center justify-center border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shadow-sm"
                      title="Close"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>

                {/* Settings Page - Full height when shown */}
                {showSettings ? (
                  <ErrorBoundary>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <Suspense fallback={<div className="p-4">Loading settings...</div>}>
                        <SettingsPage
                          user={authStatus.user}
                          onLogout={logout}
                          onResetOnboarding={() => {
                            // Clear view preference so user goes through full onboarding
                            localStorage.removeItem("workflow_view_mode");
                            setHasViewPreference(false);
                            // Reset onboarding state - this sets showWelcomeModal to true
                            resetOnboarding();
                            // Close settings AFTER resetting so the welcome modal renders
                            setShowSettings(false);
                          }}
                          onCloseSettings={() => setShowSettings(false)}
                          experimentalFeatures={experimentalFeatures}
                          onExperimentalFeaturesChange={handleExperimentalFeaturesChange}
                          onViewOrgIdChange={async () => {
                            // Refresh workflow lists when admin view org changes
                            await loadWorkflows();
                            // Also refresh community workflows if they were loaded
                            if (communityWorkflows.length > 0) {
                              setIsLoadingCommunityWorkflows(true);
                              try {
                                const result = await loadCommunityWorkflows();
                                setCommunityWorkflows(
                                  result.map(w => ({
                                    id: w.id,
                                    name: w.name,
                                    description: w.description,
                                    stepCount: w.stepCount,
                                    isCloudOnly: w.isCloudOnly,
                                    githubFolder: w.githubFolder,
                                    uuid: w.uuid,
                                    tags: w.tags,
                                  })) as WorkflowCardData[]
                                );
                              } finally {
                                setIsLoadingCommunityWorkflows(false);
                              }
                            }
                          }}
                        />
                      </Suspense>
                    </div>
                  </ErrorBoundary>
                ) : (
                  <>
                    {/* Recording Banner - always shows during recording */}
                    {isRecording && (
                      <div className="bg-gray-100 border-b border-gray-200 px-4 py-2 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          <span className="text-gray-700">Recording...</span>
                          {recordingProgress && recordingProgress.eventCount > 0 && (
                            <span className="text-gray-500">{recordingProgress.eventCount} events captured</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Processing Modal - shows when local processing and not dismissed */}
                    <ProcessingModal
                      isOpen={!isRecording && !isProcessingModalDismissed && isLocalProcessing}
                      onClose={() => setIsProcessingModalDismissed(true)}
                      localProgress={localProcessingProgress}
                      isLocalProcessing={isLocalProcessing}
                      cloudProgress={null} // CLOUD PROCESSING DISABLED
                      isCloudProcessing={false} // CLOUD PROCESSING DISABLED
                      isSynthesizing={false} // CLOUD PROCESSING DISABLED
                      synthesisProgress={null} // CLOUD PROCESSING DISABLED
                      error={null}
                    />

                    {/* Processing Banner - shows when modal dismissed (local processing only) */}
                    {!isRecording && isProcessingModalDismissed && isLocalProcessing && (
                      <div className="bg-gray-100 border-b border-gray-200 px-4 py-2 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-4">
                          {/* Local Gemini processing */}
                          {localProcessingProgress && (
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                              <span className="text-gray-700">
                                {localProcessingProgress.stage === "step_analysis" && "Analyzing steps..."}
                                {localProcessingProgress.stage === "labeling" && "Labeling..."}
                                {localProcessingProgress.stage === "synthesis" && "Synthesizing..."}
                                {localProcessingProgress.stage === "generation" && "Generating files..."}
                              </span>
                              <span className="text-gray-500">
                                {localProcessingProgress.current}/{localProcessingProgress.total}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Panel Layout - horizontal or vertical based on isVerticalLayout */}
                    <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
                      {/* Overlay for tutorial AI wait - covers sidebar and workflow panels but not chat */}
                      {(waitingForTutorialAI || waitingForTutorialOpenChrome) && (
                        <div
                          className="absolute inset-0 bg-black/10 z-40 pointer-events-auto"
                          style={{
                            width: isVerticalLayout ? "100%" : `${panelSizes[0] + panelSizes[1]}%`,
                            height: isVerticalLayout ? `${panelSizes[0] + panelSizes[1]}%` : "100%",
                          }}
                        />
                      )}
                      <PanelGroup
                        direction={isVerticalLayout ? "vertical" : "horizontal"}
                        className="flex-1"
                        id="workflow-layout-panels"
                        autoSaveId={`workflowLayoutSizes-v2-${isVerticalLayout ? "v" : "h"}`}
                        onLayout={sizes => {
                          setPanelSizes(sizes);
                          // Shrink priority: details (index 1) collapses first, then sidebar (index 0), chat (index 2) last
                          // When a panel reaches ~10% or less, collapse it
                          const COLLAPSE_THRESHOLD = 10;
                          const [sidebarSize, detailsSize, chatSize] = sizes;

                          // Only auto-collapse if all panels are visible (user hasn't manually hidden any)
                          if (sidebarVisible && detailsVisible && chatVisible) {
                            // Details collapses first
                            if (detailsSize > 0 && detailsSize <= COLLAPSE_THRESHOLD) {
                              setDetailsVisible(false);
                            }
                            // Sidebar collapses second (only if details already collapsed or very small)
                            else if (
                              sidebarSize > 0 &&
                              sidebarSize <= COLLAPSE_THRESHOLD &&
                              detailsSize <= COLLAPSE_THRESHOLD
                            ) {
                              setSidebarVisible(false);
                            }
                            // Chat collapses last (only if both others are collapsed)
                            else if (
                              chatSize > 0 &&
                              chatSize <= COLLAPSE_THRESHOLD &&
                              detailsSize <= COLLAPSE_THRESHOLD &&
                              sidebarSize <= COLLAPSE_THRESHOLD
                            ) {
                              setChatVisible(false);
                            }
                          }
                        }}
                      >
                        {/* Left Panel - Workflow Sidebar - Only show when workflow is selected */}
                        {currentWorkflow && (
                          <>
                            <Panel
                              ref={sidebarPanelRef}
                              defaultSize={15}
                              minSize={5}
                              collapsible
                              collapsedSize={0}
                              onCollapse={() => setIsSidebarCollapsed(true)}
                              onExpand={() => setIsSidebarCollapsed(false)}
                              order={1}
                              id="sidebar-panel"
                            >
                              <WorkflowSidebar
                                workflow={currentWorkflow}
                                troubleshootingSteps={
                                  Array.isArray(currentWorkflow.content?.troubleshooting)
                                    ? currentWorkflow.content.troubleshooting
                                    : []
                                }
                                hasOutput={!!currentWorkflow.content?.output}
                                selection={sidebarSelection}
                                onSelectionChange={setSidebarSelection}
                                currentStep={currentStep}
                                workflowState={workflowState as string}
                                workflowExecutionLogs={workflowExecutionLogs}
                                isExecuting={isExecuting}
                                isPreparingWorkflow={isPreparingWorkflow}
                                stepResult={stepResult}
                                isFullWorkflowMode={isFullWorkflowMode}
                                executingRange={executingRange}
                                isMcpAvailable={isMcpAvailable()}
                                shortcutsEnabled={shortcutsEnabled}
                                showRunAllHint={tutorialStep === 7}
                                onExecuteFullWorkflow={() => {
                                  // Wait for workflow completion before advancing tutorial at step 7
                                  if (tutorialStep === 7) {
                                    console.log(
                                      "[App] Tutorial step 7: Run All clicked, waiting for workflow completion..."
                                    );
                                    setWaitingForTutorialWorkflow(true);
                                  }
                                  // Check if workflow has inputs that need to be collected
                                  const inputs = currentWorkflow?.inputs;
                                  if (inputs && inputs.length > 0) {
                                    // Show input dialog and wait for user to fill them
                                    setWorkflowInputDialog({
                                      isOpen: true,
                                      onConfirm: collectedInputs => {
                                        setWorkflowInputDialog({ isOpen: false, onConfirm: null });
                                        executeFullWorkflow(collectedInputs);
                                      },
                                    });
                                  } else {
                                    executeFullWorkflow();
                                  }
                                }}
                                onExecuteStep={executeStep}
                                onExecuteStepRange={executeStepRange}
                                onJumpToStep={jumpToStep}
                                onInterruptStep={interruptStep}
                                onSetRuntimeExecutionOptions={setRuntimeExecutionOptions}
                                poolSteps={poolSteps}
                                executingPoolStepId={executingPoolStepId}
                                onExecutePoolStep={executePoolStep}
                                onDeletePoolStep={deletePoolStep}
                                onClearPool={clearPool}
                                onScheduleChanged={loadScheduledWorkflows}
                                onCloneWorkflow={handleCloneWorkflow}
                                onUndo={undoFileEdit}
                                onRedo={redoFileEdit}
                                canUndo={canUndo}
                                canRedo={canRedo}
                                onSetWorkflowVisibility={handleSetWorkflowVisibility}
                                affectedStepIds={diffHighlight?.affectedStepIds}
                                onDismissFileDiff={() => setDiffHighlight(null)}
                                diffHighlight={diffHighlight}
                                onAcceptAllDiffs={handleAcceptAllDiffs}
                                onRejectAllDiffs={handleRejectAllDiffs}
                                onAddPoolStepToWorkflow={handleAddPoolStepToWorkflow}
                                onAddWorkflowStepToPool={handleAddWorkflowStepToPool}
                                dragOperationLoading={dragOperationLoading}
                                onStartRecording={() => handleToggleRecording(currentWorkflow?.name, true)}
                                loadFileContent={loadFileContent}
                                onRefreshFiles={() => {
                                  if (currentWorkflow?.id) {
                                    initializeWorkflow(currentWorkflow.id);
                                  }
                                }}
                                onSyncToCloud={isTypescriptWorkflow ? handleSyncToCloud : undefined}
                                isSyncing={isSyncing}
                                needsPull={needsPull}
                                workflowExecutionState={workflowExecutionState}
                                liveStepStatus={liveStepStatus}
                                versionHistoryOpen={versionHistoryOpen}
                                onVersionHistoryOpenChange={setVersionHistoryOpen}
                              />
                            </Panel>

                            {/* Resize Handle - Between Sidebar and Details */}
                            <PanelResizeHandle
                              id="sidebar-resize-handle"
                              className={`relative ${
                                isVerticalLayout
                                  ? "h-1 bg-gray-200 hover:bg-gray-300 transition-colors cursor-row-resize"
                                  : "w-1 bg-gray-200 hover:bg-gray-300 transition-colors cursor-col-resize"
                              }`}
                            >
                              {/* Toggle button overlay - shows when collapsed */}
                              {isSidebarCollapsed && (
                                <button
                                  onClick={() => sidebarPanelRef.current?.expand()}
                                  className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-8 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-r flex items-center justify-center z-10"
                                  title="Expand sidebar"
                                >
                                  <ChevronRight className="w-3 h-3 text-gray-500" />
                                </button>
                              )}
                            </PanelResizeHandle>
                          </>
                        )}

                        {/* Center Panel - Step Details or Workflow Table */}
                        {/* On homepage: only render when detailsVisible is true */}
                        {currentWorkflow !== null || detailsVisible === true ? (
                          <Panel
                            ref={workflowPanelRef}
                            defaultSize={currentWorkflow !== null ? 35 : 100}
                            minSize={15}
                            collapsible
                            collapsedSize={0}
                            order={2}
                            id="details-panel"
                          >
                            <ErrorBoundary fallback={WorkflowErrorFallback}>
                              {currentWorkflow ? (
                                <StepDetailsPanel
                                  workflow={currentWorkflow}
                                  poolSteps={poolSteps}
                                  outputCode={
                                    typeof currentWorkflow.content?.output === "string"
                                      ? currentWorkflow.content?.output
                                      : ""
                                  }
                                  selection={sidebarSelection}
                                  workflowExecutionState={workflowExecutionState}
                                  logsRefreshKey={logsRefreshKey}
                                  diffHighlight={diffHighlight}
                                  onDismissDiff={() => setDiffHighlight(null)}
                                  onFileAccepted={handleFileAccepted}
                                  onScheduleChanged={loadScheduledWorkflows}
                                  onFileChange={(filePath, content) => {
                                    // Update workflow.files in-memory to keep state in sync with disk
                                    updateCurrentWorkflow({
                                      files: currentWorkflow.files?.map(f =>
                                        f.path === filePath ? { ...f, content } : f
                                      ),
                                    });
                                  }}
                                />
                              ) : useCardView ? (
                                <WorkflowMarketplace
                                  workflows={
                                    showCommunityWorkflows ? communityWorkflows : (workflows as WorkflowCardData[])
                                  }
                                  isLoading={showCommunityWorkflows ? isLoadingCommunityWorkflows : isLoadingWorkflows}
                                  loadingWorkflowId={loadingWorkflowId}
                                  downloadingWorkflowId={downloadingWorkflowId}
                                  pullingWorkflowId={pullingWorkflowId}
                                  deletingWorkflowId={deletingWorkflowId}
                                  onStartWorkflow={handleStartWorkflow}
                                  onDownloadWorkflow={handleDownloadCloudWorkflow}
                                  onPullWorkflow={showCommunityWorkflows ? undefined : handlePullWorkflow}
                                  onDeleteWorkflow={showCommunityWorkflows ? undefined : handleDeleteWorkflow}
                                  onCreateNew={
                                    showCommunityWorkflows
                                      ? undefined
                                      : () => {
                                          setShowNameInputDialog(true);
                                          // Step 15: User clicked New Workflow button, advance to step 16
                                          if (tutorialStep === 15) {
                                            console.log(
                                              "[App] Tutorial step 15: New Workflow clicked, advancing to step 16"
                                            );
                                            advanceTutorial();
                                          }
                                        }
                                  }
                                  showNewWorkflowHint={tutorialStep === 15}
                                  onRefresh={
                                    showCommunityWorkflows
                                      ? async () => {
                                          setIsLoadingCommunityWorkflows(true);
                                          try {
                                            const result = await loadCommunityWorkflows();
                                            setCommunityWorkflows(
                                              result.map(w => ({
                                                id: w.id,
                                                name: w.name,
                                                description: w.description,
                                                stepCount: w.stepCount,
                                                lastModified: w.lastModified,
                                                isPublic: w.isPublic,
                                                authorName: w.authorName,
                                                uuid: w.uuid,
                                                tags: w.tags,
                                              })) as WorkflowCardData[]
                                            );
                                          } finally {
                                            setIsLoadingCommunityWorkflows(false);
                                          }
                                        }
                                      : loadWorkflows
                                  }
                                  onToggleView={() => {
                                    setUseCardView(false);
                                    setHasViewPreference(true);
                                    localStorage.setItem("workflow_view_mode", "list");
                                    if (tutorialStep === 2) {
                                      advanceTutorial();
                                    }
                                  }}
                                  showViewToggleHint={tutorialStep === 2}
                                  onUpdateWorkflowTags={
                                    showCommunityWorkflows
                                      ? undefined
                                      : async (workflowId, tags) => {
                                          try {
                                            const cloudWorkflows =
                                              await invoke<
                                                Array<{ id: number; github_folder?: string; uuid?: string }>
                                              >("list_saved_workflows");
                                            const cloudWorkflow = cloudWorkflows.find(
                                              cw => cw.github_folder === workflowId || cw.uuid === workflowId
                                            );
                                            if (!cloudWorkflow) {
                                              return { success: false, error: "Cloud workflow not found" };
                                            }
                                            await invoke("update_workflow_tags", {
                                              workflowId: cloudWorkflow.id,
                                              tags,
                                            });
                                            await loadWorkflows();
                                            return { success: true };
                                          } catch (err) {
                                            console.error("Failed to update tags:", err);
                                            return { success: false, error: String(err) };
                                          }
                                        }
                                  }
                                  showCommunity={showCommunityWorkflows}
                                  onToggleCommunity={async () => {
                                    const newState = !showCommunityWorkflows;
                                    setShowCommunityWorkflows(newState);
                                    if (newState && communityWorkflows.length === 0) {
                                      setIsLoadingCommunityWorkflows(true);
                                      try {
                                        const result = await loadCommunityWorkflows();
                                        setCommunityWorkflows(
                                          result.map(w => ({
                                            id: w.id,
                                            name: w.name,
                                            description: w.description,
                                            stepCount: w.stepCount,
                                            lastModified: w.lastModified,
                                            isPublic: w.isPublic,
                                            authorName: w.authorName,
                                            uuid: w.uuid,
                                            tags: w.tags,
                                          })) as WorkflowCardData[]
                                        );
                                      } finally {
                                        setIsLoadingCommunityWorkflows(false);
                                      }
                                    }
                                  }}
                                />
                              ) : (
                                <ScrollArea className="h-full w-full">
                                  <div className="p-3 sm:p-4 w-full max-w-3xl mx-auto">
                                    <WorkflowTable
                                      workflows={
                                        showCommunityWorkflows
                                          ? (communityWorkflows as unknown as Workflow[])
                                          : // During onboarding steps 3/4, only show the target workflow
                                            tutorialStep === 3 || tutorialStep === 4
                                            ? workflows.filter(
                                                w =>
                                                  w.id === ONBOARDING_WORKFLOW_UUID ||
                                                  w.uuid === ONBOARDING_WORKFLOW_UUID ||
                                                  w.cloudId === ONBOARDING_WORKFLOW_UUID
                                              )
                                            : workflows
                                      }
                                      isLoading={
                                        showCommunityWorkflows ? isLoadingCommunityWorkflows : isLoadingWorkflows
                                      }
                                      loadingWorkflowId={loadingWorkflowId}
                                      downloadingWorkflowId={downloadingWorkflowId}
                                      pullingWorkflowId={pullingWorkflowId}
                                      isMcpAvailable={isMcpAvailable()}
                                      isMcpInitializing={
                                        mcpState.isDiscovering ||
                                        (mcpState.serverInfo?.is_running && !mcpState.serverInfo?.is_ready)
                                      }
                                      mcpError={mcpState.error}
                                      shortcutsEnabled={shortcutsEnabled}
                                      showViewToggleHint={tutorialStep === 1}
                                      spotlightWorkflowUuid={
                                        tutorialStep === 3 || tutorialStep === 4 ? ONBOARDING_WORKFLOW_UUID : null
                                      }
                                      spotlightWorkflowTooltip={
                                        tutorialStep === 3
                                          ? "Click to download this workflow"
                                          : tutorialStep === 4
                                            ? "Click to open this workflow"
                                            : ""
                                      }
                                      onStartWorkflow={workflowId => {
                                        // Advance tutorial when opening the target workflow
                                        const targetWorkflow = workflows.find(w => w.id === workflowId);
                                        const isOnboardingWorkflow =
                                          targetWorkflow?.id === ONBOARDING_WORKFLOW_UUID ||
                                          targetWorkflow?.uuid === ONBOARDING_WORKFLOW_UUID ||
                                          targetWorkflow?.cloudId === ONBOARDING_WORKFLOW_UUID;
                                        if (tutorialStep === 4 && isOnboardingWorkflow) {
                                          advanceTutorial();
                                        }
                                        handleStartWorkflow(workflowId);
                                      }}
                                      onUpdateWorkflowName={updateWorkflowName}
                                      onDeleteWorkflow={
                                        showCommunityWorkflows
                                          ? () => {}
                                          : (workflowId, workflowName) => {
                                              setDeleteConfirmation({
                                                isOpen: true,
                                                workflowId,
                                                workflowName,
                                              });
                                            }
                                      }
                                      onDownloadWorkflow={async workflowUuid => {
                                        await handleDownloadCloudWorkflow(workflowUuid);
                                        // Advance tutorial when downloading the target workflow
                                        // Since handleDownloadCloudWorkflow auto-opens, advance twice (3->4->5)
                                        if (tutorialStep === 3 && workflowUuid === ONBOARDING_WORKFLOW_UUID) {
                                          advanceTutorial(); // 3 -> 4 (download)
                                          advanceTutorial(); // 4 -> 5 (open - auto-triggered)
                                        }
                                      }}
                                      onPullWorkflow={showCommunityWorkflows ? undefined : handlePullWorkflow}
                                      onUpdateWorkflowTags={
                                        showCommunityWorkflows
                                          ? undefined
                                          : async (workflowId, tags) => {
                                              try {
                                                const cloudWorkflows =
                                                  await invoke<
                                                    Array<{ id: number; github_folder?: string; uuid?: string }>
                                                  >("list_saved_workflows");
                                                const cloudWorkflow = cloudWorkflows.find(
                                                  cw => cw.github_folder === workflowId || cw.uuid === workflowId
                                                );
                                                if (!cloudWorkflow) {
                                                  return { success: false, error: "Cloud workflow not found" };
                                                }
                                                await invoke("update_workflow_tags", {
                                                  workflowId: cloudWorkflow.id,
                                                  tags,
                                                });
                                                await loadWorkflows();
                                                return { success: true };
                                              } catch (err) {
                                                console.error("Failed to update tags:", err);
                                                return { success: false, error: String(err) };
                                              }
                                            }
                                      }
                                      onRefresh={
                                        showCommunityWorkflows
                                          ? async () => {
                                              setIsLoadingCommunityWorkflows(true);
                                              try {
                                                const result = await loadCommunityWorkflows();
                                                setCommunityWorkflows(
                                                  result.map(w => ({
                                                    id: w.id,
                                                    name: w.name,
                                                    description: w.description,
                                                    stepCount: w.stepCount,
                                                    lastModified: w.lastModified,
                                                    isPublic: w.isPublic,
                                                    authorName: w.authorName,
                                                    uuid: w.uuid,
                                                    tags: w.tags,
                                                  })) as WorkflowCardData[]
                                                );
                                              } finally {
                                                setIsLoadingCommunityWorkflows(false);
                                              }
                                            }
                                          : loadWorkflows
                                      }
                                      onCreateNew={
                                        showCommunityWorkflows
                                          ? undefined
                                          : () => {
                                              setShowNameInputDialog(true);
                                              // Step 15: User clicked New Workflow button, advance to step 16
                                              if (tutorialStep === 15) {
                                                console.log(
                                                  "[App] Tutorial step 15: New Workflow clicked, advancing to step 16"
                                                );
                                                advanceTutorial();
                                              }
                                            }
                                      }
                                      showNewWorkflowHint={tutorialStep === 15}
                                      onToggleView={() => {
                                        setUseCardView(true);
                                        setHasViewPreference(true);
                                        localStorage.setItem("workflow_view_mode", "card");
                                        if (tutorialStep === 1) {
                                          advanceTutorial();
                                        }
                                      }}
                                      showCommunity={showCommunityWorkflows}
                                      onToggleCommunity={async () => {
                                        const newState = !showCommunityWorkflows;
                                        setShowCommunityWorkflows(newState);
                                        if (newState && communityWorkflows.length === 0) {
                                          setIsLoadingCommunityWorkflows(true);
                                          try {
                                            const result = await loadCommunityWorkflows();
                                            setCommunityWorkflows(
                                              result.map(w => ({
                                                id: w.id,
                                                name: w.name,
                                                description: w.description,
                                                stepCount: w.stepCount,
                                                lastModified: w.lastModified,
                                                isPublic: w.isPublic,
                                                authorName: w.authorName,
                                                uuid: w.uuid,
                                                tags: w.tags,
                                              })) as WorkflowCardData[]
                                            );
                                          } finally {
                                            setIsLoadingCommunityWorkflows(false);
                                          }
                                        }
                                      }}
                                    />
                                  </div>
                                </ScrollArea>
                              )}
                            </ErrorBoundary>
                          </Panel>
                        ) : null}

                        {/* Resize Handle - Between Details and Chat & Chat Panel */}
                        {/* On homepage: hide resize handle when chat is not visible (mutually exclusive panels) */}
                        {currentWorkflow !== null || chatVisible === true ? (
                          <PanelResizeHandle
                            id="chat-resize-handle"
                            className={`relative ${
                              isVerticalLayout
                                ? "h-1 bg-gray-200 hover:bg-gray-300 transition-colors cursor-row-resize"
                                : "w-1 bg-gray-200 hover:bg-gray-300 transition-colors cursor-col-resize"
                            }`}
                          >
                            {/* Toggle button overlay - shows when collapsed */}
                            {isChatCollapsed && (
                              <button
                                onClick={() => chatPanelRef.current?.expand()}
                                className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-8 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-l flex items-center justify-center z-10"
                                title="Expand chat"
                              >
                                <ChevronLeft className="w-3 h-3 text-gray-500" />
                              </button>
                            )}
                          </PanelResizeHandle>
                        ) : null}

                        {/* Chat Panel - On homepage: only render when chatVisible is true */}
                        {currentWorkflow !== null || chatVisible === true ? (
                          <Panel
                            ref={chatPanelRef}
                            defaultSize={currentWorkflow !== null ? 50 : 100}
                            minSize={5}
                            collapsible
                            collapsedSize={0}
                            onCollapse={() => setIsChatCollapsed(true)}
                            onExpand={() => setIsChatCollapsed(false)}
                            order={3}
                            id="chat-panel"
                          >
                            <ErrorBoundary fallback={ChatErrorFallback}>
                              <div className="h-full overflow-hidden relative flex flex-col border-l">
                                {/* Floating controls */}
                                <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
                                  {/* AI Model Selection */}
                                  <select
                                    value={selectedModel}
                                    onChange={e =>
                                      setSelectedModel(
                                        e.target.value as
                                          | "gemini-2.5-pro"
                                          | "gemini-2.5-flash"
                                          | "gemini-3-pro-preview"
                                          | "claude-code"
                                      )
                                    }
                                    className="h-5 px-1 py-0 text-[10px] border border-black rounded focus:outline-none cursor-pointer appearance-none bg-[length:10px] bg-[center_right_0.2rem] bg-no-repeat pr-4 [.theme-classic_&]:bg-white [.theme-classic_&]:text-black [.theme-classic_&]:hover:bg-gray-100 [.theme-classic_&]:bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')] [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90 [.theme-inverted_&]:bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')]"
                                    title="Select AI model"
                                  >
                                    <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                                    <option value="claude-code">Claude Code Opus 4-5</option>
                                    <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                  </select>
                                  {/* Thinking Level Toggle - only for Gemini 3 */}
                                  {selectedModel === "gemini-3-pro-preview" && (
                                    <button
                                      onClick={() => setThinkingLevel(thinkingLevel === "low" ? "high" : "low")}
                                      className={`h-5 px-1 text-[8px] font-mono border border-black rounded cursor-pointer transition-colors ${
                                        thinkingLevel === "high"
                                          ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
                                          : "[.theme-classic_&]:bg-white [.theme-classic_&]:text-black [.theme-classic_&]:hover:bg-gray-100 [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90"
                                      }`}
                                      title={`Thinking: ${thinkingLevel} (click to toggle)`}
                                    >
                                      {thinkingLevel}
                                    </button>
                                  )}
                                  {/* Context usage indicator */}
                                  {contextMetrics && contextLimit && (
                                    <span
                                      className="text-[9px] text-gray-400 font-mono"
                                      title={`Prompt: ${contextMetrics.promptTokens.toLocaleString()} tokens\nResponse: ${contextMetrics.responseTokens.toLocaleString()} tokens\nTotal: ${contextMetrics.totalTokens.toLocaleString()} tokens\nLimit: ${contextLimit.toLocaleString()} tokens`}
                                    >
                                      {((contextMetrics.promptTokens / contextLimit) * 100).toFixed(1)}%
                                    </span>
                                  )}
                                </div>

                                {/* Welcome View - shown when chat is empty on homepage */}
                                {messages.length === 0 && !currentWorkflow ? (
                                  <div className="flex-1 flex items-center justify-center p-4">
                                    <div className="max-w-md w-full space-y-6">
                                      {/* Welcome Title */}
                                      <div className="text-center space-y-2">
                                        <h2 className="text-2xl font-bold text-black">What can I help you with?</h2>
                                        <p className="text-sm text-gray-500">
                                          I can automate tasks on your computer, control apps, and browse the web.
                                        </p>
                                      </div>

                                      {/* Quick Actions */}
                                      <SuggestedActions
                                        actions={getHomepageQuickActions()}
                                        onActionClick={prompt => {
                                          setInput(prompt);
                                          setTimeout(() => {
                                            if (inputRef.current) {
                                              inputRef.current.focus();
                                            }
                                          }, 50);
                                        }}
                                      />

                                      {/* Input with inline send button */}
                                      <form
                                        onSubmit={handleSubmit}
                                        className="flex items-end gap-2 border-2 border-black rounded-lg p-2 focus-within:ring-2 focus-within:ring-black"
                                      >
                                        <AutoExpandTextarea
                                          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                                          value={input}
                                          onChange={handleInputChangeWithNotification}
                                          onSubmit={() => {
                                            if ((input.trim() || pendingImages.length > 0) && isMcpAvailable()) {
                                              handleSubmit({ preventDefault: () => {} } as React.FormEvent);
                                            }
                                          }}
                                          onPasteImage={images => {
                                            setPendingImages(prev => [...prev, ...images]);
                                          }}
                                          placeholder="Ask me to do something..."
                                          disabled={!isMcpAvailable()}
                                          maxHeight={150}
                                          rows={2}
                                          className="flex-1 p-2 text-base focus:outline-none resize-none border-0"
                                        />
                                        <SpotlightHint
                                          show={tutorialStep === 10}
                                          tooltip="Click to send"
                                          arrowPosition="bottom"
                                        >
                                          <Button
                                            type="submit"
                                            disabled={!input.trim() || !isMcpAvailable()}
                                            className="px-3 py-2 flex-shrink-0"
                                            onClick={() => {
                                              // Step 10: After sending "open chrome", wait for AI then advance to step 11
                                              if (tutorialStep === 10) {
                                                console.log(
                                                  "[App] Tutorial step 10 (homepage): Send clicked, waiting for 'open chrome' execution..."
                                                );
                                                setWaitingForTutorialOpenChrome(true);
                                              }
                                            }}
                                          >
                                            <Send className="w-4 h-4" />
                                          </Button>
                                        </SpotlightHint>
                                      </form>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {/* Chat messages area */}
                                    <DebugContextMenu items={chatDebugItems} className="flex-1 min-h-0 relative">
                                      <div
                                        ref={chatContainerRef}
                                        className="absolute inset-0 overflow-y-auto overflow-x-hidden pt-8"
                                      >
                                        <div className="px-3 max-w-3xl mx-auto">
                                          {renderedMessages}

                                          {/* Loading/progress indicator - shows during AI thinking or workflow execution */}
                                          {(isExecuting || isLoading) && (
                                            <WorkflowProgressIndicator
                                              isExecuting={isExecuting || isLoading}
                                              loadingStatus={loadingStatus}
                                            />
                                          )}

                                          {/* Inline elicitation for ask_user */}
                                          {elicitationState.isOpen &&
                                            elicitationState.request &&
                                            elicitationState.renderMode === "inline" && (
                                              <div className="px-4 py-2">
                                                <InlineElicitation
                                                  request={elicitationState.request}
                                                  onRespond={elicitationRespond}
                                                />
                                              </div>
                                            )}

                                          <div ref={messagesEndRef} />
                                        </div>
                                      </div>
                                    </DebugContextMenu>

                                    {/* Chat Input */}
                                    {!showSettings && (
                                      <div className="flex-shrink-0 border-t bg-white">
                                        <div className="p-3 max-w-3xl mx-auto w-full">
                                          {/* Diff Accept/Reject Banner - shows when diff highlighting is active */}
                                          {diffHighlight && diffHighlight.files.length > 0 && (
                                            <div className="mb-2 px-2 py-1 bg-gray-100 border rounded flex items-center justify-between text-xs">
                                              <div className="flex items-center gap-2 text-gray-700">
                                                <span className="font-medium">Changes:</span>
                                                <span className="text-gray-600">
                                                  {diffHighlight.files.length} file(s)
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1">
                                                <Button
                                                  onClick={handleAcceptAllDiffs}
                                                  variant="outline"
                                                  size="sm"
                                                  className="h-5 px-2 text-xs bg-white hover:bg-gray-100 text-black border border-black"
                                                  title="Keep current changes"
                                                >
                                                  Accept All
                                                </Button>
                                                <Button
                                                  onClick={handleRejectAllDiffs}
                                                  variant="destructive"
                                                  size="sm"
                                                  className="h-5 px-2 text-xs"
                                                  title="Restore original content"
                                                >
                                                  Reject All
                                                </Button>
                                                <button
                                                  onClick={() => setDiffHighlight(null)}
                                                  className="p-0.5 hover:bg-gray-200 rounded ml-1"
                                                  title="Dismiss"
                                                >
                                                  <X className="w-3 h-3" />
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                          {/* Sticky suggestions - always above input */}
                                          {suggestedActions.length > 0 && (
                                            <div className="pb-2 relative">
                                              <button
                                                onClick={dismissSuggestions}
                                                className="absolute top-0 right-0 text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-100 rounded"
                                                title="Dismiss suggestions"
                                              >
                                                <X className="h-3 w-3" />
                                              </button>
                                              <SuggestedActions
                                                actions={suggestedActions}
                                                workflowName={suggestionsWorkflowName}
                                                isGenerating={isGeneratingSuggestions}
                                                spotlightActionId={
                                                  tutorialStep === 5
                                                    ? "explain-workflow"
                                                    : tutorialStep === 12
                                                      ? "demo-search"
                                                      : null
                                                }
                                                spotlightTooltip={
                                                  tutorialStep === 5
                                                    ? "Click to understand this workflow"
                                                    : tutorialStep === 12
                                                      ? "Click to run this demo"
                                                      : ""
                                                }
                                                onActionClick={prompt => {
                                                  console.log("[SUGGESTED-ACTION] Prefilling input:", prompt);
                                                  // During tutorial step 5, prefill and advance to step 6 (Send button)
                                                  if (tutorialStep === 5 && prompt.includes("Explain")) {
                                                    console.log(
                                                      "[App] Tutorial step 5: Clicked Explain, prefilling and advancing to step 6..."
                                                    );
                                                    setInput(prompt);
                                                    advanceTutorial();
                                                    setTimeout(() => {
                                                      if (inputRef.current) {
                                                        inputRef.current.focus();
                                                      }
                                                    }, 50);
                                                    return;
                                                  }
                                                  // During tutorial step 12, prefill and advance to step 13 (Send button)
                                                  if (tutorialStep === 12 && prompt.includes("mediar")) {
                                                    console.log(
                                                      "[App] Tutorial step 12: Clicked Demo Search, prefilling and advancing to step 13..."
                                                    );
                                                    setInput(prompt);
                                                    advanceTutorial();
                                                    setTimeout(() => {
                                                      if (inputRef.current) {
                                                        inputRef.current.focus();
                                                      }
                                                    }, 50);
                                                    return;
                                                  }
                                                  setInput(prompt);
                                                  setTimeout(() => {
                                                    if (inputRef.current) {
                                                      inputRef.current.focus();
                                                      inputRef.current.setSelectionRange(
                                                        inputRef.current.value.length,
                                                        inputRef.current.value.length
                                                      );
                                                    }
                                                  }, 50);
                                                }}
                                              />
                                            </div>
                                          )}
                                          {showFeedbackNotification && (
                                            <div className="mb-3 flex justify-center animate-in slide-in-from-top-2 duration-300">
                                              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-md border-2 border-black rounded-lg shadow-lg">
                                                <div className="flex items-center gap-2">
                                                  <div className="w-2 h-2 bg-black rounded-full animate-pulse"></div>
                                                  <span className="text-xs font-medium text-black">
                                                    Please provide feedback
                                                  </span>
                                                </div>
                                                <button
                                                  onClick={() => setShowFeedbackNotification(false)}
                                                  className="text-black hover:text-gray-600 transition-colors p-0.5 hover:bg-gray-100 rounded"
                                                  title="Dismiss"
                                                >
                                                  <X className="h-3 w-3" />
                                                </button>
                                              </div>
                                            </div>
                                          )}

                                          {/* Pasted images preview */}
                                          {pendingImages.length > 0 && (
                                            <div className="flex gap-2 mb-2 flex-wrap">
                                              {pendingImages.map((img, idx) => (
                                                <div key={idx} className="relative group">
                                                  <img
                                                    src={`data:${img.mimeType};base64,${img.data}`}
                                                    alt={`Pasted image ${idx + 1}`}
                                                    className="h-16 w-auto rounded border border-gray-300 object-contain"
                                                  />
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setPendingImages(prev => prev.filter((_, i) => i !== idx))
                                                    }
                                                    className="absolute -top-1 -right-1 bg-black text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                  >
                                                    <X className="h-3 w-3" />
                                                  </button>
                                                </div>
                                              ))}
                                            </div>
                                          )}

                                          {/* Ask/Act/X Mode Toggle - hidden on homepage */}
                                          {mode !== "homepage" && (
                                            <div className="flex items-center gap-2 mb-1">
                                              <div className="h-5 flex items-center border border-black rounded overflow-hidden text-[10px] cursor-pointer">
                                                <button
                                                  type="button"
                                                  onClick={() => setMode("ask")}
                                                  title="Ask mode: AI analyzes but cannot execute tools"
                                                  className={`px-1.5 h-full transition-colors ${
                                                    mode === "ask"
                                                      ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
                                                      : "[.theme-classic_&]:bg-white [.theme-classic_&]:text-black [.theme-classic_&]:hover:bg-gray-100 [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90"
                                                  }`}
                                                >
                                                  Ask
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setMode("act")}
                                                  title="Act mode: AI can execute all tools"
                                                  className={`px-1.5 h-full transition-colors ${
                                                    mode === "act"
                                                      ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
                                                      : "[.theme-classic_&]:bg-white [.theme-classic_&]:text-black [.theme-classic_&]:hover:bg-gray-100 [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90"
                                                  }`}
                                                >
                                                  Act
                                                </button>
                                                {experimentalFeatures.xModeEnabled && (
                                                  <button
                                                    type="button"
                                                    onClick={() => setMode("x")}
                                                    title="X mode: JS tool (run_command) and file tools only"
                                                    className={`px-1.5 h-full transition-colors ${
                                                      mode === "x"
                                                        ? "[.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black"
                                                        : "[.theme-classic_&]:bg-white [.theme-classic_&]:text-black [.theme-classic_&]:hover:bg-gray-100 [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90"
                                                    }`}
                                                  >
                                                    X
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          )}

                                          <form onSubmit={handleSubmit} className="flex gap-2 items-stretch">
                                            <AutoExpandTextarea
                                              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                                              value={input}
                                              onChange={handleInputChangeWithNotification}
                                              onSubmit={() => {
                                                if ((input.trim() || pendingImages.length > 0) && isMcpAvailable()) {
                                                  handleSubmit({ preventDefault: () => {} } as React.FormEvent);
                                                }
                                              }}
                                              onPasteImage={images => {
                                                setPendingImages(prev => [...prev, ...images]);
                                              }}
                                              placeholder={getInputPlaceholder()}
                                              disabled={!isMcpAvailable()}
                                              maxHeight={200}
                                              className={`flex-1 min-w-0 ${getInputStyling()}`}
                                              style={
                                                { userSelect: "text", WebkitUserSelect: "text" } as React.CSSProperties
                                              }
                                            />

                                            {isLoading && !input.trim() ? (
                                              <Button
                                                type="button"
                                                onClick={() => {
                                                  stop();
                                                  if (workflowState === "executing") {
                                                    interruptStep();
                                                  }
                                                }}
                                                className="px-3 flex-shrink-0 transition-colors relative h-full"
                                                title="Stop AI response (Space)"
                                              >
                                                <Square className="h-4 w-4 fill-red-500 text-red-500" />
                                                {shortcutsEnabled && (
                                                  <span className="absolute -top-2 -right-2 bg-white/5 backdrop-blur-md text-black px-0.5 py-0 rounded border border-black text-[8px] leading-none">
                                                    Space
                                                  </span>
                                                )}
                                              </Button>
                                            ) : (
                                              <SpotlightHint
                                                show={tutorialStep === 6 || tutorialStep === 10 || tutorialStep === 13}
                                                tooltip="Click to send"
                                                arrowPosition="bottom"
                                              >
                                                <Button
                                                  type="submit"
                                                  disabled={!input.trim() || !isMcpAvailable()}
                                                  className="px-3 flex-shrink-0 transition-colors h-full"
                                                  title={isLoading ? "Interrupt and send message" : "Send message"}
                                                  onClick={() => {
                                                    // Step 6: After sending, wait for AI response then advance to step 7
                                                    if (tutorialStep === 6) {
                                                      console.log(
                                                        "[App] Tutorial step 6: Send clicked, waiting for AI response..."
                                                      );
                                                      setWaitingForTutorialAI(true);
                                                    }
                                                    // Step 10: After sending "open chrome", wait for AI then advance to step 11
                                                    if (tutorialStep === 10) {
                                                      console.log(
                                                        "[App] Tutorial step 10: Send clicked, waiting for 'open chrome' execution..."
                                                      );
                                                      setWaitingForTutorialOpenChrome(true);
                                                    }
                                                    // Step 13: After sending demo search, wait for AI response then continue to step 14
                                                    if (tutorialStep === 13) {
                                                      console.log(
                                                        "[App] Tutorial step 13: Send clicked, waiting for demo search AI response..."
                                                      );
                                                      setWaitingForTutorialDemoSearchAI(true);
                                                    }
                                                  }}
                                                >
                                                  <Send className="h-4 w-4" />
                                                </Button>
                                              </SpotlightHint>
                                            )}
                                          </form>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </ErrorBoundary>
                          </Panel>
                        ) : null}
                      </PanelGroup>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* MCP Tools Panel moved to Settings tab */}
          </div>
        )}

        {/* Minimized mode or service mode */}
        {(!overlayVisible || !showChatUI) && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8">
              <h2 className="text-xl font-semibold text-gray-600 mb-2">Mediar Agent</h2>
              <p className="text-gray-500 mb-4">Running in background mode</p>

              {/* Recording Status */}
              <div className="flex items-center justify-center gap-2 mb-4">
                <div className={`w-2 h-2 rounded-full ${isRecording ? "bg-red-500 animate-pulse" : "bg-gray-400"}`} />
                <span className="text-sm text-gray-600">{isRecording ? "Recording workflow" : "Standby"}</span>
              </div>

              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOverlayVisible(true)}
                  className="flex items-center gap-2"
                >
                  Show Interface
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleRecording()}
                  className={`flex items-center gap-2 relative ${isRecording ? "text-red-600 border-red-300" : ""}`}
                  title={isRecording ? "Stop Recording (Shift+Space)" : "Start Recording (Shift+Space)"}
                >
                  <div className={`w-2 h-2 rounded-full ${isRecording ? "bg-red-500" : "bg-gray-400"}`} />
                  {isRecording ? "Stop Recording" : "Start Recording"}
                  {shortcutsEnabled && (
                    <span className="absolute -top-2 -right-1 bg-white/5 backdrop-blur-md text-black px-1 py-0.5 rounded border border-black text-[10px] leading-none font-medium">
                      ⇧Space
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Workflow Input Dialog - collect inputs before execution */}
        {currentWorkflow?.inputs && currentWorkflow.inputs.length > 0 && (
          <WorkflowInputDialog
            isOpen={workflowInputDialog.isOpen}
            onClose={() => setWorkflowInputDialog({ isOpen: false, onConfirm: null })}
            onConfirm={inputs => {
              if (workflowInputDialog.onConfirm) {
                workflowInputDialog.onConfirm(inputs);
              }
            }}
            inputs={currentWorkflow.inputs}
            workflowId={currentWorkflow.id?.toString() ?? ""}
            workflowName={currentWorkflow.name}
            isLoading={isExecuting}
          />
        )}

        {/* New Workflow Name Input Dialog */}
        <NameInputDialog
          isOpen={showNameInputDialog}
          isLoading={isCreatingWorkflow}
          onClose={() => {
            if (!isCreatingWorkflow) {
              setShowNameInputDialog(false);
            }
          }}
          onConfirm={async workflowName => {
            setIsCreatingWorkflow(true);
            try {
              // Step 16: User clicked Create, advance to step 17 (wait for deps install)
              if (tutorialStep === 16) {
                console.log("[App] Tutorial step 16: Create clicked, setting up wait for deps install");
                setWaitingForTutorialDepsInstall(true);
                advanceTutorial();
              }
              // Create new workflow with user-provided name
              await startRecordingWorkflow(workflowName);
              setShowNameInputDialog(false);
            } catch (error) {
              console.error("Failed to create workflow:", error);
              toast.error("Failed to create workflow");
              // Reset tutorial waiting state on error
              if (tutorialStep === 16 || tutorialStep === 17) {
                setWaitingForTutorialDepsInstall(false);
              }
            } finally {
              setIsCreatingWorkflow(false);
            }
          }}
          title="Create New Workflow"
          description="Enter a name for your new workflow recording"
          placeholder="e.g., Login Flow, Data Export..."
          confirmText="Create"
          defaultValue=""
          showCreateHint={tutorialStep === 16}
          tutorialAutoFillName={tutorialStep === 16 ? "My First Workflow" : undefined}
        />

        {/* Delete Workflow Confirmation Dialog */}
        <ConfirmDialog
          isOpen={deleteConfirmation.isOpen}
          isLoading={isDeletingWorkflow}
          onClose={() => {
            if (!isDeletingWorkflow) {
              setDeleteConfirmation({ isOpen: false, workflowId: null, workflowName: "" });
            }
          }}
          onConfirm={async () => {
            setIsDeletingWorkflow(true);
            try {
              const result = await deleteWorkflow(deleteConfirmation.workflowId);
              if (!result.success) {
                console.error(`Failed to delete workflow: ${result.error}`);
                toast.error(`Failed to delete workflow: ${result.error}`);
              } else if (deleteConfirmation.workflowId !== null) {
                // Cleanup AI session for deleted workflow
                clearWorkflowSession(String(deleteConfirmation.workflowId));
                console.log(`[APP] Cleaned up session for deleted workflow: ${deleteConfirmation.workflowId}`);
              }
            } finally {
              setIsDeletingWorkflow(false);
              setDeleteConfirmation({ isOpen: false, workflowId: null, workflowName: "" });
            }
          }}
          title="Delete Workflow"
          description={`Are you sure you want to delete "${deleteConfirmation.workflowName}"? This action cannot be undone and will permanently remove the workflow file.`}
          confirmText="Delete"
          cancelText="Cancel"
          variant="destructive"
        />

        {/* Autoclone Confirmation Dialog - for read-only public workflows */}
        <ConfirmDialog
          isOpen={autocloneDialog.isOpen}
          isLoading={isAutocloning}
          onClose={handleAutocloneCancel}
          onConfirm={handleAutocloneConfirm}
          title="Create Your Own Copy?"
          description={`"${autocloneDialog.workflowName}" is a read-only public workflow. To make changes, we'll create a copy in your account.`}
          confirmText="Clone & Edit"
          cancelText="Cancel"
          variant="default"
        />

        {/* Update Modal */}
        <UpdateModal
          isOpen={showUpdateModal}
          updateInfo={updateInfo}
          onDownload={handleDownloadUpdate}
          onRemindLater={handleRemindLaterUpdate}
          onSkipVersion={handleSkipUpdate}
          isDownloading={isDownloadingUpdate}
          downloadProgress={updateDownloadProgress}
          isReadyToInstall={isUpdateReadyToInstall}
          onInstallAndRestart={handleInstallAndRestart}
        />

        {/* Onboarding Booking Modal - opt-in via top bar button */}
        <WelcomeModal
          open={showOnboardingBooking}
          onCalBookingComplete={completeCalBooking}
          onDecline={declineOnboarding}
          onClose={closeOnboardingBooking}
          userEmail={authStatus.user?.email}
          userId={authStatus.user?.userId}
        />

        {/* Validation Error Modal */}
        <ValidationErrorDialog
          isOpen={showValidationErrorDialog}
          onClose={() => {
            setShowValidationErrorDialog(false);
            setValidationError(null);
          }}
          error={validationError}
        />

        {/* Workflow Execution Error Modal (module errors, syntax errors, etc.) */}
        <WorkflowExecutionErrorDialog
          isOpen={showWorkflowExecutionErrorDialog}
          onClose={() => {
            setShowWorkflowExecutionErrorDialog(false);
            setWorkflowExecutionError(null);
            setWorkflowExecutionErrorRaw(null);
          }}
          error={workflowExecutionError}
          onTroubleshoot={
            workflowExecutionError
              ? () => {
                  console.log("[APP] Prefilling AI troubleshooting with full failure context");
                  // Build a rich failure context message (similar to buildFailureContextPrompt)
                  let prompt = `## EXECUTION FAILURE DETAILS\n\n`;

                  // Basic info
                  if (workflowExecutionError.workflowName) {
                    prompt += `**Workflow:** ${workflowExecutionError.workflowName}\n`;
                  }
                  prompt += `**Error Type:** ${workflowExecutionError.category}\n`;
                  if (workflowExecutionError.exitCode !== undefined) {
                    prompt += `**Exit Code:** ${workflowExecutionError.exitCode}\n`;
                  }
                  prompt += `\n`;

                  // Error message
                  prompt += `**Error:**\n\`\`\`\n${workflowExecutionError.message || "Workflow execution failed"}\n\`\`\`\n\n`;

                  // File path if available
                  if (workflowExecutionError.filePath) {
                    prompt += `**File:** ${workflowExecutionError.filePath}\n\n`;
                  }

                  // Suggestion if available
                  if (workflowExecutionError.suggestion) {
                    prompt += `**Suggestion:** ${workflowExecutionError.suggestion}\n\n`;
                  }

                  // Full stderr
                  if (workflowExecutionError.stderr) {
                    prompt += `**stderr:**\n\`\`\`\n${workflowExecutionError.stderr}\n\`\`\`\n\n`;
                  }

                  // Full stdout
                  if (workflowExecutionError.stdout) {
                    prompt += `**stdout:**\n\`\`\`\n${workflowExecutionError.stdout}\n\`\`\`\n\n`;
                  }

                  prompt += `---\n\nPlease help me troubleshoot this error.`;

                  // Open chat panel, switch to ask mode, prefill input, and focus
                  window.dispatchEvent(new CustomEvent("open-ai-chat"));
                  setMode("ask");
                  console.log("[APP] Switched to ask mode for troubleshooting");
                  setInput(prompt);
                  // Focus input after a short delay to ensure chat panel is open
                  setTimeout(() => {
                    if (inputRef.current) {
                      inputRef.current.focus();
                      // Move cursor to end
                      inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
                    }
                  }, 150);
                }
              : undefined
          }
        />

        {/* Recording Mode Selection Dialog */}
        <RecordingModeDialog
          isOpen={showRecordingModeDialog}
          onClose={handleRecordingModeDialogClose}
          onConfirm={handleRecordingModeSelected}
        />

        {/* Target App Selection Dialog for Recording */}
        <TargetAppDialog
          isOpen={showTargetAppDialog}
          onClose={handleTargetAppDialogClose}
          onConfirm={handleTargetAppSelected}
        />

        {/* Wrong App Dialog */}
        {wrongAppInfo && (
          <WrongAppDialog
            isOpen={showWrongAppDialog}
            onClose={handleWrongAppCancel}
            onRestart={handleWrongAppRestart}
            targetAppName={wrongAppInfo.targetAppName}
            actualAppName={wrongAppInfo.actualAppName}
          />
        )}

        {/* Onboarding Success Modal */}
        <FirstRecordingSuccess
          open={showSuccessModal}
          workflowName={currentWorkflow?.name || "Your Workflow"}
          steps={(currentWorkflow?.content?.arguments as any)?.steps || []}
          onRunWorkflow={async () => {
            closeSuccessModal();
            if (currentWorkflow) {
              completeFirstRun();

              // Show success toast
              toast.success("🎉 Success! Your workflow ran perfectly.", {
                description: "You just automated your first task!",
                duration: 5000,
              });

              await startWorkflow(currentWorkflow.id);
            }
          }}
          onSaveForLater={closeSuccessModal}
        />

        {/* Onboarding Demo Modal - Step 18: Explain what will happen before auto-recording */}
        <OnboardingDemoModal
          open={tutorialStep === 18}
          onStartDemo={async () => {
            console.log("[App] Tutorial step 18: User clicked Start Demo, starting auto-recording");
            advanceTutorial(); // Move to step 19
            setIsRunningOnboardingRecordingDemo(true);

            try {
              // Set continuous recording mode
              console.log("[App] Setting recording mode to continuous...");
              await invoke("set_recording_mode", { stepByStep: false });

              // Start recording (append to existing workflow that was just created)
              console.log("[App] Starting recording for demo...");
              await toggleRecording(undefined, true); // Append to existing workflow

              // Small delay to ensure recording is started
              await new Promise(resolve => setTimeout(resolve, 500));

              // Execute the demo workflow
              const { localDataDir } = await import("@tauri-apps/api/path");
              const dataDir = await localDataDir();
              const demoWorkflowPath = `file:///${dataDir.replace(/\\/g, "/")}workflows/${RECORDING_DEMO_WORKFLOW_UUID}/src/terminator.ts`;
              console.log("[App] Executing demo workflow:", demoWorkflowPath);

              const result = await callTool("execute_sequence", {
                url: demoWorkflowPath,
                inputs: {},
                selectors: {},
                output_parser: {},
                output: {},
              });
              console.log("[App] Demo workflow completed:", result);

              // Stop recording - this will trigger local processing and AI post-processing
              console.log("[App] Stopping recording...");
              await stopRecording(true); // fromRecordingBar = true to trigger proper save flow

              // The recorder-session-ready event will be fired when local processing completes,
              // which will trigger triggerRecorderSession and AI post-processing.
              // The tutorial will be completed when the AI finishes processing.
              console.log("[App] Recording stopped, waiting for AI post-processing...");
            } catch (error) {
              console.error("[App] Demo recording failed:", error);
              toast.error("Demo recording failed. Skipping to completion.");
              // Skip to completion on error
              advanceTutorial();
            } finally {
              setIsRunningOnboardingRecordingDemo(false);
            }
          }}
        />

        {/* Elicitation Modal - AI questions during workflow */}
        <ElicitationModal />

        {/* Toast Notifications */}
        <Toaster
          position="top-center"
          icons={{
            success: <CheckCircle2 className="w-4 h-4" />,
            info: <Info className="w-4 h-4" />,
            warning: <AlertTriangle className="w-4 h-4" />,
            error: <XCircle className="w-4 h-4" />,
          }}
          toastOptions={{
            classNames: {
              toast: "bg-white !border !border-black shadow-sm !rounded-none",
              title: "text-black font-medium text-sm",
              description: "text-black text-xs",
              icon: "text-black",
              success: "bg-white !border !border-black !rounded-none",
              error: "bg-white !border !border-black !rounded-none",
              warning: "bg-white !border !border-black !rounded-none",
              info: "bg-white !border !border-black !rounded-none",
            },
          }}
        />

        {/* Live Execution Console for scheduled workflows */}
        <LiveExecutionConsole />

        {/* Crisp Chat Widget */}
        <CrispChat />
      </div>
    </AIComponentProvider>
  );
}
