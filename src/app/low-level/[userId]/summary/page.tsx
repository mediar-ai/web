'use client';

import { useState, useEffect, use, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JsonBlock } from '@/components/ui/code-block';
import { ChevronDown, ChevronUp, Clipboard, Check, RefreshCw, ArrowUp, ArrowDown, Database, HardDrive, Download, FileText, Image, Activity, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getRawEventsStorage } from '@/lib/rawEventsStorage';

// Data types for Summary tab
type SummaryDataType = 'events' | 'analyses' | 'ui_trees' | 'screenshots' | 'all';

interface SummaryItem {
  id: string;
  type: SummaryDataType;
  title: string;
  timestamp: string;
  data: Record<string, unknown>;
  isNew?: boolean;
  metadata?: Record<string, unknown>;
}

// Helper function to estimate memory usage
const estimateMemoryUsage = (items: SummaryItem[]): number => {
  return items.length * 3072; // 3KB per summary item estimate
};

// Helper function to format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const Clock = () => {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const timerId = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timerId);
  }, []);

  return <div className="text-sm text-gray-500 font-mono w-48 text-right">{time ? `UTC: ${time.toUTCString()}` : ''}</div>;
};

export default function SummaryPage({ params }: { params: Promise<{ userId: string }> }) {
  // UI state
  const [displayItems, setDisplayItems] = useState<SummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDataType, setSelectedDataType] = useState<SummaryDataType>('all');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  
  // Storage state
  const [storageInfo, setStorageInfo] = useState<{
    totalSize: number;
    eventCount: number;
    maxSize: number;
    usagePercentage: number;
  } | null>(null);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  
  // Progressive loading state
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [loadAllProgress] = useState<{ loaded: number; total: number } | null>(null);
  
  // Load More modal state
  const [isLoadMoreModalOpen, setIsLoadMoreModalOpen] = useState(false);
  
  const { userId } = use(params);
  const viewClearedRef = useRef(false);
  const storageRef = useRef(getRawEventsStorage(userId));

  // Configuration constants
  const MAX_MEMORY_MB = 50;

  const LOCAL_STORAGE_KEY = `summary-expanded-items-${userId}`;
  const SUMMARY_OPEN_STORAGE_KEY = `summary-section-open-${userId}`;
  const SORT_ORDER_STORAGE_KEY = `summary-sort-order-${userId}`;

  // Data type options for dropdown
  const dataTypeOptions: { value: SummaryDataType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'all', label: 'All Data', icon: BarChart3 },
    { value: 'events', label: 'Events', icon: Activity },
    { value: 'analyses', label: 'Analyses', icon: FileText },
    { value: 'ui_trees', label: 'UI Trees', icon: FileText },
    { value: 'screenshots', label: 'Screenshots', icon: Image },
  ];

  // Load initial data on mount
  useEffect(() => {
    loadInitialData();
    loadStorageInfo();
    loadPreferences();
  }, []);

  const loadPreferences = () => {
    const savedExpanded = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedExpanded) {
      try {
        setExpandedItems(JSON.parse(savedExpanded));
      } catch {
        console.warn('[Summary] Failed to parse saved expanded items');
      }
    }

    const savedSummaryOpen = localStorage.getItem(SUMMARY_OPEN_STORAGE_KEY);
    if (savedSummaryOpen) {
      setIsSummaryOpen(savedSummaryOpen === 'true');
    }

    const savedSortOrder = localStorage.getItem(SORT_ORDER_STORAGE_KEY);
    if (savedSortOrder === 'asc' || savedSortOrder === 'desc') {
      setSortOrder(savedSortOrder);
    }
  };

  const loadInitialData = async () => {
    try {
      setLoading(true);
      console.log('[Summary] Loading initial data...');
      
      // Simulate loading different data types
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock data for demonstration
      const mockItems: SummaryItem[] = [
        {
          id: 'analysis-1',
          type: 'analyses',
          title: 'Workflow Analysis #1',
          timestamp: new Date().toISOString(),
          data: { type: 'workflow_analysis', steps: 5, accuracy: 0.95 },
          isNew: true,
        },
        {
          id: 'event-1',
          type: 'events',
          title: 'UI Interaction Event',
          timestamp: new Date(Date.now() - 60000).toISOString(),
          data: { type: 'click', element: 'button', coordinates: [100, 200] },
        },
        {
          id: 'screenshot-1',
          type: 'screenshots',
          title: 'Screenshot Diff',
          timestamp: new Date(Date.now() - 120000).toISOString(),
          data: { type: 'screenshot_diff', changes: 3, similarity: 0.87 },
        },
        {
          id: 'ui-tree-1',
          type: 'ui_trees',
          title: 'UI Tree Capture',
          timestamp: new Date(Date.now() - 180000).toISOString(),
          data: { type: 'ui_tree', elements: 45, depth: 7 },
        },
      ];

      setDisplayItems(mockItems);
      setTotalAvailable(mockItems.length);
      setMemoryUsage(estimateMemoryUsage(mockItems));
      
      console.log(`[Summary] Loaded ${mockItems.length} summary items`);
      
    } catch (error) {
      console.error('[Summary] Failed to load initial data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadStorageInfo = async () => {
    try {
      const info = await storageRef.current.getStorageInfo();
      setStorageInfo(info);
    } catch (error) {
      console.warn('[Summary] Failed to load storage info:', error);
    }
  };

  const toggleSummary = () => {
    const newOpen = !isSummaryOpen;
    setIsSummaryOpen(newOpen);
    localStorage.setItem(SUMMARY_OPEN_STORAGE_KEY, newOpen.toString());
  };

  const toggleItemExpansion = (id: string) => {
    const newExpanded = { ...expandedItems, [id]: !expandedItems[id] };
    setExpandedItems(newExpanded);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newExpanded));
  };

  const toggleSortOrder = () => {
    const newOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    setSortOrder(newOrder);
    localStorage.setItem(SORT_ORDER_STORAGE_KEY, newOrder);
  };

  const handleCopyData = async (item: SummaryItem) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(item.data, null, 2));
      setCopiedItemId(item.id);
      setTimeout(() => setCopiedItemId(null), 2000);
    } catch (error) {
      console.error('[Summary] Failed to copy data:', error);
    }
  };

  const handleCopyAllItems = async () => {
    try {
      const allData = filteredItems.map(item => item.data);
      await navigator.clipboard.writeText(JSON.stringify(allData, null, 2));
      alert('All summary data copied to clipboard!');
    } catch (error) {
      console.error('[Summary] Failed to copy all data:', error);
      alert('Failed to copy data to clipboard');
    }
  };

  const handleDataTypeClick = (type: SummaryDataType) => {
    setSelectedDataType(selectedDataType === type ? 'all' : type);
  };

  const getItemTimestamp = useCallback((item: SummaryItem): string => {
    return new Date(item.timestamp).toLocaleString();
  }, []);

  const getDataTypeIcon = (type: SummaryDataType) => {
    const option = dataTypeOptions.find(opt => opt.value === type);
    return option ? option.icon : Activity;
  };

  // Filtering and searching
  const searchedItems = useMemo(() => {
    if (!searchTerm) return displayItems;
    const lowercasedFilter = searchTerm.toLowerCase();
    return displayItems.filter(item => 
      item.title.toLowerCase().includes(lowercasedFilter) ||
      JSON.stringify(item.data).toLowerCase().includes(lowercasedFilter)
    );
  }, [displayItems, searchTerm]);

  const dataTypeFilteredItems = useMemo(() => {
    if (selectedDataType === 'all') return searchedItems;
    return searchedItems.filter(item => item.type === selectedDataType);
  }, [searchedItems, selectedDataType]);

  const filteredItems = useMemo(() => {
    const sorted = [...dataTypeFilteredItems].sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
    return sorted;
  }, [dataTypeFilteredItems, sortOrder]);

  const expandAll = () => {
    const allExpanded = filteredItems.reduce((acc, item) => {
      acc[item.id] = true;
      return acc;
    }, {} as Record<string, boolean>);
    setExpandedItems(allExpanded);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allExpanded));
  };

  const collapseAll = () => {
    setExpandedItems({});
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({}));
  };

  const clearView = () => {
    setDisplayItems([]);
    setExpandedItems({});
    setNewItemIds(new Set());
    viewClearedRef.current = true;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({}));
  };

  const loadMore = () => {
    // Placeholder for load more functionality
    console.log('[Summary] Load more requested');
  };

  // Summary statistics
  const summaryStats = useMemo(() => {
    const stats = new Map<SummaryDataType, number>();
    for (const item of searchedItems) {
      stats.set(item.type, (stats.get(item.type) || 0) + 1);
    }
    return Array.from(stats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [searchedItems]);

  return (
    <div>
      <div className="space-y-3 py-2 border-b mb-2">
        {/* Line 1: Clock and Core Stats */}
        <div className="flex items-center gap-3">
          <Clock />
          <div className="flex items-center gap-2 px-3 py-1 border border-black rounded-md">
            <span className="text-sm font-medium">
              {displayItems.length} items loaded
            </span>
            <span className="text-xs text-muted-foreground">
              ({formatBytes(memoryUsage)})
            </span>
            {totalAvailable && (
              <span className="text-xs text-muted-foreground">
                (of {totalAvailable.toLocaleString()} total)
              </span>
            )}
            {memoryUsage > MAX_MEMORY_MB * 1024 * 1024 && (
              <span className="text-xs text-red-600">(High Memory)</span>
            )}
          </div>

          {storageInfo && (
            <div className="flex items-center gap-2 px-3 py-1 border border-black rounded-md">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">
                {storageInfo.eventCount} cached
              </span>
              <span className="text-xs text-muted-foreground">
                ({(storageInfo.totalSize / 1024 / 1024).toFixed(1)}MB)
              </span>
            </div>
          )}
        </div>

        {/* Line 2: Search and Filters */}
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Search summary data..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64 border-black"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="black-outline">
                Filter by Data Type: {dataTypeOptions.find(opt => opt.value === selectedDataType)?.label || 'All Data'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Data Type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={selectedDataType} onValueChange={(value) => setSelectedDataType(value as SummaryDataType)}>
                {dataTypeOptions.map(option => {
                  const Icon = option.icon;
                  return (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <Icon className="h-4 w-4 mr-2" />
                      {option.label}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="black-outline" size="sm" onClick={toggleSortOrder}>
            {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>

        {/* Line 3: Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            variant="black-outline" 
            size="sm" 
            onClick={() => setIsLoadMoreModalOpen(true)}
            disabled={loading}
          >
            <Download className="h-4 w-4 mr-1" />
            Load More
          </Button>
          <Button variant="black-outline" size="sm" onClick={expandAll}>Expand All</Button>
          <Button variant="black-outline" size="sm" onClick={collapseAll}>Collapse All</Button>
          <Button variant="black-outline" size="sm" onClick={clearView}>Clear View</Button>
          <Button variant="black-outline" size="sm" onClick={() => setIsStorageOpen(!isStorageOpen)} title="Storage info">
            <HardDrive className="h-4 w-4" />
          </Button>
          <Button variant="black-outline" size="sm" onClick={handleCopyAllItems} disabled={displayItems.length === 0}>
            Copy All as JSON
          </Button>
        </div>
      </div>
      
      {/* Load All Progress */}
      {loadAllProgress && (
        <div className="mb-2 p-3 border border-black rounded-md">
          <div className="flex justify-between text-sm mb-2">
            <span>Loading all summary data...</span>
            <span>{loadAllProgress.loaded.toLocaleString()} / {loadAllProgress.total.toLocaleString()}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-black h-2 rounded-full transition-all duration-300"
              style={{ width: `${(loadAllProgress.loaded / loadAllProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
      
      {displayItems.length > 0 && (
        <Card className="mb-2">
          <CardHeader className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer" onClick={toggleSummary}>
            <CardTitle className="text-sm">Summary Overview</CardTitle>
            {isSummaryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardHeader>
          <AnimatePresence>
            {isSummaryOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <CardContent className="p-2 space-y-2">
                  <div>
                    <div className="flex flex-wrap gap-1">
                      {totalAvailable && (
                        <Badge variant="outline">Total Available: {totalAvailable.toLocaleString()}</Badge>
                      )}
                      <Badge variant="outline">Memory: {formatBytes(memoryUsage)}</Badge>
                    </div>
                    {summaryStats.length > 0 && (
                      <div className="mt-2">
                        <h4 className="text-xs font-semibold mb-1">Data Types:</h4>
                        <div className="flex flex-wrap gap-1">
                          {summaryStats.map(([type, count]) => {
                            const Icon = getDataTypeIcon(type);
                            return (
                              <Badge 
                                key={type} 
                                variant={selectedDataType === type ? "default" : "secondary"}
                                onClick={() => handleDataTypeClick(type)}
                                className="cursor-pointer flex items-center gap-1"
                              >
                                <Icon className="h-3 w-3" />
                                {dataTypeOptions.find(opt => opt.value === type)?.label || type}: {count}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {storageInfo && (
        <Card className="mb-2">
          <CardHeader className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer" onClick={() => setIsStorageOpen(!isStorageOpen)}>
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              IndexedDB Storage
            </CardTitle>
            {isStorageOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardHeader>
          <AnimatePresence>
            {isStorageOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <CardContent className="p-2 space-y-2">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-gray-600">Stored Events:</div>
                      <div className="font-medium">{storageInfo.eventCount.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Storage Used:</div>
                      <div className="font-medium">{(storageInfo.totalSize / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Storage Limit:</div>
                      <div className="font-medium">{(storageInfo.maxSize / 1024 / 1024).toFixed(0)} MB</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Usage:</div>
                      <div className="font-medium">{storageInfo.usagePercentage.toFixed(1)}%</div>
                    </div>
                  </div>
                  
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>Storage Usage</span>
                      <span>{storageInfo.usagePercentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          storageInfo.usagePercentage > 90 ? 'bg-red-500' :
                          storageInfo.usagePercentage > 70 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(storageInfo.usagePercentage, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-gray-200">
                    <p className="text-xs text-gray-600">
                      Summary data includes events, analyses, UI trees, and screenshots.
                      Data is cached for offline access and analysis.
                    </p>
                  </div>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {loading && displayItems.length === 0 && (
        <div className="flex flex-col items-center justify-center pt-16">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground mt-4">Loading Summary...</p>
        </div>
      )}

      {error && <div className="text-red-500 font-bold p-2 bg-red-50 rounded-md">Error: {error}</div>}

      {!loading && !error && filteredItems.length === 0 && (
        <p>
          {displayItems.length > 0 ? "No items match your search." : "No summary data found for this user."}
        </p>
      )}

      <div className="space-y-1">
        {filteredItems.map((item) => {
          const isExpanded = expandedItems[item.id] || false;
          const timestamp = getItemTimestamp(item);
          const isNew = newItemIds.has(item.id);
          const Icon = getDataTypeIcon(item.type);
          
          return (
            <Card 
              key={item.id} 
              className={`transition-all duration-300 ${
                isNew ? 'border-l-4 border-l-black' : ''
              }`}
            >
              <CardHeader 
                className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer"
                onClick={() => toggleItemExpansion(item.id)}
              >
                <div className="text-sm font-medium pr-4 whitespace-normal flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0 flex items-center gap-1">
                    <Icon className="h-3 w-3" />
                    {item.type}
                  </Badge>
                  <span className="font-medium">{item.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{timestamp}</span>
                    {isNew && (
                      <>
                        <Badge variant="outline" className="text-xs bg-black text-white border-black">
                          NEW
                        </Badge>
                        <span className="text-xs text-black font-medium">
                          ({Math.floor((Date.now() - new Date(item.timestamp).getTime()) / 1000)}s ago)
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </CardHeader>
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <CardContent className="p-0 relative">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyData(item);
                        }}
                      >
                        {copiedItemId === item.id ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Clipboard className="h-4 w-4" />
                        )}
                      </Button>
                      <JsonBlock
                        data={item.data}
                        theme="light"
                        size="sm"
                        showCopy={true}
                        maxHeight="300px"
                      />
                    </CardContent>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          );
        })}
      </div>

      {/* Load More Modal */}
      <Dialog open={isLoadMoreModalOpen} onOpenChange={setIsLoadMoreModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load More Summary Data</DialogTitle>
            <DialogDescription>
              Choose how you want to load additional summary data
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Load More Summary Items</h3>
                  <p className="text-sm text-muted-foreground">
                    Load additional summary data including events, analyses, UI trees, and screenshots
                  </p>
                </div>
                <Button 
                  variant="black-outline"
                  onClick={() => {
                    loadMore();
                    setIsLoadMoreModalOpen(false);
                  }}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load More'}
                </Button>
              </div>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
} 