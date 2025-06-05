import React from 'react';
import type { TimelineListProps } from '@/types';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { MessageSquareText, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const TimelineList: React.FC<TimelineListProps> = ({ timelineItems, selectedItem, onSelectItem }) => {
  return (
    <div className="h-full w-full flex flex-col">
      <ScrollArea className="w-full whitespace-nowrap border-b">
        <div className="flex space-x-2 p-4">
          {timelineItems.map((item) => {
            const isSelected = selectedItem?.id === item.id;
            const timestamp = new Date(item.timestamp);
            return (
              <div
                key={item.id}
                onClick={() => onSelectItem(item)}
                className={cn(
                  'flex-shrink-0 flex flex-col items-center justify-center gap-1 w-20 h-20 rounded-md cursor-pointer border transition-colors',
                  isSelected ? 'bg-primary/10 border-primary' : 'hover:bg-muted/50'
                )}
              >
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', item.itemType === 'event' ? 'bg-primary/20' : 'bg-gray-500/20')}>
                  {item.itemType === 'event' ? (
                    <MessageSquareText className="w-5 h-5 text-primary" />
                  ) : (
                    <Zap className="w-5 h-5 text-gray-500" />
                  )}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex-grow p-4 bg-muted/30">
        {selectedItem ? (
          <Card className="h-full w-full shadow-none">
            <CardContent className="p-4">
              <p className="text-sm font-semibold">
                {selectedItem.itemType === 'event'
                  ? selectedItem.summary
                  : (selectedItem.type === 'ui_diff' ? selectedItem.change_description || 'UI Change' : 'Initial Content Dump')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedItem.itemType === 'event' ? 'Event' : 'Activity'} recorded at {new Date(selectedItem.timestamp).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground italic">Select an item from the timeline to see its summary.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineList; 