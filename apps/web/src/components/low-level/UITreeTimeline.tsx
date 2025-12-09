'use client';

import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { LowLevelEvent } from '@/types';

type UITreeEventPayload = {
  payload?: {
    timestamp?: string;
    event?: {
      app_name?: string;
      screen?: {
        ui_tree?: string;
      }
    }
  }
}

const getEventTimestamp = (event: LowLevelEvent): string => {
  const payload = event.payload as UITreeEventPayload;
  return payload?.payload?.timestamp || event.created_at;
};

const getEventTitle = (event: LowLevelEvent) => {
    const payload = event.payload as UITreeEventPayload;
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

interface UITreeTimelineProps {
  uiTreeEvents: LowLevelEvent[];
  selectedEvent: LowLevelEvent | null;
  onEventSelect: (event: LowLevelEvent) => void;
}

const UITreeTimeline: React.FC<UITreeTimelineProps> = ({
  uiTreeEvents,
  selectedEvent,
  onEventSelect,
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const lastScrollTimeRef = useRef<number>(0);

  const selectedIndex = selectedEvent
    ? uiTreeEvents.findIndex((item) => item.id === selectedEvent.id)
    : -1;

  const getTimeLabels = () => {
    if (uiTreeEvents.length === 0) return [];
    
    // If there are few events, label all of them
    if (uiTreeEvents.length <= 5) {
      return uiTreeEvents.map((item, index) => {
        const date = new Date(getEventTimestamp(item));
        return {
          id: item.id,
          index,
          time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }),
          isFirst: index === 0,
          isLast: index === uiTreeEvents.length - 1,
        };
      });
    }

    const labels = [];
    const maxLabels = Math.min(6, Math.max(3, Math.floor(uiTreeEvents.length / 5)));
    
    for (let i = 0; i < maxLabels; i++) {
      const index = Math.floor((i / (maxLabels - 1)) * (uiTreeEvents.length - 1));
      const item = uiTreeEvents[index];
      if (item) {
        const date = new Date(getEventTimestamp(item));
        const isFirst = i === 0;
        const isLast = i === maxLabels - 1;
        
        labels.push({
          id: item.id,
          index,
          time: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
          isFirst,
          isLast,
        });
      }
    }
    
    return labels;
  };

  const timeLabels = getTimeLabels();

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const now = Date.now();
      if (now - lastScrollTimeRef.current < 200) { // 200ms delay
        return;
      }

      if (!selectedEvent || uiTreeEvents.length === 0) return;

      const currentIndex = uiTreeEvents.findIndex(item => item.id === selectedEvent.id);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (event.deltaY < 0) {
        // Scroll up - go to previous (left)
        nextIndex = Math.max(0, currentIndex - 1);
      } else {
        // Scroll down - go to next (right)
        nextIndex = Math.min(uiTreeEvents.length - 1, currentIndex + 1);
      }

      if (nextIndex !== currentIndex) {
        lastScrollTimeRef.current = now;
        onEventSelect(uiTreeEvents[nextIndex]);
      }
    };

    const sliderElement = sliderRef.current;
    if (sliderElement) {
      sliderElement.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (sliderElement) {
        sliderElement.removeEventListener('wheel', handleWheel);
      }
    };
  }, [selectedEvent, uiTreeEvents, onEventSelect]);

  if (uiTreeEvents.length < 2) {
    return null;
  }

  return (
    <div className='w-full flex flex-col py-2 px-1'>
      <div
        ref={sliderRef}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percentage = clickX / rect.width;
          const index = Math.round(percentage * (uiTreeEvents.length - 1));
          onEventSelect(uiTreeEvents[index]);
        }}
        className="relative w-full h-4 bg-muted rounded-full cursor-pointer group"
      >
        <div className="relative w-full h-1 top-1/2 -translate-y-1/2 bg-border rounded-full">
          {timeLabels.map((label) => (
              (label.isFirst || label.isLast) && (
                <div
                  key={`tick-${label.id}-${label.index}`}
                  className='absolute w-0.5 h-3 bg-muted-foreground -top-1'
                  style={{ left: `${(label.index / (uiTreeEvents.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}
                />
              )
            ))}
          {uiTreeEvents.map((event, index) => (
            <div
              key={`event-${event.id}-${index}-${getEventTimestamp(event)}`}
              className={cn(
                'absolute w-2 h-2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 group-hover:scale-125',
                selectedIndex === index ? 'bg-primary scale-150' : 'bg-muted-foreground'
              )}
              style={{ left: `${(index / (uiTreeEvents.length - 1)) * 100}%` }}
              title={new Date(getEventTimestamp(event)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
            />
          ))}
          {selectedIndex !== -1 && (
            <div
              className="absolute w-4 h-4 bg-primary rounded-full border-2 border-background shadow-lg top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${(selectedIndex / (uiTreeEvents.length - 1)) * 100}%` }}
            />
          )}
        </div>
      </div>
      <div className='relative w-full h-5 mt-1'>
        {timeLabels.map((label) => {
          const leftPercent = (label.index / (uiTreeEvents.length - 1)) * 100;
          
          return (
            <div
              key={`label-${label.id}-${label.index}-${label.time}`}
              className={cn(
                'absolute text-xs text-muted-foreground whitespace-nowrap',
                label.isFirst ? 'left-0' : label.isLast ? 'right-0' : '-translate-x-1/2'
              )}
              style={label.isFirst || label.isLast ? {} : { left: `${leftPercent}%` }}
            >
              {label.time}
            </div>
          );
        })}
      </div>
      {selectedEvent && (
        <div className="text-center text-xs text-muted-foreground mt-2">
          <span className="font-semibold">{getEventTitle(selectedEvent)}</span> at {new Date(getEventTimestamp(selectedEvent)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}
        </div>
      )}
    </div>
  );
};

export default UITreeTimeline; 