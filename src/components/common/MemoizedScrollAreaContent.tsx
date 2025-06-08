import React, { memo, forwardRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CardContent } from '@/components/ui/card';
import type { MemoizedScrollAreaContentProps } from '../../types';

// Stable style object for ScrollAreas, co-located with the component that uses it.
const scrollAreaStyle = { overflow: 'scroll', scrollbarWidth: 'thin' } as const;

const MemoizedScrollAreaContent = memo(
  forwardRef<HTMLDivElement, MemoizedScrollAreaContentProps>(
    ({ content, className }, ref) => {
      return (
        <ScrollArea
          className={className || 'h-[350px] pr-3'}
          style={scrollAreaStyle}
          ref={ref}
        >
          <CardContent className='text-xs p-3'>
            {content}
          </CardContent>
        </ScrollArea>
      );
    }
  )
);
MemoizedScrollAreaContent.displayName = 'MemoizedScrollAreaContent';

export default MemoizedScrollAreaContent; 