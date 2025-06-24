'use client';

import React from 'react';
import { FlattenedWorkflowAnalysis } from '@/types';
import { hasV2Fields } from '@/lib/workflowAnalysisHelpers';
import { V1AnalysisDisplay } from './V1AnalysisDisplay';
import { V2AnalysisDisplay } from './V2AnalysisDisplay';
import { Badge } from '@/components/ui/badge';

export interface AnalysisDisplayProps {
  analysis: FlattenedWorkflowAnalysis;
  format?: 'compact' | 'detailed' | 'card';
  showMetadata?: boolean;
  className?: string;
}

/**
 * Smart AnalysisDisplay component that automatically detects schema version
 * and renders the appropriate V1 or V2 display component
 */
export function AnalysisDisplay({ 
  analysis, 
  format = 'compact', 
  showMetadata = false,
  className = ''
}: AnalysisDisplayProps) {
  const isV2 = hasV2Fields(analysis);
  const schemaVersion = analysis.schema_version || (isV2 ? 'v2' : 'v1');

  return (
    <div className={`analysis-display ${className}`}>
      {showMetadata && (
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={isV2 ? 'default' : 'secondary'}>
            Schema {schemaVersion.toUpperCase()}
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
      
      {isV2 ? (
        <V2AnalysisDisplay analysis={analysis} format={format} />
      ) : (
        <V1AnalysisDisplay analysis={analysis} format={format} />
      )}
    </div>
  );
} 