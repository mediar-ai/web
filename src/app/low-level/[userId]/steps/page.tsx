'use client';

import DiffView from "@/components/low-level/DiffView";
import FormattedUITree from "@/components/low-level/FormattedUITree";
import ScreenshotView from "@/components/low-level/ScreenshotView";
import UITreeTimeline from "@/components/low-level/UITreeTimeline";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnalysisDisplay } from '@/components/workflow-analysis';
import { useUser } from "@/context/UserContext";
import { preprocessTree } from '@/lib/diff';
import { WORKFLOW_STEP_ANALYSIS_V2_PROMPT } from "@/lib/prompts";
import { generateSimplifiedUiTreeString } from '@/lib/uiTreeUtils';
import type { LowLevelEvent } from "@/types";
import { FlattenedWorkflowAnalysis } from '@/types';
import { diffLines } from 'diff';
import { ChevronsDown, ChevronsUp, Expand, Minimize2, MinusSquare, Pencil, PlusSquare, RefreshCw } from "lucide-react";
import { use, useCallback, useEffect, useMemo, useState } from "react";

interface GenericEvent {
  [key: string]: unknown;
  keyboard?: { key_code: number, keys?: string, is_key_down?: boolean };
  mouse?: { button?: string, metadata?: { ui_element?: { application?: string, name?: string, role?: string } }, event_type?: string };
  app_name?: string;
  url?: string;
  text?: string;
  screen?: { ui_tree?: string };
  screenshot_diff?: { before_timestamp?: string, after_timestamp?: string };
}

type StepsPageEventPayload = {
  payload?: {
    timestamp?: string;
    type?: string;
    event?: GenericEvent;
  }
}

type RawEventPayload = {
  timestamp?: string;
  type?: string;
  event?: GenericEvent;
};

type ContextForAnalysis = {
  screenshotBefore?: string | null;
  screenshotAfter?: string | null;
  screenshotBeforeSameWindow?: string | null;
  previousUiTree?: string | null;
  previousWindowTitle?: string;
  previousWindowTimestamp?: string;
  currentUiTree?: string | null;
  currentUiTree_structure?: string;
  eventsSincePreviousUiTreeByTimestamp?: RawEventPayload[];
  eventsSincePreviousUiTreeBySameWindow?: RawEventPayload[];
  uiTreeDiffLatestVsPreviousForTheSameWindow?: string;
  previousAnalyses?: PreviousAnalysis[];
};

// Use the flattened type for backward compatibility in the UI
type WorkflowStepAnalysis = FlattenedWorkflowAnalysis;

type PreviousAnalysis = WorkflowStepAnalysis;

const getEventTimestamp = (event: LowLevelEvent): string => {
  const payload = event.payload as StepsPageEventPayload;
  return payload?.payload?.timestamp || event.created_at;
};

