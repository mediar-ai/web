import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import MemoizedScrollAreaContent from '../common/MemoizedScrollAreaContent';
import type { Event } from '../../types';

interface EventsTabContentProps {
  events: Event[];
}

const EventsTabContent: React.FC<EventsTabContentProps> = ({ events }) => {
  const memoizedEventsContent = useMemo(() => {
    return events.length > 0
      ? (
        <div className='relative'>
          <div className='absolute left-2 top-0 bottom-0 w-0.5 bg-border'></div>
          {events.map((event) => (
            <div
              key={event.id}
              className='relative flex items-center gap-3 pb-3'
            >
              <div className='relative z-10 w-4 h-4 bg-primary rounded-full border-2 border-background flex-shrink-0'>
              </div>
              <div className='flex-1 min-w-0'>
                <div
                  className='flex items-center gap-2'
                  title={event.thoughts
                    ? `Thoughts: ${event.thoughts}`
                    : undefined}
                >
                  <span className='text-[10px] text-muted-foreground font-mono'>
                    {event.timestamp}
                  </span>
                  <span className='text-xs text-foreground truncate'>
                    {event.summary}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )
      : (
        <p className='text-muted-foreground italic p-8 text-center'>
          No events captured yet. Start recording to see workflow events.
        </p>
      );
  }, [events]);

  return (
    <Card className='shadow-sm border-0 p-0'>
      <MemoizedScrollAreaContent content={memoizedEventsContent} />
    </Card>
  );
};

export default EventsTabContent; 