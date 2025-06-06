import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { VideoPreviewAreaProps } from '../../types'; // Adjust path as necessary

const VideoPreviewArea: React.FC<VideoPreviewAreaProps> = ({ stream, videoRef, onCollapseChange }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

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
              Live Preview
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