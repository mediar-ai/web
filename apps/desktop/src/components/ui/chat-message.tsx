import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Edit2,
  GitBranch,
  Play,
  RefreshCw,
  Save,
  WifiOff,
  X,
} from "lucide-react";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { PromptPart } from "@/lib/workflow-context";
import type { ComponentState } from "@/lib/runtime-jsx";
import { useAppContext } from "@/contexts/AIComponentContext";
import { AIGeneratedComponent } from "./ai-generated-component";
import { Button } from "./button";
import { MarkdownRenderer } from "./markdown-renderer";
import { SuggestedActions } from "./suggested-actions";
import { Textarea } from "./textarea";

// Extended message type to support custom components
export interface InteractiveComponent {
  type: "button_list" | "suggested_actions" | "custom" | "generated_ui";
  props: any;
}

// AI-generated component definition
export interface GeneratedComponent {
  jsx: string;
  initialState?: ComponentState;
}

interface ChatMessageProps {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  isStreaming?: boolean;
  interactiveComponent?: InteractiveComponent;
  /** Pasted images included with user messages */
  images?: Array<{ data: string; mimeType: string }>;
  /** Prompt breakdown for debugging (user messages only) */
  promptBreakdown?: PromptPart[];
  /** Total estimated tokens for the prompt */
  promptTotalTokens?: number;
  error?: {
    message: string;
    type: string;
    canRetry?: boolean;
    originalMessage?: string;
    isAutoRetrying?: boolean;
    retryCountdown?: number;
    partialContent?: boolean; // True when error occurred after partial response streamed
  };
  onEdit?: (id: string, newContent: string) => void;
  onRegenerate?: (id: string) => void;
  /** Fork chat from this message (keep only messages up to this one) */
  onFork?: (id: string) => void;
  /** AI-generated component to render */
  generatedComponent?: GeneratedComponent;
  /** Callback when AI component executes an action */
  onGeneratedAction?: (functionName: string, result: unknown) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  id,
  content,
  role,
  timestamp,
  isStreaming = false,
  interactiveComponent,
  images,
  promptBreakdown,
  promptTotalTokens,
  error,
  onEdit,
  onRegenerate,
  onFork,
  generatedComponent,
  onGeneratedAction,
}) => {
  const appContext = useAppContext();
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [showActions, setShowActions] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [showPromptBreakdown, setShowPromptBreakdown] = useState(false);
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 300; // ~12 lines max before scrolling
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }, []);

  // Adjust height when editing starts or content changes
  useEffect(() => {
    if (isEditing) {
      adjustTextareaHeight();
    }
  }, [isEditing, editContent, adjustTextareaHeight]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy message:", err);
    }
  };

  const copyPromptToClipboard = async () => {
    if (!promptBreakdown) return;
    try {
      // Build full prompt content from breakdown parts
      const fullPrompt = promptBreakdown
        .map(part => {
          let partContent = `=== ${part.name} ===\n${part.content || ""}`;
          if (part.children && part.children.length > 0) {
            partContent += "\n" + part.children.map(child => `  - ${child.name}: ${child.content || ""}`).join("\n");
          }
          return partContent;
        })
        .join("\n\n");
      await navigator.clipboard.writeText(fullPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy prompt:", err);
    }
  };

  const handleEdit = () => {
    if (role === "user" && onEdit) {
      setIsEditing(true);
      setEditContent(content);
    }
  };

  const handleSaveEdit = () => {
    if (onEdit && editContent.trim() !== content) {
      onEdit(id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(content);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    // Ctrl+Enter (or Cmd+Enter on Mac) to save
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <div
      className={cn("group relative py-4 px-4 transition-colors w-full")}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar removed */}

      {/* Message Content */}
      <div className={cn("w-full max-w-3xl mx-auto", role === "user" ? "flex justify-end mb-3" : "mb-3")}>
        {isEditing ? (
          <div className="space-y-2 max-w-[80%] ml-auto">
            <Textarea
              ref={textareaRef}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              onKeyDown={handleKeyPress}
              className="w-full min-h-[40px] resize-none bg-black text-white border-black rounded-2xl px-4 py-2"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={handleSaveEdit} className="h-7 px-2 text-xs border-black">
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelEdit} className="h-7 px-2 text-xs text-black">
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "relative break-words",
              role === "user"
                ? "bg-black text-white border border-black rounded-2xl px-4 py-2 max-w-[80%] font-bold"
                : "max-w-[90%] bg-white border border-black rounded-2xl px-4 py-2"
            )}
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            {/* Error Display - Compact */}
            {error && (
              <div
                className={cn(
                  "mb-2 p-2 rounded-lg",
                  error.type === "rate_limited" && "bg-gray-50",
                  error.type === "malformed_function_call" && "bg-orange-50",
                  error.type !== "rate_limited" && error.type !== "malformed_function_call" && "bg-gray-50"
                )}
                title={`${error.message}${error.originalMessage ? `\n\nRetrying: "${error.originalMessage.slice(0, 100)}${error.originalMessage.length > 100 ? "..." : ""}"` : ""}`}
              >
                {(() => {
                  // Determine error type and icon
                  const isTimeout = error.message.toLowerCase().includes("timeout");
                  const isConnection =
                    error.type === "connection_refused" || error.message.toLowerCase().includes("connect");
                  const isRateLimit = error.type === "rate_limited";
                  const isMalformed = error.type === "malformed_function_call";

                  const ErrorIcon = isTimeout
                    ? Clock
                    : isConnection
                      ? WifiOff
                      : isMalformed
                        ? AlertTriangle
                        : RefreshCw;
                  const errorTitle = isTimeout
                    ? "Timed Out"
                    : isConnection
                      ? "Connection Error"
                      : isRateLimit
                        ? "Rate Limited"
                        : isMalformed
                          ? "AI Response Error"
                          : "Error";
                  const iconColor = isMalformed ? "text-orange-600" : "text-gray-600";
                  const textColor = isMalformed ? "text-orange-700" : "text-gray-700";

                  return (
                    <div className="flex items-center gap-2">
                      <ErrorIcon className={cn("h-4 w-4 shrink-0", iconColor, isRateLimit && "animate-spin")} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-medium", textColor)}>{errorTitle}</span>
                          {error.originalMessage && (
                            <span className="text-[10px] text-gray-400 truncate max-w-[150px]">
                              "{error.originalMessage.slice(0, 30)}
                              {error.originalMessage.length > 30 ? "..." : ""}"
                            </span>
                          )}
                        </div>
                        {/* Show detailed message for connection/rate limit errors */}
                        {isConnection && (
                          <p className="text-[10px] text-gray-500 mt-0.5">Check that AI server is running</p>
                        )}
                        {isRateLimit && (
                          <p className="text-[10px] text-gray-500 mt-0.5">{error.message}</p>
                        )}
                      </div>
                      {/* Retry/Continue button - inline */}
                      {error.canRetry && error.originalMessage && onRegenerate && !isRateLimit && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRegenerate(id)}
                          className="h-6 text-[10px] px-2 shrink-0"
                          title={
                            error.partialContent ? "Continue generating from where it stopped" : "Retry the request"
                          }
                        >
                          {error.partialContent ? (
                            <>
                              <Play className="h-3 w-3 mr-1" />
                              Continue
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Retry
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Action Buttons - Positioned at bottom aligned with timestamp */}
            {!isEditing && (showActions || copied) && (
              <div
                className={cn(
                  "absolute -bottom-5 right-2 sm:right-4 flex gap-1 bg-white/5 backdrop-blur-md border border-black rounded-lg shadow-sm px-1 py-1 z-10",
                  "opacity-0 group-hover:opacity-100 transition-opacity duration-200",
                  showActions && "opacity-100"
                )}
              >
                {/* Fork Button (all messages) - start new chat from this point - FIRST/LEFTMOST */}
                {onFork && !isStreaming && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onFork(id)}
                    className="h-5 w-5 p-0"
                    title="Fork chat from here (keep only messages up to this point)"
                  >
                    <GitBranch
                      className={cn("h-3 w-3", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}
                    />
                  </Button>
                )}

                {/* Copy Button */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={copyToClipboard}
                  className="h-5 w-5 p-0"
                  title="Copy message"
                >
                  {copied ? (
                    <Check className={cn("h-3 w-3", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")} />
                  ) : (
                    <Copy className={cn("h-3 w-3", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")} />
                  )}
                </Button>

                {/* Edit Button (User messages only) */}
                {role === "user" && onEdit && (
                  <Button size="sm" variant="ghost" onClick={handleEdit} className="h-5 w-5 p-0" title="Edit message">
                    <Edit2 className={cn("h-3 w-3", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")} />
                  </Button>
                )}

                {/* Prompt Breakdown Toggle (User messages with breakdown only) */}
                {role === "user" && promptBreakdown && promptBreakdown.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPromptBreakdown(!showPromptBreakdown)}
                    className="h-5 px-1 text-[10px] [.theme-classic_&]:bg-black [.theme-classic_&]:text-white [.theme-classic_&]:hover:bg-black/80 [.theme-inverted_&]:bg-white [.theme-inverted_&]:text-black [.theme-inverted_&]:hover:bg-white/80"
                    title="Show prompt breakdown"
                  >
                    {promptTotalTokens ? `${(promptTotalTokens / 1000).toFixed(2)}k` : "ctx"}
                    {showPromptBreakdown ? (
                      <ChevronUp className="h-3 w-3 ml-0.5" />
                    ) : (
                      <ChevronDown className="h-3 w-3 ml-0.5" />
                    )}
                  </Button>
                )}

                {/* Regenerate Button (Assistant messages only) */}
                {role === "assistant" && onRegenerate && !isStreaming && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRegenerate(id)}
                    className="h-5 w-5 p-0"
                    title="Regenerate response"
                  >
                    <RefreshCw
                      className={cn("h-3 w-3", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}
                    />
                  </Button>
                )}
              </div>
            )}

            {/* Prompt Breakdown Panel (User messages only) */}
            {role === "user" && showPromptBreakdown && promptBreakdown && promptBreakdown.length > 0 && (
              <div className="mt-2 mb-2 p-2 [.theme-classic_&]:bg-black [.theme-inverted_&]:bg-white rounded-lg border border-white/20 text-[10px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold [.theme-classic_&]:text-white/80 [.theme-inverted_&]:text-black/80">
                    Prompt Breakdown
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={copyPromptToClipboard}
                      className="h-5 px-1.5 text-[10px] [.theme-classic_&]:text-white/60 [.theme-classic_&]:hover:text-white [.theme-inverted_&]:text-black/60 [.theme-inverted_&]:hover:text-black"
                      title="Copy full prompt to clipboard"
                    >
                      {promptCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!promptBreakdown) return;
                        const fullPrompt = promptBreakdown
                          .map(part => {
                            let partContent = `=== ${part.name} ===\n${part.content || ""}`;
                            if (part.children && part.children.length > 0) {
                              partContent +=
                                "\n" +
                                part.children.map(child => `  - ${child.name}: ${child.content || ""}`).join("\n");
                            }
                            return partContent;
                          })
                          .join("\n\n");
                        try {
                          const { invoke } = await import("@tauri-apps/api/core");
                          await invoke("open_in_notepad", { content: fullPrompt });
                        } catch (err) {
                          console.error("Failed to open in notepad:", err);
                        }
                      }}
                      className="h-5 px-1.5 text-[10px] [.theme-classic_&]:text-white/60 [.theme-classic_&]:hover:text-white [.theme-inverted_&]:text-black/60 [.theme-inverted_&]:hover:text-black"
                      title="Open in Notepad"
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-0.5">
                  {(() => {
                    // Group workflow-related parts into "Workflow Context"
                    const workflowParts = ["Workflow Name", "Step Mapping", "Workflow Files"];
                    const grouped: PromptPart[] = [];
                    let workflowTokens = 0;
                    let workflowContent = "";

                    for (const part of promptBreakdown) {
                      if (workflowParts.includes(part.name)) {
                        workflowTokens += part.tokens;
                        workflowContent += part.content + "\n";
                      } else {
                        grouped.push(part);
                      }
                    }

                    // Add grouped workflow context if any
                    if (workflowTokens > 0) {
                      grouped.unshift({ name: "Workflow Context", tokens: workflowTokens, content: workflowContent });
                    }

                    const toggleExpand = (name: string) => {
                      setExpandedParts(prev => {
                        const next = new Set(prev);
                        if (next.has(name)) {
                          next.delete(name);
                        } else {
                          next.add(name);
                        }
                        return next;
                      });
                    };

                    return grouped.map((part, idx) => (
                      <div key={idx}>
                        <div
                          className={cn(
                            "flex justify-between gap-2",
                            part.children && part.children.length > 0 && "cursor-pointer hover:opacity-80"
                          )}
                          onClick={() => part.children && part.children.length > 0 && toggleExpand(part.name)}
                        >
                          <span
                            className="[.theme-classic_&]:text-white/70 [.theme-inverted_&]:text-black/70 truncate flex items-center gap-1"
                            title={part.content || `${part.children?.length || 0} items`}
                          >
                            {part.children &&
                              part.children.length > 0 &&
                              (expandedParts.has(part.name) ? (
                                <ChevronDown className="h-3 w-3 shrink-0" />
                              ) : (
                                <ChevronRight className="h-3 w-3 shrink-0" />
                              ))}
                            {part.name}
                            {part.children && <span className="text-[9px] opacity-60">({part.children.length})</span>}
                          </span>
                          <span className="[.theme-classic_&]:text-white/90 [.theme-inverted_&]:text-black/90 font-mono whitespace-nowrap">
                            {(part.tokens / 1000).toFixed(2)}k
                          </span>
                        </div>
                        {/* Nested children (e.g., individual tools) */}
                        {part.children && expandedParts.has(part.name) && (
                          <div className="ml-3 mt-0.5 space-y-0.5 border-l [.theme-classic_&]:border-white/20 [.theme-inverted_&]:border-black/20 pl-2">
                            {part.children.map((child, childIdx) => (
                              <div key={childIdx} className="flex justify-between gap-2 text-[9px] group/tool relative">
                                <span className="[.theme-classic_&]:text-white/50 [.theme-inverted_&]:text-black/50 truncate cursor-help">
                                  {child.name}
                                </span>
                                <span className="[.theme-classic_&]:text-white/70 [.theme-inverted_&]:text-black/70 font-mono whitespace-nowrap">
                                  {(child.tokens / 1000).toFixed(2)}k
                                </span>
                                {child.content && (
                                  <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover/tool:block max-w-[300px] max-h-[200px] overflow-y-auto p-2 text-[10px] rounded border [.theme-classic_&]:bg-black [.theme-classic_&]:border-white/30 [.theme-classic_&]:text-white/80 [.theme-inverted_&]:bg-white [.theme-inverted_&]:border-black/30 [.theme-inverted_&]:text-black/80 shadow-lg whitespace-pre-wrap">
                                    {child.content}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                  <div className="flex justify-between gap-2 border-t [.theme-classic_&]:border-white/20 [.theme-inverted_&]:border-black/20 pt-1 mt-1">
                    <span className="[.theme-classic_&]:text-white/70 [.theme-inverted_&]:text-black/70">Total</span>
                    <span className="[.theme-classic_&]:text-white/90 [.theme-inverted_&]:text-black/90 font-mono whitespace-nowrap">
                      {((promptTotalTokens ?? 0) / 1000).toFixed(2)}k
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div
              className="chat-message-content w-full break-words"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {/* Render pasted images for user messages */}
              {role === "user" && images && images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {images.map((img, idx) => {
                    const imgSrc = `data:${img.mimeType};base64,${img.data}`;
                    return (
                      <div key={idx} className="relative group">
                        <img
                          src={imgSrc}
                          alt={`Attached image ${idx + 1}`}
                          className="max-w-[200px] max-h-32 rounded border border-white/30 cursor-pointer hover:border-white/60 transition-colors object-contain"
                          onMouseDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setExpandedImage(imgSrc);
                          }}
                        />
                        <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                          Click to enlarge
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Render content or loading state - don't show dot if error exists */}
              {!error && (!content || content === "undefined" || !content.trim()) ? (
                <span className="animate-pulse text-black text-xs">●</span>
              ) : content && content !== "undefined" && content.trim() ? (
                <MarkdownRenderer
                  content={content.trim()}
                  className={cn(
                    "text-xs leading-relaxed break-words",
                    role === "user" ? "text-white" : "text-gray-900"
                  )}
                  inheritColor={role === "user"}
                />
              ) : null}
              {/* Streaming cursor - only when actively streaming with content */}
              {isStreaming && content && content.trim() && <span className="animate-pulse ml-1 text-black">|</span>}
            </div>

            {/* Interactive Component - Support for custom components */}
            {role === "assistant" && interactiveComponent && (
              <div className="mt-3 sm:mt-4">
                {interactiveComponent.type === "suggested_actions" && (
                  <SuggestedActions
                    workflowName={interactiveComponent.props.workflowName}
                    actions={interactiveComponent.props.actions}
                    onActionClick={interactiveComponent.props.onActionClick}
                  />
                )}
                {interactiveComponent.type === "button_list" && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {interactiveComponent.props.buttons?.map((button: any, index: number) => (
                        <Button
                          key={index}
                          variant={button.variant || "outline"}
                          size="sm"
                          onClick={() => button.onClick?.(button.value)}
                          className="text-xs"
                        >
                          {button.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AI Generated Component - rendered from JSX code */}
            {role === "assistant" && generatedComponent && (
              <div className="mt-3 border border-black rounded-lg overflow-hidden">
                <AIGeneratedComponent
                  jsx={generatedComponent.jsx}
                  initialState={generatedComponent.initialState}
                  appContext={appContext}
                  onAction={onGeneratedAction}
                  onError={err => console.error("[ChatMessage] Generated component error:", err)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* User Avatar removed */}

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
    </div>
  );
};
