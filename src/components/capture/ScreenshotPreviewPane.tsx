import React, { useEffect, useState } from 'react';
import { getScreenshotById } from '@/lib/db';
import type { ActivityItem, UIDiffAnalysis, InitialFrameDumpAnalysis } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Info, Expand, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TimelineSlider from './TimelineSlider';

const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

interface ScreenshotPreviewPaneProps {
  selectedActivity: ActivityItem | null;
  activityItems: ActivityItem[];
  onActivitySelect: (item: ActivityItem) => void;
}

const ScreenshotPreviewPane: React.FC<ScreenshotPreviewPaneProps> = ({ selectedActivity, activityItems, onActivitySelect }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Select an activity to see its screenshot.');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const paneRef = React.useRef<HTMLDivElement>(null);
  const lastScrollTimeRef = React.useRef<number>(0);

  useEffect(() => {
    const fetchScreenshot = async (id: string) => {
      setLoading(true);
      setError(null);
      setImageUrl(null);
      try {
        const blob = await getScreenshotById(id);
        if (blob) {
          const url = await blobToDataURL(blob);
          setImageUrl(url);
        } else {
          setError(`Screenshot with ID "${id}" not found.`);
        }
      } catch (err) {
        setError('Failed to load screenshot.');
        console.error('[ScreenshotPreviewPane] Error fetching screenshot:', err);
      } finally {
        setLoading(false);
      }
    };

    if (selectedActivity) {
      const activity = selectedActivity as InitialFrameDumpAnalysis | UIDiffAnalysis;
      const screenshotId = activity.type === 'ui_diff' ? activity.image2_id : activity.image_id;
      
      if (screenshotId) {
        setStatusMessage('');
        fetchScreenshot(screenshotId);
      } else {
        setStatusMessage('No screenshot is associated with this activity.');
        setImageUrl(null);
        setError(null);
      }
    } else {
      setStatusMessage('Select an activity to see its screenshot.');
      setImageUrl(null);
      setError(null);
    }
  }, [selectedActivity]);

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const now = Date.now();
      if (now - lastScrollTimeRef.current < 300) { // 300ms delay
        return;
      }

      if (!selectedActivity || activityItems.length === 0) return;

      const currentIndex = activityItems.findIndex(item => item.id === selectedActivity.id);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (event.deltaY < 0) {
        // Scroll up
        nextIndex = Math.max(0, currentIndex - 1);
      } else {
        // Scroll down
        nextIndex = Math.min(activityItems.length - 1, currentIndex + 1);
      }

      if (nextIndex !== currentIndex) {
        lastScrollTimeRef.current = now;
        onActivitySelect(activityItems[nextIndex]);
      }
    };

    const paneElement = paneRef.current;
    if (paneElement) {
      paneElement.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (paneElement) {
        paneElement.removeEventListener('wheel', handleWheel);
      }
    };
  }, [selectedActivity, activityItems, onActivitySelect]);

  const renderContent = () => {
    if (loading) {
      return <Skeleton className="h-[50vh] w-full" />;
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-[200px] text-destructive">
          <AlertTriangle className="w-8 h-8 mb-2" />
          <p>{error}</p>
        </div>
      );
    }
    if (imageUrl) {
      return (
        <img
          src={imageUrl}
          alt="Activity screenshot"
          className="object-contain w-full h-full"
        />
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Info className="w-8 h-8 mb-2" />
        <p>{statusMessage}</p>
      </div>
    );
  };

  return (
    <>
      <Card className="w-full mt-4 overflow-hidden h-[400px] relative" ref={paneRef}>
        <CardContent className="p-1 h-full">
          {renderContent()}
        </CardContent>
        {imageUrl && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2"
            onClick={() => setIsFullscreen(true)}
          >
            <Expand className="w-5 h-5" />
          </Button>
        )}
      </Card>

      {isFullscreen && imageUrl && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-80 z-50 flex flex-col items-center justify-center p-4"
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white"
            onClick={() => setIsFullscreen(false)}
          >
            <X className="w-8 h-8" />
          </Button>
          <div className="w-full h-[80vh] overflow-auto">
            <div className="grid place-items-center min-h-full">
              <img
                src={imageUrl}
                alt="Activity screenshot"
                className="max-w-none"
              />
            </div>
          </div>
          <div className="w-full max-w-5xl mt-4">
            <TimelineSlider 
              activityItems={activityItems} 
              selectedActivity={selectedActivity} 
              onActivitySelect={onActivitySelect} 
            />
          </div>
        </div>
      )}
    </>
  );
};

export default ScreenshotPreviewPane; 