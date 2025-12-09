'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, ChevronUp, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { LabelingStorageInfo } from '@/types/shared-data-management';

// Helper function to format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

interface StorageInfoPanelProps {
  storageInfo: LabelingStorageInfo;
  isOpen: boolean;
  onToggle: () => void;
  dataType?: 'unified' | 'events' | 'analyses' | 'annotations';
}

export function StorageInfoPanel({ 
  storageInfo, 
  isOpen, 
  onToggle, 
  dataType = 'unified' 
}: StorageInfoPanelProps) {
  const getUsageColor = (percentage: number) => {
    if (percentage > 90) return 'bg-red-500';
    if (percentage > 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <Card className="mb-2">
      <CardHeader className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer" onClick={onToggle}>
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4" />
          IndexedDB Storage ({dataType})
        </CardTitle>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </CardHeader>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <CardContent className="p-2 space-y-2">
              {dataType === 'unified' ? (
                // Multi-tier storage display for labeling
                <div className="space-y-3">
                  {/* Events Storage Tier */}
                  <div className="p-2 border rounded">
                    <h4 className="text-xs font-semibold mb-2">Raw Events Cache</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-600">Events:</span> {storageInfo.eventCount.toLocaleString()}
                      </div>
                      <div>
                        <span className="text-gray-600">Size:</span> {formatBytes(storageInfo.eventsSize)}
                      </div>
                    </div>
                    <div className="mt-1">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Usage</span>
                        <span>{storageInfo.eventsUsagePercentage.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1">
                        <div 
                          className={`h-1 rounded-full ${getUsageColor(storageInfo.eventsUsagePercentage)}`} 
                          style={{ width: `${Math.min(storageInfo.eventsUsagePercentage, 100)}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Analyses Storage Tier */}
                  <div className="p-2 border rounded">
                    <h4 className="text-xs font-semibold mb-2">Workflow Analyses</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-600">Analyses:</span> {storageInfo.analysisCount.toLocaleString()}
                      </div>
                      <div>
                        <span className="text-gray-600">Size:</span> {formatBytes(storageInfo.analysesSize)}
                      </div>
                    </div>
                    <div className="mt-1">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Usage</span>
                        <span>{storageInfo.analysesUsagePercentage.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1">
                        <div 
                          className={`h-1 rounded-full ${getUsageColor(storageInfo.analysesUsagePercentage)}`} 
                          style={{ width: `${Math.min(storageInfo.analysesUsagePercentage, 100)}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Annotations Storage Tier */}
                  <div className="p-2 border rounded">
                    <h4 className="text-xs font-semibold mb-2">Annotations & Feedback</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-600">Entries:</span> {storageInfo.annotationCount.toLocaleString()}
                      </div>
                      <div>
                        <span className="text-gray-600">Size:</span> {formatBytes(storageInfo.annotationsSize)}
                      </div>
                    </div>
                    <div className="mt-1">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Usage</span>
                        <span>{storageInfo.annotationsUsagePercentage.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1">
                        <div 
                          className={`h-1 rounded-full ${getUsageColor(storageInfo.annotationsUsagePercentage)}`} 
                          style={{ width: `${Math.min(storageInfo.annotationsUsagePercentage, 100)}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Total Usage Summary */}
                  <div className="pt-2 border-t">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-gray-600">Total Size:</div>
                        <div className="font-medium">{formatBytes(storageInfo.totalSize)}</div>
                      </div>
                      <div>
                        <div className="text-gray-600">Storage Limit:</div>
                        <div className="font-medium">{formatBytes(storageInfo.maxSize)}</div>
                      </div>
                    </div>
                    
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Total Storage Usage</span>
                        <span>{storageInfo.usagePercentage.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${getUsageColor(storageInfo.usagePercentage)}`}
                          style={{ width: `${Math.min(storageInfo.usagePercentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-3 pt-2 border-t border-gray-200">
                    <p className="text-xs text-gray-600">
                      Data is automatically cached for offline access. 
                      Oldest items are removed when storage reaches 90% capacity.
                      Last updated: {storageInfo.lastUpdated.toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                // Single-tier storage display (fallback to simple format)
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-gray-600">Stored Items:</div>
                    <div className="font-medium">
                      {dataType === 'events' ? storageInfo.eventCount.toLocaleString() :
                       dataType === 'analyses' ? storageInfo.analysisCount.toLocaleString() :
                       storageInfo.annotationCount.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-600">Storage Used:</div>
                    <div className="font-medium">
                      {dataType === 'events' ? formatBytes(storageInfo.eventsSize) :
                       dataType === 'analyses' ? formatBytes(storageInfo.analysesSize) :
                       formatBytes(storageInfo.annotationsSize)}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
} 