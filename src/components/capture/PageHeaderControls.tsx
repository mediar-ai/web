import { Button } from '@/components/ui/button';
import { SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { AlertTriangle, PictureInPicture, RefreshCw, RotateCcw, Zap } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import type { PageHeaderControlsProps } from '../../types';
import { CustomOrgSwitcher } from '@/components/navigation/CustomOrgSwitcher';

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

const ConditionalOrganizationSwitcher: React.FC = () => {
  return <CustomOrgSwitcher />;
};

const PageHeaderControls: React.FC<PageHeaderControlsProps> = ({
  stream,
  handleStartScreenShare,
  handleStopScreenShare,
  onTogglePip,
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
    <div className="w-full sticky top-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between mt-4 p-3 border rounded-lg shadow-sm gap-4">
      <div className="flex items-center gap-4 text-sm font-mono w-full sm:w-auto">
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

      <div className="flex items-center justify-end gap-2 mt-2 sm:mt-0">
        {!stream ? (
          <Button onClick={handleStartScreenShare}>
            <Zap className="mr-2 h-4 w-4" /> Start Training
          </Button>
        ) : (
          <Button onClick={handleStopScreenShare} variant="destructive">
            Stop Training
          </Button>
        )}
        <Button onClick={onTogglePip} variant="outline" size="icon" aria-label="Toggle Picture-in-Picture" disabled={!isPipSupported}>
          <PictureInPicture className="h-4 w-4" />
        </Button>
        <SignedIn>
          <ConditionalOrganizationSwitcher />
          <UserButton 
            appearance={{
              elements: {
                avatarBox: "w-8 h-8"
              }
            }}
          />
        </SignedIn>
        <SignedOut>
          <Button asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        </SignedOut>
      </div>
    </div>
  );
};

export default PageHeaderControls; 