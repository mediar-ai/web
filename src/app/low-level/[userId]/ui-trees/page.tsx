'use client';

import { useEffect, useState, use, useCallback, useMemo } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import DiffView from '@/components/low-level/DiffView';

type UITreeEvent = LowLevelEvent & {
  payload: {
    payload?: {
      event?: {
        screen?: {
          ui_tree?: string;
        };
        app_name?: string;
      };
    };
  };
};

type GroupedUITrees = {
  [windowName: string]: UITreeEvent[];
};

export default function UITreesPage({ params }: { params: Promise<{ userId: string }> }) {
  const [events, setEvents] = useState<UITreeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedEvent, setSelectedEvent] = useState<UITreeEvent | null>(null);
  const [diffMode, setDiffMode] = useState<'raw' | 'previous' | 'next'>('raw');
  const { userId } = use(params);

  const fetchUITrees = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/low-level/${userId}/ui-trees`);
      if (!response.ok) {
        throw new Error('Failed to fetch UI tree events');
      }
      const data = await response.json();
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUITrees();
  }, [fetchUITrees]);

  const toggleGroupExpansion = (groupName: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
    // Reset selected event when collapsing/expanding a group
    setSelectedEvent(null);
  };

  const handleEventSelection = (event: UITreeEvent, eventGroup: UITreeEvent[]) => {
    const selectedIndex = eventGroup.findIndex(e => e.id === event.id);
    const hasPrevious = selectedIndex > 0;
    
    setSelectedEvent(event);
    setDiffMode(hasPrevious ? 'previous' : 'raw');
  };

  const getEventTitle = (event: UITreeEvent) => {
    const appName = event.payload.payload?.event?.app_name || 'Unknown App';
    const uiTree = event.payload.payload?.event?.screen?.ui_tree;
    if (uiTree) {
      try {
        const parsedTree = JSON.parse(uiTree);
        return parsedTree.attributes?.name || appName;
      } catch {
        return appName;
      }
    }
    return appName;
  }

  const groupedEvents = useMemo<GroupedUITrees>(() => {
    const groups: GroupedUITrees = {};
    events.forEach(event => {
      const title = getEventTitle(event);
      if (!groups[title]) {
        groups[title] = [];
      }
      groups[title].push(event);
    });
    // Sort events within each group by timestamp descending
    for (const title in groups) {
        groups[title].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return groups;
  }, [events]);

  return (
    <div>
      <div className="flex items-center gap-2 py-2 border-b mb-2">
        <Button variant="outline" onClick={fetchUITrees}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
        </Button>
      </div>
      
      {loading && (
        <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
        </div>
      )}

      {error && <div className="text-red-500 font-bold p-2 bg-red-50 rounded-md">Error: {error}</div>}

      {!loading && !error && Object.keys(groupedEvents).length === 0 && (
        <p>No UI tree events found for this user.</p>
      )}

      <div className="space-y-2">
        {Object.entries(groupedEvents).map(([windowName, eventGroup]) => {
          const isExpanded = expandedGroups[windowName] || false;
          const firstEvent = eventGroup[0];
          const lastEvent = eventGroup[eventGroup.length - 1];

          const selectedEventIndex = selectedEvent ? eventGroup.findIndex(e => e.id === selectedEvent.id) : -1;
          const previousEvent = selectedEventIndex > 0 ? eventGroup[selectedEventIndex - 1] : null;
          const nextEvent = selectedEventIndex !== -1 && selectedEventIndex < eventGroup.length - 1 ? eventGroup[selectedEventIndex + 1] : null;

          const currentTree = selectedEvent?.payload.payload?.event?.screen?.ui_tree;
          const previousTree = previousEvent?.payload.payload?.event?.screen?.ui_tree;
          const nextTree = nextEvent?.payload.payload?.event?.screen?.ui_tree;

          return (
            <Card key={windowName}>
              <CardHeader
                className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer"
                onClick={() => toggleGroupExpansion(windowName)}
              >
                <CardTitle className="text-sm font-medium truncate pr-4" title={windowName}>
                  {windowName} ({eventGroup.length})
                </CardTitle>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">
                    {new Date(firstEvent.created_at).toLocaleTimeString()} - {new Date(lastEvent.created_at).toLocaleTimeString()}
                  </span>
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
                    <CardContent className="p-2">
                        <div className="flex flex-wrap gap-1 mb-2">
                            {eventGroup.map(event => (
                                <Button 
                                    key={event.id}
                                    variant={selectedEvent?.id === event.id ? "default" : "outline"}
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleEventSelection(event, eventGroup);
                                    }}
                                >
                                    {new Date(event.created_at).toLocaleTimeString()}
                                </Button>
                            ))}
                        </div>
                        {selectedEvent && currentTree && (
                           <div className="space-y-2">
                            <ToggleGroup type="single" value={diffMode} onValueChange={(value: 'raw' | 'previous' | 'next') => value && setDiffMode(value)} className="justify-start">
                                <div className="mr-1"><ToggleGroupItem value="previous" disabled={!previousEvent}>Diff Previous</ToggleGroupItem></div>
                                <div className="mr-1"><ToggleGroupItem value="raw">Raw</ToggleGroupItem></div>
                                <div className="mr-1"><ToggleGroupItem value="next" disabled={!nextEvent}>Diff Next</ToggleGroupItem></div>
                            </ToggleGroup>

                            {diffMode === 'raw' && (
                                <pre className="p-2 text-xs overflow-auto bg-gray-100 dark:bg-gray-800 rounded">
                                    {JSON.stringify(JSON.parse(currentTree), null, 2)}
                                </pre>
                            )}
                            {diffMode === 'previous' && previousTree && (
                                <DiffView oldTree={previousTree} newTree={currentTree} />
                            )}
                            {diffMode === 'next' && nextTree && (
                                <DiffView oldTree={currentTree} newTree={nextTree} />
                            )}
                           </div>
                        )}
                    </CardContent>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          )
        })}
      </div>
    </div>
  );
} 