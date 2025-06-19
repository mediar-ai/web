'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useState, useEffect, use, useCallback, useMemo } from "react";
import type { LowLevelEvent } from "@/types";
import { generateEventSummaryString } from "../../../../lib/eventSummarizer";
import { generateSimplifiedUiTreeString } from '@/lib/uiTreeUtils';
import UITreeTimeline from "@/components/low-level/UITreeTimeline";
import FormattedUITree from "@/components/low-level/FormattedUITree";
import ScreenshotView from "@/components/low-level/ScreenshotView";
import DiffView from "@/components/low-level/DiffView";
import { useUser } from "@/context/UserContext";
import { RefreshCw, Expand, Minimize2, PlusSquare, MinusSquare, ChevronsDown, ChevronsUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WORKFLOW_STEP_ANALYSIS_PROMPT } from "@/lib/prompts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

type AnalysisOutput = {
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
} | null;

type ContextForAnalysis = {
  screenshotBefore?: string | null;
  screenshotAfter?: string | null;
  previousUiTree?: string | null;
  currentUiTree?: string | null;
  currentUiTree_structure?: string;
  eventsSincePreviousUiTreeByTimestamp?: string[];
  eventsSincePreviousUiTreeBySameWindow?: string[];
  uiTreeDiff?: string;
  previousAnalyses?: PreviousAnalysis[];
};

type WorkflowStepAnalysis = {
  id: string; // Corresponds to the database primary key
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
  client_timestamp: string;
  created_at: string;
};

type PreviousAnalysis = WorkflowStepAnalysis;

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

const getEventTimestamp = (event: LowLevelEvent): string => {
  const payload = event.payload as StepsPageEventPayload;
  return payload?.payload?.timestamp || event.created_at;
};

