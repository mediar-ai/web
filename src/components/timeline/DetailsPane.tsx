import React from 'react';
import type { DetailsPaneProps, Event, UIDiffAnalysis, InitialFrameDumpAnalysis } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';

const DetailsPane: React.FC<DetailsPaneProps> = ({ selectedItem }) => {
  const renderContent = () => {
    if (!selectedItem) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
          <Info className="w-12 h-12 mb-2" />
          <p>Select an item to see details.</p>
        </div>
      );
    }

    if (selectedItem.itemType === 'event') {
      const event = selectedItem as Event;
      return (
        <>
          <CardHeader>
            <CardTitle className="text-lg">Event Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-semibold text-muted-foreground">Summary</p>
              <p>{event.summary}</p>
            </div>
            {event.thoughts && (
              <div>
                <p className="font-semibold text-muted-foreground">AI Thoughts</p>
                <p className="italic">{event.thoughts}</p>
              </div>
            )}
            <div>
              <p className="font-semibold text-muted-foreground">Timestamp</p>
              <p className="font-mono text-xs">{event.timestamp}</p>
            </div>
          </CardContent>
        </>
      );
    }

    if (selectedItem.itemType === 'activity') {
      const activity = selectedItem as UIDiffAnalysis | InitialFrameDumpAnalysis;
      if (activity.type === 'initial_dump') {
        return (
          <>
            <CardHeader>
              <CardTitle  className="text-lg">Initial Content Dump</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
               <div>
                <p className="font-semibold text-muted-foreground">Raw Content</p>
                <p className="text-xs font-mono max-h-96 overflow-auto bg-muted p-2 rounded-md">{activity.raw_content}</p>
              </div>
              <div>
                <p className="font-semibold text-muted-foreground">Timestamp</p>
                <p className="font-mono text-xs">{activity.timestamp}</p>
              </div>
            </CardContent>
          </>
        );
      } else if (activity.type === 'ui_diff') {
        return (
          <>
            <CardHeader>
              <CardTitle  className="text-lg">UI Change Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="font-semibold text-muted-foreground">Change Detected</p>
                <p className={activity.change_detected === 'yes' ? 'text-green-600' : 'text-orange-500'}>{activity.change_detected}</p>
              </div>
              {activity.change_description && (
                <div>
                  <p className="font-semibold text-muted-foreground">Description</p>
                  <p>{activity.change_description}</p>
                </div>
              )}
               {activity.new_content_detected && (
                <div>
                  <p className="font-semibold text-muted-foreground">New Content</p>
                  <p className="text-xs font-mono max-h-48 overflow-auto bg-muted p-2 rounded-md">{activity.new_content_detected}</p>
                </div>
              )}
              {activity.identified_change_types && activity.identified_change_types.length > 0 && (
                <div>
                  <p className="font-semibold text-muted-foreground">Change Types</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {activity.identified_change_types.map((type, index) => (
                      <span key={index} className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">{type}</span>
                    ))}
                  </div>
                </div>
              )}
               <div>
                <p className="font-semibold text-muted-foreground">Timestamp</p>
                <p className="font-mono text-xs">{activity.timestamp}</p>
              </div>
            </CardContent>
          </>
        );
      }
    }

    return <p>Details for this item type are not yet implemented.</p>;
  };

  return <Card className="h-full w-full shadow-inner border overflow-y-auto">{renderContent()}</Card>;
};

export default DetailsPane; 