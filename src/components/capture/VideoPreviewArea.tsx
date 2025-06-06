import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { VideoPreviewAreaProps } from '../../types'; // Adjust path as necessary

const VideoPreviewArea: React.FC<VideoPreviewAreaProps> = ({ stream, videoRef, onCollapseChange }) => {
  // Always start with false to ensure consistent server/client hydration
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // Load from localStorage only after mounting (client-side only)
  useEffect(() => {
    setHasMounted(true);
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('livePreviewCollapsed');
      if (saved) {
        const savedState = JSON.parse(saved);
        setIsCollapsed(savedState);
      }
    }
  }, []);

  // Save to localStorage whenever state changes (but only after mounting)
  useEffect(() => {
    if (hasMounted && typeof window !== 'undefined') {
      localStorage.setItem('livePreviewCollapsed', JSON.stringify(isCollapsed));
    }
  }, [isCollapsed, hasMounted]);

  // Notify parent of state changes
  useEffect(() => {
    if (hasMounted) {
      onCollapseChange?.(isCollapsed);
    }
  }, [onCollapseChange, isCollapsed, hasMounted]);

  const toggleCollapsed = () => {
    const newCollapsedState = !isCollapsed;
    setIsCollapsed(newCollapsedState);
    onCollapseChange?.(newCollapsedState);
  };

  if (isCollapsed) {
    return (
      <div className='relative w-12 h-full'>
        <Card className='h-full w-full bg-muted/50'>
          <div className='flex items-center justify-center h-full relative'>
            <div 
              className='text-sm font-medium text-muted-foreground'
              style={{ 
                writingMode: 'vertical-lr',
                textOrientation: 'mixed',
                transform: 'rotate(180deg)'
              }}
            >
              Live Capture Preview
            </div>
            <Button
              variant='ghost'
              size='sm'
              onClick={toggleCollapsed}
              className='absolute top-2 right-1 h-6 w-6 p-0 z-10'
            >
              <ChevronRight className='h-3 w-3' />
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className='lg:col-span-1 relative'>
      <Button
        variant='ghost'
        size='sm'
        onClick={toggleCollapsed}
        className='absolute top-2 right-2 h-6 w-6 p-0 z-10 bg-background/80 hover:bg-background shadow-sm'
      >
        <ChevronLeft className='h-3 w-3' />
      </Button>
      
      {stream && (
        <Card className='shadow-lg h-full'>
          <CardHeader>
            <CardTitle className='text-base font-medium'>Live Screen Preview</CardTitle>
          </CardHeader>
          <CardContent className='aspect-video bg-slate-900 rounded-md overflow-hidden'>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className='w-full h-full object-contain'
            />
          </CardContent>
        </Card>
      )}
      {!stream && (
        <Card className='shadow-lg h-full flex flex-col items-center justify-center min-h-[300px] bg-slate-50'>
          <CardContent>
            <p className='text-muted-foreground'>
              Start recording to see live preview.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default VideoPreviewArea; 