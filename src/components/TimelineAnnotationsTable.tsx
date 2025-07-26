"use client";

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useMemo, useState } from 'react';

import { Search } from 'lucide-react';

interface TimelineAnnotation {
  // Core fields
  analysis_id: number;
  is_workflow_related: boolean;
  unrelated_reason: string | null;
  confidence_score: number | null;
  model_used: string | null;
  created_at: string;
  
  // Raw events system fields
  raw_event_id?: number;
  user_id?: string;
  workflow_template_id?: number | null;
  workflow_type_id?: number | null;
  workflow_instance_id?: number | null;
  workflow_step_id?: number | null;
  workflow_substep_id?: number | null;
  
  // Human-readable names from workflow data
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
  
  // Labeling data
  selected_labels?: string[];
  suggested_labels?: string[];
}

interface TimelineAnnotationsTableProps {
  annotations: TimelineAnnotation[];
}

export function TimelineAnnotationsTable({ annotations }: TimelineAnnotationsTableProps) {
  const [filterText, setFilterText] = useState('');
  const [viewMode, setViewMode] = useState<'events' | 'workflows'>('events');

  // Filter annotations based on search text across all fields
  const filteredAnnotations = useMemo(() => {
    if (!filterText.trim()) return annotations;
    
    const searchLower = filterText.toLowerCase();
    return annotations.filter(annotation => {
      const searchableFields = [
        annotation.analysis_id?.toString(),
        annotation.template_name,
        annotation.type_name,
        annotation.instance_name,
        annotation.step_name,
        annotation.substep_name,
        annotation.unrelated_reason,
        annotation.model_used,
        ...(annotation.inputs || []),
        ...(annotation.outputs || []),
        ...(annotation.business_logics || []),
        // Include labeling data in search
        ...(annotation.selected_labels || []),
        ...(annotation.suggested_labels || []),
      ].filter(Boolean);

      return searchableFields.some(field => 
        field?.toString().toLowerCase().includes(searchLower)
      );
    });
  }, [annotations, filterText]);

  const relatedCount = filteredAnnotations.filter(a => a.is_workflow_related).length;
  const unrelatedCount = filteredAnnotations.filter(a => !a.is_workflow_related).length;

  // Group annotations by workflow hierarchy for workflow view
  const workflowHierarchy = useMemo(() => {
    const workflows: Record<string, {
      template_name: string;
      type_name: string;
      instance_name: string;
      steps: Record<string, {
        step_name: string;
        substeps: Record<string, {
          substep_name: string;
          step_title: string;
          user_intent: string;
          step_summary: string;
          window_title: string;
          events: Array<{
            timestamp: string;
            event_type: string;
            inputs: string | string[] | null;
            outputs: string | string[] | null;
            business_logics: string | null;
            raw_event_id: number;
          }>;
        }>;
      }>;
    }> = {};

    filteredAnnotations
      .filter(a => a.is_workflow_related)
      .forEach(annotation => {
        const workflowKey = `${annotation.template_name || 'Unknown'}-${annotation.type_name || 'Unknown'}-${annotation.instance_name || 'Unknown'}`;
        const stepKey = annotation.step_name || 'Unknown Step';
        const substepKey = annotation.substep_name || 'Unknown Substep';
        
        if (!workflows[workflowKey]) {
          workflows[workflowKey] = {
            template_name: annotation.template_name || 'Unknown Workflow',
            type_name: annotation.type_name || 'Unknown Type',
            instance_name: annotation.instance_name || 'Unknown Instance',
            steps: {}
          };
        }

        if (!workflows[workflowKey].steps[stepKey]) {
          workflows[workflowKey].steps[stepKey] = {
            step_name: stepKey,
            substeps: {}
          };
        }

        if (!workflows[workflowKey].steps[stepKey].substeps[substepKey]) {
          workflows[workflowKey].steps[stepKey].substeps[substepKey] = {
            substep_name: substepKey,
            step_title: annotation.step_title || 'Unknown Step Title',
            user_intent: annotation.user_intent || '',
            step_summary: annotation.step_summary || '',
            window_title: annotation.window_title || '',
            events: []
          };
        }

        workflows[workflowKey].steps[stepKey].substeps[substepKey].events.push({
          timestamp: annotation.event_created_at || annotation.created_at,
          event_type: annotation.event_type || 'unknown',
          inputs: annotation.inputs || null,
          outputs: annotation.outputs || null,
          business_logics: annotation.business_logics || null,
          raw_event_id: annotation.raw_event_id || 0
        });
      });

    return Object.values(workflows);
  }, [filteredAnnotations]);

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
        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex border border-gray-300 rounded-lg">
            <button
              onClick={() => setViewMode('events')}
              className={`px-3 py-1 text-sm rounded-l-lg transition-colors ${
                viewMode === 'events' 
                  ? 'bg-black text-white' 
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Event View
            </button>
            <button
              onClick={() => setViewMode('workflows')}
              className={`px-3 py-1 text-sm rounded-r-lg transition-colors ${
                viewMode === 'workflows' 
                  ? 'bg-black text-white' 
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Workflow View
            </button>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-700">
            <span className="font-medium">Total: {filteredAnnotations.length}</span>
            <Badge variant="default" className="bg-black text-white">{relatedCount} RELATED</Badge>
            <Badge variant="outline" className="border-gray-400 text-gray-700">{unrelatedCount} UNRELATED</Badge>
          </div>
        </div>
      </div>

      {/* Timeline Cards */}
      <div className="space-y-4 w-full">
        {filteredAnnotations.length === 0 ? (
          <div className="text-center py-12 text-gray-600 border border-gray-300 rounded-lg bg-gray-50">
            {filterText ? 'No annotations match your filter.' : 'No timeline annotations available.'}
          </div>
        ) : viewMode === 'events' ? (
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
                     <div className="text-xs text-gray-800 space-y-1">
                       {annotation.template_name && annotation.template_name !== 'Unknown Template' && (
                         <div>{annotation.template_name}</div>
                       )}
                       {annotation.type_name && annotation.type_name !== 'Unknown Type' && (
                         <div>{annotation.type_name}</div>
                       )}
                       {annotation.instance_name && annotation.instance_name !== 'Unknown Instance' && (
                         <div>{annotation.instance_name}</div>
                       )}
                       {annotation.step_name && annotation.step_name !== 'Unknown Step' && (
                         <div>{annotation.step_name}</div>
                       )}
                       {annotation.substep_name && annotation.substep_name !== 'Unknown Substep' && (
                         <div>{annotation.substep_name}</div>
                       )}
                     </div>
                   </div>
                 )}

                                 {/* Data Flow - Only show when workflow related */}
                 {annotation.is_workflow_related && (annotation.inputs || annotation.outputs || annotation.business_logics) && (
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
                     
                     {annotation.business_logics && (
                       <div>
                         <div className="text-gray-700 text-xs mb-1 font-medium">BUSINESS LOGIC:</div>
                         <div className="text-xs p-2 bg-gray-100 rounded border text-gray-800" title={annotation.business_logics}>
                           {annotation.business_logics || 'No business logic data'}
                         </div>
                       </div>
                     )}
                   </div>
                 )}

                 {/* Labeling Data */}
                 {((annotation.selected_labels?.length ?? 0) > 0 || (annotation.suggested_labels?.length ?? 0) > 0) && (
                   <div className="mt-3 pt-3 border-t border-gray-200">
                     <div className="text-gray-700 text-xs mb-2 font-medium">LABELING DATA:</div>
                     <div className="space-y-2">
                       {annotation.selected_labels && annotation.selected_labels.length > 0 && (
                         <div>
                           <div className="text-gray-600 text-xs mb-1">LLM Generated Labels:</div>
                           <div className="text-xs text-gray-900 bg-gray-50 border rounded p-2 whitespace-pre-wrap break-words">
                             {annotation.selected_labels.join('\n\n')}
                           </div>
                         </div>
                       )}

                       {annotation.suggested_labels && annotation.suggested_labels.length > 0 && (
                         <div>
                           <div className="text-gray-600 text-xs mb-1">AI Suggested Labels:</div>
                           <div className="text-xs text-gray-700 bg-gray-50 border rounded p-2 whitespace-pre-wrap break-words">
                             {annotation.suggested_labels.join('\n\n')}
                           </div>
                         </div>
                       )}
                     </div>
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
        ) : (
          /* Workflow View */
          <div className="max-h-[600px] overflow-y-auto w-full space-y-6 pr-2">
            {workflowHierarchy.length === 0 ? (
              <div className="text-center py-12 text-gray-600 border border-gray-300 rounded-lg bg-gray-50">
                No related workflow mappings found.
              </div>
            ) : (
              workflowHierarchy.map((workflow, workflowIndex) => (
                <div key={workflowIndex} className="border border-gray-300 rounded-lg bg-white">
                  {/* Workflow Header */}
                  <div className="border-b border-gray-200 p-4 bg-gray-50">
                    <div className="space-y-2 text-sm">
                      <div className="font-bold text-lg text-gray-900">{workflow.template_name}</div>
                      <div className="text-gray-700"><span className="font-medium">Type:</span> {workflow.type_name}</div>
                      <div className="text-gray-700"><span className="font-medium">Instance:</span> {workflow.instance_name}</div>
                    </div>
                  </div>

                  {/* Steps */}
                  <div className="p-4 space-y-4">
                    {Object.values(workflow.steps).map((step, stepIndex) => (
                      <div key={stepIndex} className="border border-gray-200 rounded-lg bg-gray-50">
                        <div className="p-3 bg-gray-100 border-b border-gray-200">
                          <div className="font-medium text-gray-900">
                            <span className="font-medium">Step:</span> {step.step_name}
                          </div>
                        </div>
                        
                        {/* Substeps */}
                        <div className="p-3 space-y-3">
                          {Object.values(step.substeps).map((substep, substepIndex) => (
                            <div key={substepIndex} className="border border-gray-300 rounded-lg bg-white">
                              {/* Substep Header */}
                              <div className="border-b border-gray-200 p-3 bg-gray-50">
                                <div className="space-y-2 text-sm">
                                  <div className="font-medium text-gray-900">
                                    <span className="font-medium">Substep:</span> {substep.substep_name}
                                  </div>
                                  <div className="font-medium text-gray-900">
                                    <span className="font-medium">Analysis:</span> {substep.step_title}
                                  </div>
                                  {substep.user_intent && (
                                    <div className="text-gray-700">
                                      <span className="font-medium">Intent:</span> {substep.user_intent}
                                    </div>
                                  )}
                                  {substep.step_summary && (
                                    <div className="text-gray-700">
                                      <span className="font-medium">Summary:</span> {substep.step_summary}
                                    </div>
                                  )}
                                  {substep.window_title && (
                                    <div className="text-gray-700">
                                      <span className="font-medium">Window:</span> {substep.window_title}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Mapped Events */}
                              <div className="p-3">
                                <div className="text-sm font-medium text-gray-700 mb-3">
                                  Mapped Events ({substep.events.length})
                                </div>
                                <div className="space-y-3">
                                  {substep.events.map((event, eventIndex) => (
                                    <div key={eventIndex} className="border border-gray-200 rounded p-3 bg-gray-50">
                                      <div className="flex items-center gap-3 mb-2">
                                        <div className="text-xs font-mono text-gray-600">
                                          {new Date(event.timestamp).toLocaleString()}
                                        </div>
                                        <div className="text-xs bg-gray-200 text-gray-800 px-2 py-1 rounded border">
                                          {event.event_type}
                                        </div>
                                      </div>
                                      
                                      {/* Input/Output/Business Logic */}
                                      <div className="space-y-2 text-xs">
                                        {event.inputs && (
                                          <div>
                                            <div className="text-gray-700 font-medium mb-1">INPUT:</div>
                                            <div className="bg-gray-100 rounded border text-gray-800 p-2">
                                              {typeof event.inputs === 'string' 
                                                ? event.inputs 
                                                : Array.isArray(event.inputs) ? event.inputs.join(', ') : 'No input data'
                                              }
                                            </div>
                                          </div>
                                        )}
                                        
                                        {event.outputs && (
                                          <div>
                                            <div className="text-gray-700 font-medium mb-1">OUTPUT:</div>
                                            <div className="bg-gray-100 rounded border text-gray-800 p-2">
                                              {typeof event.outputs === 'string' 
                                                ? event.outputs 
                                                : Array.isArray(event.outputs) ? event.outputs.join(', ') : 'No output data'
                                              }
                                            </div>
                                          </div>
                                        )}
                                        
                                        {event.business_logics && (
                                          <div>
                                            <div className="text-gray-700 font-medium mb-1">BUSINESS LOGIC:</div>
                                            <div className="bg-gray-100 rounded border text-gray-800 p-2">
                                              {event.business_logics}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
} 