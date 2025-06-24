'use client';

import React from 'react';
import { FlattenedWorkflowAnalysis } from '@/types';
import { V2AnalysisDisplay } from './V2AnalysisDisplay';
import { Badge } from '@/components/ui/badge';

export interface AnalysisDisplayProps {
  analysis: FlattenedWorkflowAnalysis;
  format?: 'compact' | 'detailed' | 'card';
  showMetadata?: boolean;
  className?: string;
}

/**
 * Renders the V2 analysis display.
 * The logic for switching between V1 and V2 has been removed as V1 is obsolete.
 */
export function AnalysisDisplay({ 
  analysis, 
  format = 'compact', 
  showMetadata = false,
  className = ''
}: AnalysisDisplayProps) {
  // We now always render the V2 display. The isV2 check is no longer needed.
  return (
    <div className={`analysis-display ${className}`}>
      {showMetadata && (
        <div className="flex items-center gap-2 mb-2">
          <Badge variant='default'>
            Schema V2
          </Badge>
          {analysis.raw_llm_output?.model_used && (
            <Badge variant="outline" className="text-xs">
              {analysis.raw_llm_output.model_used}
            </Badge>
          )}
          {analysis.raw_llm_output?.generation_timestamp && (
            <span className="text-xs text-muted-foreground">
              {new Date(analysis.raw_llm_output.generation_timestamp).toLocaleString()}
            </span>
          )}
        </div>
      )}
      
        <V2AnalysisDisplay analysis={analysis} format={format} />
    </div>
  );
} 