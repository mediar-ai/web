import React from 'react';
import { Button } from '@/components/ui/button';
import type { PageHeaderControlsProps } from '../../types'; // Adjust path as necessary

const PageHeaderControls: React.FC<PageHeaderControlsProps> = ({
  stream,
  handleStartScreenShare,
  handleStopScreenShare,
  handleManualInitialDump,
  mainStatus,
  autoDetectionEnabled,
  isMonitoring,
  displayChangePercent,
  activeAnalysesCount,
  initialDumpInProgress,
  error,
  streamRef,
  MAX_PARALLEL_ANALYSES,
}) => {
  return (
    <div className='w-full max-w-7xl mb-6 flex items-center justify-between gap-4'>
      <div className='flex items-center gap-3'>
        <h1 className='text-2xl font-bold tracking-tight'>
          Workflow Capture
        </h1>
        <p className='text-sm text-muted-foreground'>
          Insights from your screen
        </p>
        <div className='flex items-center gap-2 pl-4'>
          <Button
            onClick={stream ? handleStopScreenShare : handleStartScreenShare}
            size='default'
            className={`w-24 ${
              stream
                ? 'bg-red-600 hover:bg-red-700 animate-pulse text-white'
                : ''
            }`}
          >
            {stream ? 'Stop' : 'Start'}
          </Button>
          <Button
            onClick={handleManualInitialDump}
            size='default'
            variant='outline'
            className='w-32'
            disabled={!streamRef.current || 
              activeAnalysesCount >= MAX_PARALLEL_ANALYSES ||
              initialDumpInProgress}
          >
            {initialDumpInProgress
              ? 'Dumping...'
              : activeAnalysesCount >= MAX_PARALLEL_ANALYSES
              ? `Analyzing (${activeAnalysesCount})...`
              : 'Capture Frame'}
          </Button>
        </div>
      </div>
      <div
        className={`text-sm rounded-md px-3 py-1.5 min-w-[280px] text-center bg-background flex items-center justify-between ${
          activeAnalysesCount > 0
            ? 'text-blue-600 bg-blue-50 animate-pulse border border-blue-200'
            : error
            ? 'text-red-600 bg-red-50 border border-red-200'
            : 'text-muted-foreground'
        }`}
      >
        <span className='truncate'>Status: {mainStatus}</span>
        {autoDetectionEnabled && (
          <span
            className='text-xs opacity-75 pl-2 ml-2 border-l whitespace-nowrap'
            style={{ minWidth: '85px' }}
          >
            %Ch: [{isMonitoring
              ? displayChangePercent.toFixed(1).padStart(3, ' ')
              : ' --'}]
          </span>
        )}
      </div>
    </div>
  );
};

export default PageHeaderControls; 