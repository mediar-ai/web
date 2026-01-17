import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  Cloud,
  RefreshCw,
  CopyPlus,
  Globe,
  ExternalLink,
  Loader2,
  History,
  ArrowDownToLine,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CloudActionsButtonProps {
  workflowId: string | number;
  isPublic?: boolean;
  isSyncing: boolean;
  needsPull: boolean;
  hasSteps: boolean;
  onSyncToCloud?: () => Promise<{ success: boolean; error?: string }>;
  onCloneWorkflow?: (id: string | number) => Promise<void>;
  onSetWorkflowVisibility?: (id: string | number, isPublic: boolean) => Promise<{ success: boolean; error?: string }>;
  handleDashboard: () => void;
  // Version history props
  workflowPath?: string;
  saveVersion?: (message?: string, authorType?: string) => Promise<unknown>;
  onOpenVersionHistory?: () => void;
  versionsCount?: number;
}

export function CloudActionsButton({
  workflowId,
  isPublic,
  isSyncing,
  needsPull,
  hasSteps,
  onSyncToCloud,
  onCloneWorkflow,
  onSetWorkflowVisibility,
  handleDashboard,
  workflowPath,
  saveVersion,
  onOpenVersionHistory,
  versionsCount = 0,
}: CloudActionsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [isTogglingVisibility, setIsTogglingVisibility] = useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click and Escape key
  React.useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    // Use capture phase to ensure we catch all clicks
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="outline"
        size="icon"
        className={cn("h-6 w-6 flex-shrink-0 relative", needsPull && "ring-2 ring-yellow-400")}
        title="Cloud actions"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
        {needsPull && <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full" />}
      </Button>
      {isOpen && (
        <div
          ref={menuRef}
          className="absolute left-0 top-full mt-1 z-[9999] w-48 rounded-md border bg-white p-1 shadow-md"
        >
          {/* Sync to Cloud */}
          {onSyncToCloud && (
            <button
              onClick={async () => {
                setIsOpen(false);
                // Auto-save version before syncing
                if (workflowPath && saveVersion) {
                  try {
                    await saveVersion("Before cloud sync", "auto");
                  } catch (e) {
                    console.warn("[LOCAL_HISTORY] Failed to save version before sync:", e);
                  }
                }
                await onSyncToCloud();
              }}
              disabled={isSyncing}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-50"
            >
              {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              <span>Sync to Cloud</span>
              {needsPull && (
                <span className="ml-auto text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded">update</span>
              )}
            </button>
          )}
          {/* View History */}
          {workflowPath && onOpenVersionHistory && (
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenVersionHistory();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-gray-100"
            >
              <Clock className="w-3 h-3" />
              <span>View History</span>
              {versionsCount > 0 && (
                <span className="ml-auto text-[10px] bg-gray-100 text-gray-600 px-1 rounded">{versionsCount}</span>
              )}
            </button>
          )}
          {/* Deploy */}
          {hasSteps && (
            <button
              onClick={() => {
                setIsOpen(false);
                handleDashboard();
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-gray-100"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Deploy to Dashboard</span>
            </button>
          )}
          <div className="my-1 h-px bg-gray-200" />
          {/* Clone */}
          {onCloneWorkflow && (
            <button
              onClick={async () => {
                setIsOpen(false);
                setIsCloning(true);
                try {
                  await onCloneWorkflow(workflowId);
                } finally {
                  setIsCloning(false);
                }
              }}
              disabled={isCloning}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-50"
            >
              {isCloning ? <Loader2 className="w-3 h-3 animate-spin" /> : <CopyPlus className="w-3 h-3" />}
              <span>Clone Workflow</span>
            </button>
          )}
          {/* Visibility */}
          {onSetWorkflowVisibility && (
            <button
              onClick={async () => {
                setIsOpen(false);
                setIsTogglingVisibility(true);
                try {
                  await onSetWorkflowVisibility(workflowId, !isPublic);
                } finally {
                  setIsTogglingVisibility(false);
                }
              }}
              disabled={isTogglingVisibility}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-50"
            >
              {isTogglingVisibility ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
              <span>{isPublic ? "Make Private" : "Make Public"}</span>
              {isPublic && <span className="ml-auto text-[10px] bg-green-100 text-green-700 px-1 rounded">public</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
