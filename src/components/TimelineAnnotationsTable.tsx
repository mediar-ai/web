"use client";

import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

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
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 h-4 w-4" />
          <Input
            placeholder="Filter all fields..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-10 border-gray-300 focus:border-black"
          />
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-700">
          <span className="font-medium">Total: {filteredAnnotations.length}</span>
          <Badge variant="default" className="bg-black text-white">{relatedCount} RELATED</Badge>
          <Badge variant="outline" className="border-gray-400 text-gray-700">{unrelatedCount} UNRELATED</Badge>
        </div>
      </div>

      {/* Timeline Cards */}
      <div className="space-y-4 w-full">
        {filteredAnnotations.length === 0 ? (
          <div className="text-center py-12 text-gray-600 border border-gray-300 rounded-lg bg-gray-50">
            {filterText ? 'No annotations match your filter.' : 'No timeline annotations available.'}
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto w-full space-y-3 pr-2">
            {filteredAnnotations.map((annotation) => (
              <div 
                key={`${annotation.raw_event_id || annotation.analysis_id}-${annotation.analysis_id}`}
                className={`border rounded-lg p-4 hover:shadow-md transition-shadow ${
                  annotation.is_workflow_related 
                    ? 'border-gray-300 bg-white' 
                    : 'border-gray-400 bg-gray-50'
                }`}
              >
                                 {/* Header Row */}
                 <div className="flex items-center justify-between mb-3">
                   <div className="flex items-center gap-3">
                     <div className="text-sm font-mono text-gray-600" title={annotation.event_created_at || undefined}>
                       {annotation.event_created_at ? 
                         new Date(annotation.event_created_at).toLocaleString('en-US', {
                           month: '2-digit',
                           day: '2-digit',
                           hour: '2-digit',
                           minute: '2-digit',
                           second: '2-digit',
                           hour12: false
                         }) :
                         '-'
                       }
                     </div>
                     <span className="inline-flex items-center px-2 py-1 rounded text-sm font-medium bg-gray-200 text-gray-800 border">
                       {(annotation.event_type || 'unknown').replace('ui_', '')}
                     </span>
                     <div className="text-base font-medium text-gray-900" title={annotation.step_summary || annotation.user_intent || undefined}>
                       {annotation.step_title || `Analysis ${annotation.analysis_id}`}
                     </div>
                   </div>
                   <div className="flex items-center gap-2">
                     <Badge 
                       variant={annotation.is_workflow_related ? "default" : "secondary"}
                       className={`text-sm ${annotation.is_workflow_related ? 'bg-black text-white' : 'bg-gray-300 text-gray-700'}`}
                     >
                       {annotation.is_workflow_related ? "RELATED" : "UNRELATED"} {annotation.confidence_score !== null ? `${(annotation.confidence_score * 100).toFixed(0)}%` : ''}
                     </Badge>
                   </div>
                 </div>

                                                  {/* Workflow Hierarchy */}
                 {annotation.is_workflow_related && (annotation.template_name || annotation.type_name) && (
                   <div className="mb-3 text-sm">
                     <div className="text-gray-600 mb-1 font-medium">Workflow Context:</div>
                     <div className="flex flex-wrap gap-1 text-xs">
                       {annotation.template_name && annotation.template_name !== 'Unknown Template' && (
                         <span className="bg-gray-900 text-white px-2 py-1 rounded border" title={`Workflow: ${annotation.template_name}`}>
                           WORKFLOW: {annotation.template_name}
                         </span>
                       )}
                       {annotation.type_name && annotation.type_name !== 'Unknown Type' && (
                         <span className="bg-gray-700 text-white px-2 py-1 rounded border" title={annotation.type_name}>
                           TYPE: {annotation.type_name}
                         </span>
                       )}
                       {annotation.instance_name && annotation.instance_name !== 'Unknown Instance' && (
                         <span className="bg-gray-500 text-white px-2 py-1 rounded border" title={annotation.instance_name}>
                           INSTANCE: {annotation.instance_name}
                         </span>
                       )}
                       {annotation.step_name && annotation.step_name !== 'Unknown Step' && (
                         <span className="bg-gray-400 text-black px-2 py-1 rounded border" title={annotation.step_name}>
                           STEP: {annotation.step_name}
                         </span>
                       )}
                       {annotation.substep_name && annotation.substep_name !== 'Unknown Substep' && (
                         <span className="bg-gray-300 text-black px-2 py-1 rounded border" title={annotation.substep_name}>
                           SUBSTEP: {annotation.substep_name}
                         </span>
                       )}
                     </div>
                   </div>
                 )}

                                 {/* Data Flow */}
                 {(annotation.inputs || annotation.outputs || annotation.business_logics) && (
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                     {annotation.inputs && (
                       <div>
                         <div className="text-gray-700 text-xs mb-1 font-medium">INPUT:</div>
                         <div className="text-xs p-2 bg-gray-100 rounded border text-gray-800" title={typeof annotation.inputs === 'string' ? annotation.inputs : Array.isArray(annotation.inputs) ? annotation.inputs.join(', ') : ''}>
                           {typeof annotation.inputs === 'string' ?
                             annotation.inputs :
                             Array.isArray(annotation.inputs) && annotation.inputs.length > 0 ?
                               annotation.inputs.join(', ') :
                               'No input data'
                           }
                         </div>
                       </div>
                     )}
                     
                     {annotation.outputs && (
                       <div>
                         <div className="text-gray-700 text-xs mb-1 font-medium">OUTPUT:</div>
                         <div className="text-xs p-2 bg-gray-100 rounded border text-gray-800" title={typeof annotation.outputs === 'string' ? annotation.outputs : Array.isArray(annotation.outputs) ? annotation.outputs.join(', ') : ''}>
                           {typeof annotation.outputs === 'string' ?
                             annotation.outputs :
                             Array.isArray(annotation.outputs) && annotation.outputs.length > 0 ?
                               annotation.outputs.join(', ') :
                               'No output data'
                           }
                         </div>
                       </div>
                     )}
                     
                     {(annotation.business_logics || annotation.business_logic) && (
                       <div>
                         <div className="text-gray-700 text-xs mb-1 font-medium">BUSINESS LOGIC:</div>
                         <div className="text-xs p-2 bg-gray-100 rounded border text-gray-800" title={(annotation.business_logics || annotation.business_logic) as string}>
                           {typeof (annotation.business_logics || annotation.business_logic) === 'string' ? 
                             (annotation.business_logics || annotation.business_logic) :
                             Array.isArray(annotation.business_logic) && annotation.business_logic.length > 0 ? 
                               annotation.business_logic.join(', ') :
                               'No business logic data'
                           }
                         </div>
                       </div>
                     )}
                   </div>
                 )}

                                 {/* Unrelated Reason */}
                 {!annotation.is_workflow_related && annotation.unrelated_reason && (
                   <div className="mt-3 text-sm">
                     <div className="text-gray-700 text-xs mb-1 font-medium">UNRELATED REASON:</div>
                     <div className="text-xs p-2 bg-gray-200 rounded border text-gray-900" title={annotation.unrelated_reason}>
                       {annotation.unrelated_reason}
                     </div>
                   </div>
                 )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
} 