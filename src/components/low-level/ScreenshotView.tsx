'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { loadScreenshotFromStorage } from '@/lib/screenshotStorage';
import { Skeleton } from '@/components/ui/skeleton';

interface ScreenshotViewProps {
  dataUrl: string | null;
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
  // Optional: Load from storage instead of using dataUrl directly
  storageConfig?: {
    userId: string;
    sessionId: string;
    eventId: string | number;
    type?: 'before' | 'after' | 'single';
  };
}

const ScreenshotView: React.FC<ScreenshotViewProps> = ({ 
  dataUrl, 
  onWheel, 
  storageConfig 
}) => {
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(dataUrl);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadScreenshot = async () => {
      // If we have storage config, try to load from storage first
      if (storageConfig) {
        setIsLoading(true);
        try {
          const storageUrl = await loadScreenshotFromStorage(
            storageConfig.userId,
            storageConfig.sessionId,
            storageConfig.eventId,
            storageConfig.type || 'single',
            dataUrl
          );
          setFinalImageUrl(storageUrl);
        } catch (error) {
          console.error('[ScreenshotView] Error loading from storage:', error);
          setFinalImageUrl(dataUrl);
        } finally {
          setIsLoading(false);
        }
      } else {
        // Use the provided dataUrl directly
        setFinalImageUrl(dataUrl);
      }
    };

    loadScreenshot();
  }, [dataUrl, storageConfig]);

  if (isLoading) {
    return (
      <div className="w-full h-[700px] bg-muted rounded-lg flex items-center justify-center">
        <div className="space-y-4 w-full max-w-sm">
          <Skeleton className="h-6 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-1/2 mx-auto" />
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!finalImageUrl) {
    return (
      <div className="w-full h-[700px] bg-muted flex items-center justify-center text-muted-foreground rounded-lg">
        No screenshot available for this step.
      </div>
    );
  }

  return (
    <div 
      className="w-full h-[700px] overflow-hidden bg-muted rounded-lg flex items-center justify-center"
      onWheel={onWheel}
    >
      <Image 
        src={finalImageUrl} 
        alt="Workflow Step Screenshot" 
        width={1920}
        height={1080}
        className="max-h-full max-w-none" 
        style={{ objectFit: 'contain' }}
        onError={() => {
          console.error('[ScreenshotView] Image failed to load:', finalImageUrl);
          // If storage image fails, try fallback to dataUrl if available
          if (finalImageUrl !== dataUrl && dataUrl) {
            setFinalImageUrl(dataUrl);
          }
        }}
      />
    </div>
  );
};

export default ScreenshotView; 