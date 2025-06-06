import React, { useMemo, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import MemoizedScrollAreaContent from '../common/MemoizedScrollAreaContent';
import type { ActivityItem } from '../../types';
import { cn } from '@/lib/utils';

interface ActivityTabContentProps {
  activityItems: ActivityItem[];
  selectedActivity: ActivityItem | null;
  onActivitySelect: (item: ActivityItem) => void;
}

const ActivityTabContent: React.FC<ActivityTabContentProps> = ({ activityItems, selectedActivity, onActivitySelect }) => {
  // Reverse the activities so newest appears at bottom
  const reversedActivityItems = useMemo(() => [...activityItems].reverse(), [activityItems]);
  
  const itemRefs = React.useRef<React.RefObject<HTMLLIElement>[]>([]);
  
  // Ensure refs array matches the reversed activities length
  useEffect(() => {
    itemRefs.current = reversedActivityItems.map((_, i) => itemRefs.current[i] || React.createRef());
  }, [reversedActivityItems]);

  useEffect(() => {
    if (selectedActivity) {
      const index = reversedActivityItems.findIndex(item => item.id === selectedActivity.id);
      console.log('[ActivityTabContent] Auto-scroll - Selected activity:', selectedActivity.id);
      console.log('[ActivityTabContent] Auto-scroll - Found at index:', index, 'out of', reversedActivityItems.length);
      
      if (index !== -1 && itemRefs.current[index]?.current) {
        console.log('[ActivityTabContent] Auto-scroll - Scrolling to item at index:', index);
        itemRefs.current[index].current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      } else {
        console.log('[ActivityTabContent] Auto-scroll - Could not find ref for index:', index);
      }
    }
  }, [selectedActivity, reversedActivityItems]);

  const activityContent = reversedActivityItems.length > 0
    ? (
      <ul className='space-y-2 p-1'>
        {reversedActivityItems.map((item, index) => {
          const isSelected = selectedActivity?.id === item.id;
          if (item.type === 'initial_dump') {
            return (
              <li
                key={item.id}
                ref={itemRefs.current[index]}
                onClick={() => onActivitySelect(item)}
                className={cn(
                  'p-3 border rounded-md text-xs transition-colors cursor-pointer',
                  isSelected ? 'bg-primary/10 border-primary' : 'bg-background hover:bg-muted/50'
                )}
              >
                <p className='font-medium text-[10px] mb-1.5 text-muted-foreground'>
                  {new Date(item.timestamp).toLocaleString()}
                  <span className='ml-2 text-foreground font-semibold'>
                    Initial Frame Content
                  </span>
                </p>
                <MemoizedScrollAreaContent 
                  className='whitespace-pre-wrap p-2 bg-muted rounded text-foreground max-h-40'
                  content={<div className="text-foreground">{item.raw_content}</div>} 
                />
              </li>
            );
          } else if (item.type === 'ui_diff') {
            return (
              <li
                key={item.id}
                ref={itemRefs.current[index]}
                onClick={() => onActivitySelect(item)}
                className={cn(
                  'p-3 border rounded-md text-xs transition-colors cursor-pointer',
                  isSelected ? 'bg-primary/10 border-primary' : 'bg-background hover:bg-muted/50'
                )}
              >
                <p className='font-medium text-[10px] mb-1.5 text-muted-foreground'>
                  {new Date(item.timestamp).toLocaleString()}
                </p>
                <div className='space-y-1'>
                  <div>
                    <strong className='text-foreground'>Change Detected:</strong>
                    {' '}
                    <span
                      className={item.change_detected === 'yes'
                        ? 'text-green-600 font-semibold'
                        : 'text-orange-500'}
                    >
                      {item.change_detected}
                    </span>
                  </div>
                  {item.change_detected === 'yes' && (
                    <>
                      {item.change_description && (
                        <div>
                          <strong className='text-foreground'>Description:</strong>
                          {' '}
                          {item.change_description}
                        </div>
                      )} 
                      {item.new_content_detected && (
                        <div className='mt-1.5 pt-1 border-t'>
                          <strong className='text-foreground'>
                            Newly Detected Content:
                          </strong>
                          <MemoizedScrollAreaContent 
                            className='whitespace-pre-wrap p-2 mt-1 bg-muted rounded max-h-40'
                            content={<div className="text-foreground">{item.new_content_detected}</div>}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          }
          return null;
        })}
      </ul>
    )
    : (
      <p className='text-muted-foreground italic p-8 text-center'>
        No activity captured yet. Start recording.
      </p>
    );
  
  return (
    <Card className='shadow-sm border-0 p-0'>
      <MemoizedScrollAreaContent
        content={activityContent}
        className='h-[350px] pr-3'
      />
    </Card>
  );
};

export default ActivityTabContent; 