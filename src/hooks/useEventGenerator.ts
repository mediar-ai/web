import { useCallback, useEffect, useRef } from 'react';
import type { ActivityItem, Event, RunningAnalysis } from '../types';

export interface UseEventGeneratorProps {
  stream: MediaStream | null;
  activityItems: ActivityItem[];
  setActivityItems: React.Dispatch<React.SetStateAction<ActivityItem[]>>;
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  setRunningAnalyses: React.Dispatch<React.SetStateAction<RunningAnalysis[]>>;
  setCompletedAnalyses: React.Dispatch<React.SetStateAction<RunningAnalysis[]>>;
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
  setActivityItems,
  events,
  setEvents,
  setRunningAnalyses,
  setCompletedAnalyses,
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
    const unprocessedActivities = activityItems.filter(item => !item.processedForEvent);

    if (
      eventGenerationInProgressRef.current ||
      activeAnalysesCountRef.current >= MAX_PARALLEL_ANALYSES ||
      unprocessedActivities.length === 0
    ) {
      return;
    }

    eventGenerationInProgressRef.current = true;

    const last10Activities = activityItems.slice(0, 10);
    const mostRecentInitialDump = activityItems.find((item) => item.type === 'initial_dump');

    const activitiesToAnalyze: ActivityItem[] = [...last10Activities];
    if (
      mostRecentInitialDump &&
      !last10Activities.some((item) => item.id === mostRecentInitialDump.id)
    ) {
      activitiesToAnalyze.push(mostRecentInitialDump);
    }

    if (activitiesToAnalyze.length === 0) {
      logToUI('[processMultiActivityEvent] No new activities to analyze for event');
      eventGenerationInProgressRef.current = false;
      return;
    }

    const activityIdsToAnalyze = activitiesToAnalyze.map(item => item.id);
    
    // Collect sequenceIds from activities being analyzed
    const rawSequenceIds = activitiesToAnalyze
      .map(item => item.sequenceId)
      .filter((id): id is string => id !== undefined);
    
    logToUI('[Event Gen] Raw sequence IDs:', rawSequenceIds);
    
    const sequenceIds = rawSequenceIds
      .map(id => {
        // Normalize old underscore format to new dash format
        return id.replace(/_/g, '-');
      })
      .sort((a, b) => {
        // Sort by session first, then by screenshot number
        const [aSession, aShot] = a.split('-').map(Number);
        const [bSession, bShot] = b.split('-').map(Number);
        
        if (aSession !== bSession) {
          return aSession - bSession;
        }
        return aShot - bShot;
      });
    
    logToUI('[Event Gen] Normalized and sorted sequence IDs:', sequenceIds);
    
    // Create a display string for the sequence IDs
    let eventSequenceId = '';
    if (sequenceIds.length > 0) {
      // Check if they're consecutive and from the same session
      const sessionIds = sequenceIds.map(id => id.split('-')[0]);
      const allSameSession = sessionIds.every(id => id === sessionIds[0]);
      
      if (allSameSession && sequenceIds.length > 1) {
        // Show as range if same session: "1-3-7"
        const shotNumbers = sequenceIds.map(id => parseInt(id.split('-')[1]));
        const minShot = Math.min(...shotNumbers);
        const maxShot = Math.max(...shotNumbers);
        eventSequenceId = `${sessionIds[0]}-${minShot}-${maxShot}`;
        logToUI('[Event Gen] Range format:', eventSequenceId);
      } else if (sequenceIds.length === 1) {
        // Single sequence ID
        eventSequenceId = sequenceIds[0];
        logToUI('[Event Gen] Single format:', eventSequenceId);
      } else {
        // Multiple sessions or non-consecutive, show first and last
        eventSequenceId = `${sequenceIds[0]}...${sequenceIds[sequenceIds.length - 1]}`;
        logToUI('[Event Gen] Multiple format:', eventSequenceId);
      }
    }
    
    const analysisId = `event-${activityIdsToAnalyze[0]}-${Date.now()}`;
    const analysisPayload = {
      analysisType: 'multi_activity_event',
      activitiesSummary: activitiesToAnalyze.map((item) => {
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
      }),
      prompt: eventsPrompt,
      model: EVENTS_MODEL_NAME,
      previousEvents: events.slice(0, 50).map((e) => ({
        summary: e.summary,
        timestamp: e.timestamp,
        isNewWorkflow: e.thoughts?.includes('yes') || false,
      })),
    };
    const newRunningAnalysis: RunningAnalysis = { 
      id: analysisId, 
      type: 'Event Generation', 
      startTime: Date.now(),
      model: EVENTS_MODEL_NAME,
      status: 'running',
      payloadType: 'text',
      payloadSize: JSON.stringify(analysisPayload.activitiesSummary).length,
      sequenceId: eventSequenceId,
    };
    setRunningAnalyses(prev => [...prev, newRunningAnalysis]);
    
    setActiveAnalysesCount((prev) => prev + 1);
    setMainStatus(`Analyzing Event (${activeAnalysesCountRef.current + 1})...`);
    logToUI(
      '[processMultiActivityEvent] 🎯 Analyzing',
      activitiesToAnalyze.length,
      'activities for event generation',
    );

    try {
      const response = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analysisPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();

      if (result.analysis) {
        const { is_distinct_event, description } = result.analysis;

        const eventId = new Date().toISOString() + (is_distinct_event === 'yes' ? '-event' : '-event-non-distinct');
        const newEvent: Event = {
          id: eventId,
          summary: description || (is_distinct_event === 'yes' ? 'New Event' : 'Non-distinct activity'),
          thoughts: is_distinct_event === 'yes' ? 'Distinct event' : 'Non-distinct activity based on backend analysis.',
          timestamp: new Date().toISOString(),
          activity_ids: activityIdsToAnalyze,
        };

        setActivityItems(prev => prev.map(item =>
          unprocessedActivities.some(ua => ua.id === item.id)
            ? { ...item, processedForEvent: true }
            : item
        ));
        
        if (is_distinct_event === 'yes') {
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
            '[processMultiActivityEvent] [SUCCESS] Distinct event generated:',
            description,
          );
        } else {
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
            '[processMultiActivityEvent] ⏭️ No distinct event identified - similar to recent activity. Description:',
            description,
          );
        }
      } else {
        logError(
          '[processMultiActivityEvent] Backend error:',
          result.error || 'Unknown error',
        );
      }
      const completed: RunningAnalysis = { ...newRunningAnalysis, status: 'completed', endTime: Date.now() };
      setCompletedAnalyses(prev => [completed, ...prev].slice(0, 100));
    } catch (err) {
      logError('[processMultiActivityEvent] Network error:', err);
      const failed: RunningAnalysis = { ...newRunningAnalysis, status: 'failed', endTime: Date.now() };
      setRunningAnalyses(prev => prev.map(a => a.id === analysisId ? failed : a));
      setCompletedAnalyses(prev => [failed, ...prev].slice(0, 100));
    } finally {
      setActiveAnalysesCount((prev) => Math.max(0, prev - 1));
      setRunningAnalyses(prev => prev.filter(a => a.id !== analysisId));
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
    setRunningAnalyses,
    setCompletedAnalyses,
    setActivityItems,
  ]);

  useEffect(() => {
    if (activeAnalysesCount >= MAX_PARALLEL_ANALYSES) {
      return;
    }

    if (stream) {
      processMultiActivityEvent();
    }
  }, [
    stream,
    activityItems,
    processMultiActivityEvent,
    activeAnalysesCount,
    MAX_PARALLEL_ANALYSES,
  ]);
} 