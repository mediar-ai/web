import React, { useEffect, useState } from 'react';
import { getScreenshotById } from '@/lib/db';
import type { ScreenshotPreviewProps, UIDiffAnalysis, InitialFrameDumpAnalysis, TimelineItem } from '@/types';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Info } from 'lucide-react';

const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const ScreenshotPreview: React.FC<ScreenshotPreviewProps> = ({ selectedItem, timelineItems }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Select an item to see the preview.');

  useEffect(() => {
    const fetchScreenshot = async (id: string) => {
      console.log(`[ScreenshotPreview] Fetching screenshot for ID: ${id}`);
      setLoading(true);
      setError(null);
      setImageUrl(null);
      try {
        const blob = await getScreenshotById(id);
        if (blob) {
          const url = await blobToDataURL(blob);
          setImageUrl(url);
          console.log(`[ScreenshotPreview] Successfully loaded screenshot for ID: ${id}`);
        } else {
          setError(`Screenshot with ID "${id}" not found in the database.`);
          console.warn(`[ScreenshotPreview] Screenshot not found for ID: ${id}`);
        }
      } catch (err) {
        setError('Failed to load screenshot from the database.');
        console.error('[ScreenshotPreview] Error fetching screenshot:', err);
      } finally {
        setLoading(false);
      }
    };

    const findScreenshotForEvent = (eventItem: TimelineItem) => {
      const eventIndex = timelineItems.findIndex(item => item.id === eventItem.id);
      if (eventIndex === -1) return undefined;

      // Search for the next activity item in the timeline (which is chronologically previous)
      for (let i = eventIndex + 1; i < timelineItems.length; i++) {
        const potentialActivity = timelineItems[i];
        if (potentialActivity.itemType === 'activity') {
          if (potentialActivity.type === 'ui_diff' && potentialActivity.image2_id) {
            return potentialActivity.image2_id;
          } else if (potentialActivity.type === 'initial_dump' && potentialActivity.image_id) {
            return potentialActivity.image_id;
          }
        }
      }
      return undefined;
    };

    if (selectedItem) {
      let screenshotId: string | undefined;
      if (selectedItem.itemType === 'activity') {
        const activity = selectedItem as InitialFrameDumpAnalysis | UIDiffAnalysis;
        if (activity.type === 'ui_diff') {
          screenshotId = activity.image2_id;
        } else if (activity.type === 'initial_dump') {
          screenshotId = activity.image_id;
        }
      } else if (selectedItem.itemType === 'event') {
        screenshotId = findScreenshotForEvent(selectedItem);
        if (!screenshotId) {
          setStatusMessage('Could not find a relevant screenshot for this event.');
        }
      }

      if (screenshotId) {
        setStatusMessage('');
        fetchScreenshot(screenshotId);
      } else {
        // This handles cases where an activity/event has no associated screenshot
        if(selectedItem.itemType !== 'event') {
          setStatusMessage('No screenshot associated with this activity.');
        }
        setImageUrl(null);
        setError(null);
        setLoading(false);
      }
    } else {
      setStatusMessage('Select an item from the timeline to see the preview.');
      setImageUrl(null);
      setError(null);
      setLoading(false);
    }
  }, [selectedItem, timelineItems]);

  const renderContent = () => {
    if (loading) {
      return <Skeleton className="w-full h-full" />;
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-destructive p-4">
          <AlertTriangle className="w-12 h-12 mb-2" />
          <p className="font-semibold">Error</p>
          <p className="text-xs">{error}</p>
        </div>
      );
    }
    if (imageUrl) {
      return (
        <img
          src={imageUrl}
          alt="Screenshot preview"
          className="object-contain w-full h-full"
        />
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
        <Info className="w-12 h-12 mb-2" />
        <p>{statusMessage}</p>
      </div>
    );
  };

  return (
    <Card className="h-full w-full shadow-inner border bg-muted/20 flex items-center justify-center overflow-hidden">
      {renderContent()}
    </Card>
  );
};

export default ScreenshotPreview; 