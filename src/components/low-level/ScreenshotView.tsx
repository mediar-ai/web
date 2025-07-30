'use client';

import Image from 'next/image';
import React from 'react';

interface ScreenshotViewProps {
  dataUrl: string | null;
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
}

const ScreenshotView: React.FC<ScreenshotViewProps> = ({ 
  dataUrl, 
  onWheel
}) => {
  if (!dataUrl) {
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
        src={dataUrl} 
        alt="Workflow Step Screenshot" 
        width={1920}
        height={1080}
        className="max-h-full max-w-full" 
        style={{ objectFit: 'contain' }}
        onError={() => {
          console.error('[ScreenshotView] Image failed to load:', dataUrl);
        }}
      />
    </div>
  );
};

export default ScreenshotView; 