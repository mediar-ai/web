'use client';

import React from 'react';
import { FlattenedWorkflowAnalysis } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDisplayableFields } from '@/lib/workflowAnalysisHelpers';

export interface V2AnalysisDisplayProps {
  analysis: FlattenedWorkflowAnalysis;
  format?: 'compact' | 'detailed' | 'card';
}

/**
 * V2 Schema Display Component - Shows new action-focused 8-field format
 */
export function V2AnalysisDisplay({ analysis, format = 'compact' }: V2AnalysisDisplayProps) {
  const fields = getDisplayableFields(analysis);

  const renderField = (label: string, value: string, className?: string) => (
    <div key={label} className={`${className || ''}`}>
      <p className="text-xs">
        <strong className="text-muted-foreground">{label}:</strong>{' '}
        <span className="text-foreground">{value || 'Not available'}</span>
      </p>
    </div>
  );

  const renderCompactView = () => (
    <div className="v2-analysis space-y-1">
      {renderField('Title', fields.title)}
      {renderField('Summary', fields.summary)}
      {renderField('Actions', fields.actions)}
      {renderField('Changes', fields.changes)}
      {renderField('Results', fields.results)}
      {renderField('Clicked', fields.clicked)}
      {renderField('Typed', fields.typed)}
      {renderField('Intent', fields.intent)}
    </div>
  );

  const renderDetailedView = () => (
    <div className="v2-analysis space-y-3">
      {/* Core Action Info */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-primary">Step Overview</h4>
        {renderField('Title', fields.title)}
        {renderField('Summary', fields.summary)}
        {renderField('User Intent', fields.intent)}
      </div>

      {/* What Happened */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-primary">Actions Taken</h4>
        {renderField('Events', fields.actions)}
        {renderField('Clicked Elements', fields.clicked)}
        {renderField('Text Typed', fields.typed)}
      </div>

      {/* Results */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-primary">Outcomes</h4>
        {renderField('Content Changes', fields.changes)}
        {renderField('Results', fields.results)}
      </div>
    </div>
  );

  const content = format === 'compact' ? renderCompactView() : renderDetailedView();

  if (format === 'card') {
    return (
      <Card className="v2-analysis-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {fields.title}
          </CardTitle>
          {fields.intent !== 'No intent identified' && (
            <p className="text-sm text-muted-foreground italic">
              Intent: {fields.intent}
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div>
              <p className="text-sm"><strong>Summary:</strong> {fields.summary}</p>
            </div>
            
            {fields.actions !== 'No actions recorded' && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Actions Taken:</p>
                <p className="text-xs">{fields.actions}</p>
              </div>
            )}

            {fields.changes !== 'No changes recorded' && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Changes:</p>
                <p className="text-xs">{fields.changes}</p>
              </div>
            )}

            {fields.results !== 'No results recorded' && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Results:</p>
                <p className="text-xs">{fields.results}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return content;
} 