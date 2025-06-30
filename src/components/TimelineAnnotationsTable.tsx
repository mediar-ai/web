"use client";

import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';

interface TimelineAnnotation {
  id: number;
  analysis_id: number;
  is_workflow_related: boolean;
  workflow_id: number | null;
  workflow_title: string | null;
  workflow_type_name: string | null;
  workflow_instance_name: string | null;
  step_name: string | null;
  substep_name: string | null;
  inputs: string[] | null;
  outputs: string[] | null;
  business_logic: string[] | null;
  unrelated_reason: string | null;
  confidence_score: number | null;
  model_used: string | null;
  created_at: string;
  updated_at: string;
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
      <div className="border rounded-lg">
        <div className="max-h-[600px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <TableRow>
                <TableHead className="w-24 min-w-[80px] resize-x">Analysis ID</TableHead>
                <TableHead className="w-20 min-w-[70px] resize-x">Status</TableHead>
                <TableHead className="w-32 min-w-[120px] resize-x">Confidence</TableHead>
                <TableHead className="w-40 min-w-[160px] resize-x">Workflow</TableHead>
                <TableHead className="w-32 min-w-[120px] resize-x">Type</TableHead>
                <TableHead className="w-40 min-w-[160px] resize-x">Instance</TableHead>
                <TableHead className="w-32 min-w-[120px] resize-x">Step</TableHead>
                <TableHead className="w-32 min-w-[120px] resize-x">Substep</TableHead>
                <TableHead className="w-40 min-w-[160px] resize-x">Inputs</TableHead>
                <TableHead className="w-40 min-w-[160px] resize-x">Outputs</TableHead>
                <TableHead className="w-40 min-w-[160px] resize-x">Business Logic</TableHead>
                <TableHead className="w-60 min-w-[240px] resize-x">Unrelated Reason</TableHead>
                <TableHead className="w-20 min-w-[80px] resize-x">Model</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAnnotations.map((annotation) => (
                <TableRow key={annotation.id} className="hover:bg-muted/50">
                  <TableCell className="font-mono text-xs">
                    {annotation.analysis_id}
                  </TableCell>
                  
                  <TableCell>
                    <Badge 
                      variant={annotation.is_workflow_related ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {annotation.is_workflow_related ? "Related" : "Unrelated"}
                    </Badge>
                  </TableCell>
                  
                  <TableCell>
                    {annotation.confidence_score !== null && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {(annotation.confidence_score * 100).toFixed(0)}%
                        </span>
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all"
                            style={{ width: `${annotation.confidence_score * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </TableCell>
                  
                  <TableCell className="max-w-[160px] truncate" title={annotation.workflow_title || undefined}>
                    {annotation.workflow_title}
                  </TableCell>
                  
                  <TableCell className="max-w-[120px] truncate" title={annotation.workflow_type_name || undefined}>
                    {annotation.workflow_type_name}
                  </TableCell>
                  
                  <TableCell className="max-w-[160px] truncate" title={annotation.workflow_instance_name || undefined}>
                    {annotation.workflow_instance_name}
                  </TableCell>
                  
                  <TableCell className="max-w-[120px] truncate" title={annotation.step_name || undefined}>
                    {annotation.step_name}
                  </TableCell>
                  
                  <TableCell className="max-w-[120px] truncate" title={annotation.substep_name || undefined}>
                    {annotation.substep_name}
                  </TableCell>
                  
                  <TableCell className="max-w-[160px]">
                    {annotation.inputs && annotation.inputs.length > 0 && (
                      <div className="space-y-1">
                        {annotation.inputs.slice(0, 2).map((input, idx) => (
                          <div key={idx} className="text-xs bg-blue-50 px-2 py-1 rounded truncate" title={input}>
                            {input}
                          </div>
                        ))}
                        {annotation.inputs.length > 2 && (
                          <div className="text-xs text-muted-foreground">
                            +{annotation.inputs.length - 2} more
                          </div>
                        )}
                      </div>
                    )}
                  </TableCell>
                  
                  <TableCell className="max-w-[160px]">
                    {annotation.outputs && annotation.outputs.length > 0 && (
                      <div className="space-y-1">
                        {annotation.outputs.slice(0, 2).map((output, idx) => (
                          <div key={idx} className="text-xs bg-green-50 px-2 py-1 rounded truncate" title={output}>
                            {output}
                          </div>
                        ))}
                        {annotation.outputs.length > 2 && (
                          <div className="text-xs text-muted-foreground">
                            +{annotation.outputs.length - 2} more
                          </div>
                        )}
                      </div>
                    )}
                  </TableCell>
                  
                  <TableCell className="max-w-[160px]">
                    {annotation.business_logic && annotation.business_logic.length > 0 && (
                      <div className="space-y-1">
                        {annotation.business_logic.slice(0, 2).map((logic, idx) => (
                          <div key={idx} className="text-xs bg-purple-50 px-2 py-1 rounded truncate" title={logic}>
                            {logic}
                          </div>
                        ))}
                        {annotation.business_logic.length > 2 && (
                          <div className="text-xs text-muted-foreground">
                            +{annotation.business_logic.length - 2} more
                          </div>
                        )}
                      </div>
                    )}
                  </TableCell>
                  
                  <TableCell className="max-w-[240px]">
                    {annotation.unrelated_reason && (
                      <div className="text-xs bg-gray-50 px-2 py-1 rounded" title={annotation.unrelated_reason}>
                        {annotation.unrelated_reason.length > 50 
                          ? `${annotation.unrelated_reason.substring(0, 50)}...`
                          : annotation.unrelated_reason
                        }
                      </div>
                    )}
                  </TableCell>
                  
                  <TableCell className="max-w-[80px] truncate text-xs font-mono">
                    {annotation.model_used}
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