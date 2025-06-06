import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import MemoizedScrollAreaContent from '../common/MemoizedScrollAreaContent';
import type { Event } from '../../types';
import { cn } from '@/lib/utils';

interface EventsTabContentProps {
  events: Event[];
  selectedEvent: Event | null;
  onEventSelect: (event: Event) => void;
}

const EventsTabContent: React.FC<EventsTabContentProps> = ({ events, selectedEvent, onEventSelect }) => {
  const itemRefs = React.useRef<React.RefObject<HTMLDivElement>[]>([]);
  
  if (itemRefs.current.length !== events.length) {
    itemRefs.current = Array(events.length).fill(null).map((_, i) => itemRefs.current[i] || React.createRef());
  }

  React.useEffect(() => {
    if (selectedEvent) {
      const index = events.findIndex(event => event.id === selectedEvent.id);
      if (index !== -1 && itemRefs.current[index]?.current) {
        itemRefs.current[index].current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedEvent, events]);

  const memoizedEventsContent = useMemo(() => {
    return events.length > 0
      ? (
        <div className='relative p-1'>
          <div className='absolute left-3 top-2 bottom-2 w-0.5 bg-border -z-10'></div>
          {events.map((event, index) => {
            const isSelected = selectedEvent?.id === event.id;
            return (
              <div
                key={event.id}
                ref={itemRefs.current[index]}
                onClick={() => onEventSelect(event)}
                className={cn(
                  'relative flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                )}
              >
                <div className={cn(
                  'relative z-10 w-3 h-3 bg-background rounded-full border-2',
                  isSelected ? 'border-primary' : 'border-muted-foreground'
                )}>
                </div>
                <div className='flex-1 min-w-0'>
                  <div
                    className='flex items-center gap-2'
                    title={event.thoughts
                      ? `Thoughts: ${event.thoughts}`
                      : undefined}
                  >
                    <span className='text-[10px] text-muted-foreground font-mono'>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <span className='text-xs text-foreground truncate'>
                      {event.summary}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )
      : (
        <p className='text-muted-foreground italic p-8 text-center'>
          No events captured yet. Start recording to see workflow events.
        </p>
      );
  }, [events, selectedEvent, onEventSelect]);

  return (
    <Card className='shadow-sm border-0 p-0'>
      <MemoizedScrollAreaContent content={memoizedEventsContent} className='h-[350px]' />
    </Card>
  );
};

export default EventsTabContent; 