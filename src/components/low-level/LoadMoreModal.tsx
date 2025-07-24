'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, RefreshCw, Calendar } from 'lucide-react';
import type { LoadMoreModalProps } from '@/types/shared-data-management';

interface TimeBoundary {
  startDate: Date | null;
  endDate: Date | null;
}

interface LoadMoreModalExtendedProps extends LoadMoreModalProps {
  // Cache loading
  storageInfo?: { eventCount: number; totalSize: number } | null;
  autoLoadingComplete?: boolean;
  onLoadFromCache?: () => void;
  onLoadAll?: () => void;
  
  // Period loading
  timeBoundary?: TimeBoundary;
  onTimeBoundaryChange?: (boundary: TimeBoundary) => void;
  onLoadEventsForPeriod?: () => void;
  isLoadingPeriod?: boolean;
  
  // Customization
  chunkSize?: number;
  pageTitle?: string;
}

// Helper function to convert UTC Date to datetime-local format (displaying UTC time)
const dateToUTCString = (date: Date): string => {
  return date.toISOString().slice(0, 16);
};

// Helper function to interpret datetime-local input as UTC time
const dateStringToUTC = (dateString: string): Date => {
  // Treat the input as UTC by appending 'Z'
  return new Date(dateString + ':00.000Z');
};

export const LoadMoreModal: React.FC<LoadMoreModalExtendedProps> = ({
  isOpen,
  onClose,
  onLoadMore,
  totalAvailable,
  currentLoaded,
  loadAllProgress,
  
  // Extended props
  storageInfo,
  autoLoadingComplete = true,
  onLoadFromCache,
  onLoadAll,
  timeBoundary,
  onTimeBoundaryChange,
  onLoadEventsForPeriod,
  isLoadingPeriod = false,
  chunkSize = 1000,
  pageTitle = "Events"
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Load More {pageTitle}</DialogTitle>
          <DialogDescription>
            Choose how you want to load additional {pageTitle.toLowerCase()}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Load More from Cache Option */}
          {storageInfo && onLoadFromCache && storageInfo.eventCount > currentLoaded && autoLoadingComplete && (
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Load More from Cache</h3>
                  <p className="text-sm text-muted-foreground">
                    Load {Math.min(chunkSize, storageInfo.eventCount - currentLoaded)} more {pageTitle.toLowerCase()} from cached data (fast)
                  </p>
                </div>
                <Button 
                  variant="black-outline"
                  onClick={() => {
                    onLoadFromCache();
                    onClose();
                  }}
                >
                  Load {Math.min(chunkSize, storageInfo.eventCount - currentLoaded)} {pageTitle}
                </Button>
              </div>
            </Card>
          )}

          {/* Load All Option */}
          {totalAvailable && onLoadAll && currentLoaded < totalAvailable && autoLoadingComplete && (
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Load All {pageTitle}</h3>
                  <p className="text-sm text-muted-foreground">
                    Load all {(totalAvailable - currentLoaded).toLocaleString()} remaining {pageTitle.toLowerCase()} (may be slow)
                  </p>
                </div>
                <Button 
                  variant="black-outline"
                  onClick={() => {
                    onLoadAll();
                    onClose();
                  }}
                  disabled={!!loadAllProgress}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Load All ({(totalAvailable - currentLoaded).toLocaleString()})
                </Button>
              </div>
            </Card>
          )}

          {/* Load by Period Option */}
          {timeBoundary && onTimeBoundaryChange && onLoadEventsForPeriod && (
            <Card className="p-4">
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Load by Time Period</h3>
                  <p className="text-sm text-muted-foreground">
                    Load {pageTitle.toLowerCase()} from a specific time range (up to 10,000 {pageTitle.toLowerCase()}) - Times in UTC
                  </p>
                </div>
                
                {/* Simple date inputs since TimeBoundarySelector might not be available */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Start Date (UTC)</label>
                    <input 
                      type="datetime-local"
                      value={timeBoundary.startDate ? dateToUTCString(timeBoundary.startDate) : ''}
                      onChange={(e) => onTimeBoundaryChange({
                        ...timeBoundary,
                        startDate: e.target.value ? dateStringToUTC(e.target.value) : null
                      })}
                      className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">End Date (UTC)</label>
                    <input 
                      type="datetime-local"
                      value={timeBoundary.endDate ? dateToUTCString(timeBoundary.endDate) : ''}
                      onChange={(e) => onTimeBoundaryChange({
                        ...timeBoundary,
                        endDate: e.target.value ? dateStringToUTC(e.target.value) : null
                      })}
                      className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <Button 
                    variant="black-outline"
                    onClick={() => {
                      onLoadEventsForPeriod();
                      onClose();
                    }}
                    disabled={!timeBoundary.startDate || !timeBoundary.endDate || isLoadingPeriod}
                  >
                    {isLoadingPeriod ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                        Loading Period...
                      </>
                    ) : (
                      <>
                        <Calendar className="h-4 w-4 mr-1" />
                        Load for Period
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Simple Load More Option */}
          {!onLoadFromCache && !onLoadAll && (
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Load More {pageTitle}</h3>
                  <p className="text-sm text-muted-foreground">
                    Load {chunkSize} more {pageTitle.toLowerCase()}
                  </p>
                </div>
                <Button 
                  variant="black-outline"
                  onClick={() => {
                    onLoadMore(chunkSize.toString());
                    onClose();
                  }}
                >
                  Load {chunkSize} {pageTitle}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoadMoreModal; 