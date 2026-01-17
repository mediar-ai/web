import { useState, useEffect } from "react";
import { X, Clock, RotateCcw, Trash2, Loader2, Save, User, Bot, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

interface VersionHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  versions: WorkflowVersion[];
  isLoading: boolean;
  isSaving: boolean;
  isRestoring: boolean;
  onSaveVersion: (message?: string) => Promise<WorkflowVersion | null>;
  onRestoreVersion: (versionId: string) => Promise<{ success: boolean; error: string | null }>;
  onDeleteVersion: (versionId: string) => Promise<boolean>;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatFullTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AuthorIcon({ type }: { type: "user" | "ai" | "auto" }) {
  switch (type) {
    case "user":
      return <User className="w-3 h-3 text-blue-500" />;
    case "ai":
      return <Bot className="w-3 h-3 text-purple-500" />;
    case "auto":
      return <Timer className="w-3 h-3 text-gray-400" />;
  }
}

export function VersionHistoryPanel({
  isOpen,
  onClose,
  versions,
  isLoading,
  isSaving,
  isRestoring,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
}: VersionHistoryPanelProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [hoveredVersionId, setHoveredVersionId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRestoring && !isSaving) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isRestoring, isSaving, onClose]);

  const handleSave = async () => {
    const message = saveMessage.trim() || undefined;
    await onSaveVersion(message);
    setSaveMessage("");
    setShowSaveInput(false);
  };

  const handleRestore = async (versionId: string) => {
    const result = await onRestoreVersion(versionId);
    if (result.success) {
      setSelectedVersionId(null);
      toast.success("Version restored successfully");
      onClose();
    } else {
      toast.error("Failed to restore version", {
        description: result.error || "Unknown error occurred",
      });
    }
  };

  const handleDelete = async (versionId: string) => {
    setIsDeleting(versionId);
    try {
      await onDeleteVersion(versionId);
      if (selectedVersionId === versionId) {
        setSelectedVersionId(null);
      }
    } finally {
      setIsDeleting(null);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isRestoring && !isSaving) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleBackdropClick}>
      <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 backdrop-blur-md border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white rounded-lg shadow-lg w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 [.theme-classic_&]:border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-b [.theme-inverted_&]:border-white bg-gray-50 dark:bg-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 [.theme-classic_&]:text-gray-600 [.theme-inverted_&]:text-gray-300" />
            <h2 className="font-semibold text-sm [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
              Version History
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isRestoring || isSaving}
            className="p-1 [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:hover:bg-white/10 rounded border border-transparent [.theme-classic_&]:hover:border-black [.theme-inverted_&]:hover:border-white transition-colors disabled:opacity-50"
            title="Close (Escape)"
          >
            <X className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          </button>
        </div>

        {/* Save Version Section */}
        <div className="px-4 py-3 [.theme-classic_&]:border-b [.theme-classic_&]:border-gray-200 [.theme-inverted_&]:border-b [.theme-inverted_&]:border-gray-700 flex-shrink-0">
          {showSaveInput ? (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Describe this version (optional)"
                value={saveMessage}
                onChange={e => setSaveMessage(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 [.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-800 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white"
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setShowSaveInput(false);
                    setSaveMessage("");
                  }
                }}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={isSaving} className="flex-1 h-7 text-xs">
                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                  Save Version
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowSaveInput(false);
                    setSaveMessage("");
                  }}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveInput(true)}
              disabled={isSaving}
              className="w-full h-8 text-xs"
            >
              <Save className="w-3 h-3 mr-1.5" />
              Save Current Version
            </Button>
          )}
        </div>

        {/* Version List */}
        <ScrollArea className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm [.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 [.theme-classic_&]:text-gray-300 [.theme-inverted_&]:text-gray-600" />
              <p>No saved versions yet</p>
              <p className="text-xs mt-1">Save a version to create a restore point</p>
            </div>
          ) : (
            <div className="divide-y [.theme-classic_&]:divide-gray-200 [.theme-inverted_&]:divide-gray-700">
              {versions.map((version, index) => {
                const isSelected = selectedVersionId === version.id;
                const isHovered = hoveredVersionId === version.id;
                const isCurrent = index === 0;
                const showActions = isSelected || isHovered;

                return (
                  <div
                    key={version.id}
                    className={cn(
                      "px-4 py-3 cursor-pointer transition-colors",
                      "[.theme-classic_&]:hover:bg-gray-50 [.theme-inverted_&]:hover:bg-gray-800",
                      isSelected && "[.theme-classic_&]:bg-blue-50 [.theme-inverted_&]:bg-blue-900/30"
                    )}
                    onClick={() => setSelectedVersionId(isSelected ? null : version.id)}
                    onMouseEnter={() => setHoveredVersionId(version.id)}
                    onMouseLeave={() => setHoveredVersionId(null)}
                  >
                    {/* Version Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <AuthorIcon type={version.authorType} />
                        <span className="text-xs font-medium [.theme-classic_&]:text-gray-600 [.theme-inverted_&]:text-gray-300">
                          v{version.versionNumber}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-medium">
                            Current
                          </span>
                        )}
                      </div>
                      <span
                        className="text-xs [.theme-classic_&]:text-gray-400 [.theme-inverted_&]:text-gray-500 flex-shrink-0"
                        title={formatFullTime(version.createdAt)}
                      >
                        {formatRelativeTime(version.createdAt)}
                      </span>
                    </div>

                    {/* Version Message */}
                    <p className="text-sm [.theme-classic_&]:text-gray-700 [.theme-inverted_&]:text-gray-300 mt-1 truncate">
                      {version.message || (
                        <span className="[.theme-classic_&]:text-gray-400 [.theme-inverted_&]:text-gray-500 italic">
                          {version.authorType === "auto" ? "Auto-saved" : "No description"}
                        </span>
                      )}
                    </p>

                    {/* Changed Files (when selected) */}
                    {isSelected && version.changedFiles.length > 0 && (
                      <div className="mt-2 text-xs [.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400">
                        <span className="font-medium">{version.changedFiles.length} files</span>
                      </div>
                    )}

                    {/* Actions (on hover or selection) */}
                    {showActions && (
                      <div className="flex gap-2 mt-3">
                        {/* Only show restore button for non-current versions */}
                        {!isCurrent && (
                          <Button
                            size="sm"
                            onClick={e => {
                              e.stopPropagation();
                              handleRestore(version.id);
                            }}
                            disabled={isRestoring}
                            className="flex-1 h-7 text-xs"
                            title="Restore this version"
                          >
                            {isRestoring ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <RotateCcw className="w-3 h-3 mr-1" />
                            )}
                            Restore
                          </Button>
                        )}
                        {/* Show message for current version instead of disabled button */}
                        {isCurrent && (
                          <span className="flex-1 h-7 flex items-center justify-center text-xs [.theme-classic_&]:text-gray-400 [.theme-inverted_&]:text-gray-500 italic">
                            You're on this version
                          </span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={e => {
                            e.stopPropagation();
                            handleDelete(version.id);
                          }}
                          disabled={isDeleting === version.id || isCurrent}
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          title={isCurrent ? "Cannot delete current version" : "Delete this version"}
                        >
                          {isDeleting === version.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="px-4 py-2 [.theme-classic_&]:border-t [.theme-classic_&]:border-gray-200 [.theme-inverted_&]:border-t [.theme-inverted_&]:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs [.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400 flex-shrink-0">
          {versions.length} version{versions.length !== 1 ? "s" : ""} saved locally in ~/.mediar/local-history/
        </div>
      </div>
    </div>
  );
}
