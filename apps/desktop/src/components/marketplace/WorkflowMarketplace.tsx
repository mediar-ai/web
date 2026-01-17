import { Search, Plus, Zap, Clock, Globe, Loader2, X, List, Tag, Users } from "lucide-react";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { WorkflowCard, type WorkflowCardData } from "./WorkflowCard";
import { SpotlightHint } from "@/components/onboarding";
import { toast } from "sonner";

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

function RefreshIcon({ isRefreshing }: { isRefreshing: boolean }) {
  return (
    <motion.svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      animate={{ rotate: isRefreshing ? 360 : 0 }}
      transition={{
        duration: 0.6,
        ease: "easeInOut",
        repeat: isRefreshing ? Infinity : 0,
      }}
    >
      {/* Minimal geometric refresh - two opposing arrows */}
      <path d="M10 3V6L14 4L10 2V3Z" fill="currentColor" />
      <path d="M10 17V14L6 16L10 18V17Z" fill="currentColor" />
      <path d="M4 10C4 6.69 6.69 4 10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M16 10C16 13.31 13.31 16 10 16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </motion.svg>
  );
}

interface WorkflowMarketplaceProps {
  workflows: WorkflowCardData[];
  isLoading: boolean;
  loadingWorkflowId?: string | null;
  downloadingWorkflowId?: string | null;
  pullingWorkflowId?: string | null;
  deletingWorkflowId?: string | null;
  onStartWorkflow: (id: string | null) => void;
  onDownloadWorkflow?: (uuid: string) => Promise<void>;
  onPullWorkflow?: (workflowId: string) => Promise<void>;
  onDeleteWorkflow?: (workflowId: string) => Promise<void>;
  onCreateNew?: () => void;
  onRefresh?: () => void;
  onToggleView?: () => void;
  showViewToggleHint?: boolean;
  showNewWorkflowHint?: boolean;
  onUpdateWorkflowTags?: (workflowId: string, tags: string[]) => Promise<{ success: boolean; error?: string }>;
  showCommunity?: boolean;
  onToggleCommunity?: () => void;
}

type CategoryFilter = "all" | "recent" | "public";

const CATEGORIES: { id: CategoryFilter; label: string; icon: React.ReactNode }[] = [
  { id: "all", label: "All", icon: <Zap className="w-4 h-4" /> },
  { id: "recent", label: "Recent", icon: <Clock className="w-4 h-4" /> },
  { id: "public", label: "Public", icon: <Globe className="w-4 h-4" /> },
];

