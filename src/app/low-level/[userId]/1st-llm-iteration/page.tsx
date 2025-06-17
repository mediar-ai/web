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

const ConciseEventView = ({ event }: { event: LowLevelEvent }) => {
  const payload = event.payload.payload
  const eventType = payload?.type ?? 'unknown';
  const eventData = payload?.event ?? {};

  let summary: React.ReactNode = <span><b>{eventType} (event)</b></span>;
  switch (eventType) {
    case 'keyboard':
      const keyboardEvent = eventData.keyboard as { key_code: number, keys?: string, is_key_down?: boolean };
      const key = keyboardEvent?.keys;
      const keyCode = keyboardEvent?.key_code;
      const keyState = keyboardEvent?.is_key_down ? 'down' : 'up';
      const keyName = key ? (key.length > 1 ? key.replace(/([A-Z])/g, ' $1').trim() : key) : (keyCode ? String.fromCharCode(keyCode) : 'Unknown');
      
      summary = <span><b>Keyboard (event):</b> {keyName} ({keyState})</span>;
      break;
    case 'mouse':
      const mouseEvent = eventData.mouse as { button?: string, metadata?: { ui_element?: { application?: string, name?: string, role?: string } }, event_type?: string };
      const button = mouseEvent?.button || 'click';
      const eventTypeStr = mouseEvent?.event_type?.toLowerCase() || 'click';
      const appName = mouseEvent?.metadata?.ui_element?.application || 'Unknown Application';
      const elementName = mouseEvent?.metadata?.ui_element?.name || '<NO NAME>';
      const elementRole = mouseEvent?.metadata?.ui_element?.role || 'UNKNOWN';
      
      summary = <span><b>Mouse (event):</b> {button} ({eventTypeStr}) on {elementRole} &quot;{elementName}&quot; in &quot;{appName}&quot;</span>;
      break;
    case 'application_switch':
      summary = <span><b>App Switch (event):</b> to &quot;{eventData.app_name as string}&quot;</span>;
      break;
    case 'browser_tab_navigation':
      summary = <span><b>Browser Nav (event):</b> to &quot;{eventData.url as string}&quot;</span>;
      break;
    case 'text_input_completed':
      summary = <span><b>Text Input (event):</b> &quot;{eventData.text as string}&quot; in &quot;{eventData.app_name as string}&quot;</span>;
      break;
    case 'ui_tree':
      try {
        const uiTree = JSON.parse((eventData as { screen?: { ui_tree?: string } }).screen?.ui_tree as string);
        summary = <span><b>UI Tree captured for</b> {uiTree.attributes?.name || eventData.app_name as string}</span>;
      } catch {
        summary = <span><b>UI Tree captured for</b> {eventData.app_name as string}</span>;
      }
      break;
    case 'screenshot_diff':
      const diffData = eventData.screenshot_diff;
      const before = diffData?.before_timestamp ? new Date(diffData.before_timestamp).toLocaleTimeString() : 'N/A';
      const after = diffData?.after_timestamp ? new Date(diffData.after_timestamp).toLocaleTimeString() : 'N/A';
      summary = <span><b>Screenshot Diff:</b> {before} vs {after}</span>;
      break;
  }

  return (
    <div className="text-sm font-medium pr-4" title={typeof summary === 'string' ? summary : undefined}>
      {summary} <span className="text-muted-foreground text-xs">{new Date(event.created_at).toLocaleString()}</span>
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
  const [previousAnalyses, setPreviousAnalyses] = useState<PreviousAnalysis[]>([]);
  const [allWorkflowAnalyses, setAllWorkflowAnalyses] = useState<WorkflowStepAnalysis[]>([]);

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
    const allItemValues = ["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"];
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
    setDetailSelection('collapse');
  }

  const handleReprocess = async () => {
    setIsProcessing(true);
    setAnalysisOutput(null);

    const context = {
      previousUiTree: previousSameWindowUiTree,
      currentUiTree,
      events: eventsBetweenSameWindow,
      screenshotBefore: beforeScreenshotDataUrlSameWindow,
      screenshotAfter: afterScreenshotDataUrl,
      previousAnalyses,
    };

    try {
      // Step 1: Get the analysis from the processing API
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
        throw new Error(`API error: ${processResponse.statusText}`);
      }

      const result = await processResponse.json();
      setAnalysisOutput(result.analysis);

      // Step 2: Save the analysis to the new table
      if (result.analysis && selectedEvent) {
        const sessionId = localStorage.getItem('app_session_id') || 'unknown-session';
        const clientTimestamp = selectedEvent.created_at;

        const saveResponse = await fetch('/api/save-llm-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            sessionId,
            analysis: result.analysis,
            clientTimestamp,
          }),
        });

        if (saveResponse.ok) {
          fetchAllWorkflowAnalyses();
        }
      }
    } catch (err) {
      console.error("Failed to re-process", err);
      // You might want to set an error state here to show in the UI
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    setUserId(userId);
  }, [userId, setUserId]);

  const fetchAllEvents = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/low-level/${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch events');
      }
      const data = await response.json();
      const sortedEvents = data.events.sort((a: LowLevelEvent, b: LowLevelEvent) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      setAllEvents(sortedEvents);
      
      const uiTrees = sortedEvents.filter((e: LowLevelEvent) => e.payload.payload?.type === 'ui_tree');
      if (uiTrees.length > 0) {
        setSelectedEvent(uiTrees[uiTrees.length - 1]); // Select the latest one
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchAllWorkflowAnalyses = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/fetch-llm-analyses?userId=${userId}&limit=1000`);
      if (!response.ok) {
        throw new Error('Failed to fetch all workflow analyses');
      }
      const data = await response.json();
      console.log("Fetched all workflow analyses:", data.analyses);
      setAllWorkflowAnalyses(data.analyses);
    } catch (err) {
      console.error("Failed to fetch all workflow analyses", err);
    }
  }, [userId]);

  const uiTreeEvents = useMemo(() => {
    return allEvents.filter(e => e.payload.payload?.type === 'ui_tree');
  }, [allEvents]);

  useEffect(() => {
    fetchAllEvents();
    fetchAllWorkflowAnalyses();
  }, [fetchAllEvents, fetchAllWorkflowAnalyses]);

  useEffect(() => {
    if (!selectedEvent || !userId || uiTreeEvents.length < 1) {
      setPreviousAnalyses([]);
      return;
    };

    const fetchRelativeAnalyses = async () => {
      const currentIndex = uiTreeEvents.findIndex(e => e.id === selectedEvent.id);
      if (currentIndex === -1) return;

      const previousEventTimestamps = uiTreeEvents
        .slice(Math.max(0, currentIndex - 3), currentIndex)
        .map(e => e.created_at);
      
      if (previousEventTimestamps.length === 0) {
        setPreviousAnalyses([]);
        return;
      }

      try {
        const response = await fetch('/api/fetch-analyses-by-timestamps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, timestamps: previousEventTimestamps }),
        });
        if (!response.ok) {
          throw new Error('Failed to fetch relative analyses');
        }
        const data = await response.json();
        setPreviousAnalyses(data.analyses || []);
      } catch (err) {
        console.error("Failed to fetch relative analyses", err);
        setPreviousAnalyses([]);
      }
    };
    
    fetchRelativeAnalyses();
  }, [selectedEvent, userId, uiTreeEvents]);

  const existingAnalysisForSelectedEvent = useMemo(() => {
    if (!selectedEvent || !allWorkflowAnalyses) return null;
    
    console.log("Searching for analysis for event created at:", new Date(selectedEvent.created_at).toISOString());
    
    const analysis = allWorkflowAnalyses.find(a => {
      const analysisTime = new Date(a.client_timestamp).getTime();
      const eventTime = new Date(selectedEvent.created_at).getTime();
      
      if (Math.abs(analysisTime - eventTime) < 1000) { // Allow for a small difference
          console.log("Found matching analysis:", a);
          return true;
      }
      return false;
    });

    if (!analysis) {
        console.log("No matching analysis found.");
    }

    return analysis || null;
  }, [selectedEvent, allWorkflowAnalyses]);

  const previousUiTreeEvent = useMemo(() => {
    if (!selectedEvent || uiTreeEvents.length < 2) return null;
    const currentIndex = uiTreeEvents.findIndex(e => e.id === selectedEvent.id);
    return currentIndex > 0 ? uiTreeEvents[currentIndex - 1] : null;
  }, [selectedEvent, uiTreeEvents]);
  
  const previousUiTree = (previousUiTreeEvent?.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree;

  const relevantScreenshotDiff = useMemo(() => {
    if (!previousUiTreeEvent || !selectedEvent) return null;
    
    const prevTimestamp = new Date(previousUiTreeEvent.created_at).getTime();
    const currentTimestamp = new Date(selectedEvent.created_at).getTime();

    return allEvents.find(event => {
      if (event.payload.payload?.type !== 'screenshot_diff') return false;
      const diffTimestamp = new Date(event.created_at).getTime();
      return diffTimestamp > prevTimestamp && diffTimestamp < currentTimestamp;
    })
  }, [allEvents, previousUiTreeEvent, selectedEvent]);
  
  const screenshotEventPayload = relevantScreenshotDiff?.payload.payload?.event.screenshot_diff;
  const beforeScreenshotDataUrl = screenshotEventPayload?.before || null;
  const afterScreenshotDataUrl = screenshotEventPayload?.after || null;
  const beforeScreenshotTimestamp = screenshotEventPayload?.before_timestamp || null;

  const currentUiTree = (selectedEvent?.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree;

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

  const previousSameWindowUiTree = (previousSameWindowUiTreeEvent?.payload.payload?.event as { screen?: { ui_tree?: string } })?.screen?.ui_tree;

  const eventsBetweenByTimestamp = useMemo(() => {
    if (!previousUiTreeEvent || !selectedEvent) return [];
    
    const prevTimestamp = new Date(previousUiTreeEvent.created_at).getTime();
    const currentTimestamp = new Date(selectedEvent.created_at).getTime();

    return allEvents.filter(event => {
      const eventTimestamp = new Date(event.created_at).getTime();
      const eventType = event.payload.payload?.type;
      const isRelevant = eventType !== 'ui_tree' && eventType !== 'screenshot_diff';
      return isRelevant && eventTimestamp > prevTimestamp && eventTimestamp < currentTimestamp;
    });
  }, [allEvents, previousUiTreeEvent, selectedEvent]);

  const eventsBetweenSameWindow = useMemo(() => {
    if (!previousSameWindowUiTreeEvent || !selectedEvent) return [];

    const prevTimestamp = new Date(previousSameWindowUiTreeEvent.created_at).getTime();
    const currentTimestamp = new Date(selectedEvent.created_at).getTime();

    return allEvents.filter(event => {
      const eventTimestamp = new Date(event.created_at).getTime();
      const eventType = event.payload.payload?.type;
      const isRelevant = eventType !== 'ui_tree' && eventType !== 'screenshot_diff';
      return isRelevant && eventTimestamp > prevTimestamp && eventTimestamp < currentTimestamp;
    });
  }, [allEvents, previousSameWindowUiTreeEvent, selectedEvent]);

  const relevantScreenshotDiffSameWindow = useMemo(() => {
    if (!previousSameWindowUiTreeEvent || !selectedEvent) return null;

    const prevTimestamp = new Date(previousSameWindowUiTreeEvent.created_at).getTime();
    const currentTimestamp = new Date(selectedEvent.created_at).getTime();

    return allEvents.find(event => {
      if (event.payload.payload?.type !== 'screenshot_diff') return false;
      const diffTimestamp = new Date(event.created_at).getTime();
      return diffTimestamp > prevTimestamp && diffTimestamp < currentTimestamp;
    });
  }, [allEvents, previousSameWindowUiTreeEvent, selectedEvent]);
  
  const screenshotEventPayloadSameWindow = relevantScreenshotDiffSameWindow?.payload.payload?.event.screenshot_diff;
  const beforeScreenshotDataUrlSameWindow = screenshotEventPayloadSameWindow?.before || null;
  const beforeScreenshotTimestampSameWindow = screenshotEventPayloadSameWindow?.before_timestamp || null;

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
                          <div className="w-12 flex justify-center"><Checkbox disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
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
                          <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Events (since previous ui-tree by timestamp)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="p-2 border rounded-md bg-gray-50 dark:bg-gray-800 space-y-1">
                            {eventsBetweenByTimestamp.length > 0 ? (
                              eventsBetweenByTimestamp.map(event => <ConciseEventView key={event.id} event={event} />)
                            ) : (
                              <p className="text-xs text-muted-foreground">No events found in this interval.</p>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="sub-item-events-same-window">
                        <div className="flex items-center">
                          <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
                          <AccordionTrigger className="text-sm font-semibold flex-1">Events (since previous ui-tree of the same window)</AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="p-2 border rounded-md bg-gray-50 dark:bg-gray-800 space-y-1">
                            {previousSameWindowUiTreeEvent ? (
                              eventsBetweenSameWindow.length > 0 ? (
                                eventsBetweenSameWindow.map(event => <ConciseEventView key={event.id} event={event} />)
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
              <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
              <AccordionTrigger className="flex-1">Good Examples</AccordionTrigger>
            </div>
            <AccordionContent>
              Placeholder for Good Examples.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-4">
            <div className="flex items-center">
              <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
              <AccordionTrigger className="flex-1">Bad Examples</AccordionTrigger>
            </div>
            <AccordionContent>
              Placeholder for Bad Examples.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-6">
            <div className="flex items-center">
              <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
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
                    <p className="text-muted-foreground mt-1">{new Date(analysis.created_at).toLocaleString()}</p>
                  </div>
                ))
              ) : (
                <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800 text-xs text-muted-foreground">
                  No previous analyses found for the steps immediately preceding the selected event.
                </div>
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
                    <Button variant="outline">
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
                <Button variant="outline" size="default" onClick={handleReprocess} disabled={isProcessing || !selectedEvent}>
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