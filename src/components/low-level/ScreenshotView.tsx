'use client';

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

interface ScreenshotViewProps {
  dataUrl: string | null | undefined;
}

const ScreenshotView: React.FC<ScreenshotViewProps> = ({ dataUrl }) => {
  if (dataUrl === undefined) {
    return <Skeleton className="w-full h-64" />;
  }

  if (!dataUrl) {
    return (
      <div className="flex items-center justify-center w-full h-64 border rounded-md bg-gray-50 dark:bg-gray-800">
        <span className="text-gray-500">No screenshot available.</span>
      </div>
    );
  }

  return (
    <div className="p-2 border rounded-md">
      <img src={dataUrl} alt="Screenshot" className="max-w-full h-auto rounded-md" />
    </div>
  );
};

export default ScreenshotView; 