export function WorkflowMarketplace({
  workflows,
  isLoading,
  loadingWorkflowId,
  downloadingWorkflowId,
  pullingWorkflowId,
  deletingWorkflowId,
  onStartWorkflow,
  onDownloadWorkflow,
  onPullWorkflow,
  onDeleteWorkflow,
  onCreateNew,
  onRefresh,
  onToggleView,
  showViewToggleHint = false,
  showNewWorkflowHint = false,
  onUpdateWorkflowTags,
  showCommunity = false,
  onToggleCommunity,
}: WorkflowMarketplaceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Tag autocomplete state
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Tag editing state for cards (batch mode - save on close)
  const [tagEditingWorkflowId, setTagEditingWorkflowId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [originalTags, setOriginalTags] = useState<string[]>([]);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagPopoverRef = useRef<HTMLDivElement>(null);

  // Get all unique tags from workflows
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    workflows.forEach(w => {
      w.tags?.forEach(tag => tagSet.add(tag.toLowerCase()));
    });
    return Array.from(tagSet).sort();
  }, [workflows]);

  // Parse search query for filtering
  const { tags: filterTags, textQuery } = useMemo(() => parseSearchQuery(searchQuery), [searchQuery]);

  // Compute tag suggestions based on cursor position
  const tagSuggestionContext = useMemo(() => {
    if (!searchInputRef.current) return null;
    const cursorPos = searchInputRef.current.selectionStart ?? searchQuery.length;
    const beforeCursor = searchQuery.slice(0, cursorPos);
    const tagMatch = beforeCursor.match(/tag:(\S*)$/i);
    if (tagMatch) {
      const partial = tagMatch[1].toLowerCase();
      return { partial, startIndex: tagMatch.index! };
    }
    return null;
  }, [searchQuery]);

  const tagSuggestions = useMemo(() => {
    if (!tagSuggestionContext) return [];
    const { partial } = tagSuggestionContext;
    return allTags.filter(tag => tag.startsWith(partial) && !filterTags.includes(tag)).slice(0, 5);
  }, [tagSuggestionContext, allTags, filterTags]);

  // Save tags and close popover
  const saveTagsAndClose = useCallback(async () => {
    if (!tagEditingWorkflowId || !onUpdateWorkflowTags) {
      setTagEditingWorkflowId(null);
      setNewTagInput("");
      setPendingTags([]);
      return;
    }

    // Check if tags changed
    const tagsChanged = JSON.stringify(pendingTags.sort()) !== JSON.stringify(originalTags.sort());
    if (!tagsChanged) {
      setTagEditingWorkflowId(null);
      setNewTagInput("");
      setPendingTags([]);
      return;
    }

    setIsSavingTags(true);
    const result = await onUpdateWorkflowTags(tagEditingWorkflowId, pendingTags);
    setIsSavingTags(false);

    if (result.success) {
      toast.success("Tags updated");
    } else {
      toast.error(result.error || "Failed to update tags");
    }

    setTagEditingWorkflowId(null);
    setNewTagInput("");
    setPendingTags([]);
  }, [tagEditingWorkflowId, pendingTags, originalTags, onUpdateWorkflowTags]);

  // Click outside handler for tag popover - saves on close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(event.target as Node)) {
        saveTagsAndClose();
      }
    };
    if (tagEditingWorkflowId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [tagEditingWorkflowId, saveTagsAndClose]);

  // Focus tag input when popover opens
  useEffect(() => {
    if (tagEditingWorkflowId && tagInputRef.current) {
      setTimeout(() => tagInputRef.current?.focus(), 0);
    }
  }, [tagEditingWorkflowId]);

  // Handle tag suggestion selection
  const handleSelectTagSuggestion = useCallback(
    (tag: string) => {
      if (!tagSuggestionContext) return;
      const { startIndex } = tagSuggestionContext;
      const before = searchQuery.slice(0, startIndex);
      const after = searchQuery.slice(searchInputRef.current?.selectionStart ?? searchQuery.length);
      setSearchQuery(`${before}tag:${tag} ${after}`.trim());
      setShowTagSuggestions(false);
      setSelectedSuggestionIndex(0);
      searchInputRef.current?.focus();
    },
    [tagSuggestionContext, searchQuery]
  );

  // Handle search input keyboard events
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (showTagSuggestions && tagSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestionIndex(i => Math.min(i + 1, tagSuggestions.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestionIndex(i => Math.max(i - 1, 0));
        } else if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleSelectTagSuggestion(tagSuggestions[selectedSuggestionIndex]);
        } else if (e.key === "Escape") {
          setShowTagSuggestions(false);
        }
      }
    },
    [showTagSuggestions, tagSuggestions, selectedSuggestionIndex, handleSelectTagSuggestion]
  );

  // Show/hide tag suggestions
  useEffect(() => {
    if (tagSuggestionContext && tagSuggestions.length > 0) {
      setShowTagSuggestions(true);
      setSelectedSuggestionIndex(0);
    } else {
      setShowTagSuggestions(false);
    }
  }, [tagSuggestionContext, tagSuggestions.length]);

  // Handle adding tag locally (batch mode)
  const handleAddTagLocal = useCallback(
    (newTag: string) => {
      const tag = newTag.trim().toLowerCase();
      if (!tag || pendingTags.includes(tag)) return;
      setPendingTags([...pendingTags, tag]);
      setNewTagInput("");
    },
    [pendingTags]
  );

  // Handle removing tag locally (batch mode)
  const handleRemoveTagLocal = useCallback(
    (tagToRemove: string) => {
      setPendingTags(pendingTags.filter(t => t !== tagToRemove));
    },
    [pendingTags]
  );

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      // Keep spinning for at least 500ms for visual feedback
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // Filter workflows based on search and category
  const filteredWorkflows = useMemo(() => {
    let result = [...workflows];

    // Tag filter
    if (filterTags.length > 0) {
      result = result.filter(w => {
        const workflowTags = (w.tags || []).map(t => t.toLowerCase());
        return filterTags.every(tag => workflowTags.includes(tag));
      });
    }

    // Text search filter
    if (textQuery) {
      const query = textQuery.toLowerCase();
      result = result.filter(
        w => w.name.toLowerCase().includes(query) || (w.description && w.description.toLowerCase().includes(query))
      );
    }

    // Category filter
    switch (activeCategory) {
      case "recent":
        result = result
          .sort((a, b) => {
            // Featured workflows always come first
            if (a.isFeatured && !b.isFeatured) return -1;
            if (!a.isFeatured && b.isFeatured) return 1;
            const aTime = typeof a.lastModified === "string" ? new Date(a.lastModified).getTime() : a.lastModified;
            const bTime = typeof b.lastModified === "string" ? new Date(b.lastModified).getTime() : b.lastModified;
            return bTime - aTime;
          })
          .slice(0, 10);
        break;
      case "public":
        result = result.filter(w => w.isPublic);
        break;
    }

    // Always sort featured workflows first (applies to all categories)
    result.sort((a, b) => {
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;
      return 0;
    });

    return result;
  }, [workflows, filterTags, textQuery, activeCategory]);

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Header with black bar */}
      <div className="flex-shrink-0">
        {/* Black accent bar */}
        <div className="h-1 bg-black" />

        <div className="px-6 pt-5 pb-4 border-b-2 border-black">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-2xl font-mono font-bold text-black">
                  {showCommunity ? "Community Workflows" : "Workflows"}
                </h1>
                <p className="text-sm text-gray-500 font-mono mt-0.5">
                  {workflows.length} workflow{workflows.length !== 1 ? "s" : ""} available
                </p>
              </div>
              {/* Community Toggle */}
              {onToggleCommunity && (
                <button
                  onClick={onToggleCommunity}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md border-2 border-black transition-colors font-mono text-sm bg-white text-black hover:bg-black hover:text-white"
                  title={showCommunity ? "Show my workflows" : "Show community workflows"}
                >
                  <Users className="w-4 h-4" />
                  {showCommunity ? "My Workflows" : "Community"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {onToggleView && (
                <SpotlightHint show={showViewToggleHint} tooltip="Click to switch to list view" arrowPosition="bottom">
                  <button
                    onClick={onToggleView}
                    className="p-2 rounded-md border-2 border-black hover:bg-black hover:text-white transition-colors"
                    title="Switch to list view"
                  >
                    <List className="w-5 h-5" />
                  </button>
                </SpotlightHint>
              )}
              {onRefresh && (
                <motion.button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className={cn(
                    "p-2 rounded-md border-2 border-black transition-colors",
                    isRefreshing ? "bg-black text-white" : "hover:bg-black hover:text-white"
                  )}
                  title="Refresh workflows"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <RefreshIcon isRefreshing={isRefreshing} />
                </motion.button>
              )}
              {onCreateNew && (
                <SpotlightHint
                  show={showNewWorkflowHint}
                  tooltip="Click to create a new workflow"
                  arrowPosition="bottom"
                >
                  <button
                    onClick={onCreateNew}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-md",
                      "bg-black text-white font-mono font-bold text-sm",
                      "border-2 border-black",
                      "hover:bg-white hover:text-black transition-colors"
                    )}
                  >
                    <Plus className="w-4 h-4" />
                    New Workflow
                  </button>
                </SpotlightHint>
              )}
            </div>
          </div>

          {/* Search and Categories in one row */}
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search workflows..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className={cn(
                  "w-full pl-9 pr-9 py-2 rounded-md",
                  "bg-white border-2 border-black",
                  "text-sm font-mono placeholder:text-gray-400",
                  "focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2",
                  "transition-all duration-200"
                )}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
              {/* Tag autocomplete dropdown */}
              <AnimatePresence>
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 right-0 mt-1 bg-white border-2 border-black rounded-md shadow-lg z-50 overflow-hidden"
                  >
                    {tagSuggestions.map((tag, index) => (
                      <button
                        key={tag}
                        onClick={() => handleSelectTagSuggestion(tag)}
                        className={cn(
                          "w-full px-3 py-2 text-left text-sm font-mono flex items-center gap-2",
                          index === selectedSuggestionIndex ? "bg-black text-white" : "hover:bg-gray-100"
                        )}
                      >
                        <Tag className="w-3 h-3" />
                        {tag}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-1">
              {CATEGORIES.map(category => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-md",
                    "text-sm font-mono font-medium whitespace-nowrap",
                    "border-2 transition-all duration-200",
                    activeCategory === category.id
                      ? "bg-black text-white border-black"
                      : "text-black border-transparent hover:border-black"
                  )}
                >
                  {category.icon}
                  {category.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content - hide scrollbar */}
      <div
        className="flex-1 overflow-y-auto scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-black" />
            <p className="text-sm text-gray-500 font-mono">Loading workflows...</p>
          </div>
        ) : (
          <div className="px-6 py-4">
            {filteredWorkflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-lg bg-black text-white flex items-center justify-center mb-4">
                  <Zap className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-mono font-bold text-black mb-1">
                  {searchQuery ? "No workflows found" : "No workflows yet"}
                </h3>
                <p className="text-sm text-gray-500 mb-4 max-w-sm font-mono">
                  {searchQuery ? "Try adjusting your search" : "Create your first workflow to get started"}
                </p>
                {!searchQuery && (
                  <button
                    onClick={onCreateNew}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-md",
                      "bg-black text-white font-mono font-bold text-sm",
                      "border-2 border-black",
                      "hover:bg-white hover:text-black transition-colors"
                    )}
                  >
                    <Plus className="w-4 h-4" />
                    Create Workflow
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {filteredWorkflows.map(workflow => (
                  <div key={workflow.id || workflow.name} className="relative">
                    <WorkflowCard
                      workflow={workflow}
                      variant="default"
                      onOpen={onStartWorkflow}
                      onDownload={onDownloadWorkflow}
                      onPullWorkflow={onPullWorkflow}
                      onDelete={onDeleteWorkflow}
                      onTagClick={
                        onUpdateWorkflowTags
                          ? id => {
                              if (tagEditingWorkflowId === id) {
                                saveTagsAndClose();
                              } else {
                                const wf = workflows.find(w => w.id === id);
                                const tags = wf?.tags || [];
                                setPendingTags([...tags]);
                                setOriginalTags([...tags]);
                                setTagEditingWorkflowId(id);
                                setNewTagInput("");
                              }
                            }
                          : undefined
                      }
                      isLoading={loadingWorkflowId === workflow.id}
                      isDownloading={downloadingWorkflowId === workflow.id}
                      isUpdating={pullingWorkflowId === workflow.id}
                      isDeleting={deletingWorkflowId === workflow.id}
                    />
                    {/* Tag popover (batch mode) */}
                    {tagEditingWorkflowId === workflow.id && (
                      <div
                        ref={tagPopoverRef}
                        className="absolute top-10 right-2 z-20 bg-white border-2 border-black rounded-md shadow-lg p-2 min-w-[160px]"
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Pending tags (local state) */}
                        {pendingTags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {pendingTags.map(tag => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono"
                              >
                                {tag}
                                <button onClick={() => handleRemoveTagLocal(tag)} className="hover:text-red-500">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Add new tag input */}
                        <input
                          ref={tagInputRef}
                          type="text"
                          value={newTagInput}
                          onChange={e => setNewTagInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && newTagInput.trim()) {
                              handleAddTagLocal(newTagInput);
                            } else if (e.key === "Escape") {
                              saveTagsAndClose();
                            }
                          }}
                          placeholder="Add tag, Enter to add"
                          className="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-black"
                          disabled={isSavingTags}
                        />
                        {isSavingTags && <div className="text-xs text-gray-400 mt-1 font-mono">Saving...</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
