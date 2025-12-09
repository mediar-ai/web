'use client';

import { useState, useEffect, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Database, 
  HardDrive, 
  Download, 
  ArrowUp, 
  ArrowDown
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import type { LabelingStorageInfo } from '@/types/shared-data-management';

// Helper function to format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Clock component
const Clock = () => {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const timerId = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timerId);
  }, []);

  return (
    <div className="text-sm text-gray-500 font-mono w-48 text-right">
      {time ? `UTC: ${time.toUTCString()}` : ''}
    </div>
  );
};

interface DataControlsPanelProps {
  // Data display info
  displayItemsCount: number;
  totalAvailable: number | null;
  memoryUsage: number;
  itemType: string; // 'events' | 'analyses' | 'annotations'
  
  // Storage info
  storageInfo: LabelingStorageInfo | null;
  
  // Search and filters
  searchTerm: string;
  onSearchChange: (term: string) => void;
  availableFilters?: string[];
  selectedFilter?: string | null;
  onFilterChange?: (filter: string | null) => void;
  filterLabel?: string;
  
  // Sort controls
  sortOrder: 'asc' | 'desc';
  onSortOrderToggle: () => void;
  
  // Action callbacks
  onLoadMore: () => void;
  onClearView: () => void;
  onClearStorage: () => void;
  onToggleStorageInfo: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCopyAll: () => void;
  
  // State flags
  loading: boolean;
  maxMemoryMB: number;
  
  // Custom content (for tab-specific controls)
  children?: ReactNode;
}

export function DataControlsPanel({
  displayItemsCount,
  totalAvailable,
  memoryUsage,
  itemType,
  storageInfo,
  searchTerm,
  onSearchChange,
  availableFilters = [],
  selectedFilter,
  onFilterChange,
  filterLabel = 'Filter',
  sortOrder,
  onSortOrderToggle,
  onLoadMore,
  onClearView,
  onClearStorage,
  onToggleStorageInfo,
  onExpandAll,
  onCollapseAll,
  onCopyAll,
  loading,
  maxMemoryMB,
  children
}: DataControlsPanelProps) {
  return (
    <div className="space-y-3 py-2 border-b mb-2">
      {/* Line 1: Stats, Search, and Filters - Fixed Width Layout */}
      <div className="flex items-center justify-between gap-3 max-w-full overflow-hidden">
        {/* Left side: Clock and Stats - Fixed widths */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-48">
            <Clock />
          </div>
          <div className="flex items-center gap-2 px-3 py-1 border border-black rounded-md whitespace-nowrap">
            <span className="text-sm font-medium">
              {displayItemsCount} {itemType} loaded
            </span>
            <span className="text-xs text-muted-foreground">
              ({formatBytes(memoryUsage)})
            </span>
            {totalAvailable && (
              <span className="text-xs text-muted-foreground">
                (of {totalAvailable.toLocaleString()} total)
              </span>
            )}
            {memoryUsage > maxMemoryMB * 1024 * 1024 && (
              <span className="text-xs text-red-600">(High Memory)</span>
            )}
          </div>

          {storageInfo && (
            <div className="flex items-center gap-2 px-3 py-1 border border-black rounded-md whitespace-nowrap">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">
                {itemType === 'events' ? storageInfo.eventCount :
                 itemType === 'analyses' ? storageInfo.analysisCount :
                 storageInfo.annotationCount} cached
              </span>
              <span className="text-xs text-muted-foreground">
                ({itemType === 'events' ? formatBytes(storageInfo.eventsSize) :
                  itemType === 'analyses' ? formatBytes(storageInfo.analysesSize) :
                  formatBytes(storageInfo.annotationsSize)})
              </span>
            </div>
          )}
        </div>

        {/* Right side: Search and controls - Fixed widths */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Input
            type="text"
            placeholder={`Search ${itemType}...`}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-40 border-black"
          />
          
          {availableFilters.length > 0 && onFilterChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="black-outline" className="whitespace-nowrap">
                  {filterLabel}: {selectedFilter || 'all'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{filterLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={selectedFilter || 'all'} onValueChange={onFilterChange}>
                  {availableFilters.map(filter => (
                    <DropdownMenuRadioItem key={filter} value={filter}>
                      {filter}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          
          <Button variant="black-outline" size="sm" onClick={onSortOrderToggle} className="flex-shrink-0">
            {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
          
          {/* Custom controls for specific tabs */}
          {children}
        </div>
      </div>

      {/* Line 2: Action Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button 
          variant="black-outline" 
          size="sm" 
          onClick={onLoadMore}
          disabled={loading}
        >
          <Download className="h-4 w-4 mr-1" />
          Load More
        </Button>
        
        <Button variant="black-outline" size="sm" onClick={onExpandAll}>
          Expand All
        </Button>
        
        <Button variant="black-outline" size="sm" onClick={onCollapseAll}>
          Collapse All
        </Button>
        
        <Button variant="black-outline" size="sm" onClick={onClearView}>
          Clear View
        </Button>
        
        <Button 
          variant="black-outline" 
          size="sm" 
          onClick={onClearStorage} 
          title={`Clear ${itemType} storage`}
        >
          <Database className="h-4 w-4" />
        </Button>
        
        <Button 
          variant="black-outline" 
          size="sm" 
          onClick={onToggleStorageInfo} 
          title="Storage info"
        >
          <HardDrive className="h-4 w-4" />
        </Button>
        
        <Button 
          variant="black-outline" 
          size="sm" 
          onClick={onCopyAll} 
          disabled={displayItemsCount === 0}
        >
          Copy All as JSON
        </Button>
      </div>
    </div>
  );
} 