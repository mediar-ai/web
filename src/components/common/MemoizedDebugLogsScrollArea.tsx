import React, { memo, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { MemoizedDebugLogsScrollAreaProps } from '../../types';

// Stable style object for this specific ScrollArea component
const scrollAreaStyle = { overflow: 'scroll', scrollbarWidth: 'thin' } as const;

const MemoizedDebugLogsScrollArea = memo(
  ({ logs }: MemoizedDebugLogsScrollAreaProps) => {
    const content = useMemo(() => {
      return logs.length > 0
        ? (
          logs.map((log, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap border-b border-slate-700 py-1 pr-16 ${
                log.includes('[ERROR]') ? 'text-red-400' : 'text-slate-200'
              }`}
            >
              {log}
            </div>
          ))
        )
        : <p className='p-4 text-center'>No UI logs yet.</p>;
    }, [logs]);

    return (
      <ScrollArea
        className='h-[350px] w-full p-3 bg-slate-900 text-slate-200 font-mono text-[10px] leading-relaxed rounded-md'
        style={scrollAreaStyle}
      >
        {content}
      </ScrollArea>
    );
  },
);
MemoizedDebugLogsScrollArea.displayName = 'MemoizedDebugLogsScrollArea';

export default MemoizedDebugLogsScrollArea; 