import { useCallback, useEffect, useRef } from 'react';
import type { ActivityItem, Event } from '../types';

interface UseEventGeneratorProps {
  stream: MediaStream | null;
  activityItems: ActivityItem[];
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  activeAnalysesCount: number;
  setActiveAnalysesCount: React.Dispatch<React.SetStateAction<number>>;
  logToUI: (...args: unknown[]) => void;
  logError: (...args: unknown[]) => void;
  setMainStatus: React.Dispatch<React.SetStateAction<string>>;
  MAX_PARALLEL_ANALYSES: number;
  EVENTS_MODEL_NAME: string;
  eventsPrompt: string;
}

export function useEventGenerator({
  stream,
  activityItems,
  events,
  setEvents,
  activeAnalysesCount,
  setActiveAnalysesCount,
  logToUI,
  logError,
  setMainStatus,
  MAX_PARALLEL_ANALYSES,
  EVENTS_MODEL_NAME,
  eventsPrompt,
}: UseEventGeneratorProps): void {
  const eventGenerationInProgressRef = useRef<boolean>(false);
  const activeAnalysesCountRef = useRef(activeAnalysesCount);
  useEffect(() => {
    activeAnalysesCountRef.current = activeAnalysesCount;
  }, [activeAnalysesCount]);

  const processMultiActivityEvent = useCallback(async () => {
    if (
      eventGenerationInProgressRef.current ||
      activeAnalysesCountRef.current >= MAX_PARALLEL_ANALYSES
    ) {
      logToUI(
        '[processMultiActivityEvent] Already processing or max analyses running, skipping',
      );
      return;
    }

    eventGenerationInProgressRef.current = true;

    // Use a direct copy from props to ensure freshness inside the callback
    const activityItemsCopy = [...activityItems];
    const last10Activities = activityItemsCopy.slice(0, 10);
    const mostRecentInitialDump = activityItemsCopy.find((item) => item.type === 'initial_dump');

    const activitiesToAnalyze: ActivityItem[] = [...last10Activities];
    if (
      mostRecentInitialDump &&
      !last10Activities.some((item) => item.id === mostRecentInitialDump.id)
    ) {
      activitiesToAnalyze.push(mostRecentInitialDump);
    }

    if (activitiesToAnalyze.length === 0) {
      logToUI('[processMultiActivityEvent] No activities to analyze for event');
      eventGenerationInProgressRef.current = false;
      return;
    }

    setActiveAnalysesCount((prev) => prev + 1);
    setMainStatus(`Analyzing Event (${activeAnalysesCountRef.current + 1})...`);
    logToUI(
      '[processMultiActivityEvent] 🎯 Analyzing',
      activitiesToAnalyze.length,
      'activities for event generation',
    );

    try {
      const activitiesSummary = activitiesToAnalyze.map((item) => {
        if (item.type === 'initial_dump') {
          return {
            type: 'initial_dump',
            timestamp: item.timestamp,
            content_preview: item.raw_content.substring(0, 500) + '...',
          };
        } else { // 'ui_diff'
          return {
            type: 'ui_diff',
            timestamp: item.timestamp,
            change_detected: item.change_detected,
            change_description: item.change_description,
            change_types: item.identified_change_types,
            new_content_preview: item.new_content_detected
              ? item.new_content_detected.substring(0, 200) + '...'
              : null,
          };
        }
      });

      const response = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisType: 'multi_activity_event',
          activitiesSummary: activitiesSummary,
          prompt: eventsPrompt,
          model: EVENTS_MODEL_NAME,
          previousEvents: events.slice(0, 50).map((e) => ({
            summary: e.summary,
            timestamp: e.timestamp,
            isNewWorkflow: e.thoughts?.includes('yes') || false,
          })),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();

      if (result.analysis) {
        const { is_distinct_event, description } = result.analysis;

        if (is_distinct_event === 'yes') {
          const eventId = new Date().toISOString() + '-event';
          const newEvent: Event = {
            id: eventId,
            summary: description,
            thoughts: `Distinct event`, 
            timestamp: new Date().toISOString(), 
          };

          setEvents((prevEvents) =>
            [newEvent, ...prevEvents]
              .sort((a, b) => {
                const timeA = new Date(a.id.split('-event')[0]).getTime();
                const timeB = new Date(b.id.split('-event')[0]).getTime();
                return timeB - timeA;
              })
              .slice(0, 100) 
          );

          logToUI(
            '[processMultiActivityEvent] ✅ Distinct event generated:',
            description,
          );
        } else {
          logToUI(
            '[processMultiActivityEvent] ⏭️ No distinct event identified - similar to recent activity. Description:',
            description,
          );
          const eventId = new Date().toISOString() + '-event-non-distinct';
          const newEvent: Event = {
            id: eventId,
            summary: description || 'No distinct event identified',
            thoughts: 'Non-distinct activity based on backend analysis.',
            timestamp: new Date().toISOString(), 
          };
          setEvents((prevEvents) =>
            [newEvent, ...prevEvents]
              .sort((a, b) => {
                const timeA = new Date(a.id.split('-event')[0]).getTime();
                const timeB = new Date(b.id.split('-event')[0]).getTime();
                return timeB - timeA;
              })
              .slice(0, 100)
          );
        }
      } else {
        logError(
          '[processMultiActivityEvent] Backend error:',
          result.error || 'Unknown error',
        );
      }
    } catch (err) {
      logError('[processMultiActivityEvent] Network error:', err);
    } finally {
      setActiveAnalysesCount((prev) => Math.max(0, prev - 1));
      eventGenerationInProgressRef.current = false;
    }
  }, [
    activityItems,
    events,
    eventsPrompt,
    EVENTS_MODEL_NAME,
    MAX_PARALLEL_ANALYSES,
    logToUI,
    logError,
    setActiveAnalysesCount,
    setMainStatus,
    setEvents,
  ]);

  useEffect(() => {
    if (eventGenerationInProgressRef.current) {
      return;
    }

    if (stream && activeAnalysesCount < MAX_PARALLEL_ANALYSES) {
      processMultiActivityEvent();
    }
  }, [stream, activityItems, activeAnalysesCount, processMultiActivityEvent, MAX_PARALLEL_ANALYSES]);
} 