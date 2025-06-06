import React from 'react';
import { Button } from '@/components/ui/button';
import type { PageHeaderControlsProps } from '../../types';
import { Play, StopCircle, AlertTriangle, RotateCcw, Zap, RefreshCw } from 'lucide-react';

const PageHeaderControls: React.FC<PageHeaderControlsProps> = ({
  stream,
  handleStartScreenShare,
  handleStopScreenShare,
  mainStatus,
  autoDetectionEnabled,
  isMonitoring,
  displayChangePercent,
  activeAnalysesCount,
  error,
  streamRef,
  MAX_PARALLEL_ANALYSES,
  reconnectRequired,
}) => {
  return (
    <div className='w-full flex flex-col sm:flex-row justify-between items-center mb-1 py-2'>
      <div className='flex items-center gap-2 mb-2 sm:mb-0'>
        {reconnectRequired ? (
            <Button onClick={handleStartScreenShare} className='bg-yellow-500 hover:bg-yellow-600 text-white'>
                <RefreshCw className='mr-2 h-4 w-4' /> Reconnect
            </Button>
        ) : !streamRef.current ? (
          <Button onClick={handleStartScreenShare} className='bg-green-600 hover:bg-green-700 text-white'>
            <Play className='mr-2 h-4 w-4' /> Start Capture
          </Button>
        ) : (
          <Button onClick={handleStopScreenShare} variant='destructive'>
            <StopCircle className='mr-2 h-4 w-4' /> Stop Capture
          </Button>
        )}
      </div>

      <div className='flex flex-col sm:flex-row items-center gap-2 text-xs'>
        <div className={`transition-all duration-300 ease-in-out text-center min-w-[180px] py-1.5 px-2 ${error ? 'bg-red-600 text-white rounded' : (stream && mainStatus.startsWith('Recording') ? 'bg-blue-500 text-white rounded' : 'text-gray-600 dark:text-gray-300')}`}>
          {error ? <><AlertTriangle className='inline mr-1 h-3 w-3' /> {mainStatus}</> : mainStatus}
        </div>
        {stream && autoDetectionEnabled && isMonitoring && (
          <div className="tabular-nums px-2 py-1 min-w-[100px] text-center border rounded">
            <RotateCcw className="animate-spin mr-1.5 h-3 w-3" style={{ animationDuration: '2s' }} />
            {displayChangePercent.toFixed(1)}%
          </div>
        )}
        {stream && (
           <div className="px-2 py-1 min-w-[100px] text-center border rounded">
            <Zap className='mr-1.5 h-3 w-3' /> 
            Analyses: {activeAnalysesCount}/{MAX_PARALLEL_ANALYSES}
          </div>
        )}
      </div>
    </div>
  );
};

export default PageHeaderControls; 