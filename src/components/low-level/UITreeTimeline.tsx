'use client';

import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { LowLevelEvent } from '@/types';

type UITreeEventPayload = {
  payload?: {
    event?: {
      app_name?: string;
      screen?: {
        ui_tree?: string;
      }
    }
  }
}

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
  const reversedEvents = React.useMemo(() => [...uiTreeEvents].reverse(), [uiTreeEvents]);
  const sliderRef = useRef<HTMLDivElement>(null);
  const lastScrollTimeRef = useRef<number>(0);

  const selectedIndex = selectedEvent
    ? reversedEvents.findIndex((item) => item.id === selectedEvent.id)
    : -1;

  const getTimeLabels = () => {
    if (reversedEvents.length === 0) return [];
    
    // If there are few events, label all of them
    if (reversedEvents.length <= 5) {
      return reversedEvents.map((item, index) => {
        const date = new Date(item.created_at);
        return {
          id: item.id,
          index,
          time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          isFirst: index === 0,
          isLast: index === reversedEvents.length - 1,
        };
      });
    }

    const labels = [];
    const maxLabels = Math.min(6, Math.max(3, Math.floor(reversedEvents.length / 5)));
    
    for (let i = 0; i < maxLabels; i++) {
      const index = Math.floor((i / (maxLabels - 1)) * (reversedEvents.length - 1));
      const item = reversedEvents[index];
      if (item) {
        const date = new Date(item.created_at);
        const isFirst = i === 0;
        const isLast = i === maxLabels - 1;
        
        labels.push({
          id: item.id,
          index,
          time: date.toLocaleDateString([], { 
            month: 'short', 
            day: 'numeric'
          }) + ' ' + date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit'
          }),
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

      if (!selectedEvent || reversedEvents.length === 0) return;

      const currentIndex = reversedEvents.findIndex(item => item.id === selectedEvent.id);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (event.deltaY < 0) {
        // Scroll up - go to previous (left)
        nextIndex = Math.max(0, currentIndex - 1);
      } else {
        // Scroll down - go to next (right)
        nextIndex = Math.min(reversedEvents.length - 1, currentIndex + 1);
      }

      if (nextIndex !== currentIndex) {
        lastScrollTimeRef.current = now;
        onEventSelect(reversedEvents[nextIndex]);
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
  }, [selectedEvent, reversedEvents, onEventSelect]);

  if (reversedEvents.length < 2) {
    return null;
  }

  return (
    <div className="w-full flex flex-col gap-2 py-4 px-2">
      <div
        ref={sliderRef}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percentage = clickX / rect.width;
          const index = Math.round(percentage * (reversedEvents.length - 1));
          onEventSelect(reversedEvents[index]);
        }}
        className="relative w-full h-4 bg-muted rounded-full cursor-pointer group"
      >
        <div className="relative w-full h-1 top-1/2 -translate-y-1/2 bg-border rounded-full">
          {timeLabels.map((label) => (
              (label.isFirst || label.isLast) && (
                <div
                  key={`tick-${label.id}-${label.index}`}
                  className='absolute w-0.5 h-3 bg-muted-foreground -top-1'
                  style={{ left: `${(label.index / (reversedEvents.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}
                />
              )
            ))}
          {reversedEvents.map((event, index) => (
            <div
              key={event.id}
              className={cn(
                'absolute w-2 h-2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 group-hover:scale-125',
                selectedIndex === index ? 'bg-primary scale-150' : 'bg-muted-foreground'
              )}
              style={{ left: `${(index / (reversedEvents.length - 1)) * 100}%` }}
              title={new Date(event.created_at).toLocaleTimeString()}
            />
          ))}
          {selectedIndex !== -1 && (
            <div
              className="absolute w-4 h-4 bg-primary rounded-full border-2 border-background shadow-lg top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${(selectedIndex / (reversedEvents.length - 1)) * 100}%` }}
            />
          )}
        </div>
      </div>
      <div className='relative w-full h-5 mt-1'>
        {timeLabels.map((label) => {
          const leftPercent = (label.index / (reversedEvents.length - 1)) * 100;
          
          return (
            <div
              key={`${label.id}-${label.index}`}
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
          <span className="font-semibold">{getEventTitle(selectedEvent)}</span> at {new Date(selectedEvent.created_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

export default UITreeTimeline; 