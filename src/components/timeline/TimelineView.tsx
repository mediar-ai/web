import React, { useState } from 'react';
import type { TimelineViewProps, TimelineItem } from '@/types';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import TimelineList from './TimelineList';
import ScreenshotPreview from './ScreenshotPreview';
import DetailsPane from './DetailsPane';

const TimelineView: React.FC<TimelineViewProps> = ({ timelineItems }) => {
  const [selectedItem, setSelectedItem] = useState<TimelineItem | null>(null);

  return (
    <ResizablePanelGroup direction="vertical" className="w-full h-full">
      <ResizablePanel defaultSize={30} minSize={20}>
        <TimelineList
          timelineItems={timelineItems}
          selectedItem={selectedItem}
          onSelectItem={setSelectedItem}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={70}>
        <div className="w-full h-full flex flex-col">
          <div className="flex-1 min-h-0 p-1">
            <ScreenshotPreview selectedItem={selectedItem} timelineItems={timelineItems} />
          </div>
          <div className="flex-shrink-0 h-auto max-h-[40%] overflow-y-auto border-t">
            <DetailsPane selectedItem={selectedItem} />
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default TimelineView; 