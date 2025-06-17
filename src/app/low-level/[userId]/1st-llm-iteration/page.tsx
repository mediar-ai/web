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

export default function LlmIterationPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [uiTreeEvents, setUiTreeEvents] = useState<LowLevelEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<LowLevelEvent | null>(null);

  const fetchUITrees = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/low-level/${userId}/ui-trees`);
      if (!response.ok) {
        throw new Error('Failed to fetch UI tree events');
      }
      const data = await response.json();
      setUiTreeEvents(data.events);
      if (data.events.length > 0) {
        setSelectedEvent(data.events[0]);
      }
    } catch (err) {
      console.error(err);
    }
  }, [userId]);

  useEffect(() => {
    fetchUITrees();
  }, [fetchUITrees]);

  const previousUiTree = useMemo(() => {
    if (!selectedEvent || uiTreeEvents.length < 2) return null;
    const currentIndex = uiTreeEvents.findIndex(e => e.id === selectedEvent.id);
    if (currentIndex > 0) {
      const prevEvent = uiTreeEvents[currentIndex - 1];
      const payload = prevEvent.payload as { payload?: { event?: { screen?: { ui_tree?: string } } } };
      return payload?.payload?.event?.screen?.ui_tree;
    }
    return null;
  }, [selectedEvent, uiTreeEvents]);

  return (
    <div className="p-4">
      <UITreeTimeline
        uiTreeEvents={uiTreeEvents}
        selectedEvent={selectedEvent}
        onEventSelect={setSelectedEvent}
      />
      <div className="flex items-center">
        <div className="w-12 text-xs text-gray-500">Included</div>
        <div className="flex-1"></div>
      </div>
      <Accordion type="multiple" className="w-full" defaultValue={["item-1"]}>
        <AccordionItem value="item-1">
          <div className="flex items-center">
            <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
            <AccordionTrigger className="flex-1">Context</AccordionTrigger>
          </div>
          <AccordionContent className="space-y-4 pl-4">
            <Accordion type="multiple" className="w-full">
              <AccordionItem value="sub-item-1">
                <div className="flex items-center">
                  <div className="w-12 flex justify-center"><Checkbox disabled /></div>
                  <AccordionTrigger className="text-sm font-semibold flex-1">Screenshot (at the time of previous ui-tree)</AccordionTrigger>
                </div>
                <AccordionContent>
                  <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                    Placeholder for previous screenshot.
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sub-item-2">
                <div className="flex items-center">
                  <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
                  <AccordionTrigger className="text-sm font-semibold flex-1">Previous ui-tree</AccordionTrigger>
                </div>
                <AccordionContent>
                  {previousUiTree ? (
                    <FormattedUITree treeString={previousUiTree} />
                  ) : (
                    <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                      No previous UI tree to display.
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sub-item-3">
                <div className="flex items-center">
                  <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
                  <AccordionTrigger className="text-sm font-semibold flex-1">Events (between previous and latest ui-tree)</AccordionTrigger>
                </div>
                <AccordionContent>
                  <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                    Placeholder for events.
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sub-item-4">
                <div className="flex items-center">
                  <div className="w-12 flex justify-center"><Checkbox checked disabled /></div>
                  <AccordionTrigger className="text-sm font-semibold flex-1">ui-tree diff (latest vs. previous)</AccordionTrigger>
                </div>
                <AccordionContent>
                  <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                    Placeholder for ui-tree diff.
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sub-item-5">
                <div className="flex items-center">
                  <div className="w-12 flex justify-center"><Checkbox disabled /></div>
                  <AccordionTrigger className="text-sm font-semibold flex-1">Screenshot (at the time of the latest ui-tree)</AccordionTrigger>
                </div>
                <AccordionContent>
                  <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                    Placeholder for latest screenshot.
                  </div>
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