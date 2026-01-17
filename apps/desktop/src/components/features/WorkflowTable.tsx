import {
  Trash2,
  Search,
  Loader2,
  Pencil,
  Check,
  Download,
  LayoutGrid,
  X,
  Tag,
  Plus,
  Copy,
  Users,
  Star,
} from "lucide-react";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { UpdateBadge } from "@/components/ui/update-badge";
import { SpotlightHint } from "@/components/onboarding";

// Parse search query for tag:value syntax (e.g., "tag:prod tag:dev some text")
function parseSearchQuery(query: string): { tags: string[]; textQuery: string } {
  const tagPattern = /tag:(\S+)/gi;
  const tags: string[] = [];
  let match;
  while ((match = tagPattern.exec(query)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  const textQuery = query.replace(tagPattern, "").trim();
  return { tags, textQuery };
}

function RefreshIcon({ isRefreshing, size = 12 }: { isRefreshing: boolean; size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      animate={{ rotate: isRefreshing ? 360 : 0 }}
      transition={{
        duration: 0.6,
        ease: "easeInOut",
        repeat: isRefreshing ? Infinity : 0,
      }}
    >
      <path d="M10 3V6L14 4L10 2V3Z" fill="currentColor" />
      <path d="M10 17V14L6 16L10 18V17Z" fill="currentColor" />
      <path d="M4 10C4 6.69 6.69 4 10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M16 10C16 13.31 13.31 16 10 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </motion.svg>
  );
}

export interface Workflow {
  id: string | null; // UUID for TypeScript workflows
  name: string;
  description: string;
  stepCount: number;
  lastModified: string | number;
  currentVersion?: string;
  latestVersion?: string; // Latest version available in cloud (for update detection)
  totalVersions?: number;
  authorName?: string | null;
  localPath?: string; // Present for local TypeScript workflows
  cloudId?: string; // Cloud UUID for synced local workflows
  githubFolder?: string; // UUID folder name for TypeScript workflows in cloud (legacy)
  uuid?: string; // Workflow UUID for zip download endpoint
  isCloudOnly?: boolean; // True if workflow exists in cloud but not locally (needs download)
  isPublic?: boolean; // True if workflow is publicly accessible
  organizationId?: string; // Owning organization ID
  userAccessLevel?: "owner" | "admin" | "write" | "read" | "public_read" | null; // User's access level
  tags?: string[]; // Tags for filtering/categorization
  isFeatured?: boolean; // Featured workflows always appear for all users
}

interface WorkflowTableProps {
  workflows: Workflow[];
  isLoading: boolean;
  loadingWorkflowId?: string | null;
  downloadingWorkflowId?: string | null; // Track which workflow is being downloaded
  pullingWorkflowId?: string | null; // Track which workflow is being updated
  isMcpAvailable: boolean;
  isMcpInitializing?: boolean;
  mcpError?: string | null;
  shortcutsEnabled: boolean;
  onStartWorkflow: (workflowId: string | null) => void;
  onUpdateWorkflowName: (workflowId: string | null, newName: string) => Promise<{ success: boolean; error?: string }>;
  onDeleteWorkflow: (workflowId: string | null, workflowName: string) => void;
  onDownloadWorkflow?: (workflowUuid: string) => Promise<void>; // Download cloud-only TypeScript workflows (uses UUID)
  onPullWorkflow?: (workflowId: string) => Promise<void>; // Pull latest version for existing local workflows
  onRefresh?: () => void;
  onCreateNew?: () => void;
  onToggleView?: () => void;
  showViewToggleHint?: boolean;
  spotlightWorkflowUuid?: string | null; // UUID of workflow to spotlight (for onboarding)
  spotlightWorkflowTooltip?: string; // Tooltip text for the spotlighted workflow
  onUpdateWorkflowTags?: (workflowId: string, tags: string[]) => Promise<{ success: boolean; error?: string }>;
  showCommunity?: boolean;
  onToggleCommunity?: () => void;
  showNewWorkflowHint?: boolean;
}

type SortOption = "modified-desc" | "modified-asc" | "name-asc" | "name-desc" | "steps-desc" | "steps-asc";

export function WorkflowTable({
  workflows,
  isLoading,
  loadingWorkflowId,
  downloadingWorkflowId,
  pullingWorkflowId,
  isMcpAvailable,
  isMcpInitializing = false,
  mcpError,
  shortcutsEnabled,
  onStartWorkflow,
  onUpdateWorkflowName,
  onDeleteWorkflow,
  onDownloadWorkflow,
  onPullWorkflow,
  onRefresh,
  onCreateNew,
  onToggleView,
  showViewToggleHint = false,
  spotlightWorkflowUuid,
  spotlightWorkflowTooltip = "Click to download this workflow",
  onUpdateWorkflowTags,
  showCommunity,
  onToggleCommunity,
  showNewWorkflowHint: _showNewWorkflowHint,
}: WorkflowTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("modified-desc");
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [editedWorkflowName, setEditedWorkflowName] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Tag editing state
  const [tagEditingWorkflowId, setTagEditingWorkflowId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagPopoverRef = useRef<HTMLDivElement>(null);

  // Click outside handler for tag popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(event.target as Node)) {
        setTagEditingWorkflowId(null);
        setNewTagInput("");
      }
    };
    if (tagEditingWorkflowId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [tagEditingWorkflowId]);

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleSaveWorkflowName = async (workflowId: string | null, originalName: string) => {
    if (editedWorkflowName.trim() && editedWorkflowName !== originalName) {
      setIsSaving(true);
      try {
        const result = await onUpdateWorkflowName(workflowId, editedWorkflowName.trim());
        if (!result.success) {
          toast.error("Failed to rename workflow", {
            description: result.error || "An unexpected error occurred",
          });
          // Revert to original name on error
          setEditedWorkflowName(originalName);
        } else {
          toast.success("Workflow renamed successfully");
        }
      } catch (error) {
        toast.error("Failed to rename workflow", {
          description: error instanceof Error ? error.message : "An unexpected error occurred",
        });
        // Revert to original name on error
        setEditedWorkflowName(originalName);
      } finally {
        setIsSaving(false);
      }
    }
    setEditingWorkflowId(null);
  };

  // Compute all unique tags from workflows for autocomplete
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    workflows.forEach(w => {
      if (w.tags && Array.isArray(w.tags)) {
        w.tags.forEach(tag => tagSet.add(tag.toLowerCase()));
      }
    });
    return Array.from(tagSet).sort();
  }, [workflows]);

  // Parse search query to extract tag filters (moved here so filterTags is available for suggestions)
  const { tags: filterTags, textQuery } = useMemo(() => parseSearchQuery(searchQuery), [searchQuery]);

  // Check if user is typing a tag filter (e.g., "tag:" or "tag:p")
  const tagSuggestionContext = useMemo(() => {
    // Match "tag:" at end, or "tag:partial" at end
    const match = searchQuery.match(/tag:(\S*)$/i);
    if (match) {
      const partial = match[1].toLowerCase();
      return { isTypingTag: true, partial };
    }
    return { isTypingTag: false, partial: "" };
  }, [searchQuery]);

  // Filter tag suggestions based on partial match
  const tagSuggestions = useMemo(() => {
    if (!tagSuggestionContext.isTypingTag) return [];
    const { partial } = tagSuggestionContext;
    // Filter out already-used tags and match partial
    return allTags.filter(tag => !filterTags.includes(tag) && tag.startsWith(partial));
  }, [tagSuggestionContext, allTags, filterTags]);

  // Handle selecting a tag suggestion
  const handleSelectTag = useCallback(
    (tag: string) => {
      // Replace "tag:partial" at end with "tag:selected "
      const newQuery = searchQuery.replace(/tag:\S*$/i, `tag:${tag} `);
      setSearchQuery(newQuery);
      setShowTagSuggestions(false);
      setSelectedSuggestionIndex(0);
      searchInputRef.current?.focus();
    },
    [searchQuery]
  );

  // Handle keyboard navigation in suggestions
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showTagSuggestions || tagSuggestions.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedSuggestionIndex(i => Math.min(i + 1, tagSuggestions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedSuggestionIndex(i => Math.max(i - 1, 0));
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          handleSelectTag(tagSuggestions[selectedSuggestionIndex]);
          break;
        case "Escape":
          setShowTagSuggestions(false);
          break;
      }
    },
    [showTagSuggestions, tagSuggestions, selectedSuggestionIndex, handleSelectTag]
  );

  // Handle adding a tag to a workflow
  const handleAddTag = useCallback(
    async (workflowId: string, currentTags: string[], newTag: string) => {
      if (!onUpdateWorkflowTags || !newTag.trim()) return;
      const tag = newTag.trim().toLowerCase();
      if (currentTags.includes(tag)) {
        toast.error(`Tag "${tag}" already exists`);
        return;
      }
      const newTags = [...currentTags, tag];
      const result = await onUpdateWorkflowTags(workflowId, newTags);
      if (result.success) {
        toast.success(`Added tag: ${tag}`);
        setTagEditingWorkflowId(null);
        setNewTagInput("");
        onRefresh?.();
      } else {
        toast.error(result.error || "Failed to add tag");
      }
    },
    [onUpdateWorkflowTags, onRefresh]
  );

  // Handle removing a tag from a workflow
  const handleRemoveTag = useCallback(
    async (workflowId: string, currentTags: string[], tagToRemove: string) => {
      if (!onUpdateWorkflowTags) return;
      const newTags = currentTags.filter(t => t !== tagToRemove);
      const result = await onUpdateWorkflowTags(workflowId, newTags);
      if (result.success) {
        toast.success(`Removed tag: ${tagToRemove}`);
        onRefresh?.();
      } else {
        toast.error(result.error || "Failed to remove tag");
      }
    },
    [onUpdateWorkflowTags, onRefresh]
  );

  // Filtered and sorted workflows
  const processedWorkflows = useMemo(() => {
    let result = [...workflows];

    // Filter by tag:value syntax
    if (filterTags.length > 0) {
      result = result.filter(w => {
        if (!w.tags || !Array.isArray(w.tags)) return false;
        const workflowTags = w.tags.map(t => t.toLowerCase());
        // Workflow must have at least one of the filter tags (OR logic)
        return filterTags.some(tag => workflowTags.includes(tag));
      });
    }

    // Filter by text query (name or description)
    if (textQuery) {
      const query = textQuery.toLowerCase();
      result = result.filter(w => w.name.toLowerCase().includes(query) || w.description.toLowerCase().includes(query));
    }

    // Sort - featured workflows always come first, then apply the selected sort
    result.sort((a, b) => {
      // Featured workflows always come first
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;

      switch (sortBy) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "steps-asc":
          return a.stepCount - b.stepCount;
        case "steps-desc":
          return b.stepCount - a.stepCount;
        case "modified-asc": {
          const aTime = typeof a.lastModified === "string" ? new Date(a.lastModified).getTime() : a.lastModified;
          const bTime = typeof b.lastModified === "string" ? new Date(b.lastModified).getTime() : b.lastModified;
          return aTime - bTime;
        }
        case "modified-desc":
        default: {
          const aTime = typeof a.lastModified === "string" ? new Date(a.lastModified).getTime() : a.lastModified;
          const bTime = typeof b.lastModified === "string" ? new Date(b.lastModified).getTime() : b.lastModified;
          return bTime - aTime;
        }
      }
    });

    return result;
  }, [workflows, filterTags, textQuery, sortBy]);

  return (
    <div className="w-full space-y-3">
      {/* Control Bar - Search | New | Sort | Card View */}
      <div className="flex items-center gap-2 py-2">
        {/* Search with tag autocomplete */}
        <div className="relative flex-1" style={{ maxWidth: "200px" }}>
          <Input
            ref={searchInputRef}
            placeholder="Search..."
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              // Show suggestions when typing "tag:"
              const match = e.target.value.match(/tag:(\S*)$/i);
              setShowTagSuggestions(!!match);
              setSelectedSuggestionIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            onBlur={() => {
              // Delay hiding to allow click on suggestion
              setTimeout(() => setShowTagSuggestions(false), 150);
            }}
            className="h-5 pl-0.5 pr-5 py-0 border border-black font-mono text-[10px] leading-none focus:ring-1 focus:ring-black"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-black"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {/* Tag autocomplete dropdown */}
          <AnimatePresence>
            {showTagSuggestions && tagSuggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute z-50 top-full left-0 mt-1 w-full bg-white border border-black shadow-md max-h-32 overflow-y-auto"
              >
                {tagSuggestions.map((tag, i) => (
                  <button
                    key={tag}
                    onClick={() => handleSelectTag(tag)}
                    className={cn(
                      "w-full px-2 py-1 text-left font-mono text-[10px] hover:bg-black hover:text-white",
                      i === selectedSuggestionIndex && "bg-black text-white"
                    )}
                  >
                    tag:{tag}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          {/* Show active tag filters as pills */}
          {filterTags.length > 0 && (
            <div className="absolute left-0 top-full mt-1 flex flex-wrap gap-1">
              {filterTags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-black text-white font-mono text-[9px] rounded"
                >
                  {tag}
                  <button
                    onClick={() => setSearchQuery(searchQuery.replace(new RegExp(`tag:${tag}\\s*`, "gi"), "").trim())}
                    className="hover:text-gray-300"
                  >
                    <X className="h-2 w-2" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* New Button */}
        {onCreateNew && (
          <button
            onClick={onCreateNew}
            className="h-5 px-2 text-[10px] font-mono font-bold bg-black text-white border border-black rounded hover:bg-white hover:text-black transition-colors"
          >
            New Workflow
          </button>
        )}

        {/* Community Toggle */}
        {onToggleCommunity && (
          <button
            onClick={onToggleCommunity}
            className="flex items-center gap-1 h-5 px-2 text-[10px] font-mono border border-black rounded transition-colors hover:bg-black hover:text-white"
            title={showCommunity ? "Show my workflows" : "Show community workflows"}
          >
            <Users className="w-3 h-3" />
            {showCommunity ? "My Workflows" : "Community"}
          </button>
        )}

        {/* Refresh Button */}
        {onRefresh && (
          <motion.button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "h-5 w-5 flex items-center justify-center border border-black rounded transition-colors",
              isRefreshing ? "bg-black text-white" : "hover:bg-black hover:text-white"
            )}
            title="Refresh workflows"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <RefreshIcon isRefreshing={isRefreshing} size={12} />
          </motion.button>
        )}

        {/* Sort Controls */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-600 font-mono">Sort:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
            className="h-5 px-0.5 py-0 border border-black font-mono text-[10px] leading-none focus:outline-none focus:ring-1 focus:ring-black"
          >
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="steps-desc">Steps (Most)</option>
            <option value="steps-asc">Steps (Least)</option>
            <option value="modified-desc">Modified (Newest)</option>
            <option value="modified-asc">Modified (Oldest)</option>
          </select>
        </div>

        {/* View Toggle */}
        {onToggleView && (
          <SpotlightHint show={showViewToggleHint} tooltip="Click to switch to card view" arrowPosition="bottom">
            <button
              onClick={onToggleView}
              className="flex items-center gap-1 h-5 px-2 text-[10px] font-mono border border-black rounded hover:bg-black hover:text-white transition-colors"
            >
              <LayoutGrid className="w-3 h-3" />
              Cards
            </button>
          </SpotlightHint>
        )}
      </div>

      {/* Table */}
      <div className={cn("border border-black rounded-lg overflow-hidden", !isMcpAvailable && "opacity-60")}>
        <Table>
          <TableHeader>
            <TableRow className="[.theme-classic_&]:bg-black/5 [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:bg-black [.theme-inverted_&]:hover:bg-black border-b border-black">
              <TableHead className="w-[20px] [.theme-classic_&]:text-gray-700 [.theme-inverted_&]:text-white font-medium text-xs py-1 px-0 h-auto leading-none text-center">
                #
              </TableHead>
              <TableHead className="[.theme-classic_&]:text-gray-700 [.theme-inverted_&]:text-white font-medium text-xs py-1 pl-1 pr-2 h-auto leading-none">
                Workflow Name
              </TableHead>
              <TableHead className="w-[100px] text-right [.theme-classic_&]:text-gray-700 [.theme-inverted_&]:text-white font-medium text-xs py-1 px-1 h-auto leading-none">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <p className="text-sm font-medium text-gray-500">Loading workflows...</p>
                    <p className="text-xs text-gray-400">Please wait</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : processedWorkflows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <p className="text-sm font-medium text-gray-500">
                      {searchQuery ? "No workflows match your search" : "No workflows found"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {searchQuery ? "Try a different search term" : "Start recording to create your first workflow"}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              processedWorkflows.map((workflow, index) => (
                <TableRow
                  key={workflow.id ?? `workflow-${index}`}
                  className={cn("border-b hover:bg-gray-50 group", !isMcpAvailable && "pointer-events-none")}
                >
                  {/* Row Number */}
                  <TableCell className="py-0 px-0 text-[10px] text-gray-500 text-center">{index + 1}</TableCell>

                  {/* Name Cell with metadata */}
                  <TableCell className="py-1 pl-1 pr-3">
                    {editingWorkflowId === workflow.id ? (
                      <div className="flex items-center gap-1 w-full">
                        <input
                          type="text"
                          value={editedWorkflowName}
                          onChange={e => setEditedWorkflowName(e.target.value)}
                          onKeyDown={async e => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              await handleSaveWorkflowName(workflow.id, workflow.name);
                            } else if (e.key === "Escape") {
                              setEditingWorkflowId(null);
                            }
                          }}
                          className="font-semibold text-sm bg-transparent border-b border-black focus:outline-none focus:border-black/60 px-1 flex-1"
                          autoFocus
                          disabled={isSaving}
                        />
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            await handleSaveWorkflowName(workflow.id, workflow.name);
                          }}
                          disabled={isSaving}
                          className="flex items-center gap-1 px-2 py-0.5 bg-black text-white hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded text-xs font-medium"
                          title="Save (or press Enter)"
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Saving</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Save</span>
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5 leading-none">
                        <SpotlightHint
                          show={
                            !!spotlightWorkflowUuid &&
                            (workflow.id === spotlightWorkflowUuid ||
                              workflow.uuid === spotlightWorkflowUuid ||
                              workflow.cloudId === spotlightWorkflowUuid)
                          }
                          tooltip={spotlightWorkflowTooltip}
                        >
                          <div className="flex items-center gap-1 group">
                            <h3
                              className="text-sm font-semibold text-gray-900 leading-none cursor-pointer hover:underline"
                              onClick={e => {
                                e.stopPropagation();
                                // Cloud-only workflows need download first
                                if (workflow.isCloudOnly && workflow.uuid && onDownloadWorkflow) {
                                  console.log(
                                    "[WorkflowTable] Triggering download for cloud-only workflow:",
                                    workflow.uuid
                                  );
                                  onDownloadWorkflow(workflow.uuid);
                                } else {
                                  onStartWorkflow(workflow.id);
                                }
                              }}
                            >
                              {workflow.name}{" "}
                              {workflow.id !== null ? (
                                <>
                                  <span className="inline-flex items-center">
                                    <span className="font-mono text-[10px] text-black font-normal ml-1">ID</span>
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(workflow.id!);
                                        toast.success("Workflow ID copied to clipboard");
                                      }}
                                      className="inline-flex items-center justify-center w-4 h-4 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                                      title={`Copy ID: ${workflow.id}`}
                                    >
                                      <Copy className="w-3 h-3" />
                                    </button>
                                  </span>
                                  {workflow.currentVersion && (
                                    <span className="font-mono text-[10px] text-gray-500 font-normal ml-1">
                                      v{workflow.currentVersion}
                                    </span>
                                  )}
                                  <span className="font-mono text-[10px] text-gray-500 font-normal ml-2">
                                    {workflow.stepCount} steps
                                  </span>
                                  <UpdateBadge
                                    currentVersion={workflow.currentVersion}
                                    latestVersion={workflow.latestVersion}
                                    className="ml-1"
                                    onUpdate={
                                      workflow.id && onPullWorkflow ? () => onPullWorkflow(workflow.id!) : undefined
                                    }
                                    isUpdating={pullingWorkflowId === workflow.id}
                                  />
                                  {workflow.isPublic && (
                                    <span className="font-mono text-[10px] text-black font-normal ml-1 px-1 py-0.5 border border-black rounded">
                                      PUBLIC
                                    </span>
                                  )}
                                  {(workflow.userAccessLevel === "read" ||
                                    workflow.userAccessLevel === "public_read") && (
                                    <span className="font-mono text-[10px] text-orange-600 font-normal ml-1 px-1 py-0.5 border border-orange-400 rounded bg-orange-50">
                                      READ-ONLY
                                    </span>
                                  )}
                                  {workflow.isFeatured && (
                                    <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-amber-700 font-normal ml-1 px-1 py-0.5 border border-amber-400 rounded bg-amber-50">
                                      <Star className="w-2.5 h-2.5 fill-amber-500" />
                                      FEATURED
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="font-mono text-[10px] text-orange-600 font-normal">UNSAVED</span>
                              )}
                            </h3>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setEditedWorkflowName(workflow.name);
                                setEditingWorkflowId(workflow.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/10 rounded transition-opacity flex-shrink-0"
                              title="Edit workflow name"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        </SpotlightHint>

                        {/* Second line: Last Modified and Author */}
                        <div className="flex items-center gap-2 text-[10px] text-gray-600 leading-none">
                          <span className="font-mono">
                            Last modified:{" "}
                            {new Date(
                              typeof workflow.lastModified === "string" ? workflow.lastModified : workflow.lastModified
                            ).toLocaleString()}
                          </span>
                          {workflow.authorName && (
                            <span className="font-mono text-gray-500">by {workflow.authorName}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </TableCell>

                  {/* Actions Cell */}
                  <TableCell className="py-1 px-1 align-middle text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {/* Show Download button for cloud-only workflows, Open button for others */}
                      {workflow.isCloudOnly && workflow.uuid ? (
                        <Button
                          size="sm"
                          disabled={downloadingWorkflowId === workflow.uuid || !onDownloadWorkflow}
                          onClick={() => onDownloadWorkflow?.(workflow.uuid!)}
                          className="h-4 px-1 py-0 text-[10px] relative leading-none bg-blue-600 hover:bg-blue-700"
                          title="Download workflow to local"
                        >
                          {downloadingWorkflowId === workflow.uuid ? (
                            <>
                              <Loader2 className="w-2.5 h-2.5 animate-spin mr-0.5" />
                              <span className="text-[10px]">Downloading</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-2.5 h-2.5 mr-0.5" />
                              Download
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!isMcpAvailable || loadingWorkflowId === workflow.id}
                          onClick={() => onStartWorkflow(workflow.id)}
                          className="h-4 px-1 py-0 text-[10px] relative leading-none"
                          title={
                            !isMcpAvailable
                              ? "MCP tools are not available"
                              : `Open workflow${index < 9 && shortcutsEnabled ? ` (Press ${index + 1})` : ""}`
                          }
                        >
                          {loadingWorkflowId === workflow.id ? (
                            <>
                              <Loader2 className="w-2.5 h-2.5 animate-spin mr-0.5" />
                              <span className="text-[10px]">Loading</span>
                            </>
                          ) : (
                            <>
                              Open
                              {isMcpAvailable && shortcutsEnabled && index < 9 && (
                                <span className="absolute -top-1 -right-0.5 bg-white text-black px-0.5 py-0 rounded border border-black text-[8px] leading-none font-medium">
                                  {index + 1}
                                </span>
                              )}
                            </>
                          )}
                        </Button>
                      )}

                      {/* Tag button with dropdown */}
                      {onUpdateWorkflowTags && (
                        <div className="relative">
                          <button
                            onClick={() => {
                              setTagEditingWorkflowId(tagEditingWorkflowId === workflow.id ? null : workflow.id);
                              setNewTagInput("");
                            }}
                            className={cn(
                              "p-0.5 rounded flex-shrink-0 transition-colors",
                              (workflow.tags?.length ?? 0) > 0
                                ? "bg-black hover:bg-gray-800 text-white"
                                : "bg-white hover:bg-gray-100 text-gray-600 border border-gray-300"
                            )}
                            title={`Tags: ${workflow.tags?.join(", ") || "none"}`}
                          >
                            <Tag className="w-3 h-3" />
                          </button>
                          {/* Tag editing dropdown */}
                          <AnimatePresence>
                            {tagEditingWorkflowId === workflow.id && (
                              <motion.div
                                ref={tagPopoverRef}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute z-50 right-0 top-full mt-1 min-w-[150px] bg-white border border-black shadow-lg p-2"
                              >
                                {/* Existing tags */}
                                {(workflow.tags?.length ?? 0) > 0 && (
                                  <div className="flex flex-wrap gap-1 mb-2">
                                    {workflow.tags?.map(tag => (
                                      <span
                                        key={tag}
                                        className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-black text-white font-mono text-[9px] rounded"
                                      >
                                        {tag}
                                        <button
                                          onClick={() => handleRemoveTag(workflow.id!, workflow.tags || [], tag)}
                                          className="hover:text-gray-300"
                                        >
                                          <X className="h-2 w-2" />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {/* Add new tag input */}
                                <div className="flex items-center gap-1">
                                  <input
                                    ref={tagInputRef}
                                    type="text"
                                    value={newTagInput}
                                    onChange={e => setNewTagInput(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleAddTag(workflow.id!, workflow.tags || [], newTagInput);
                                      } else if (e.key === "Escape") {
                                        setTagEditingWorkflowId(null);
                                      }
                                    }}
                                    placeholder="new tag"
                                    className="flex-1 h-5 px-1 text-[10px] font-mono border border-gray-300 rounded"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => handleAddTag(workflow.id!, workflow.tags || [], newTagInput)}
                                    className="p-0.5 bg-black text-white rounded hover:bg-gray-700"
                                    title="Add tag"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}

                      <button
                        onClick={() => onDeleteWorkflow(workflow.id, workflow.name)}
                        className="p-0.5 bg-red-600 hover:bg-red-700 text-white rounded flex-shrink-0 transition-colors"
                        title="Delete workflow"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer: Results count */}
      {!isLoading && processedWorkflows.length > 0 && (
        <div className="flex items-center justify-between py-2">
          <div className="text-xs text-gray-600 font-mono">
            Showing {processedWorkflows.length} of {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
            {searchQuery && ` (filtered)`}
          </div>
        </div>
      )}
    </div>
  );
}
