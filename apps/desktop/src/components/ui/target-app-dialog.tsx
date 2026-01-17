import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2, RefreshCw, TreePine, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMcp } from "@/contexts/McpContext";
import { cn } from "@/lib/utils";

export interface ApplicationInfo {
  name: string;
  process_name: string;
  pid: number;
  title?: string;
}

interface TargetAppDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (app: ApplicationInfo) => void | Promise<void>;
  title?: string;
  description?: string;
  isLoading?: boolean;
}

type TreeCaptureStatus = "idle" | "loading" | "success" | "error";

export function TargetAppDialog({
  isOpen,
  onClose,
  onConfirm,
  title = "Select Target Application",
  description = "Choose the application you want to record actions in",
  isLoading = false,
}: TargetAppDialogProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [applications, setApplications] = useState<ApplicationInfo[]>([]);
  const [selectedApp, setSelectedApp] = useState<ApplicationInfo | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [treeCaptureStatus, setTreeCaptureStatus] = useState<TreeCaptureStatus>("idle");
  const [treeCaptureError, setTreeCaptureError] = useState<string | null>(null);
  const { callTool } = useMcp();

  const fetchApplications = useCallback(async () => {
    setIsFetching(true);
    try {
      const response = await callTool("get_applications_and_windows_list", {});
      console.log("[TargetAppDialog] MCP response:", response);

      if (response?.isError) {
        console.error("[TargetAppDialog] Tool returned error:", response);
        return;
      }

      const contentArray = response?.content;
      let data: Record<string, unknown> | null = null;

      if (Array.isArray(contentArray) && contentArray[0]) {
        const content = contentArray[0];
        if (content.type === "text" && content.text) {
          data = JSON.parse(content.text);
        } else if (typeof content === "object") {
          data = content as Record<string, unknown>;
        }
      }

      if (data?.applications && Array.isArray(data.applications)) {
        // Filter out Mediar itself from the list
        const filteredApps = (data.applications as ApplicationInfo[]).filter(
          app => !app.process_name.toLowerCase().includes("mediar")
        );
        setApplications(filteredApps);

        // Auto-select first app if none selected
        if (!selectedApp && filteredApps.length > 0) {
          setSelectedApp(filteredApps[0]);
        }
      }
    } catch (error) {
      console.error("[TargetAppDialog] Failed to get applications:", error);
    } finally {
      setIsFetching(false);
    }
  }, [callTool, selectedApp]);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      fetchApplications();
    } else {
      setIsVisible(false);
      setSelectedApp(null);
      setTreeCaptureStatus("idle");
      setTreeCaptureError(null);
    }
  }, [isOpen, fetchApplications]);

  // Reset tree capture status when app selection changes
  const handleAppSelect = (app: ApplicationInfo) => {
    setSelectedApp(app);
    setTreeCaptureStatus("idle");
    setTreeCaptureError(null);
  };

  // Handle "Get Tree" button click - captures UI tree for selected app
  const handleGetTree = async () => {
    if (!selectedApp) return;

    setTreeCaptureStatus("loading");
    setTreeCaptureError(null);

    try {
      console.log("🌳 [TargetAppDialog] Setting target app and capturing tree...");

      // Store target app in backend first
      await invoke("set_recording_target_app", {
        pid: selectedApp.pid,
        processName: selectedApp.process_name,
        appName: selectedApp.name,
        windowTitle: selectedApp.title || null,
      });
      console.log("✅ [TargetAppDialog] Target app stored in backend");

      // Capture UI tree
      await invoke("capture_target_app_tree_before");
      console.log("✅ [TargetAppDialog] UI tree captured successfully");

      setTreeCaptureStatus("success");
    } catch (error) {
      console.error("❌ [TargetAppDialog] Failed to capture tree:", error);
      setTreeCaptureStatus("error");
      setTreeCaptureError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleConfirm = async () => {
    if (!selectedApp) return;
    await onConfirm(selectedApp);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && selectedApp && !isLoading && !isFetching) {
      if (treeCaptureStatus === "success") {
        handleConfirm();
      } else if (treeCaptureStatus === "idle" || treeCaptureStatus === "error") {
        handleGetTree();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500 mt-1">{description}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              {applications.length > 0 ? `${applications.length} applications` : "Select an application"}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchApplications}
              disabled={isFetching}
              title="Refresh application list"
              className="h-8 w-8"
            >
              <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
            </Button>
          </div>
          <div className="border rounded-md overflow-hidden">
            <ScrollArea className="h-56">
              {isFetching && applications.length === 0 ? (
                <div className="flex items-center justify-center h-full py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading applications...</span>
                </div>
              ) : applications.length === 0 ? (
                <div className="flex items-center justify-center h-full py-8 text-sm text-muted-foreground">
                  No applications found
                </div>
              ) : (
                <div className="divide-y">
                  {applications.map(app => (
                    <button
                      key={`${app.pid}-${app.name}`}
                      onClick={() => handleAppSelect(app)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-100",
                        selectedApp?.pid === app.pid && "bg-blue-50 hover:bg-blue-100"
                      )}
                    >
                      <span className="truncate block">
                        {app.name || app.process_name}
                        {app.title && (
                          <span className="text-muted-foreground">
                            {" - "}
                            {app.title.substring(0, 30)}
                            {app.title.length > 30 ? "..." : ""}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Tree capture status message */}
        {treeCaptureStatus === "error" && treeCaptureError && (
          <div className="px-4 pb-2">
            <p className="text-sm text-red-600">Failed to capture tree: {treeCaptureError}</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
          <Button variant="outline" onClick={onClose} disabled={isLoading || treeCaptureStatus === "loading"}>
            Cancel
          </Button>

          {/* Get Tree button */}
          <Button
            variant="outline"
            onClick={handleGetTree}
            disabled={!selectedApp || isFetching || treeCaptureStatus === "loading" || treeCaptureStatus === "success"}
          >
            {treeCaptureStatus === "loading" ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Capturing...
              </>
            ) : treeCaptureStatus === "success" ? (
              <>
                <Check className="w-4 h-4 mr-2 text-green-600" />
                Tree Captured
              </>
            ) : (
              <>
                <TreePine className="w-4 h-4 mr-2" />
                Get Tree
              </>
            )}
          </Button>

          {/* Start Recording button */}
          <Button onClick={handleConfirm} disabled={!selectedApp || isLoading || treeCaptureStatus !== "success"}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              "Start Recording"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
