'use client';

import React from 'react';
import { FlattenedWorkflowAnalysis } from '@/types';
import { Card, CardContent } from '@/components/ui/card';

export interface V1AnalysisDisplayProps {
  analysis: FlattenedWorkflowAnalysis;
  format?: 'compact' | 'detailed' | 'card';
}

/**
 * V1 Schema Display Component - Shows traditional 8-field format
 */
export function V1AnalysisDisplay({ analysis, format = 'compact' }: V1AnalysisDisplayProps) {
  const fields = [
    { label: 'Workflow', value: analysis.workflow },
    { label: 'Step', value: analysis.step },
    { label: 'Description', value: analysis.description },
    { label: 'Facts', value: analysis.facts },
    { label: 'Logic', value: analysis.logic },
    { label: 'Tech', value: analysis.tech },
    { label: 'Apps', value: analysis.apps },
    { label: 'Context', value: analysis.context },
  ];

  const renderField = (label: string, value: string) => (
    <p key={label} className="text-xs">
      <strong>{label}:</strong> {value || 'Not available'}
    </p>
  );

  const content = (
    <div className="v1-analysis space-y-1">
      {format === 'compact' ? (
        // Compact view - show essential fields only
        <>
          {renderField('Workflow', analysis.workflow)}
          {renderField('Step', analysis.step)}
          {renderField('Description', analysis.description)}
          {renderField('Facts', analysis.facts)}
          {renderField('Logic', analysis.logic)}
          {renderField('Tech', analysis.tech)}
          {renderField('Apps', analysis.apps)}
          {renderField('Context', analysis.context)}
        </>
      ) : (
        // Detailed view - show all fields with better spacing
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2">
            {fields.map(field => renderField(field.label, field.value))}
          </div>
        </div>
      )}
    </div>
  );

  if (format === 'card') {
    return (
      <Card>
        <CardContent className="p-4">
          {content}
        </CardContent>
      </Card>
    );
  }

  return content;
} 