const EventSummary = ({ event }: { event: LowLevelEvent }) => {
  const summary = generateEventSummaryString(event);
  return (
    <div className="text-sm font-medium pr-4" title={typeof summary === 'string' ? summary : undefined}>
      {summary}
    </div>
  );
};

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
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro-preview-06-05');
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisOutput, setAnalysisOutput] = useState<AnalysisOutput>(null);
  const [allWorkflowAnalyses, setAllWorkflowAnalyses] = useState<WorkflowStepAnalysis[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [currentBatchStep, setCurrentBatchStep] = useState(0);
  const [totalBatchSteps, setTotalBatchSteps] = useState(0);
  const [rawLlmInputForDisplay, setRawLlmInputForDisplay] = useState<string | null>(null);
  
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
      const analyses: WorkflowStepAnalysis[] = data.analyses || [];
      setAllWorkflowAnalyses(analyses);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId]);

  useEffect(() => {
    setUserId(userId);
    const fetchEvents = async () => {
      try {
        const response = await fetch(`/api/low-level/${userId}`);
        if (!response.ok) {
          throw new Error('Network response was not ok when fetching events');
        }
        const data = await response.json();
        const sortedEvents = (data.events || []).sort((a: LowLevelEvent, b: LowLevelEvent) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        setAllEvents(sortedEvents);
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

  // Find which UI tree events have not been processed yet
  const unprocessedUiTreeEvents = useMemo(() => {
    if (!Array.isArray(allWorkflowAnalyses) || allWorkflowAnalyses.length === 0) {
      return uiTreeEvents;
    }
    const analyzedTimestamps = new Set(allWorkflowAnalyses.map(a => a.client_timestamp));
    return uiTreeEvents.filter(event => !analyzedTimestamps.has(getEventTimestamp(event)));
  }, [uiTreeEvents, allWorkflowAnalyses]);

  // Find the analysis that corresponds to the currently selected event
  const existingAnalysisForSelectedEvent = useMemo(() => {
    if (!selectedEvent || !allWorkflowAnalyses) return null;
    const selectedTimestamp = getEventTimestamp(selectedEvent);
    return allWorkflowAnalyses.find(a => a.client_timestamp === selectedTimestamp) || null;
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
      return eventTime > prevTimestamp && eventTime < currentTimestamp;
    });
  }, [allEvents, previousUiTreeEvent, selectedEvent]);

  const handleReprocess = async () => {
    if (!rawLlmInputForDisplay) {
      alert("Cannot re-process: Raw LLM input is not available.");
      return;
    }

    setIsProcessing(true);
    setAnalysisOutput(null);
    setError(null);

    try {
      const payload = JSON.parse(rawLlmInputForDisplay);
      const response = await fetch('/api/process-workflow-step', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process workflow step');
      }

      const result = await response.json();
      setAnalysisOutput(result);

      // After processing, save the analysis
      if (selectedEvent) {
        await fetch('/api/save-llm-analysis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...result,
            userId,
            client_timestamp: getEventTimestamp(selectedEvent),
          }),
        });
        // Refresh analyses to include the new one
        await fetchAllWorkflowAnalyses();
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const processedStepsCount = useMemo(() => {
    if (!allWorkflowAnalyses.length || !uiTreeEvents.length) return 0;
    const analyzedTimestamps = new Set(allWorkflowAnalyses.map(a => a.client_timestamp));
    return uiTreeEvents.filter(event => analyzedTimestamps.has(getEventTimestamp(event))).length;
  }, [allWorkflowAnalyses, uiTreeEvents]);

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

  const relevantScreenshotDiff = useMemo(() => {
      if (!previousUiTreeEvent || !selectedEvent) return null;
      const prevTimestamp = new Date(getEventTimestamp(previousUiTreeEvent)).getTime();
      const currentTimestamp = new Date(getEventTimestamp(selectedEvent)).getTime();
      return allEvents.find(event => {
          if ((event.payload as StepsPageEventPayload).payload?.type !== 'screenshot_diff') return false;
          const diffTimestamp = new Date(getEventTimestamp(event)).getTime();
          return diffTimestamp > prevTimestamp && diffTimestamp < currentTimestamp;
      });
  }, [allEvents, previousUiTreeEvent, selectedEvent]);

  const beforeScreenshotDataUrl = useMemo(() => relevantScreenshotDiff?.payload.payload?.event?.screenshot_diff?.before || null, [relevantScreenshotDiff]);
  const afterScreenshotDataUrl = useMemo(() => relevantScreenshotDiff?.payload.payload?.event?.screenshot_diff?.after || null, [relevantScreenshotDiff]);
  const beforeScreenshotTimestamp = useMemo(() => relevantScreenshotDiff?.payload.payload?.event?.screenshot_diff?.before_timestamp || null, [relevantScreenshotDiff]);

  const relevantScreenshotDiffSameWindow = useMemo(() => {
      if (!previousSameWindowUiTreeEvent || !selectedEvent) return null;
      const prevTimestamp = new Date(getEventTimestamp(previousSameWindowUiTreeEvent)).getTime();
      const currentTimestamp = new Date(getEventTimestamp(selectedEvent)).getTime();
      return allEvents.find(event => {
          if ((event.payload as StepsPageEventPayload).payload?.type !== 'screenshot_diff') return false;
          const diffTimestamp = new Date(getEventTimestamp(event)).getTime();
          return diffTimestamp > prevTimestamp && diffTimestamp < currentTimestamp;
      });
  }, [allEvents, previousSameWindowUiTreeEvent, selectedEvent]);

  const beforeScreenshotDataUrlSameWindow = useMemo(() => relevantScreenshotDiffSameWindow?.payload.payload?.event?.screenshot_diff?.before || null, [relevantScreenshotDiffSameWindow]);
  const beforeScreenshotTimestampSameWindow = useMemo(() => relevantScreenshotDiffSameWindow?.payload.payload?.event?.screenshot_diff?.before_timestamp || null, [relevantScreenshotDiffSameWindow]);

  const llmContext = useMemo((): ContextForAnalysis => {
    if (!selectedEvent) {
      return {};
    }

    const context: ContextForAnalysis = {};

    if (contextConfig.includeScreenshots) {
      context.screenshotAfter = afterScreenshotDataUrl;
      context.screenshotBefore = beforeScreenshotDataUrlSameWindow;
    }
    if (contextConfig.includePreviousUiTree && previousUiTree) {
      context.previousUiTree = generateSimplifiedUiTreeString(previousUiTree);
    }
    if (contextConfig.includeCurrentUiTree && currentUiTree) {
      context.currentUiTree_structure = "The UI tree is a simplified representation of the accessibility tree. Each line has the format: 'LineNumber. RomanNumeralIndentation. [Role] 'Name' {Attributes}'.";
      context.currentUiTree = generateSimplifiedUiTreeString(currentUiTree);
    }
    
    if (contextConfig.includeEventsSincePreviousUiTree && eventsBetweenByTimestamp.length > 0) {
      context.eventsSincePreviousUiTreeByTimestamp = eventsBetweenByTimestamp.map(event => generateEventSummaryString(event));
    }

    if (contextConfig.includeEventsSinceSameWindowUiTree && eventsBetweenSameWindow.length > 0) {
      context.eventsSincePreviousUiTreeBySameWindow = eventsBetweenSameWindow.map(event => generateEventSummaryString(event));
    }

    if (contextConfig.includePreviousAnalyses && previousAnalyses.length > 0) {
      context.previousAnalyses = previousAnalyses.slice(0, 3);
    }

    return context;
  }, [
    selectedEvent,
    previousUiTree,
    currentUiTree,
    beforeScreenshotDataUrlSameWindow,
    afterScreenshotDataUrl,
    eventsBetweenByTimestamp,
    eventsBetweenSameWindow,
    previousAnalyses,
    contextConfig,
  ]);

  useEffect(() => {
    // Automatically update the raw JSON preview whenever the context or model changes.
    if (selectedEvent && Object.keys(llmContext).length > 0) {
      const llmApiPayload = {
        prompt: WORKFLOW_STEP_ANALYSIS_PROMPT,
        model: selectedModel,
        context: llmContext,
      };
      setRawLlmInputForDisplay(JSON.stringify(llmApiPayload, null, 2));
    } else {
      setRawLlmInputForDisplay(null);
    }
  }, [llmContext, selectedModel, selectedEvent]);

  // --- End of Reactive Data Processing ---

  const handleProcessAllRemaining = async () => {
    setIsBatchProcessing(true);
    setTotalBatchSteps(unprocessedUiTreeEvents.length);
    setCurrentBatchStep(0);

    let recentAnalyses: PreviousAnalysis[] = [...previousAnalyses];

    for (let i = 0; i < unprocessedUiTreeEvents.length; i++) {
      const eventToProcess = unprocessedUiTreeEvents[i];
      setCurrentBatchStep(i + 1);

      // Assemble context for the current step
      const currentIndex = uiTreeEvents.findIndex(e => e.id === eventToProcess.id);
      const prevEvent = currentIndex > 0 ? uiTreeEvents[currentIndex - 1] : null;
      
      const context: ContextForAnalysis = {};
      
      // This logic should be encapsulated to avoid repetition, but for now, we'll build it here
      const prevUiTreeString = prevEvent ? (prevEvent.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree : null;

      if (contextConfig.includePreviousUiTree && prevUiTreeString) {
        context.previousUiTree = generateSimplifiedUiTreeString(prevUiTreeString);
      }
      if (contextConfig.includeCurrentUiTree) {
        const currentUiTreeString = (eventToProcess.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree;
        context.currentUiTree = generateSimplifiedUiTreeString(currentUiTreeString);
      }
      if (contextConfig.includePreviousAnalyses && recentAnalyses.length > 0) {
        context.previousAnalyses = recentAnalyses;
      }

      // Gather and process events for the current step in the batch
      const prevEventTimestamp = prevEvent ? new Date(getEventTimestamp(prevEvent)).getTime() : 0;
      const currentEventTimestamp = new Date(getEventTimestamp(eventToProcess)).getTime();
      
      const relevantRawEvents = allEvents.filter(e => {
        const eventTime = new Date(getEventTimestamp(e)).getTime();
        // Include events strictly after the previous UI tree event and up to/including the current UI tree event.
        // Also, ensure we don't include the prevEvent itself if it's a UI tree, but do include current eventToProcess.
        return eventTime > prevEventTimestamp && eventTime <= currentEventTimestamp;
      });

      if (relevantRawEvents.length > 0) {
        const summarizedEvents = relevantRawEvents.map(event => generateEventSummaryString(event));
        if (contextConfig.includeEventsSincePreviousUiTree) {
          context.eventsSincePreviousUiTreeByTimestamp = summarizedEvents;
        }
        if (contextConfig.includeEventsSinceSameWindowUiTree) {
          // In batch mode, both event types refer to the same set of events between UI trees.
          // We can assign the same summarized events here if the user has this option checked.
          context.eventsSincePreviousUiTreeBySameWindow = summarizedEvents;
        }
      }

      
      try {
        const processResponse = await fetch('/api/process-workflow-step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: WORKFLOW_STEP_ANALYSIS_PROMPT,
            model: selectedModel,
            context,
          }),
        });

        if (!processResponse.ok) {
          throw new Error(`API error for step ${i + 1}: ${processResponse.statusText}`);
        }

        const result = await processResponse.json();
        
        if (result.analysis) {
          const sessionId = localStorage.getItem('app_session_id') || 'unknown-session';
          const clientTimestamp = eventToProcess.created_at;

          await fetch('/api/save-llm-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              sessionId,
              analysis: result.analysis,
              clientTimestamp,
            }),
          });
          
          const newAnalysis: PreviousAnalysis = {
            id: `batch-${Date.now()}`, // temp id
            ...result.analysis,
            client_timestamp: clientTimestamp,
            created_at: new Date().toISOString()
          };
          
          recentAnalyses = [newAnalysis, ...recentAnalyses].slice(0, 3);
          setAllWorkflowAnalyses(prev => [...prev, newAnalysis]);
        }
      } catch (err) {
        console.error(`Failed to process step ${i + 1}`, err);
        // Optional: decide if you want to stop the batch on error
      }
    }

    setIsBatchProcessing(false);
    setCurrentBatchStep(0);
    setTotalBatchSteps(0);
  };

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
            <span className="text-muted-foreground">Total Steps:</span>
            <span className="font-semibold">{uiTreeEvents.length}</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-foreground">Processed:</span>
            <span className="font-semibold">{processedStepsCount}</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-foreground">Remaining:</span>
            <span className="font-semibold">{unprocessedUiTreeEvents.length}</span>
          </div>
          <div className="flex-grow" />
          <Button variant="outline" size="sm" onClick={handleProcessAllRemaining} disabled={isBatchProcessing || unprocessedUiTreeEvents.length === 0}>
            {isBatchProcessing ? `Processing ${currentBatchStep}/${totalBatchSteps}...` : 'Process all remaining Steps'}
          </Button>
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
                          {beforeScreenshotTimestamp ? (
                            <p className="text-xs text-muted-foreground mb-1">{new Date(beforeScreenshotTimestamp).toLocaleString()}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground mb-1">(Timestamp not available)</p>
                          )}
                          <ScreenshotView dataUrl={beforeScreenshotDataUrl} />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-prev-screenshot-same-window">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeScreenshots} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Screenshot (at the time of previous ui-tree of the same window)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          {beforeScreenshotTimestampSameWindow ? (
                            <p className="text-xs text-muted-foreground mb-1">{new Date(beforeScreenshotTimestampSameWindow).toLocaleString()}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground mb-1">(Timestamp not available)</p>
                          )}
                          <ScreenshotView dataUrl={beforeScreenshotDataUrlSameWindow} />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-5">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked={contextConfig.includeLatestScreenshot} disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Screenshot (at the time of the latest ui-tree)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          {afterScreenshotDataUrl && selectedEvent && (
                            <p className="text-xs text-muted-foreground mb-1">{new Date(selectedEvent.created_at).toLocaleString()}</p>
                          )}
                          <ScreenshotView dataUrl={afterScreenshotDataUrl} />
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
                              eventsBetweenByTimestamp.map(event => <EventSummary key={event.id} event={event} />)
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
                                eventsBetweenSameWindow.map(event => <EventSummary key={event.id} event={event} />)
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
                value={WORKFLOW_STEP_ANALYSIS_PROMPT}
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
                  <div key={analysis.id} className="p-2 border rounded-md bg-gray-50 dark:bg-gray-800 text-xs">
                    <p><strong>Workflow:</strong> {analysis.workflow}</p>
                    <p><strong>Step:</strong> {analysis.step}</p>
                    <p><strong>Description:</strong> {analysis.description}</p>
                    <p><strong>Facts:</strong> {analysis.facts}</p>
                    <p><strong>Logic:</strong> {analysis.logic}</p>
                    <p><strong>Tech:</strong> {analysis.tech}</p>
                    <p><strong>Apps:</strong> {analysis.apps}</p>
                    <p><strong>Context:</strong> {analysis.context}</p>
                    <p className="text-muted-foreground">Timestamp: {new Date(analysis.client_timestamp).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}</p>
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
                  {isProcessing ? (
                    <Badge variant="outline">Processing...</Badge>
                  ) : existingAnalysisForSelectedEvent ? (
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
                      <DropdownMenuRadioItem value="gemini-2.5-flash-preview-05-20">
                        gemini-2.5-flash-preview-05-20
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="gemini-2.5-pro-preview-06-05">
                        gemini-2.5-pro-preview-06-05
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={handleReprocess} disabled={isProcessing || !selectedEvent}>
                  {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Re-process"}
                </Button>
              </div>
            </div>
            <AccordionContent>
              {isProcessing ? (
                <div className="flex items-center justify-center p-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : analysisOutput ? (
                <div className="space-y-2 p-2 text-sm">
                  <p><strong>Workflow:</strong> {analysisOutput.workflow}</p>
                  <p><strong>Step:</strong> {analysisOutput.step}</p>
                  <p><strong>Description:</strong> {analysisOutput.description}</p>
                  <p><strong>Facts:</strong> {analysisOutput.facts}</p>
                  <p><strong>Logic:</strong> {analysisOutput.logic}</p>
                  <p><strong>Tech:</strong> {analysisOutput.tech}</p>
                  <p><strong>Apps:</strong> {analysisOutput.apps}</p>
                  <p><strong>Context:</strong> {analysisOutput.context}</p>
                </div>
              ) : existingAnalysisForSelectedEvent ? (
                <div className="space-y-2 p-2 text-sm">
                  <p><strong>Workflow:</strong> {existingAnalysisForSelectedEvent.workflow}</p>
                  <p><strong>Step:</strong> {existingAnalysisForSelectedEvent.step}</p>
                  <p><strong>Description:</strong> {existingAnalysisForSelectedEvent.description}</p>
                  <p><strong>Facts:</strong> {existingAnalysisForSelectedEvent.facts}</p>
                  <p><strong>Logic:</strong> {existingAnalysisForSelectedEvent.logic}</p>
                  <p><strong>Tech:</strong> {existingAnalysisForSelectedEvent.tech}</p>
                  <p><strong>Apps:</strong> {existingAnalysisForSelectedEvent.apps}</p>
                  <p><strong>Context:</strong> {existingAnalysisForSelectedEvent.context}</p>
                </div>
              ) : (
                <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                  Click &rdquo;Re-process&rdquo; to generate the workflow step analysis.
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
} 