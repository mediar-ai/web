"use client";

import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';

interface TimelineAnnotation {
  // Common fields
  analysis_id: number;
  is_workflow_related: boolean;
  unrelated_reason: string | null;
  confidence_score: number | null;
  model_used: string | null;
  created_at: string;
  
  // Old system fields (legacy)
  id?: number;
  workflow_id?: number | null;
  workflow_title?: string | null;
  workflow_type_name?: string | null;
  workflow_instance_name?: string | null;
  business_logic?: string[] | null;
  updated_at?: string;
  
  // New raw events system fields
  raw_event_id?: number;
  user_id?: string;
  workflow_template_id?: number | null;
  workflow_type_id?: number | null;
  workflow_instance_id?: number | null;
  workflow_step_id?: number | null;
  workflow_substep_id?: number | null;
  // Human-readable names
  template_name?: string;
  type_name?: string;
  instance_name?: string;
  step_name?: string;
  substep_name?: string;
  event_type?: string;
  // Analysis information
  step_title?: string;
  user_intent?: string;
  step_summary?: string;
  window_title?: string;
  inputs?: string | string[] | null;
  outputs?: string | string[] | null;
  business_logics?: string | null;
  event_payload?: Record<string, unknown>;
  event_created_at?: string;
}

interface TimelineAnnotationsTableProps {
  annotations: TimelineAnnotation[];
}