const getEventTitle = (event: LowLevelEvent) => {
  const payload = event.payload as { payload?: { event?: { app_name?: string, screen?: { ui_tree?: string } } } };
  const appName = payload?.payload?.event?.app_name || 'Unknown App';
  const uiTree = payload?.payload?.event?.screen?.ui_tree;
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

export default function LlmIterationPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { setUserId } = useUser();
  const [allEvents, setAllEvents] = useState<LowLevelEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<LowLevelEvent | null>(null);
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);
  const [openContextGroupItems, setOpenContextGroupItems] = useState<string[]>([]);
  const [openDetailItems, setOpenDetailItems] = useState<string[]>([]);
  const [accordionSelection, setAccordionSelection] = useState<'expand' | 'collapse' | null>(null);
  const [contextGroupSelection, setContextGroupSelection] = useState<'expand' | 'collapse' | null>(null);
  const [detailSelection, setDetailSelection] = useState<'expand' | 'collapse' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro'); // 🔥 Updated to stable Vertex AI model name
  const [allWorkflowAnalyses, setAllWorkflowAnalyses] = useState<WorkflowStepAnalysis[]>([]);
  const [pendingJobCount, setPendingJobCount] = useState(0);
  const [rawLlmInputForDisplay, setRawLlmInputForDisplay] = useState<string | null>(null);
  const [totalEventCount, setTotalEventCount] = useState<number>(0);
  const [totalStepsCount, setTotalStepsCount] = useState<number>(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadMoreModalOpen, setIsLoadMoreModalOpen] = useState(false);
  const [loadAmount, setLoadAmount] = useState('1000');
  
  // State to control which context elements are included
  const [contextConfig, ] = useState({
    includeScreenshots: false,
    includePreviousUiTree: false,
    includePreviousWindowTitle: true,
    includePreviousSameWindowUiTree: false,
    includeEventsSincePreviousUiTree: true,
    includeEventsSinceSameWindowUiTree: true,
    includeCurrentUiTree: true,
    includeUiTreeDiff: true,
    includeLatestScreenshot: false,
    includePreviousAnalyses: true,
    includeGoodExamples: false,
    includeBadExamples: false,
    includePreviousWindowTimestamp: true,
  });

  const ACCORDION_STORAGE_KEY = useMemo(() => `llm-iteration-accordion-state-${userId}`, [userId]);
  const CONTEXT_GROUP_STORAGE_KEY = useMemo(() => `llm-iteration-context-group-state-${userId}`, [userId]);
  const DETAIL_ACCORDION_STORAGE_KEY = useMemo(() => `llm-iteration-detail-state-${userId}`, [userId]);

  useEffect(() => {
    if (userId) {
      const storedState = localStorage.getItem(ACCORDION_STORAGE_KEY);
      if (storedState) {
        try {
          setOpenAccordionItems(JSON.parse(storedState));
        } catch (e) {
          console.error("Failed to parse accordion state from localStorage", e);
          setOpenAccordionItems([]);
        }
      } else {
        setOpenAccordionItems([]);
      }

      const storedGroupState = localStorage.getItem(CONTEXT_GROUP_STORAGE_KEY);
      if (storedGroupState) {
        try {
          setOpenContextGroupItems(JSON.parse(storedGroupState));
        } catch (e) {
          console.error("Failed to parse context group state from localStorage", e);
          setOpenContextGroupItems([]);
        }
      } else {
        setOpenContextGroupItems([]);
      }
      
      const storedDetailState = localStorage.getItem(DETAIL_ACCORDION_STORAGE_KEY);
      if (storedDetailState) {
        try {
          setOpenDetailItems(JSON.parse(storedDetailState));
        } catch (e) {
          console.error("Failed to parse detail state from localStorage", e);
          setOpenDetailItems([]);
        }
      } else {
        setOpenDetailItems([]);
      }
    }
  }, [userId, ACCORDION_STORAGE_KEY, CONTEXT_GROUP_STORAGE_KEY, DETAIL_ACCORDION_STORAGE_KEY]);

  const handleAccordionValueChange = (value: string[]) => {
    setOpenAccordionItems(value);
    if (userId) {
      localStorage.setItem(ACCORDION_STORAGE_KEY, JSON.stringify(value));
    }
    setAccordionSelection(null);
  };

  const handleContextGroupValueChange = (value: string[]) => {
    setOpenContextGroupItems(value);
    if (userId) {
      localStorage.setItem(CONTEXT_GROUP_STORAGE_KEY, JSON.stringify(value));
    }
    setContextGroupSelection(null);
  };

  const handleDetailItemsValueChange = (value: string[]) => {
    setOpenDetailItems(value);
    if (userId) {
      localStorage.setItem(DETAIL_ACCORDION_STORAGE_KEY, JSON.stringify(value));
    }
    setDetailSelection(null);
  };

  const expandAll = () => {
    const allItemValues = ["item-1", "item-raw-llm-input", "item-2", "item-3", "item-4", "item-5", "item-6"];
    setOpenAccordionItems(allItemValues);
    localStorage.setItem(ACCORDION_STORAGE_KEY, JSON.stringify(allItemValues));
    setAccordionSelection('expand');
  };

  const collapseAll = () => {
    setOpenAccordionItems([]);
    localStorage.setItem(ACCORDION_STORAGE_KEY, JSON.stringify([]));
    setAccordionSelection('collapse');
  };

  const expandAllContextGroups = () => {
    const allGroupValues = ["group-screenshots", "group-ui-tree", "group-events"];
    setOpenContextGroupItems(allGroupValues);
    localStorage.setItem(CONTEXT_GROUP_STORAGE_KEY, JSON.stringify(allGroupValues));
    setContextGroupSelection('expand');
  };

  const collapseAllContextGroups = () => {
    setOpenContextGroupItems([]);
    localStorage.setItem(CONTEXT_GROUP_STORAGE_KEY, JSON.stringify([]));
    setContextGroupSelection('collapse');
  };

  const expandAllDetails = () => {
    const allDetailValues = [
      "sub-item-1", "sub-item-prev-screenshot-same-window", "sub-item-5", // Screenshots
      "sub-item-2", "sub-item-prev-window-title", "sub-item-prev-same-window", "sub-item-current-tree", "sub-item-4", // UI-Tree
      "sub-item-3", "sub-item-events-same-window", // Events
    ];
    setOpenDetailItems(allDetailValues);
    localStorage.setItem(DETAIL_ACCORDION_STORAGE_KEY, JSON.stringify(allDetailValues));
    setDetailSelection('expand');
  }

  const collapseAllDetails = () => {
    setOpenDetailItems([]);
    localStorage.setItem(DETAIL_ACCORDION_STORAGE_KEY, JSON.stringify([]));
  }

  // --- Start of Reactive Data Processing ---

  const fetchAllWorkflowAnalyses = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/fetch-llm-analyses?userId=${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch workflow analyses');
      }
      const data = await response.json();
      // The API now returns flattened analyses for backward compatibility
      const analyses: WorkflowStepAnalysis[] = data.analyses || [];
      setAllWorkflowAnalyses(analyses);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId]);

  useEffect(() => {
    setUserId(userId);
    const fetchEvents = async () => {
      if (!userId) return;
      setLoading(true);
      try {
        const response = await fetch(`/api/low-level/${userId}?offset=0`);
        if (!response.ok) {
          throw new Error('Network response was not ok when fetching events');
        }
        const data = await response.json();
        // The API now provides pre-sorted, stable data. No need to sort on the client.
        const newEvents = data.events || [];
        setAllEvents(newEvents);
        setHasMore(data.hasMore || false);
        setOffset(newEvents.length);
        if (data.totalEventCount) {
          setTotalEventCount(data.totalEventCount);
        }
        if (data.totalStepsCount) {
          setTotalStepsCount(data.totalStepsCount);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchEvents();
      fetchAllWorkflowAnalyses();
    }
  }, [userId, setUserId, fetchAllWorkflowAnalyses]);

  useEffect(() => {
    if (!userId) return;

    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/users/${userId}/workflow-status`);
        if (!response.ok) return;
        const data = await response.json();
        setPendingJobCount(data.pendingCount || 0);
        
        // To avoid re-fetching all analyses, we can just update the count
        // if it's different from the length of our current analyses array.
        // A more robust solution might merge new analyses, but this is efficient.
        if (data.processedCount !== allWorkflowAnalyses.length) {
            fetchAllWorkflowAnalyses();
        }

      } catch (e) {
        console.error("Failed to fetch workflow status", e);
      }
    };
    
    // Poll immediately and then every 5 seconds
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);

    return () => clearInterval(interval);
  }, [userId, allWorkflowAnalyses.length, fetchAllWorkflowAnalyses]);

  const loadMoreEvents = async (amount: number) => {
    if (!hasMore || isLoadingMore || !userId) return;
    setIsLoadingMore(true);
    try {
      const response = await fetch(`/api/low-level/${userId}?offset=${offset}&limit=${amount}`);
      if (!response.ok) {
        throw new Error('Network response was not ok when fetching more events');
      }
      const data = await response.json();
      // The API now provides pre-sorted, stable data. No need to sort on the client.
      const newEvents = data.events || [];
      
      setAllEvents(prevEvents => [...prevEvents, ...newEvents]);
      setHasMore(data.hasMore || false);
      setOffset(prevOffset => prevOffset + newEvents.length);

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Filter for UI tree events and sort them
  const uiTreeEvents = useMemo(() => {
    return allEvents
      .filter(event => (event.payload as StepsPageEventPayload).payload?.type === 'ui_tree')
      .sort((a, b) => new Date(getEventTimestamp(a)).getTime() - new Date(getEventTimestamp(b)).getTime());
  }, [allEvents]);

  useEffect(() => {
    // Automatically select the last UI tree event on initial load,
    // but don't override if a selection has already been made.
    if (uiTreeEvents.length > 0 && !selectedEvent) {
      setSelectedEvent(uiTreeEvents[uiTreeEvents.length - 1]);
    }
  }, [uiTreeEvents, selectedEvent]);

  const previousAnalyses = useMemo(() => {
    if (!selectedEvent || !allWorkflowAnalyses.length) {
      return [];
    }
  
    // Find the index of the currently selected event in the sorted list of all UI tree events.
    const currentIndex = uiTreeEvents.findIndex(event => event.id === selectedEvent.id);
    if (currentIndex <= 0) {
      return [];
    }
  
    // Get the timestamps of the three UI tree events that precede the current one.
    const precedingEvents = uiTreeEvents.slice(Math.max(0, currentIndex - 3), currentIndex);
    const precedingTimestamps = new Set(precedingEvents.map(e => getEventTimestamp(e)));
  
    // Filter all existing analyses to find the ones that match these preceding timestamps.
    const relevantAnalyses = allWorkflowAnalyses
      .filter(analysis => precedingTimestamps.has(analysis.client_timestamp))
      .sort((a, b) => new Date(b.client_timestamp).getTime() - new Date(a.client_timestamp).getTime()); // Sort descending
  
    return relevantAnalyses;
  }, [selectedEvent, allWorkflowAnalyses, uiTreeEvents]);

  // Find the analysis that corresponds to the currently selected event
  const existingAnalysisForSelectedEvent = useMemo(() => {
    if (!selectedEvent || !allWorkflowAnalyses) return null;
    
    // Use direct ID matching via source_ui_tree_event_id for reliable linking
    return allWorkflowAnalyses.find(analysis => 
      analysis.source_ui_tree_event_id === selectedEvent.id
    ) || null;
  }, [selectedEvent, allWorkflowAnalyses]);

  // Find the previous UI tree event in the timeline
  const previousUiTreeEvent = useMemo(() => {
    if (!selectedEvent) return null;
    const currentIndex = uiTreeEvents.findIndex(e => e.id === selectedEvent.id);
    return currentIndex > 0 ? uiTreeEvents[currentIndex - 1] : null;
  }, [selectedEvent, uiTreeEvents]);

  // Get the UI tree string from the previous event
  const previousUiTree = useMemo(() => {
    if (!previousUiTreeEvent) return null;
    return (previousUiTreeEvent.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree || null;
  }, [previousUiTreeEvent]);

  // Get the UI tree string from the current event
  const currentUiTree = useMemo(() => {
    if (!selectedEvent) return null;
    return (selectedEvent.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree || null;
  }, [selectedEvent]);

  // Find all events that occurred between the previous and current UI tree events
  const eventsBetweenByTimestamp = useMemo(() => {
    if (!previousUiTreeEvent || !selectedEvent) return [];
    const prevTimestamp = new Date(getEventTimestamp(previousUiTreeEvent)).getTime();
    const currentTimestamp = new Date(getEventTimestamp(selectedEvent)).getTime();
    return allEvents.filter(e => {
      const eventTime = new Date(getEventTimestamp(e)).getTime();
      return eventTime > prevTimestamp && eventTime <= currentTimestamp;
    });
  }, [allEvents, previousUiTreeEvent, selectedEvent]);

  const processedStepsCount = useMemo(() => {
    if (!allWorkflowAnalyses.length || !uiTreeEvents.length) return 0;
    const analyzedTimestamps = new Set(allWorkflowAnalyses.map(a => a.client_timestamp));
    return uiTreeEvents.filter(event => analyzedTimestamps.has(getEventTimestamp(event))).length;
  }, [allWorkflowAnalyses, uiTreeEvents]);

  const previousSameWindowUiTreeEvent = useMemo(() => {
    if (!selectedEvent) return null;
    const currentTitle = getEventTitle(selectedEvent);
    const currentIndex = uiTreeEvents.findIndex(e => e.id === selectedEvent.id);
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (getEventTitle(uiTreeEvents[i]) === currentTitle) {
        return uiTreeEvents[i];
      }
    }
    return null;
  }, [selectedEvent, uiTreeEvents]);

  const previousSameWindowUiTree = useMemo(() => {
      if (!previousSameWindowUiTreeEvent) return null;
      return (previousSameWindowUiTreeEvent.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree || null;
  }, [previousSameWindowUiTreeEvent]);

  const eventsBetweenSameWindow = useMemo(() => {
      if (!previousSameWindowUiTreeEvent || !selectedEvent) return [];
      const prevTimestamp = new Date(getEventTimestamp(previousSameWindowUiTreeEvent)).getTime();
      const currentTimestamp = new Date(getEventTimestamp(selectedEvent)).getTime();
      return allEvents.filter(e => {
          const eventTime = new Date(getEventTimestamp(e)).getTime();
          return eventTime > prevTimestamp && eventTime < currentTimestamp;
      });
  }, [allEvents, previousSameWindowUiTreeEvent, selectedEvent]);

  // Screenshot for "previous ui-tree by timestamp"
  const relevantScreenshotDiffPrevious = useMemo(() => {
      if (!previousUiTreeEvent) return null;
      const targetTimestamp = new Date(getEventTimestamp(previousUiTreeEvent)).getTime();
      
      // Time bounds: 2 seconds before, 1 second after
      const beforeBound = targetTimestamp - (2 * 1000); // 2 seconds before
      const afterBound = targetTimestamp + (1 * 1000);  // 1 second after
      
      // Find screenshot_diff events within time bounds
      const candidateEvents = allEvents.filter(event => {
          if ((event.payload as StepsPageEventPayload).payload?.type !== 'screenshot_diff') return false;
          const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
          if (!afterTimestamp) return false;
          
          const afterTime = new Date(afterTimestamp).getTime();
          return afterTime >= beforeBound && afterTime <= afterBound;
      });
      
      // Find the one with after_timestamp closest to the UI tree timestamp
      let closestEvent = null;
      let smallestTimeDiff = Infinity;
      
      for (const event of candidateEvents) {
          const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
          if (afterTimestamp) {
              const afterTime = new Date(afterTimestamp).getTime();
              const timeDiff = Math.abs(afterTime - targetTimestamp);
              if (timeDiff < smallestTimeDiff) {
                  smallestTimeDiff = timeDiff;
                  closestEvent = event;
              }
          }
      }
      
      return closestEvent;
  }, [allEvents, previousUiTreeEvent]);

  // Screenshot for "latest ui-tree"
  const relevantScreenshotDiff = useMemo(() => {
      if (!selectedEvent) return null;
      const currentTimestamp = new Date(getEventTimestamp(selectedEvent)).getTime();
      
      // Time bounds: 2 seconds before, 1 second after
      const beforeBound = currentTimestamp - (2 * 1000); // 2 seconds before
      const afterBound = currentTimestamp + (1 * 1000);  // 1 second after
      
      // Find screenshot_diff events within time bounds
      const candidateEvents = allEvents.filter(event => {
          if ((event.payload as StepsPageEventPayload).payload?.type !== 'screenshot_diff') return false;
          const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
          if (!afterTimestamp) return false;
          
          const afterTime = new Date(afterTimestamp).getTime();
          return afterTime >= beforeBound && afterTime <= afterBound;
      });
      
      // Find the one with after_timestamp closest to the UI tree timestamp
      let closestEvent = null;
      let smallestTimeDiff = Infinity;
      
      for (const event of candidateEvents) {
          const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
          if (afterTimestamp) {
              const afterTime = new Date(afterTimestamp).getTime();
              const timeDiff = Math.abs(afterTime - currentTimestamp);
              if (timeDiff < smallestTimeDiff) {
                  smallestTimeDiff = timeDiff;
                  closestEvent = event;
              }
          }
      }
      
      return closestEvent;
  }, [allEvents, selectedEvent]);

  const beforeScreenshotDataUrl = useMemo(() => relevantScreenshotDiffPrevious?.payload.payload?.event?.screenshot_diff?.after || null, [relevantScreenshotDiffPrevious]);
  const beforeScreenshotTimestamp = useMemo(() => relevantScreenshotDiffPrevious?.payload.payload?.event?.screenshot_diff?.after_timestamp || null, [relevantScreenshotDiffPrevious]);
  
  const afterScreenshotDataUrl = useMemo(() => relevantScreenshotDiff?.payload.payload?.event?.screenshot_diff?.after || null, [relevantScreenshotDiff]);
  const afterScreenshotTimestamp = useMemo(() => relevantScreenshotDiff?.payload.payload?.event?.screenshot_diff?.after_timestamp || null, [relevantScreenshotDiff]);

  // Screenshot for "previous ui-tree of the same window"
  const relevantScreenshotDiffSameWindow = useMemo(() => {
      if (!previousSameWindowUiTreeEvent) return null;
      const targetTimestamp = new Date(getEventTimestamp(previousSameWindowUiTreeEvent)).getTime();
      
      // Time bounds: 2 seconds before, 1 second after
      const beforeBound = targetTimestamp - (2 * 1000); // 2 seconds before
      const afterBound = targetTimestamp + (1 * 1000);  // 1 second after
      
      // Find screenshot_diff events within time bounds
      const candidateEvents = allEvents.filter(event => {
          if ((event.payload as StepsPageEventPayload).payload?.type !== 'screenshot_diff') return false;
          const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
          if (!afterTimestamp) return false;
          
          const afterTime = new Date(afterTimestamp).getTime();
          return afterTime >= beforeBound && afterTime <= afterBound;
      });
      
      // Find the one with after_timestamp closest to the UI tree timestamp
      let closestEvent = null;
      let smallestTimeDiff = Infinity;
      
      for (const event of candidateEvents) {
          const afterTimestamp = event.payload.payload?.event?.screenshot_diff?.after_timestamp;
          if (afterTimestamp) {
              const afterTime = new Date(afterTimestamp).getTime();
              const timeDiff = Math.abs(afterTime - targetTimestamp);
              if (timeDiff < smallestTimeDiff) {
                  smallestTimeDiff = timeDiff;
                  closestEvent = event;
              }
          }
      }
      
      return closestEvent;
  }, [allEvents, previousSameWindowUiTreeEvent]);

  const beforeScreenshotDataUrlSameWindow = useMemo(() => relevantScreenshotDiffSameWindow?.payload.payload?.event?.screenshot_diff?.after || null, [relevantScreenshotDiffSameWindow]);
  const beforeScreenshotTimestampSameWindow = useMemo(() => relevantScreenshotDiffSameWindow?.payload.payload?.event?.screenshot_diff?.after_timestamp || null, [relevantScreenshotDiffSameWindow]);

  const llmContext = useMemo((): ContextForAnalysis => {
    if (!selectedEvent) {
      return {};
    }

    const context: ContextForAnalysis = {};

    if (contextConfig.includeScreenshots) {
      context.screenshotBefore = beforeScreenshotDataUrl;
      context.screenshotBeforeSameWindow = beforeScreenshotDataUrlSameWindow;
    }
    if (contextConfig.includeLatestScreenshot) {
      context.screenshotAfter = afterScreenshotDataUrl;
    }
    if (contextConfig.includePreviousUiTree && previousUiTree) {
      context.previousUiTree = generateSimplifiedUiTreeString(previousUiTree);
    }
    if (contextConfig.includePreviousWindowTitle && previousUiTreeEvent) {
      context.previousWindowTitle = getEventTitle(previousUiTreeEvent);
      context.previousWindowTimestamp = new Date(previousUiTreeEvent.created_at).toLocaleString();
    }
    if (contextConfig.includeCurrentUiTree && currentUiTree) {
      context.currentUiTree_structure = "The UI tree is a simplified representation of the accessibility tree. Each line has the format: 'LineNumber. RomanNumeralIndentation. [Role] 'Name' {Attributes}'.";
      context.currentUiTree = generateSimplifiedUiTreeString(currentUiTree);
    }
    
    if (contextConfig.includeUiTreeDiff && currentUiTree && previousSameWindowUiTree) {
      const oldStr = preprocessTree(previousSameWindowUiTree);
      const newStr = preprocessTree(currentUiTree);
      const differences = diffLines(oldStr, newStr);
      
      const changedLines = differences
        .filter(part => part.added || part.removed)
        .map(part => {
          const prefix = part.added ? '+' : '-';
          // Add prefix to each line of the change
          return part.value.split('\n').filter(line => line.length > 0).map(line => `${prefix} ${line}`).join('\n');
        })
        .join('\n');

      if (changedLines.length > 0) {
        context.uiTreeDiffLatestVsPreviousForTheSameWindow = changedLines;
      }
    }

    if (contextConfig.includeEventsSincePreviousUiTree && eventsBetweenByTimestamp.length > 0) {
      context.eventsSincePreviousUiTreeByTimestamp = eventsBetweenByTimestamp.map(event => event.payload.payload as RawEventPayload);
    }

    if (contextConfig.includeEventsSinceSameWindowUiTree && eventsBetweenSameWindow.length > 0) {
      context.eventsSincePreviousUiTreeBySameWindow = eventsBetweenSameWindow.map(event => event.payload.payload as RawEventPayload);
    }

    if (contextConfig.includePreviousAnalyses && previousAnalyses.length > 0) {
      context.previousAnalyses = previousAnalyses.slice(0, 3);
    }

    return context;
  }, [
    selectedEvent,
    previousUiTree,
    currentUiTree,
    beforeScreenshotDataUrl,
    beforeScreenshotDataUrlSameWindow,
    afterScreenshotDataUrl,
    eventsBetweenByTimestamp,
    eventsBetweenSameWindow,
    previousAnalyses,
    contextConfig,
    previousSameWindowUiTree,
    previousUiTreeEvent
  ]);

  useEffect(() => {
    // Automatically update the raw JSON preview whenever the context or model changes.
    if (selectedEvent && Object.keys(llmContext).length > 0) {
      const llmApiPayload = {
        prompt: WORKFLOW_STEP_ANALYSIS_V2_PROMPT,
        model: selectedModel,
        context: llmContext,
      };
      setRawLlmInputForDisplay(JSON.stringify(llmApiPayload, null, 2));
    } else {
      setRawLlmInputForDisplay(null);
    }
  }, [llmContext, selectedModel, selectedEvent]);

  // --- End of Reactive Data Processing ---

  const handleLoadMoreRequest = () => {
    let amount = parseInt(loadAmount, 10);
    // In case of 'all', we'll need a different strategy, for now, let's use a very large number
    // This should be coordinated with a backend change that can handle large limit requests.
    if (loadAmount === 'all') {
      amount = totalEventCount - allEvents.length; 
    }
    loadMoreEvents(amount);
    setIsLoadMoreModalOpen(false);
  };

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);

  const handleProcessStep = useCallback(async () => {
    if (!selectedEvent || !userId) return;

    setIsProcessing(true);
    setProcessingError(null);

    try {
      const response = await fetch('/api/ui/process-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          sessionId: selectedEvent.session_id,
          clientTimestamp: getEventTimestamp(selectedEvent),
          context: llmContext,
          model: selectedModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to process step');
      }

      // After successful processing, refresh all analyses to get the new one.
      await fetchAllWorkflowAnalyses();

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Failed to process step:", errorMessage);
      setProcessingError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedEvent, userId, llmContext, selectedModel, fetchAllWorkflowAnalyses]);

  if (error) {
    return <div className="p-4 text-red-500 font-bold bg-red-50 rounded-md">Error: {error}</div>;
  }

  if (!loading && allEvents.length === 0) {
    return <div className="p-4">No events found for this user.</div>;
  }

  return (
    <div className="p-4">
      <div className="sticky top-28 bg-background z-10 border-b">
        {loading ? (
          <div className="py-4 px-2 h-[124px] flex items-center">
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <UITreeTimeline
            uiTreeEvents={uiTreeEvents}
            selectedEvent={selectedEvent}
            onEventSelect={setSelectedEvent}
          />
        )}
      </div>
      <Card className="my-4">
        <CardContent className="p-4 flex items-center space-x-4 text-sm">
          <span className="font-semibold text-base">Summary:</span>
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-foreground">Total Events:</span>
            <span className="font-semibold">{totalEventCount} (loaded {allEvents.length})</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-foreground">UI Steps:</span>
            <span className="font-semibold">{uiTreeEvents.length} / {totalStepsCount}</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-foreground">Processed:</span>
            <span className="font-semibold">{processedStepsCount}</span>
          </div>
          <div className="flex-grow" />
          {hasMore && (
            <Button variant="outline" size="sm" onClick={() => setIsLoadMoreModalOpen(true)} disabled={isLoadingMore}>
              {isLoadingMore ? 'Loading...' : 'Load More'}
            </Button>
          )}
          {pendingJobCount > 0 ? (
            <Badge variant="outline">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Processing {pendingJobCount} remaining...
            </Badge>
          ) : (
            <Badge variant="secondary">
              Idle
            </Badge>
          )}
        </CardContent>
      </Card>
      <div className="flex items-center my-4 space-x-2">
        <div className="w-12 text-xs text-gray-500">(Included)</div>
        <div className="flex-1"></div>
        <TooltipProvider>
          <div className="flex items-end space-x-2">
            <div className="flex items-center space-x-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={accordionSelection === 'expand' ? 'default' : 'outline'} size="sm" onClick={expandAll}><Expand className="h-4 w-4" /></Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Expand All Sections</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={accordionSelection === 'collapse' ? 'default' : 'outline'} size="sm" onClick={collapseAll}><Minimize2 className="h-4 w-4" /></Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Collapse All Sections</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="h-4 border-l border-gray-300 mx-1"></div>
            <div className="flex items-center space-x-2 transform translate-y-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={contextGroupSelection === 'expand' ? 'default' : 'outline'} size="sm" onClick={expandAllContextGroups}><PlusSquare className="h-4 w-4" /></Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Expand Context Groups</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={contextGroupSelection === 'collapse' ? 'default' : 'outline'} size="sm" onClick={collapseAllContextGroups}><MinusSquare className="h-4 w-4" /></Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Collapse Context Groups</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="h-4 border-l border-gray-300 mx-1"></div>
            <div className="flex items-center space-x-2 transform translate-y-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={detailSelection === 'expand' ? 'default' : 'outline'} size="sm" onClick={expandAllDetails}><ChevronsDown className="h-4 w-4" /></Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Expand All Details</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant={detailSelection === 'collapse' ? 'default' : 'outline'} size="sm" onClick={collapseAllDetails}><ChevronsUp className="h-4 w-4" /></Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Collapse All Details</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>
      </div>
      {loading ? (
        <div className="flex flex-col items-center justify-center pt-16">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground mt-4">Loading Events...</p>
        </div>
      ) : (
        <Accordion 
          type="multiple" 
          className="w-full" 
          value={openAccordionItems}
          onValueChange={handleAccordionValueChange}
        >
          <AccordionItem value="item-1">
            <div className="flex items-center">
              <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
              <AccordionTrigger className="flex-1">Context</AccordionTrigger>
            </div>
            <AccordionContent className="space-y-4 pl-4">
              <Accordion 
                type="multiple" 
                className="w-full"
                value={openContextGroupItems}
                onValueChange={handleContextGroupValueChange}
              >
                <AccordionItem value="group-screenshots">
                  <AccordionTrigger className="text-md font-semibold pl-4">Screenshots</AccordionTrigger>
                  <AccordionContent className="pl-8">
                    <Accordion type="multiple" value={openDetailItems} onValueChange={handleDetailItemsValueChange}>
                      <AccordionItem value="sub-item-1">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeScreenshots} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Screenshot (at the time of previous ui-tree by timestamp)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="text-xs text-muted-foreground mb-1">
                            {previousUiTreeEvent ? (
                              <p><strong>UI Tree:</strong> {new Date(previousUiTreeEvent.created_at).toLocaleString()}</p>
                            ) : (
                              <p><strong>UI Tree:</strong> (Not available)</p>
                            )}
                            {beforeScreenshotTimestamp ? (
                              <p><strong>Screenshot:</strong> {new Date(beforeScreenshotTimestamp).toLocaleString()}</p>
                            ) : (
                              <p><strong>Screenshot:</strong> (Not available)</p>
                            )}
                          </div>
                          <ScreenshotView 
                            dataUrl={beforeScreenshotDataUrl}
                          />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-prev-screenshot-same-window">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeScreenshots} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Screenshot (at the time of previous ui-tree of the same window)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="text-xs text-muted-foreground mb-1">
                            {previousSameWindowUiTreeEvent ? (
                              <p><strong>UI Tree:</strong> {new Date(previousSameWindowUiTreeEvent.created_at).toLocaleString()}</p>
                            ) : (
                              <p><strong>UI Tree:</strong> (Not available)</p>
                            )}
                            {beforeScreenshotTimestampSameWindow ? (
                              <p><strong>Screenshot:</strong> {new Date(beforeScreenshotTimestampSameWindow).toLocaleString()}</p>
                            ) : (
                              <p><strong>Screenshot:</strong> (Not available)</p>
                            )}
                          </div>
                          <ScreenshotView 
                            dataUrl={beforeScreenshotDataUrlSameWindow}
                          />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-5">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeLatestScreenshot} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Screenshot (at the time of the latest ui-tree)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="text-xs text-muted-foreground mb-1">
                            {selectedEvent ? (
                              <p><strong>UI Tree:</strong> {new Date(selectedEvent.created_at).toLocaleString()}</p>
                            ) : (
                              <p><strong>UI Tree:</strong> (Not available)</p>
                            )}
                            {afterScreenshotTimestamp ? (
                              <p><strong>Screenshot:</strong> {new Date(afterScreenshotTimestamp).toLocaleString()}</p>
                            ) : (
                              <p><strong>Screenshot:</strong> (Not available)</p>
                            )}
                          </div>
                          <ScreenshotView 
                            dataUrl={afterScreenshotDataUrl}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="group-ui-tree">
                  <AccordionTrigger className="text-md font-semibold pl-4">UI-Tree</AccordionTrigger>
                  <AccordionContent className="pl-8">
                    <Accordion type="multiple" value={openDetailItems} onValueChange={handleDetailItemsValueChange}>
                      <AccordionItem value="sub-item-2">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includePreviousUiTree} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Previous ui-tree (by timestamp)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          {previousUiTree ? (
                            <>
                              <p className="text-xs text-muted-foreground mb-1">{new Date(previousUiTreeEvent!.created_at).toLocaleString()}</p>
                              <FormattedUITree treeString={previousUiTree} />
                            </>
                          ) : (
                            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                              No previous UI tree to display.
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-prev-window-title">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includePreviousWindowTitle} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Window title of previous ui tree by timestamp</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          {previousUiTreeEvent ? (
                            <div className="p-2 text-sm">
                              <p><b>Timestamp:</b> {new Date(previousUiTreeEvent.created_at).toLocaleString()}</p>
                              <p><b>Window:</b> {getEventTitle(previousUiTreeEvent)}</p>
                            </div>
                          ) : (
                            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                              No previous UI tree to display.
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-prev-same-window">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includePreviousSameWindowUiTree} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Previous ui-tree (same window)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          {previousSameWindowUiTree ? (
                            <FormattedUITree treeString={previousSameWindowUiTree} />
                          ) : (
                            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                              No previous UI tree found for this window.
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-current-tree">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeCurrentUiTree} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Latest ui-tree</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          {currentUiTree ? (
                            <FormattedUITree treeString={currentUiTree} />
                          ) : (
                            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                              No UI tree to display.
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-4">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeUiTreeDiff} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">ui-tree diff (latest vs. previous for the same window)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          {currentUiTree && previousSameWindowUiTree ? (
                            <DiffView oldTree={previousSameWindowUiTree} newTree={currentUiTree} />
                          ) : (
                            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                              Not enough data to compute diff.
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="group-events">
                  <AccordionTrigger className="text-md font-semibold pl-4">Events</AccordionTrigger>
                  <AccordionContent className="pl-8">
                    <Accordion type="multiple" value={openDetailItems} onValueChange={handleDetailItemsValueChange}>
                      <AccordionItem value="sub-item-3">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeEventsSincePreviousUiTree} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Events (since previous ui-tree by timestamp)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="p-2 border rounded-md bg-gray-50 dark:bg-gray-800 space-y-1">
                            {eventsBetweenByTimestamp.length > 0 ? (
                              eventsBetweenByTimestamp.map((event, index) => (
                                <div key={index}>
                                  <pre className="text-xs overflow-auto bg-gray-50 border rounded-md font-mono text-gray-700">
                                    {JSON.stringify(event.payload.payload, null, 2)}
                                  </pre>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground">No events found in this interval.</p>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-events-same-window">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeEventsSinceSameWindowUiTree} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Events (since previous ui-tree of the same window)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="p-2 border rounded-md bg-gray-50 dark:bg-gray-800 space-y-1">
                            {previousSameWindowUiTreeEvent ? (
                              eventsBetweenSameWindow.length > 0 ? (
                                eventsBetweenSameWindow.map((event, index) => (
                                  <div key={index}>
                                    <pre className="text-xs overflow-auto bg-gray-50 border rounded-md font-mono text-gray-700">
                                      {JSON.stringify(event.payload.payload, null, 2)}
                                    </pre>
                                  </div>
                                ))
                              ) : (
                                <p className="text-xs text-muted-foreground">No events found in this interval.</p>
                              )
                            ) : (
                              <p className="text-xs text-muted-foreground">No previous UI tree from the same window to compare against.</p>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <div className="flex items-center">
              <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
              <AccordionTrigger className="flex-1">System prompt</AccordionTrigger>
            </div>
            <AccordionContent>
              <Textarea
                value={WORKFLOW_STEP_ANALYSIS_V2_PROMPT}
                readOnly
                disabled
                className="h-64 text-xs bg-gray-50 dark:bg-gray-800"
              />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <div className="flex items-center">
              <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeGoodExamples} disabled /></div>
              <AccordionTrigger className="flex-1">Good Examples</AccordionTrigger>
            </div>
            <AccordionContent>
              Placeholder for Good Examples.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-4">
            <div className="flex items-center">
              <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeBadExamples} disabled /></div>
              <AccordionTrigger className="flex-1">Bad Examples</AccordionTrigger>
            </div>
            <AccordionContent>
              Placeholder for Bad Examples.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-6">
            <div className="flex items-center">
              <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includePreviousAnalyses} disabled /></div>
              <AccordionTrigger className="flex-1">Previous Analyses</AccordionTrigger>
            </div>
            <AccordionContent className="space-y-2">
              {previousAnalyses.length > 0 ? (
                previousAnalyses.map((analysis) => (
                  <div key={analysis.id} className="p-2 border rounded-md bg-gray-50 dark:bg-gray-800">
                    <AnalysisDisplay analysis={analysis} format="detailed" showMetadata={true} />
                    <p className="text-muted-foreground text-xs mt-2">Timestamp: {new Date(analysis.client_timestamp).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</p>
                  </div>
                ))
              ) : (
                <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800 text-xs text-muted-foreground">
                  No previous analyses found for the steps immediately preceding the selected event.
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-raw-llm-input">
            <div className="flex items-center">
              {/* Checkbox removed as per user request */}
              <div className="w-12 flex justify-center"></div> {/* Maintain spacing if needed, or remove entirely if trigger should align left */} 
              <AccordionTrigger className="flex-1 italic">Full Raw LLM Input Context</AccordionTrigger>
            </div>
            <AccordionContent>
              {rawLlmInputForDisplay ? (
                <pre className="p-2 text-xs overflow-auto bg-gray-50 border rounded-md font-mono text-gray-700 max-h-96">
                  {rawLlmInputForDisplay}
                </pre>
              ) : (
                <p className="text-sm text-gray-500 p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                  No raw input to display. Process a step to see the input.
                </p>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-5">
            <div className="flex items-center w-full">
              <div className="w-12" />
              <AccordionTrigger className="flex-grow-0 pr-2">
                <div className="flex items-center gap-2">
                  <span>Output</span>
                  {existingAnalysisForSelectedEvent ? (
                    <Badge variant="secondary">Processed</Badge>
                  ) : (
                    <Badge variant="destructive">Not Processed</Badge>
                  )}
                </div>
              </AccordionTrigger>
              <div className="flex-grow" />
              <div className="flex items-center space-x-2 mr-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      {selectedModel}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuRadioGroup
                      value={selectedModel}
                      onValueChange={setSelectedModel}
                    >
                      <DropdownMenuRadioItem value="gemini-2.5-flash">
                        gemini-2.5-flash
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="gemini-2.5-pro">
                        gemini-2.5-pro
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button 
                  onClick={handleProcessStep} 
                  disabled={isProcessing}
                  size="sm"
                >
                  {isProcessing ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Pencil className="mr-2 h-4 w-4" />
                  )}
                  {existingAnalysisForSelectedEvent ? 'Re-Process' : 'Process'}
                </Button>
              </div>
            </div>
            <AccordionContent>
              {processingError && (
                <div className="p-2 my-2 text-xs text-red-700 bg-red-100 border border-red-200 rounded-md">
                  <strong>Error:</strong> {processingError}
                </div>
              )}
              {existingAnalysisForSelectedEvent ? (
                <div className="space-y-2 p-2">
                  <AnalysisDisplay analysis={existingAnalysisForSelectedEvent} format="detailed" showMetadata={true} />
                </div>
              ) : (
                <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                  No analysis available for this step. It may still be in the processing queue.
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {isLoadingMore && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="ml-4 text-muted-foreground">Loading more events...</p>
        </div>
      )}

      <Dialog open={isLoadMoreModalOpen} onOpenChange={setIsLoadMoreModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load More Events</DialogTitle>
            <DialogDescription>
              Select how many more events you would like to load into the timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="load-amount" className="text-right">
                Amount
              </Label>
              <Select value={loadAmount} onValueChange={setLoadAmount}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select amount" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1000">1,000</SelectItem>
                  <SelectItem value="5000">5,000</SelectItem>
                  <SelectItem value="10000">10,000</SelectItem>
                  <SelectItem value="all">All Remaining</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" onClick={handleLoadMoreRequest}>Load Events</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 