import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { PageHeaderControlsProps } from '../../types';
import { AlertTriangle, RotateCcw, Zap, RefreshCw } from 'lucide-react';

interface StatusIndicatorProps {
  mainStatus: string;
  autoDetectionEnabled: boolean;
  isMonitoring: boolean;
  displayChangePercent: number;
  activeAnalysesCount: number;
  error: string | null;
  streamRef: React.RefObject<MediaStream | null>;
  MAX_PARALLEL_ANALYSES: number;
  reconnectRequired: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
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
  if (reconnectRequired) {
    return (
      <div className='bg-yellow-500 text-white rounded py-1.5 px-2 text-xs flex items-center'>
        <RefreshCw className='mr-2 h-4 w-4' /> Reconnect needed
      </div>
    );
  }

  return (
    <div className='flex items-center gap-2 text-xs'>
      <div className={`transition-all duration-300 ease-in-out text-center min-w-[180px] py-1.5 px-2 ${error ? 'bg-red-600 text-white rounded' : (streamRef.current && mainStatus.startsWith('Recording') ? 'bg-blue-500 text-white rounded' : 'text-gray-600 dark:text-gray-300')}`}>
        {error ? <><AlertTriangle className='inline mr-1 h-3 w-3' /> {mainStatus}</> : mainStatus}
      </div>
      {streamRef.current && autoDetectionEnabled && isMonitoring && (
        <div className="tabular-nums px-2 py-1 min-w-[100px] text-center border rounded">
          <RotateCcw className="animate-spin mr-1.5 h-3 w-3" style={{ animationDuration: '2s' }} />
          {displayChangePercent.toFixed(1)}%
        </div>
      )}
      {streamRef.current && (
         <div className="px-2 py-1 min-w-[100px] text-center border rounded">
          <Zap className='mr-1.5 h-3 w-3' /> 
          Analyses: {activeAnalysesCount}/{MAX_PARALLEL_ANALYSES}
        </div>
      )}
    </div>
  );
};


const PageHeaderControls: React.FC<PageHeaderControlsProps> = ({
  stream,
  handleStartScreenShare,
  handleStopScreenShare,
  onTogglePip,
  isPipOpen,
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
    const [isPipSupported, setIsPipSupported] = useState(false);

    useEffect(() => {
        if (window.documentPictureInPicture) {
            setIsPipSupported(true);
        }
    }, []);

    return (
      <div className='w-full flex flex-col sm:flex-row justify-between items-center mb-1 py-2'>
        <div className="flex items-center gap-2">
          <StatusIndicator
            mainStatus={mainStatus}
            autoDetectionEnabled={autoDetectionEnabled}
            isMonitoring={isMonitoring}
            displayChangePercent={displayChangePercent}
            activeAnalysesCount={activeAnalysesCount}
            error={error}
            streamRef={streamRef}
            MAX_PARALLEL_ANALYSES={MAX_PARALLEL_ANALYSES}
            reconnectRequired={reconnectRequired}
          />
        </div>

        <div className="flex items-center gap-2 mt-2 sm:mt-0">
          <Button onClick={onTogglePip} variant="outline" size="sm" disabled={!isPipSupported}>
            {isPipOpen ? 'Close PiP' : 'Open PiP'}
          </Button>

          {!stream && (
            <Button onClick={handleStartScreenShare} size="sm">
              Start Capture
            </Button>
          )}

          {stream && (
            <Button onClick={handleStopScreenShare} variant="destructive" size="sm">
              Stop Capture
            </Button>
          )}
        </div>
      </div>
    )
};

export default PageHeaderControls; 