export function TimelineAnnotationsTable({ annotations }: TimelineAnnotationsTableProps) {
  const [filterText, setFilterText] = useState('');

  // Filter annotations based on search text across all fields
  const filteredAnnotations = useMemo(() => {
    if (!filterText.trim()) return annotations;
    
    const searchLower = filterText.toLowerCase();
    return annotations.filter(annotation => {
      const searchableFields = [
        annotation.analysis_id?.toString(),
        annotation.workflow_title,
        annotation.workflow_type_name,
        annotation.workflow_instance_name,
        annotation.step_name,
        annotation.substep_name,
        annotation.unrelated_reason,
        annotation.model_used,
        ...(annotation.inputs || []),
        ...(annotation.outputs || []),
        ...(annotation.business_logic || []),
      ].filter(Boolean);

      return searchableFields.some(field => 
        field?.toString().toLowerCase().includes(searchLower)
      );
    });
  }, [annotations, filterText]);

  const relatedCount = filteredAnnotations.filter(a => a.is_workflow_related).length;
  const unrelatedCount = filteredAnnotations.filter(a => !a.is_workflow_related).length;

  return (
    <div className="w-full space-y-4">
      {/* Filter and Summary */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Filter all fields..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Total: {filteredAnnotations.length}</span>
          <Badge variant="secondary">{relatedCount} Related</Badge>
          <Badge variant="outline">{unrelatedCount} Unrelated</Badge>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg w-full overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto w-full">
          <Table className="w-full table-fixed">
            <TableHeader className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <TableRow>
                <TableHead className="w-24">Timestamp</TableHead>
                <TableHead className="w-16">Type</TableHead>
                <TableHead className="w-36">Analysis</TableHead>
                <TableHead className="w-16">Status</TableHead>
                <TableHead className="w-12">Conf</TableHead>
                <TableHead className="w-28">Template</TableHead>
                <TableHead className="w-28">Workflow Type</TableHead>
                <TableHead className="w-28">Instance</TableHead>
                <TableHead className="w-28">Step</TableHead>
                <TableHead className="w-20">Substep</TableHead>
                <TableHead className="w-28">Inputs</TableHead>
                <TableHead className="w-28">Outputs</TableHead>
                <TableHead className="w-32">Business Logic</TableHead>
                <TableHead className="w-32">Unrelated Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAnnotations.map((annotation) => (
                <TableRow key={`${annotation.raw_event_id || annotation.analysis_id}-${annotation.analysis_id}`} className="hover:bg-muted/50">
                  <TableCell className="text-xs p-2 font-mono" title={annotation.event_created_at || undefined}>
                    {annotation.event_created_at ? 
                      new Date(annotation.event_created_at).toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      }) :
                      '-'
                    }
                  </TableCell>
                  
                  <TableCell className="text-xs p-2">
                    <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      {(annotation.event_type || 'unknown').replace('ui_', '')}
                    </span>
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate" title={annotation.step_summary || annotation.user_intent || undefined}>
                    {annotation.step_title ? 
                      annotation.step_title.substring(0, 35) + (annotation.step_title.length > 35 ? '...' : '') :
                      `Analysis ${annotation.analysis_id}`
                    }
                  </TableCell>
                  
                  <TableCell className="p-2">
                    <Badge 
                      variant={annotation.is_workflow_related ? "default" : "secondary"}
                      className="text-xs px-1 py-0.5"
                    >
                      {annotation.is_workflow_related ? "✓" : "✗"}
                    </Badge>
                  </TableCell>
                  
                  <TableCell className="text-xs p-2">
                    {annotation.confidence_score !== null && (
                      <span className="text-xs">
                        {(annotation.confidence_score * 100).toFixed(0)}%
                      </span>
                    )}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate" title={annotation.template_name || undefined}>
                    {annotation.template_name ? annotation.template_name.substring(0, 25) + (annotation.template_name.length > 25 ? '...' : '') : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate" title={annotation.type_name || undefined}>
                    {annotation.type_name ? annotation.type_name.substring(0, 25) + (annotation.type_name.length > 25 ? '...' : '') : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate" title={annotation.instance_name || undefined}>
                    {annotation.instance_name ? annotation.instance_name.substring(0, 25) + (annotation.instance_name.length > 25 ? '...' : '') : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate" title={annotation.step_name || undefined}>
                    {annotation.step_name ? annotation.step_name.substring(0, 25) + (annotation.step_name.length > 25 ? '...' : '') : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate" title={annotation.substep_name || undefined}>
                    {annotation.substep_name ? annotation.substep_name.substring(0, 20) + (annotation.substep_name.length > 20 ? '...' : '') : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate">
                    {annotation.inputs ? (
                      <div className="text-xs" title={typeof annotation.inputs === 'string' ? annotation.inputs : Array.isArray(annotation.inputs) ? annotation.inputs.join(', ') : ''}>
                        {typeof annotation.inputs === 'string' ? 
                          annotation.inputs.substring(0, 30) + (annotation.inputs.length > 30 ? '...' : '') :
                          Array.isArray(annotation.inputs) && annotation.inputs.length > 0 ? 
                            `${annotation.inputs[0].substring(0, 25)}${annotation.inputs[0].length > 25 ? '...' : ''}${annotation.inputs.length > 1 ? ` +${annotation.inputs.length - 1}` : ''}` :
                            '-'
                        }
                      </div>
                    ) : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate">
                    {annotation.outputs ? (
                      <div className="text-xs" title={typeof annotation.outputs === 'string' ? annotation.outputs : Array.isArray(annotation.outputs) ? annotation.outputs.join(', ') : ''}>
                        {typeof annotation.outputs === 'string' ? 
                          annotation.outputs.substring(0, 30) + (annotation.outputs.length > 30 ? '...' : '') :
                          Array.isArray(annotation.outputs) && annotation.outputs.length > 0 ? 
                            `${annotation.outputs[0].substring(0, 25)}${annotation.outputs[0].length > 25 ? '...' : ''}${annotation.outputs.length > 1 ? ` +${annotation.outputs.length - 1}` : ''}` :
                            '-'
                        }
                      </div>
                    ) : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate">
                    {(annotation.business_logics || annotation.business_logic) ? (
                      <div className="text-xs" title={(annotation.business_logics || annotation.business_logic) as string}>
                        {typeof (annotation.business_logics || annotation.business_logic) === 'string' ? 
                          ((annotation.business_logics || annotation.business_logic) as string).substring(0, 35) + 
                          (((annotation.business_logics || annotation.business_logic) as string).length > 35 ? '...' : '') :
                          Array.isArray(annotation.business_logic) && annotation.business_logic.length > 0 ? 
                            `${annotation.business_logic[0].substring(0, 30)}${annotation.business_logic[0].length > 30 ? '...' : ''}${annotation.business_logic.length > 1 ? ` +${annotation.business_logic.length - 1}` : ''}` :
                            '-'
                        }
                      </div>
                    ) : '-'}
                  </TableCell>
                  
                  <TableCell className="text-xs p-2 truncate">
                    {annotation.unrelated_reason ? (
                      <div className="text-xs" title={annotation.unrelated_reason}>
                        {annotation.unrelated_reason.substring(0, 35) + (annotation.unrelated_reason.length > 35 ? '...' : '')}
                      </div>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {filteredAnnotations.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            {filterText ? 'No annotations match your filter.' : 'No timeline annotations available.'}
          </div>
        )}
      </div>
    </div>
  );
} 