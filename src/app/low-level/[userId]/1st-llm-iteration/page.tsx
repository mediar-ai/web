'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Checkbox } from "@/components/ui/checkbox"
import { useState, useEffect, use, useCallback, useMemo } from "react";
import type { LowLevelEvent } from "@/types";
import UITreeTimeline from "@/components/low-level/UITreeTimeline";
import FormattedUITree from "@/components/low-level/FormattedUITree";
import ScreenshotView from "@/components/low-level/ScreenshotView";
import DiffView from "@/components/low-level/DiffView";
import { useUser } from "@/context/UserContext";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [openSubAccordionItems, setOpenSubAccordionItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ACCORDION_STORAGE_KEY = useMemo(() => `llm-iteration-accordion-state-${userId}`, [userId]);
  const SUB_ACCORDION_STORAGE_KEY = useMemo(() => `llm-iteration-sub-accordion-state-${userId}`, [userId]);

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

      const storedSubState = localStorage.getItem(SUB_ACCORDION_STORAGE_KEY);
      if (storedSubState) {
        try {
          setOpenSubAccordionItems(JSON.parse(storedSubState));
        } catch (e) {
          console.error("Failed to parse sub-accordion state from localStorage", e);
          setOpenSubAccordionItems([]);
        }
      } else {
        setOpenSubAccordionItems([]);
      }
    }
  }, [userId, ACCORDION_STORAGE_KEY, SUB_ACCORDION_STORAGE_KEY]);

  const handleAccordionValueChange = (value: string[]) => {
    setOpenAccordionItems(value);
    if (userId) {
      localStorage.setItem(ACCORDION_STORAGE_KEY, JSON.stringify(value));
    }
  };

  const handleSubAccordionValueChange = (value: string[]) => {
    setOpenSubAccordionItems(value);
    if (userId) {
      localStorage.setItem(SUB_ACCORDION_STORAGE_KEY, JSON.stringify(value));
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

  useEffect(() => {
    fetchAllEvents();
  }, [fetchAllEvents]);

  const uiTreeEvents = useMemo(() => {
    return allEvents.filter(e => e.payload.payload?.type === 'ui_tree');
  }, [allEvents]);

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

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="space-y-2 pt-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-red-500 font-bold bg-red-50 rounded-md">Error: {error}</div>;
  }

  if (allEvents.length === 0) {
    return <div className="p-4">No events found for this user.</div>;
  }

  return (
    <div className="p-4">
      <div className="sticky top-28 bg-background z-10 border-b">
        <UITreeTimeline
          uiTreeEvents={uiTreeEvents}
          selectedEvent={selectedEvent}
          onEventSelect={setSelectedEvent}
        />
      </div>
      <div className="flex items-center my-4">
        <div className="w-12 text-xs text-gray-500">(Included)</div>
        <div className="flex-1"></div>
      </div>
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
              value={openSubAccordionItems}
              onValueChange={handleSubAccordionValueChange}
            >
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
        <AccordionItem value="item-2">
          <div className="flex items-center">
            <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
            <AccordionTrigger className="flex-1">System prompt</AccordionTrigger>
          </div>
          <AccordionContent>
            Placeholder for System prompt.
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
      </Accordion>
    </div>
  );
} 