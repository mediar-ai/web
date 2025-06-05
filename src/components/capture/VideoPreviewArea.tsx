import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { VideoPreviewAreaProps } from '../../types'; // Adjust path as necessary

const VideoPreviewArea: React.FC<VideoPreviewAreaProps> = ({ stream, videoRef }) => {
  return (
    <div className='lg:col-span-1'>
      {stream && (
        <Card className='shadow-lg h-full'>
          <CardHeader>
            <CardTitle className='text-xl'>Live Screen Preview</CardTitle>
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