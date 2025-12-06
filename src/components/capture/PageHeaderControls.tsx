import { Button } from '@/components/ui/button';
import { SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { AlertTriangle, ExternalLink, PictureInPicture, RefreshCw, Zap, Wand2 } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import type { PageHeaderControlsProps } from '../../types';
import { CustomOrgSwitcher } from '@/components/navigation/CustomOrgSwitcher';
import { toast } from 'sonner';

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
  autoDetectionEnabled: _autoDetectionEnabled,
  isMonitoring: _isMonitoring,
  displayChangePercent: _displayChangePercent,
  activeAnalysesCount: _activeAnalysesCount,
  error,
  streamRef,
  MAX_PARALLEL_ANALYSES: _MAX_PARALLEL_ANALYSES,
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
  const [isInIframe, setIsInIframe] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (window.documentPictureInPicture) {
      setIsPipSupported(true);
    }
    // Check if running in iframe (must be done client-side)
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      // If we can't access window.top due to cross-origin, we're in an iframe
      setIsInIframe(true);
    }
    // Check if on mobile device
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const mobileKeywords = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(mobileKeywords.test(userAgent) || isSmallScreen);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleStartClick = () => {
    if (isMobile) {
      toast('Desktop Required', {
        description: 'Screen sharing is only available on desktop browsers. Please open this page on a computer to start recording.',
        duration: 5000,
      });
      return;
    }
    handleStartScreenShare();
  };

  return (
    <div className="w-full sticky top-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-between mt-4 p-3 border rounded-lg shadow-sm gap-3">
      {/* Status indicator - hidden on mobile since training won't work anyway */}
      <div className="hidden sm:flex items-center gap-4 text-sm font-mono w-full sm:w-auto">
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

      {/* Mobile: simplified layout */}
      <div className="flex sm:hidden flex-col w-full gap-2">
        {!stream ? (
          <Button onClick={handleStartClick} variant="outline" className="w-full">
            <Zap className="mr-2 h-4 w-4" /> Start Recording
          </Button>
        ) : (
          <Button onClick={handleStopScreenShare} variant="outline" className="w-full border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
            Stop Recording
          </Button>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="outline" className="flex-1">
            <Link href="https://mediar.ai/turnkey" target="_blank" rel="noopener noreferrer">
              <Wand2 className="mr-2 h-4 w-4" /> Get Automation
            </Link>
          </Button>
          <SignedIn>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8"
                }
              }}
            />
          </SignedIn>
          <SignedOut>
            <Button asChild size="sm">
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </SignedOut>
        </div>
      </div>

      {/* Desktop: full layout */}
      <div className="hidden sm:flex items-center justify-end gap-2">
        {!stream ? (
          <Button onClick={handleStartClick} variant="outline">
            <Zap className="mr-2 h-4 w-4" /> Start Recording
          </Button>
        ) : (
          <Button onClick={handleStopScreenShare} variant="outline" className="border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
            Stop Recording
          </Button>
        )}
        {isInIframe ? (
          <Button
            onClick={() => window.open('https://app.mediar.ai/web', '_blank')}
            variant="outline"
            size="icon"
            aria-label="Open in new window"
            title="Open in new window for full features"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={onTogglePip} variant="outline" size="icon" aria-label="Toggle Picture-in-Picture" disabled={!isPipSupported}>
            <PictureInPicture className="h-4 w-4" />
          </Button>
        )}
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
          {isInIframe ? (
            <Button
              onClick={() => {
                // Send message to parent window to redirect to app
                console.log('Sending postMessage to parent for sign-in redirect');
                window.parent.postMessage(
                  { type: 'mediar-redirect', action: 'sign-in' },
                  '*'
                );
              }}
            >
              Sign In
            </Button>
          ) : (
            <Button asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
          )}
        </SignedOut>
      </div>
    </div>
  );
};

export default PageHeaderControls; 