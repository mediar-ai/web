'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Command,
  Search,
  Play,
  Copy,
  Plus,
  RefreshCw,
  Eye,
  Edit,
} from 'lucide-react';
import { WorkflowWithSettings } from '@/lib/workflow-types';

interface CommandPaletteProps {
  workflows: WorkflowWithSettings[];
  onExecuteWorkflow?: (workflowId: number) => void;
  onDuplicateWorkflow?: (workflowId: number) => void;
  onViewWorkflow?: (workflowId: number) => void;
  onEditWorkflow?: (workflowId: number) => void;
  // onDeleteWorkflow?: (workflowId: number) => void; // Reserved for future use
  onCreateWorkflow?: () => void;
  onRefresh?: () => void;
}

interface CommandItem {
  id: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
  category: 'workflow' | 'action' | 'navigation';
  action: () => void;
  keywords: string[];
}

export function CommandPalette({
  workflows,
  onExecuteWorkflow,
  onDuplicateWorkflow,
  onViewWorkflow,
  onEditWorkflow,
  // onDeleteWorkflow,
  onCreateWorkflow,
  onRefresh,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Create command items from workflows and actions
  const commandItems = useMemo(() => {
    const items: CommandItem[] = [];

    // Add global actions
    items.push({
      id: 'create-workflow',
      title: 'Create New Workflow',
      description: 'Create a new workflow from scratch or template',
      icon: <Plus className="w-4 h-4" />,
      category: 'action',
      action: () => {
        setOpen(false);
        onCreateWorkflow?.();
      },
      keywords: ['create', 'new', 'workflow', 'add', 'plus'],
    });

    items.push({
      id: 'refresh',
      title: 'Refresh Workflows',
      description: 'Refresh the workflow list',
      icon: <RefreshCw className="w-4 h-4" />,
      category: 'action',
      action: () => {
        setOpen(false);
        onRefresh?.();
      },
      keywords: ['refresh', 'reload', 'update', 'sync'],
    });

    // Add workflow-specific commands
    workflows.forEach((workflow) => {
      // Execute workflow
      items.push({
        id: `execute-${workflow.id}`,
        title: `Execute: ${workflow.name}`,
        description: workflow.description || 'Run this workflow',
        icon: <Play className="w-4 h-4" />,
        category: 'workflow',
        action: () => {
          setOpen(false);
          onExecuteWorkflow?.(workflow.id);
        },
        keywords: ['execute', 'run', 'start', 'play', workflow.name.toLowerCase()],
      });

      // View workflow
      items.push({
        id: `view-${workflow.id}`,
        title: `View: ${workflow.name}`,
        description: 'View workflow details and settings',
        icon: <Eye className="w-4 h-4" />,
        category: 'workflow',
        action: () => {
          setOpen(false);
          onViewWorkflow?.(workflow.id);
        },
        keywords: ['view', 'details', 'settings', 'info', workflow.name.toLowerCase()],
      });

      // Duplicate workflow
      items.push({
        id: `duplicate-${workflow.id}`,
        title: `Duplicate: ${workflow.name}`,
        description: 'Create a copy of this workflow',
        icon: <Copy className="w-4 h-4" />,
        category: 'workflow',
        action: () => {
          setOpen(false);
          onDuplicateWorkflow?.(workflow.id);
        },
        keywords: ['duplicate', 'copy', 'clone', workflow.name.toLowerCase()],
      });

      // Edit workflow
      items.push({
        id: `edit-${workflow.id}`,
        title: `Edit: ${workflow.name}`,
        description: 'Edit workflow configuration',
        icon: <Edit className="w-4 h-4" />,
        category: 'workflow',
        action: () => {
          setOpen(false);
          onEditWorkflow?.(workflow.id);
        },
        keywords: ['edit', 'modify', 'change', 'update', workflow.name.toLowerCase()],
      });
    });

    return items;
  }, [workflows, onExecuteWorkflow, onDuplicateWorkflow, onViewWorkflow, onEditWorkflow, onCreateWorkflow, onRefresh]);

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!search) return commandItems;

    const searchLower = search.toLowerCase();
    return commandItems.filter((item) => {
      return (
        item.title.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower) ||
        item.keywords.some((keyword) => keyword.includes(searchLower))
      );
    });
  }, [commandItems, search]);

  // Group items by category
  const groupedItems = useMemo(() => {
    const groups = {
      action: [] as CommandItem[],
      workflow: [] as CommandItem[],
      navigation: [] as CommandItem[],
    };

    filteredItems.forEach((item) => {
      groups[item.category].push(item);
    });

    return groups;
  }, [filteredItems]);

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, filteredItems, selectedIndex]);

  // Global keyboard shortcut to open
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setSearch('');
        setSelectedIndex(0);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const renderCategory = (title: string, items: CommandItem[]) => {
    if (items.length === 0) return null;

    return (
      <div className="mb-4">
        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {title}
        </div>
        {items.map((item) => {
          const globalIndex = filteredItems.indexOf(item);
          const isSelected = globalIndex === selectedIndex;

          return (
            <button
              key={item.id}
              className={`w-full px-3 py-2.5 flex items-start gap-3 hover:bg-gray-100 transition-colors ${
                isSelected ? 'bg-gray-100' : ''
              }`}
              onClick={item.action}
              onMouseEnter={() => setSelectedIndex(globalIndex)}
            >
              <div className="flex-shrink-0 mt-0.5 text-gray-500">
                {item.icon}
              </div>
              <div className="flex-1 text-left">
                <div className="font-medium text-sm text-gray-900">
                  {item.title}
                </div>
                {item.description && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {item.description}
                  </div>
                )}
              </div>
              {isSelected && (
                <div className="flex-shrink-0 text-xs text-gray-400 mt-0.5">
                  ⏎
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* Trigger hint */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
      >
        <Command className="w-4 h-4" />
        <span>⌘K</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 max-w-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b">
            <Search className="w-5 h-5 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type a command or search..."
              className="flex-1 border-0 focus:ring-0 p-0 text-base placeholder:text-gray-400"
              autoFocus
            />
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded">↑↓</kbd>
              <span>Navigate</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded">⏎</kbd>
              <span>Select</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded">Esc</kbd>
              <span>Close</span>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto py-2">
            {filteredItems.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-500">
                No commands found for &quot;{search}&quot;
              </div>
            ) : (
              <>
                {renderCategory('Actions', groupedItems.action)}
                {renderCategory('Workflows', groupedItems.workflow)}
                {renderCategory('Navigation', groupedItems.navigation)}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}