import React, { useEffect, useState, useRef } from 'react';
import type { ActivityItem, UIDiffAnalysis, InitialFrameDumpAnalysis, DataProvider } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Info, Expand, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export interface ScreenshotPreviewPaneProps {
  selectedActivity: ActivityItem | null;
  activityItems: ActivityItem[];
  onActivitySelect: (item: ActivityItem) => void;
  dataProvider: DataProvider;
}

const ScreenshotPreviewPane: React.FC<ScreenshotPreviewPaneProps> = ({ 
  selectedActivity, 
  activityItems, 
  onActivitySelect,
  dataProvider,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const prevActivityIdRef = useRef<string | null>(null);

  useEffect(() => {
    const fetchImage = async () => {
      if (!selectedActivity) {
        setImageUrl(null);
        setError(null);
        return;
      }

      if (selectedActivity.id === prevActivityIdRef.current && imageUrl) return;
      prevActivityIdRef.current = selectedActivity.id;

      setLoading(true);
      setError(null);
      setImageUrl(null);

      const imageId = selectedActivity.type === 'ui_diff'
        ? (selectedActivity as UIDiffAnalysis).image2_id
        : (selectedActivity as InitialFrameDumpAnalysis).image_id;

      if (imageId) {
        try {
          const result = await dataProvider.loadScreenshot(imageId);
          if (result instanceof Blob) {
            const url = await blobToDataURL(result);
            setImageUrl(url);
          } else if (typeof result === 'string') {
            setImageUrl(result);
          } else {
            setError(`Screenshot not found.`);
          }
        } catch (err) {
          setError('Failed to load screenshot.');
          console.error('[ScreenshotPreviewPane] Error loading screenshot:', err);
        }
      } else {
        setError('No screenshot is associated with this activity.');
      }
      setLoading(false);
    };

    fetchImage();
  }, [selectedActivity, dataProvider, imageUrl]);

  const handleNavigation = (direction: 'prev' | 'next') => {
    if (!selectedActivity || activityItems.length === 0) return;
    const currentIndex = activityItems.findIndex(item => item.id === selectedActivity.id);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (direction === 'prev') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else {
      nextIndex = Math.min(activityItems.length - 1, currentIndex + 1);
    }

    if (nextIndex !== currentIndex) {
      onActivitySelect(activityItems[nextIndex]);
    }
  };
  
  const renderContent = () => {
    if (loading) {
      return <Skeleton className="h-full w-full" />;
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-destructive-foreground bg-destructive/20 p-4">
          <AlertTriangle className="w-8 h-8 mb-2" />
          <p className="text-center font-semibold">{error}</p>
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
        <p>Select an activity to see its screenshot.</p>
      </div>
    );
  };

  return (
    <>
      <Card className="w-full mt-4 overflow-hidden h-[400px] relative">
        <CardContent className="p-1 h-full">
          {renderContent()}
        </CardContent>
        {imageUrl && !loading && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => setIsFullScreen(true)}
            >
              <Expand className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 -translate-y-1/2 left-2"
              onClick={() => handleNavigation('prev')}
              disabled={activityItems.findIndex(item => item.id === selectedActivity?.id) === 0}
            >
              &lt;
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 -translate-y-1/2 right-2"
              onClick={() => handleNavigation('next')}
              disabled={activityItems.findIndex(item => item.id === selectedActivity?.id) === activityItems.length - 1}
            >
              &gt;
            </Button>
          </>
        )}
      </Card>

      {isFullScreen && imageUrl && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white hover:text-white hover:bg-white/10"
            onClick={() => setIsFullScreen(false)}
          >
            <X className="w-8 h-8" />
          </Button>
          <img
            src={imageUrl}
            alt="Activity screenshot"
            className="max-w-[90vw] max-h-[90vh] object-contain"
          />
        </div>
      )}
    </>
  );
};

export default ScreenshotPreviewPane; 