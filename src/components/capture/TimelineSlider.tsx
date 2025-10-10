import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { ActivityItem } from '@/types';

interface TimelineSliderProps {
  activityItems: ActivityItem[];
  selectedActivity: ActivityItem | null;
  onActivitySelect: (item: ActivityItem) => void;
}

const TimelineSlider: React.FC<TimelineSliderProps> = ({
  activityItems,
  selectedActivity,
  onActivitySelect,
}) => {
  // Reverse the activities so newest appears at the right
  const reversedActivityItems = React.useMemo(() => [...activityItems].reverse(), [activityItems]);
  
  const sliderRef = useRef<HTMLDivElement>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const selectedIndex = selectedActivity
    ? reversedActivityItems.findIndex((item) => item.id === selectedActivity.id)
    : -1;

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const now = Date.now();
      if (now - lastScrollTimeRef.current < 200) { // 200ms delay
        return;
      }

      if (!selectedActivity || reversedActivityItems.length === 0) return;

      const currentIndex = reversedActivityItems.findIndex(item => item.id === selectedActivity.id);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (event.deltaY < 0) {
        // Scroll up - go to previous (left)
        nextIndex = Math.max(0, currentIndex - 1);
      } else {
        // Scroll down - go to next (right)
        nextIndex = Math.min(reversedActivityItems.length - 1, currentIndex + 1);
      }

      if (nextIndex !== currentIndex) {
        lastScrollTimeRef.current = now;
        onActivitySelect(reversedActivityItems[nextIndex]);
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
  }, [selectedActivity, reversedActivityItems, onActivitySelect]);

  const handleSliderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!sliderRef.current || reversedActivityItems.length === 0) return;

    const sliderRect = sliderRef.current.getBoundingClientRect();
    const clickX = e.clientX - sliderRect.left;
    const sliderWidth = sliderRect.width;
    const clickPercentage = clickX / sliderWidth;

    const targetIndex = Math.round(clickPercentage * (reversedActivityItems.length - 1));
    const newActivity = reversedActivityItems[Math.max(0, Math.min(targetIndex, reversedActivityItems.length - 1))];

    if (newActivity) {
      onActivitySelect(newActivity);
    }
  };

  // Calculate which items should have time labels (roughly every 5-7 items or based on time gaps)
  const getTimeLabels = () => {
    if (reversedActivityItems.length === 0) return [];
    
    const labels = [];
    const maxLabels = Math.min(6, Math.max(3, Math.floor(reversedActivityItems.length / 5)));
    
    for (let i = 0; i < maxLabels; i++) {
      const index = Math.floor((i / (maxLabels - 1)) * (reversedActivityItems.length - 1));
      const item = reversedActivityItems[index];
      if (item) {
        const date = new Date(item.timestamp);
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
  
  if (reversedActivityItems.length < 2) {
      return null; // Don't render the slider if there are not enough items
  }

  return (
    <div className='w-full flex flex-col gap-2 py-4 px-2'>
      <div
        ref={sliderRef}
        onClick={handleSliderClick}
        className='relative w-full h-4 bg-muted rounded-full cursor-pointer group'
      >
        {/* Track */}
        <div className='relative w-full h-1 top-1/2 -translate-y-1/2 bg-border rounded-full'>
            {/* Tick marks for edge labels */}
            {timeLabels.map((label, i) => (
              (label.isFirst || label.isLast) && (
                <div
                  key={`tick-${i}`}
                  className='absolute w-0.5 h-3 bg-muted-foreground -top-1'
                  style={{ left: `${(label.index / (reversedActivityItems.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}
                />
              )
            ))}
            
            {/* Markers for each activity */}
            {reversedActivityItems.map((item, index) => (
                <div
                    key={item.id}
                    className={cn(
                        'absolute w-2 h-2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                        selectedIndex === index ? 'bg-primary scale-150' : 'bg-muted-foreground',
                        'transition-all duration-150 group-hover:scale-125'
                    )}
                    style={{ left: `${(index / (reversedActivityItems.length - 1)) * 100}%` }}
                />
            ))}
            
            {/* Handle for selected activity */}
            {selectedIndex !== -1 && (
                <div
                    className='absolute w-4 h-4 bg-primary rounded-full border-2 border-background shadow-lg top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none'
                    style={{ left: `${(selectedIndex / (reversedActivityItems.length - 1)) * 100}%` }}
                />
            )}
        </div>
      </div>
      
      {/* Time labels */}
      <div className='relative w-full h-5 mt-1'>
        {timeLabels.map((label, i) => {
          const leftPercent = (label.index / (reversedActivityItems.length - 1)) * 100;

          return (
            <div
              key={`label-${i}`}
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
    </div>
  );
};

export default TimelineSlider; 