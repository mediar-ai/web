import React from 'react';
import { Card } from '@/components/ui/card';
import MemoizedScrollAreaContent from '../common/MemoizedScrollAreaContent';
import type { ActivityTabContentProps } from '../../types';

const ActivityTabContent: React.FC<ActivityTabContentProps> = ({ memoizedActivityContent }) => {
  return (
    <Card className='shadow-sm border-0 p-0'>
      <MemoizedScrollAreaContent
        content={memoizedActivityContent}
        className='h-[350px] pr-3 bg-white' // Specific class for this instance
      />
    </Card>
  );
};

export default ActivityTabContent; 