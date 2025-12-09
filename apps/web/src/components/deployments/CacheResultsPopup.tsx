'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle, XCircle, AlertTriangle, Database, Loader2 } from 'lucide-react';

interface CacheResult {
  cached: boolean;
  cache_hit_id?: number;
  status?: 'completed' | 'failed';
  quotes?: unknown[];
  execution_duration_seconds?: number;
  error_message?: string;
  formatted_output?: string;
  created_at?: string;
  quotes_found?: number;
  cache_source?: 'hash' | 'jsonb';
  query_time?: number;
}

interface CacheResultsPopupProps {
  cacheResult: CacheResult | null;
  isVisible: boolean;
  executionStatus: 'pending' | 'queued' | 'running' | 'completed' | 'failed';
  onClose: () => void;
}

export function CacheResultsPopup({ 
  cacheResult, 
  isVisible, 
  executionStatus,
  onClose 
}: CacheResultsPopupProps) {
  if (!isVisible || !cacheResult) return null;

  const getStatusIcon = () => {
    if (cacheResult.status === 'completed') {
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    } else if (cacheResult.status === 'failed') {
      return <XCircle className="w-4 h-4 text-red-600" />;
    }
    return <Database className="w-4 h-4 text-blue-600" />;
  };

  const getExecutionStatusIcon = () => {
    switch (executionStatus) {
      case 'pending':
      case 'queued':
        return <Clock className="w-4 h-4 text-orange-500" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="fixed top-4 right-4 z-50 w-80 animate-in slide-in-from-right duration-300">
      <Card className="border-black border-2 shadow-lg bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-600" />
              <CardTitle className="text-sm font-mono">CACHE RESULTS</CardTitle>
            </div>
            <button 
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-3">
          {/* Cache Hit Information */}
          {cacheResult.cached && (
            <div className="border-l-4 border-blue-500 pl-3">
              <div className="flex items-center gap-2 mb-2">
                {getStatusIcon()}
                <span className="text-sm font-semibold">
                  Cache Hit #{cacheResult.cache_hit_id}
                </span>
                <Badge variant="outline" className="text-xs">
                  {cacheResult.cache_source?.toUpperCase() || 'CACHED'}
                </Badge>
              </div>
              
              {/* Results Summary */}
              {cacheResult.status === 'completed' && (
                <div className="text-sm text-green-700 mb-2">
                  [SUCCESS] {cacheResult.quotes_found || 0} quotes found
                  {cacheResult.execution_duration_seconds && (
                    <span className="text-gray-500 ml-2">
                      (in {formatDuration(cacheResult.execution_duration_seconds)})
                    </span>
                  )}
                </div>
              )}
              
              {cacheResult.status === 'failed' && (
                <div className="text-sm text-red-700 mb-2">
                  [ERROR] Execution failed
                  {cacheResult.error_message && (
                    <div className="text-xs text-red-600 mt-1 font-mono">
                      {cacheResult.error_message}
                    </div>
                  )}
                </div>
              )}
              
              <div className="text-xs text-gray-500">
                Cached on {cacheResult.created_at ? new Date(cacheResult.created_at).toLocaleString() : 'Unknown'}
                {cacheResult.query_time && (
                  <span className="ml-2">• Retrieved in {cacheResult.query_time}ms</span>
                )}
              </div>
            </div>
          )}
          
          {/* Current Execution Status */}
          <div className="border-t pt-3">
            <div className="flex items-center gap-2 mb-2">
              {getExecutionStatusIcon()}
              <span className="text-sm font-semibold">Live Execution</span>
              <Badge variant="outline" className="text-xs">
                {executionStatus.toUpperCase()}
              </Badge>
            </div>
            
            <div className="text-xs text-gray-600">
              {executionStatus === 'pending' && 'Preparing to queue execution...'}
              {executionStatus === 'queued' && 'Execution queued, waiting to start...'}
              {executionStatus === 'running' && 'Execution in progress...'}
              {executionStatus === 'completed' && 'Live execution completed!'}
              {executionStatus === 'failed' && 'Live execution failed.'}
            </div>
          </div>
          
          {/* Info Message */}
          <div className="bg-blue-50 border border-blue-200 rounded p-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-800">
                <p className="font-semibold mb-1">Cache vs Live Results</p>
                <p>
                  Cache shows previous results instantly. Live execution provides 
                  fresh data and will replace this when complete.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 