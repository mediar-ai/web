import React from 'react';
import { Card } from '@/components/ui/card';
import MemoizedScrollAreaContent from '../common/MemoizedScrollAreaContent';
import type { EventsTabContentProps } from '../../types';

const EventsTabContent: React.FC<EventsTabContentProps> = ({ memoizedEventsContent }) => {
  return (
    <Card className='shadow-sm border-0 p-0'>
      <MemoizedScrollAreaContent content={memoizedEventsContent} />
    </Card>
  );
};

export default EventsTabContent; 