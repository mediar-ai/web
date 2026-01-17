import { Play, Download, Zap, ChevronRight, Loader2, Trash2, Tag, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { UpdateBadge } from "@/components/ui/update-badge";
import { useState } from "react";

export interface WorkflowCardData {
  id: string | null;
  name: string;
  description: string;
  stepCount: number;
  lastModified: string | number;
  currentVersion?: string;
  latestVersion?: string;
  authorName?: string | null;
  category?: string;
  icon?: string;
  isCloudOnly?: boolean;
  isPublic?: boolean;
  isFeatured?: boolean;
  downloads?: number;
  rating?: number;
  tags?: string[]; // Tags for filtering/categorization
  uuid?: string; // Workflow UUID for download
}

interface WorkflowCardProps {
  workflow: WorkflowCardData;
  onOpen: (id: string | null) => void;
  onDownload?: (uuid: string) => Promise<void>;
  onPullWorkflow?: (workflowId: string) => Promise<void>;
  onDelete?: (workflowId: string) => Promise<void>;
  onTagClick?: (workflowId: string) => void;
  isLoading?: boolean;
  isDownloading?: boolean;
  isUpdating?: boolean;
  isDeleting?: boolean;
  variant?: "default" | "compact";
}

export function WorkflowCard({
  workflow,
  onOpen,
  onDownload,
  onPullWorkflow,
  onDelete,
  onTagClick,
  isLoading = false,
  isDownloading = false,
  isUpdating = false,
  isDeleting = false,
  variant = "default",
}: WorkflowCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleClick = () => {
    if (showDeleteConfirm) return; // Don't open if delete confirm is showing
    if (workflow.isCloudOnly && onDownload && workflow.id) {
      onDownload(workflow.id);
    } else {
      onOpen(workflow.id);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete && workflow.id) {
      await onDelete(workflow.id);
    }
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "group cursor-pointer",
          "bg-white border-2 border-black rounded-md",
          "transition-all duration-200 ease-out",
          "hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5"
        )}
        onClick={handleClick}
      >
        <div className="p-3 flex items-center gap-3">
          {/* Icon */}
          <div className="w-10 h-10 rounded-md bg-black text-white flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h4 className="font-mono font-bold text-sm text-black truncate">{workflow.name}</h4>
              <UpdateBadge
                currentVersion={workflow.currentVersion}
                latestVersion={workflow.latestVersion}
                onUpdate={workflow.id && onPullWorkflow ? () => onPullWorkflow(workflow.id!) : undefined}
                isUpdating={isUpdating}
              />
            </div>
            <p className="text-xs text-gray-500 font-mono">{workflow.stepCount} steps</p>
          </div>

          {/* Action */}
          <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {isLoading || isDownloading ? (
              <Loader2 className="w-4 h-4 animate-spin text-black" />
            ) : (
              <ChevronRight className="w-4 h-4 text-black" />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default variant - compact design
  const shortId = workflow.id ? workflow.id.slice(0, 4) : null;

  // Delete confirmation overlay
  if (showDeleteConfirm) {
    return (
      <div
        className={cn(
          "group",
          "bg-white border-2 border-black rounded-md overflow-hidden",
          "transition-all duration-150 ease-out",
          "w-full max-w-[240px]"
        )}
      >
        <div className="h-1 bg-red-500" />
        <div className="p-3">
          <div className="text-center py-2">
            <p className="font-mono font-bold text-sm text-black mb-1">Delete workflow?</p>
            <p className="font-mono text-xs text-gray-500 mb-3 truncate" title={workflow.name}>
              {workflow.name}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={handleCancelDelete}
                className={cn(
                  "px-3 py-1.5 rounded font-mono font-bold text-xs",
                  "bg-white text-black border-2 border-black",
                  "hover:bg-gray-100 transition-colors"
                )}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className={cn(
                  "px-3 py-1.5 rounded font-mono font-bold text-xs",
                  "bg-red-500 text-white border-2 border-red-500",
                  "hover:bg-red-600 hover:border-red-600 transition-colors",
                  "flex items-center gap-1"
                )}
              >
                {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group cursor-pointer relative",
        "bg-white border-2 border-black rounded-md overflow-hidden",
        "transition-all duration-150 ease-out",
        "hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5",
        "w-full max-w-[240px]"
      )}
      onClick={handleClick}
    >
      {/* Action buttons - top right, appear on hover */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {onTagClick && workflow.id && (
          <button
            onClick={e => {
              e.stopPropagation();
              onTagClick(workflow.id!);
            }}
            className={cn("p-1.5 rounded", "bg-white/90 border border-gray-200", "hover:bg-gray-100")}
            title="Manage tags"
          >
            <Tag className="w-3 h-3" />
          </button>
        )}
        {onDelete && workflow.id && !workflow.isCloudOnly && (
          <button
            onClick={handleDeleteClick}
            className={cn(
              "p-1.5 rounded",
              "bg-white/90 border border-gray-200",
              "hover:bg-red-50 hover:border-red-300 hover:text-red-500"
            )}
            title="Delete workflow"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Minimal header bar */}
      <div className="h-1 bg-black" />

      {/* Content - more compact */}
      <div className="p-3">
        {/* Top row: icon + name + badges */}
        <div className="flex items-start gap-2 mb-2">
          {/* Small icon */}
          <div className="w-8 h-8 rounded bg-black text-white flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-mono font-bold text-sm text-black truncate" title={workflow.name}>
                {workflow.name}
              </h3>
              <UpdateBadge
                currentVersion={workflow.currentVersion}
                latestVersion={workflow.latestVersion}
                className="flex-shrink-0"
                onUpdate={workflow.id && onPullWorkflow ? () => onPullWorkflow(workflow.id!) : undefined}
                isUpdating={isUpdating}
              />
              {workflow.isPublic && (
                <span className="bg-black text-white text-[8px] font-mono font-bold px-1 py-0.5 rounded flex-shrink-0">
                  PUB
                </span>
              )}
              {workflow.isFeatured && (
                <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 border border-amber-400 text-[8px] font-mono font-bold px-1 py-0.5 rounded flex-shrink-0">
                  <Star className="w-2 h-2 fill-amber-500" />
                </span>
              )}
            </div>
            {/* ID badge with tooltip */}
            {shortId && (
              <span className="inline-block text-[9px] font-mono text-gray-400 mt-0.5" title={workflow.id || ""}>
                #{shortId}
              </span>
            )}
          </div>
        </div>

        {/* Description - shorter, full on hover */}
        <p
          className="text-gray-500 text-[10px] line-clamp-1 mb-2 font-mono"
          title={workflow.description || "No description"}
        >
          {workflow.description || "No description"}
        </p>

        {/* Metadata row */}
        <div className="flex items-center justify-between text-[9px] text-gray-400 font-mono">
          <span>{workflow.stepCount} steps</span>
          {workflow.authorName && (
            <span className="truncate max-w-[80px]" title={workflow.authorName}>
              {workflow.authorName}
            </span>
          )}
        </div>

        {/* Action button - appears on hover */}
        <div
          className={cn(
            "mt-2 pt-2 border-t border-gray-100",
            "opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          )}
        >
          <button
            className={cn(
              "w-full py-1.5 rounded font-mono font-bold text-xs",
              "flex items-center justify-center gap-1.5",
              "bg-black text-white border border-black",
              "hover:bg-white hover:text-black transition-colors"
            )}
            disabled={isLoading || isDownloading}
          >
            {isLoading || isDownloading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                {isDownloading ? "..." : "..."}
              </>
            ) : workflow.isCloudOnly ? (
              <>
                <Download className="w-3 h-3" />
                Get
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                Open
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
