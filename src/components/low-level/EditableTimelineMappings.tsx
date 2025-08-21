'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Edit2,
  PlusCircle,
  Search,
  Trash2,
  XCircle
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TimelineAnnotation } from './types';

// Types - using the structure from timeline-event-mappings API
/*
interface TimelineAnnotation {
  user_id: string;
  raw_event_id: number;
  analysis_id: number;
  confidence_score: number;
  is_workflow_related: boolean;
  model_used: string;
  unrelated_reason: string | null;
  workflow_id: number | null;
  workflow_type_id: number | null;
  workflow_instance_id: number | null;
  workflow_step_id: number | null;
  workflow_substep_id: number | null;
  template_name?: string;
  type_name?: string;
  instance_name?: string;
  step_name?: string;
  substep_name?: string;
  event_type?: string;
  step_title?: string;
  user_intent?: string;
  step_summary?: string;
  events_that_happened?: string;
  how_content_changed?: string;
  results_if_any?: string;
  what_was_clicked?: string;
  what_was_typed?: string;
  window_title?: string;
  inputs?: string | string[] | null;
  outputs?: string | string[] | null;
  business_logics?: string | null;
  created_at: string;
  event_payload?: Record<string, unknown>;
  event_created_at?: string;
  // Labeling data
  selected_labels?: string[];
  suggested_labels?: string[];
}
*/

// WorkflowComponent interface removed as it's not used

interface WorkflowType {
  id: number;
  type_name: string;
}

interface WorkflowInstance {
  id: number;
  instance_name: string;
}

interface WorkflowSubstep {
  id: number;
  substep_name: string;
}

interface WorkflowStep {
  id: number;
  step_name: string;
  substeps?: WorkflowSubstep[];
}

interface CanvasContent {
  id: number;
  title: string;
  detailed_workflow_data?: {
    workflow_components_with_ids?: {
      workflow_types?: WorkflowType[];
      workflow_instances?: WorkflowInstance[];
      steps?: WorkflowStep[];
    };
  };
}

interface WorkflowComponents {
  templates: Array<{ id: number; name: string }>;
  types: Array<{ id: number; name: string; template_id: number }>;
  instances: Array<{ id: number; name: string; template_id: number }>;
  steps: Array<{ id: number; name: string; template_id: number }>;
  substeps: Array<{ id: number; name: string; step_id: number }>;
}

interface EditableTimelineMappingsProps {
  annotations: TimelineAnnotation[];
  workflows: CanvasContent[]
  onAnnotationsChange: (annotations: TimelineAnnotation[]) => void;
  isProcessing?: boolean; // Add optional processing state
  processingBatch?: { current: number; total: number } | null; // Add batch info
}

// Custom types for workflow hierarchy view
interface EventInHierarchy {
  annotation: TimelineAnnotation;
  timestamp: string;
  event_type: string;
  inputs: string | string[] | null;
  outputs: string | string[] | null;
  business_logics: string | null;
  raw_event_id: number;
}

interface SubstepInHierarchy {
  substep_id: number | null;
  substep_name: string;
  step_title: string;
  user_intent: string;
  step_summary: string;
  window_title: string;
  events: EventInHierarchy[];
}

interface StepInHierarchy {
  step_id: number | null;
  step_name: string;
  substeps: Record<string, SubstepInHierarchy>;
}

interface WorkflowInHierarchy {
  template_id: number | null;
  template_name: string;
  type_id: number | null;
  type_name: string;
  instance_id: number | null;
  instance_name: string;
  steps: Record<string, StepInHierarchy>;
}


// Extract workflow components from synthesized workflows
const extractWorkflowComponents = (workflows: CanvasContent[]): WorkflowComponents => {
  const components: WorkflowComponents = {
    templates: [],
    types: [],
    instances: [],
    steps: [],
    substeps: []
  };

  workflows.forEach(workflow => {
    // Templates
    components.templates.push({
      id: workflow.id,
      name: workflow.title || `Workflow ${workflow.id}`
    });

    // Access the nested workflow components structure
    const workflowComponents = workflow.detailed_workflow_data?.workflow_components_with_ids;
    
    if (!workflowComponents) {
      // Only log if we actually have detailed_workflow_data but missing the components
      if (workflow.detailed_workflow_data) {
        console.warn(`Workflow ${workflow.id} has detailed_workflow_data but missing workflow_components_with_ids. Keys:`, Object.keys(workflow.detailed_workflow_data));
      }
      return;
    }

    // Types - use the original IDs from workflow_components_with_ids
    workflowComponents.workflow_types?.forEach((type: WorkflowType) => {
      components.types.push({
        id: type.id, // Use the original ID from the database
        name: type.type_name,
        template_id: workflow.id
      });
    });

    // Instances - use the original IDs from workflow_components_with_ids
    workflowComponents.workflow_instances?.forEach((instance: WorkflowInstance) => {
      components.instances.push({
        id: instance.id, // Use the original ID from the database
        name: instance.instance_name,
        template_id: workflow.id
      });
    });

    // Steps and substeps - use the original IDs from workflow_components_with_ids
    workflowComponents.steps?.forEach((step: WorkflowStep) => {
      components.steps.push({
        id: step.id, // Use the original ID from the database
        name: step.step_name,
        template_id: workflow.id
      });

      step.substeps?.forEach((substep: WorkflowSubstep) => {
        components.substeps.push({
          id: substep.id, // Use the original ID from the database
          name: substep.substep_name,
          step_id: step.id // Use the original step ID
        });
      });
    });
  });

  return components;
};

export const EditableTimelineMappings: React.FC<EditableTimelineMappingsProps> = ({
  annotations,
  workflows,
  onAnnotationsChange,
  isProcessing = false,
  processingBatch = null,
}) => {
  // Local state management with debounced updates (same pattern as synthesis)
  const [localAnnotations, setLocalAnnotations] = useState<TimelineAnnotation[]>(annotations);
  
  // Note: readOnly mode support available if needed
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'related' | 'unrelated'>('all');
  const [sortBy, setSortBy] = useState<'timestamp' | 'confidence' | 'event_type'>('timestamp');
  const [viewMode, setViewMode] = useState<'events' | 'workflows'>('events');
  const [addEventModalState, setAddEventModalState] = useState<{
    isOpen: boolean;
    workflow: WorkflowInHierarchy | null;
    step: StepInHierarchy | null;
    substep: SubstepInHierarchy | null;
  }>({ isOpen: false, workflow: null, step: null, substep: null });
  
  // State for tracking expanded events to show raw JSON
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  // Keep local state in sync when parent updates
  useEffect(() => {
    setLocalAnnotations(annotations);
  }, [annotations]);

  // Debounce updates to parent to avoid excessive renders
  // OPTIMIZATION: Only pass changed annotations to reduce API calls from 7x to 1x per edit
  // TODO: Future enhancement could batch multiple rapid changes to same annotation
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Extract workflow components for dropdowns
  const workflowComponents = useMemo(() => extractWorkflowComponents(workflows), [workflows]);

  // Filtered and sorted annotations with deduplication
  const filteredAnnotations = useMemo(() => {
    const filtered = localAnnotations.filter(annotation => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const searchableContent = [
          annotation.template_name,
          annotation.type_name,
          annotation.instance_name,
          annotation.step_name,
          annotation.substep_name,
          annotation.event_type,
          annotation.step_title,
          annotation.window_title,
          annotation.unrelated_reason
        ].filter(Boolean).join(' ').toLowerCase();
        
        if (!searchableContent.includes(searchLower)) return false;
      }

      // Status filter
      if (filterStatus === 'related' && !annotation.is_workflow_related) return false;
      if (filterStatus === 'unrelated' && annotation.is_workflow_related) return false;

      return true;
    });

    // Sort filtered annotations (deduplication removed)
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'confidence':
          return (b.confidence_score || 0) - (a.confidence_score || 0);
        case 'event_type':
          return (a.event_type || '').localeCompare(b.event_type || '');
        case 'timestamp':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return filtered;
  }, [localAnnotations, searchTerm, filterStatus, sortBy]);

  // Group annotations by workflow hierarchy for workflow view
  const workflowHierarchy = useMemo(() => {
    const workflows: Record<string, WorkflowInHierarchy> = {};

    filteredAnnotations
      .filter(a => a.is_workflow_related)
      .forEach(annotation => {
        const workflowKey = `${annotation.workflow_id || 'unknown'}`;
        const stepKey = `${annotation.workflow_step_id || 'unknown'}`;
        const substepKey = `${annotation.workflow_substep_id || 'unknown'}`;
        
        if (!workflows[workflowKey]) {
          workflows[workflowKey] = {
            template_id: annotation.workflow_id ?? null,
            template_name: annotation.template_name || 'Unknown Workflow',
            type_id: annotation.workflow_type_id ?? null,
            type_name: annotation.type_name || 'Unknown Type',
            instance_id: annotation.workflow_instance_id ?? null,
            instance_name: annotation.instance_name || 'Unknown Instance',
            steps: {}
          };
        }

        if (!workflows[workflowKey].steps[stepKey]) {
          workflows[workflowKey].steps[stepKey] = {
            step_id: annotation.workflow_step_id ?? null,
            step_name: annotation.step_name || 'Unknown Step',
            substeps: {}
          };
        }

        if (!workflows[workflowKey].steps[stepKey].substeps[substepKey]) {
          workflows[workflowKey].steps[stepKey].substeps[substepKey] = {
            substep_id: annotation.workflow_substep_id ?? null,
            substep_name: annotation.substep_name || 'Unknown Substep',
            step_title: annotation.step_title || 'Unknown Step Title',
            user_intent: annotation.user_intent || '',
            step_summary: annotation.step_summary || '',
            window_title: annotation.window_title || '',
            events: []
          };
        }

        workflows[workflowKey].steps[stepKey].substeps[substepKey].events.push({
          annotation: annotation,
          timestamp: annotation.event_created_at || annotation.created_at,
          event_type: annotation.event_type || 'unknown',
          inputs: annotation.inputs || null,
          outputs: annotation.outputs || null,
          business_logics: annotation.business_logics || null,
          raw_event_id: annotation.raw_event_id,
        });
      });

    return Object.values(workflows);
  }, [filteredAnnotations]);

  // Group annotations by analysis_id for event view
  const analysisGroups = useMemo(() => {
    const groups: Record<number, {
      analysis_id: number;
      analysis_info: {
        step_title: string;
        user_intent: string;
        step_summary: string;
        events_that_happened: string;
        how_content_changed: string;
        results_if_any: string;
        what_was_clicked: string;
        what_was_typed: string;
        window_title: string;
        selected_labels: string[];
        suggested_labels: string[];
      };
      events: TimelineAnnotation[];
    }> = {};

    filteredAnnotations.forEach(annotation => {
      const analysisId = annotation.analysis_id;
      
      if (!groups[analysisId]) {
        groups[analysisId] = {
          analysis_id: analysisId,
          analysis_info: {
            step_title: annotation.step_title || 'Unknown Step',
            user_intent: annotation.user_intent || '',
            step_summary: annotation.step_summary || '',
            events_that_happened: annotation.events_that_happened || '',
            how_content_changed: annotation.how_content_changed || '',
            results_if_any: annotation.results_if_any || '',
            what_was_clicked: annotation.what_was_clicked || '',
            what_was_typed: annotation.what_was_typed || '',
            window_title: annotation.window_title || '',
            selected_labels: annotation.selected_labels || [],
            suggested_labels: annotation.suggested_labels || []
          },
          events: []
        };
      }
      
      groups[analysisId].events.push(annotation);
    });

    return Object.values(groups).sort((a, b) => {
      // Sort by the earliest event timestamp in each group
      const aEarliest = Math.min(...a.events.map(e => new Date(e.created_at).getTime()));
      const bEarliest = Math.min(...b.events.map(e => new Date(e.created_at).getTime()));
      return bEarliest - aEarliest; // Most recent first
    });
  }, [filteredAnnotations]);

  const handleAnnotationChange = (
    annotation: TimelineAnnotation,
    field: keyof TimelineAnnotation,
     
    value: any
  ) => {
    const updated = [...localAnnotations];
    const actualIndex = localAnnotations.findIndex(
      ann => ann.analysis_id === annotation.analysis_id && ann.raw_event_id === annotation.raw_event_id
    );
    
    if (actualIndex !== -1) {
      const changedAnnotation = {
        ...updated[actualIndex],
        [field]: value,
      };
      updated[actualIndex] = changedAnnotation;

      setLocalAnnotations(updated);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Only pass the changed annotation for optimization
        onAnnotationsChange([changedAnnotation]);
      }, 300);
    }
  };

  const handleRemoveEventFromWorkflow = (analysisId: number) => {
    const updated = [...localAnnotations];
    const actualIndex = updated.findIndex(ann => ann.analysis_id === analysisId);
    
    if (actualIndex !== -1) {
        const changedAnnotation = {
            ...updated[actualIndex],
            is_workflow_related: false,
            workflow_id: null,
            workflow_type_id: null,
            workflow_instance_id: null,
            workflow_step_id: null,
            workflow_substep_id: null,
        };
        updated[actualIndex] = changedAnnotation;

        setLocalAnnotations(updated);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            // Only pass the changed annotation for optimization
            onAnnotationsChange([changedAnnotation]);
        }, 300);
    }
  };

  const handleAddEventToWorkflow = (
    annotation: TimelineAnnotation,
    workflow: WorkflowInHierarchy,
    step: StepInHierarchy,
    substep: SubstepInHierarchy
  ) => {
    const updated = [...localAnnotations];
    const actualIndex = updated.findIndex(ann => ann.analysis_id === annotation.analysis_id);

    if (actualIndex !== -1) {
        const changedAnnotation = {
            ...updated[actualIndex],
            is_workflow_related: true,
            workflow_id: workflow.template_id,
            template_name: workflow.template_name,
            workflow_type_id: workflow.type_id,
            type_name: workflow.type_name,
            workflow_instance_id: workflow.instance_id,
            instance_name: workflow.instance_name,
            workflow_step_id: step.step_id,
            step_name: step.step_name,
            workflow_substep_id: substep.substep_id,
            substep_name: substep.substep_name,
        };
        updated[actualIndex] = changedAnnotation;
        
        setLocalAnnotations(updated);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            // Only pass the changed annotation for optimization
            onAnnotationsChange([changedAnnotation]);
        }, 300);

        setAddEventModalState({ isOpen: false, workflow: null, step: null, substep: null });
    }
  };

  // Helper function to toggle event expansion
  const toggleEventExpansion = (eventId: number) => {
    setExpandedEvents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  // Helper function to render raw JSON payload
  const renderRawJsonPayload = (annotation: TimelineAnnotation) => {
    if (!annotation.event_payload) {
      return (
        <div className="text-xs text-gray-500 italic p-2 bg-gray-50 rounded border">
          No raw event payload available
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div className="text-xs font-medium text-gray-700">Raw Event JSON:</div>
        <pre className="text-xs bg-gray-50 p-3 rounded border overflow-x-auto whitespace-pre-wrap font-mono">
          {JSON.stringify(annotation.event_payload, null, 2)}
        </pre>
      </div>
    );
  };

  const relatedCount = filteredAnnotations.filter(a => a.is_workflow_related).length;
  const unrelatedCount = filteredAnnotations.filter(a => !a.is_workflow_related).length;

  const getStatusBadge = (annotation: TimelineAnnotation) => {
    if (annotation.is_workflow_related) {
      const confidence = Math.round((annotation.confidence_score || 0) * 100);
      return (
        <Badge variant={confidence >= 80 ? "default" : confidence >= 60 ? "secondary" : "destructive"}>
          <CheckCircle className="h-3 w-3 mr-1" />
          Related ({confidence}%)
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline">
          <XCircle className="h-3 w-3 mr-1" />
          Unrelated
        </Badge>
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
        <Edit2 className="h-4 w-4" />
        <span>Review and edit timeline event annotations below:</span>
      </div>

      {/* Search and Filter Controls */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search annotations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          
          <Select value={filterStatus} onValueChange={(value: 'all' | 'related' | 'unrelated') => setFilterStatus(value)}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Annotations</SelectItem>
              <SelectItem value="related">Workflow Related</SelectItem>
              <SelectItem value="unrelated">Unrelated</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(value: 'timestamp' | 'confidence' | 'event_type') => setSortBy(value)}>
            <SelectTrigger>
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="timestamp">Timestamp</SelectItem>
              <SelectItem value="confidence">Confidence</SelectItem>
              <SelectItem value="event_type">Event Type</SelectItem>
            </SelectContent>
          </Select>


        </div>
      </Card>

      {/* View Mode Toggle and Stats */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex border border-black rounded-lg">
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
          <Badge variant="outline" className="border-black text-gray-700">{unrelatedCount} UNRELATED</Badge>
        </div>
      </div>

      {/* Mappings List */}
      {viewMode === 'events' ? (
        <div className="space-y-3">
          {/* Show processing state when no annotations yet but processing is active */}
          {isProcessing && annotations.length === 0 ? (
            <div className="space-y-4">
              <Card className="p-8 text-center border border-black rounded-lg bg-blue-50">
                <div className="space-y-3">
                  <div className="animate-spin rounded-full h-8 w-8 mx-auto border-b-2 border-black"></div>
                  <p className="text-gray-700 font-medium">Processing Timeline Events</p>
                  <p className="text-sm text-gray-600">
                    {processingBatch 
                      ? `Analyzing batch ${processingBatch.current} of ${processingBatch.total}...`
                      : 'Analyzing events and mapping to workflows...'
                    }
                  </p>
                  <p className="text-xs text-gray-500">
                    Results will appear here as batches complete
                  </p>
                </div>
              </Card>
              
              {/* Show batch progress if available */}
              {processingBatch && (
                <Card className="p-4 border border-black rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Batch Progress</span>
                    <span className="text-xs text-gray-600">
                      {Math.round((processingBatch.current / processingBatch.total) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-black h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${(processingBatch.current / processingBatch.total) * 100}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Processing batch {processingBatch.current}</span>
                    <span>{processingBatch.total} total batches</span>
                  </div>
                </Card>
              )}
            </div>
          ) : analysisGroups.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground border border-black rounded-lg">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>No timeline annotations found matching your criteria.</p>
              {isProcessing && (
                <p className="text-sm text-gray-500 mt-2">
                  Processing is still active - results may appear soon
                </p>
              )}
            </Card>
          ) : (
            <>
              {/* Show active processing indicator above results when processing and have results */}
              {isProcessing && annotations.length > 0 && (
                <Card className="p-3 border border-black rounded-lg bg-green-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="animate-pulse w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-sm text-green-700">
                        Processing active - new results will appear below
                      </span>
                    </div>
                    {processingBatch && (
                      <span className="text-xs text-green-600">
                        Batch {processingBatch.current}/{processingBatch.total}
                      </span>
                    )}
                  </div>
                </Card>
              )}
              
              {/* Existing analysis groups rendering */}
              {analysisGroups.map((group) => (
                 <Card key={group.analysis_id} className="p-4 border border-black rounded-lg bg-white">
                 {/* Analysis Header */}
                 <div className="border-b border-gray-200 pb-4 mb-4">
                   <div className="flex items-center justify-between mb-3">
                     <div className="space-y-1">
                       <div className="font-semibold text-lg text-gray-900">{group.analysis_info.step_title}</div>
                       <div className="text-sm text-muted-foreground">
                         Analysis #{group.analysis_id} • {group.events.length} event{group.events.length !== 1 ? 's' : ''}
                       </div>
                     </div>
                     <div className="flex items-center gap-2">
                       {group.analysis_info.selected_labels && group.analysis_info.selected_labels.length > 0 && (
                         <Badge variant="default" className="text-xs">
                           LLM Labels: {group.analysis_info.selected_labels.length}
                         </Badge>
                       )}
                       {group.analysis_info.suggested_labels && group.analysis_info.suggested_labels.length > 0 && (
                         <Badge variant="secondary" className="text-xs">
                           AI Suggestions: {group.analysis_info.suggested_labels.length}
                         </Badge>
                       )}
                     </div>
                   </div>

                   {/* Analysis Details */}
                   <div className="space-y-3 text-sm">
                     {/* Step Overview */}
                     <div className="space-y-2">
                       <h5 className="font-medium text-gray-800">Step Overview</h5>
                       {group.analysis_info.step_summary && (
                         <div className="text-gray-700">
                           <span className="font-medium">Summary:</span> {group.analysis_info.step_summary}
                         </div>
                       )}
                       {group.analysis_info.user_intent && (
                         <div className="text-gray-700">
                           <span className="font-medium">User Intent:</span> {group.analysis_info.user_intent}
                         </div>
                       )}
                     </div>

                     {/* Actions Taken */}
                     {(group.analysis_info.events_that_happened || group.analysis_info.what_was_clicked || group.analysis_info.what_was_typed) && (
                       <div className="space-y-2">
                         <h5 className="font-medium text-gray-800">Actions Taken</h5>
                         {group.analysis_info.events_that_happened && (
                           <div className="text-gray-700">
                             <span className="font-medium">Events:</span> {group.analysis_info.events_that_happened}
                           </div>
                         )}
                         {group.analysis_info.what_was_clicked && (
                           <div className="text-gray-700">
                             <span className="font-medium">Clicked Elements:</span> {group.analysis_info.what_was_clicked}
                           </div>
                         )}
                         {group.analysis_info.what_was_typed && (
                           <div className="text-gray-700">
                             <span className="font-medium">Text Typed:</span> {group.analysis_info.what_was_typed}
                           </div>
                         )}
                       </div>
                     )}

                     {/* Outcomes */}
                     {(group.analysis_info.how_content_changed || group.analysis_info.results_if_any) && (
                       <div className="space-y-2">
                         <h5 className="font-medium text-gray-800">Outcomes</h5>
                         {group.analysis_info.how_content_changed && (
                           <div className="text-gray-700">
                             <span className="font-medium">Content Changes:</span> {group.analysis_info.how_content_changed}
                           </div>
                         )}
                         {group.analysis_info.results_if_any && (
                           <div className="text-gray-700">
                             <span className="font-medium">Results:</span> {group.analysis_info.results_if_any}
                           </div>
                         )}
                       </div>
                     )}

                     {/* Context */}
                     {group.analysis_info.window_title && (
                       <div className="space-y-2">
                         <h5 className="font-medium text-gray-800">Context</h5>
                         <div className="text-gray-700">
                           <span className="font-medium">Window:</span> {group.analysis_info.window_title}
                         </div>
                       </div>
                     )}
                   </div>

                   {/* Analysis Labels */}
                   {((group.analysis_info.selected_labels?.length ?? 0) > 0 || (group.analysis_info.suggested_labels?.length ?? 0) > 0) && (
                     <div className="mt-3 space-y-3">
                       {group.analysis_info.selected_labels && group.analysis_info.selected_labels.length > 0 && (
                         <div className="flex items-start space-x-3">
                           <Label className="min-w-[140px] text-sm pt-2">LLM Generated Labels:</Label>
                           <div className="flex-1">
                             <div className="text-sm text-gray-900 bg-gray-50 border rounded-md p-2 min-h-[2.5rem] whitespace-pre-wrap break-words">
                               {group.analysis_info.selected_labels.join('\n\n')}
                             </div>
                           </div>
                         </div>
                       )}

                       {group.analysis_info.suggested_labels && group.analysis_info.suggested_labels.length > 0 && (
                         <div className="flex items-start space-x-3">
                           <Label className="min-w-[140px] text-sm pt-2">AI Suggested Labels:</Label>
                           <div className="flex-1">
                             <div className="text-sm text-gray-700 bg-gray-50 border rounded-md p-2 min-h-[2.5rem] whitespace-pre-wrap break-words">
                               {group.analysis_info.suggested_labels.join('\n\n')}
                             </div>
                           </div>
                         </div>
                       )}
                     </div>
                   )}
                 </div>

                 {/* Raw Events */}
                 <div className="space-y-3">
                   {group.events.length > 0 && <h4 className="text-sm font-medium text-gray-700 mb-3">Raw Events ({group.events.length}):</h4>}

                {group.events.map((annotation, eventIndex) => {
                  return (
                    <Card key={`${annotation.analysis_id}-${eventIndex}`} className={`${annotation.is_workflow_related ? 'ring-2 ring-primary' : ''}`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="space-y-1">
                              <div className="flex items-center space-x-2">
                                <Badge variant="outline">
                                  Event #{annotation.raw_event_id || annotation.analysis_id}
                                </Badge>
                                <Badge variant="outline">
                                  {annotation.event_type || 'Unknown'}
                                </Badge>
                                                                                      {getStatusBadge(annotation)}
                                </div>
                              
                              <div className="text-sm text-muted-foreground">
                                {annotation.event_created_at 
                                  ? new Date(annotation.event_created_at).toLocaleString()
                                  : new Date(annotation.created_at).toLocaleString()
                                }
                              </div>
                              
                              {annotation.step_title && (
                                <div className="text-sm">
                                  <strong>Step:</strong> {annotation.step_title}
                                </div>
                              )}
                              
                              {annotation.window_title && (
                                <div className="text-sm text-muted-foreground">
                                  <strong>Window:</strong> {annotation.window_title}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleEventExpansion(annotation.raw_event_id || annotation.analysis_id)}
                              className="h-8 w-8 p-0"
                            >
                              {expandedEvents.has(annotation.raw_event_id || annotation.analysis_id) ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-3">
                        {/* Related/Unrelated Toggle */}
                        <div className="flex items-center space-x-3">
                          <Label htmlFor={`toggle-${annotation.analysis_id}`} className="min-w-[140px] text-sm">
                            Workflow Status:
                          </Label>
                          <div className="flex items-center space-x-3">
                            <Switch
                              id={`toggle-${annotation.analysis_id}`}
                              checked={annotation.is_workflow_related}
                                                             onCheckedChange={(checked) => 
                                 handleAnnotationChange(annotation, 'is_workflow_related', checked)
                               }
                            />
                            <span className="text-sm font-medium">
                              {annotation.is_workflow_related ? 'Related' : 'Unrelated'}
                            </span>
                          </div>
                        </div>

                        {/* Confidence Score */}
                        <div className="flex items-center space-x-3">
                          <Label htmlFor={`confidence-${annotation.analysis_id}`} className="min-w-[140px] text-sm">
                            Confidence Score:
                          </Label>
                          <div className="flex items-center space-x-2">
                            <Input
                              id={`confidence-${annotation.analysis_id}`}
                              type="number"
                              min={0}
                              max={100}
                              value={Math.round((annotation.confidence_score || 0) * 100)}
                                                             onChange={(e) => 
                                 handleAnnotationChange(annotation, 'confidence_score', parseInt(e.target.value || '0') / 100)
                               }
                              className="w-20"
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                        </div>

                        {annotation.is_workflow_related ? (
                          /* Workflow Component Selectors */
                          <div className="grid grid-cols-1 gap-3">
                            <div className="flex items-center space-x-3">
                              <Label htmlFor={`template-${annotation.analysis_id}`} className="min-w-[140px] text-sm">
                                Workflow Template:
                              </Label>
                              <Select
                                value={annotation.workflow_id?.toString() || ""}
                                                                 onValueChange={(value) => 
                                   handleAnnotationChange(annotation, 'workflow_id', parseInt(value))
                                 }
                              >
                                <SelectTrigger id={`template-${annotation.analysis_id}`} className="flex-1">
                                  <SelectValue>
                                    {annotation.template_name && annotation.template_name !== 'Unknown Template' 
                                      ? annotation.template_name 
                                      : "Select template..."
                                    }
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {workflowComponents.templates.map(template => (
                                    <SelectItem key={template.id} value={template.id.toString()}>
                                      {template.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center space-x-3">
                              <Label htmlFor={`type-${annotation.analysis_id}`} className="min-w-[140px] text-sm">
                                Workflow Type:
                              </Label>
                              <Select
                                value={annotation.workflow_type_id?.toString() || ""}
                                onValueChange={(value) => 
                                  handleAnnotationChange(annotation, 'workflow_type_id', parseInt(value))
                                }
                              >
                                <SelectTrigger id={`type-${annotation.analysis_id}`} className="flex-1">
                                  <SelectValue>
                                    {annotation.type_name && annotation.type_name !== 'Unknown Type' 
                                      ? annotation.type_name 
                                      : "Select type..."
                                    }
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {workflowComponents.types
                                    .filter(type => type.template_id === annotation.workflow_id)
                                    .map(type => (
                                      <SelectItem key={type.id} value={type.id.toString()}>
                                        {type.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center space-x-3">
                              <Label htmlFor={`instance-${annotation.analysis_id}`} className="min-w-[140px] text-sm">
                                Workflow Instance:
                              </Label>
                              <Select
                                value={annotation.workflow_instance_id?.toString() || ""}
                                onValueChange={(value) => 
                                  handleAnnotationChange(annotation, 'workflow_instance_id', parseInt(value))
                                }
                              >
                                <SelectTrigger id={`instance-${annotation.analysis_id}`} className="flex-1">
                                  <SelectValue>
                                    {annotation.instance_name && annotation.instance_name !== 'Unknown Instance' 
                                      ? annotation.instance_name 
                                      : "Select instance..."
                                    }
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {workflowComponents.instances
                                    .filter(instance => instance.template_id === annotation.workflow_id)
                                    .map(instance => (
                                      <SelectItem key={instance.id} value={instance.id.toString()}>
                                        {instance.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center space-x-3">
                              <Label htmlFor={`step-${annotation.analysis_id}`} className="min-w-[140px] text-sm">
                                Workflow Step:
                              </Label>
                              <Select
                                value={annotation.workflow_step_id?.toString() || ""}
                                onValueChange={(value) => 
                                  handleAnnotationChange(annotation, 'workflow_step_id', parseInt(value))
                                }
                              >
                                <SelectTrigger id={`step-${annotation.analysis_id}`} className="flex-1">
                                  <SelectValue>
                                    {annotation.step_name && annotation.step_name !== 'Unknown Step' 
                                      ? annotation.step_name 
                                      : "Select step..."
                                    }
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {workflowComponents.steps
                                    .filter(step => step.template_id === annotation.workflow_id)
                                    .map(step => (
                                      <SelectItem key={step.id} value={step.id.toString()}>
                                        {step.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center space-x-3">
                              <Label htmlFor={`substep-${annotation.analysis_id}`} className="min-w-[140px] text-sm">
                                Workflow Substep:
                              </Label>
                              <Select
                                value={annotation.workflow_substep_id?.toString() || "none"}
                                onValueChange={(value) => 
                                  handleAnnotationChange(annotation, 'workflow_substep_id', value === "none" ? null : parseInt(value))
                                }
                              >
                                <SelectTrigger id={`substep-${annotation.analysis_id}`} className="flex-1">
                                  <SelectValue>
                                    {annotation.substep_name && annotation.substep_name !== 'Unknown Substep' 
                                      ? annotation.substep_name 
                                      : "Select substep (optional)..."
                                    }
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No substep</SelectItem>
                                  {workflowComponents.substeps
                                    .filter(substep => substep.step_id === annotation.workflow_step_id)
                                    .map(substep => (
                                      <SelectItem key={substep.id} value={substep.id.toString()}>
                                        {substep.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ) : (
                          /* Show unrelated event information */
                          <div className="space-y-3">
                            {annotation.unrelated_reason && (
                              <div className="flex items-start space-x-3">
                                <Label htmlFor={`reason-${annotation.analysis_id}`} className="min-w-[140px] text-sm pt-2">
                                  Reason:
                                </Label>
                                <Textarea
                                  id={`reason-${annotation.analysis_id}`}
                                  value={annotation.unrelated_reason || ''}
                                  onChange={(e) => 
                                    handleAnnotationChange(annotation, 'unrelated_reason', e.target.value || null)
                                  }
                                  placeholder="Why this event is unrelated..."
                                  rows={2}
                                  className="resize-none flex-1"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Event Details Section - Only show when workflow related */}
                        {annotation.is_workflow_related && (
                          <div className="space-y-3">
                            <h4 className="text-sm font-medium text-gray-700">Event Details</h4>
                            
                            <div className="flex items-start space-x-3">
                              <Label htmlFor={`inputs-${annotation.analysis_id}`} className="min-w-[140px] text-sm pt-2">
                                Inputs:
                              </Label>
                              <Textarea
                                id={`inputs-${annotation.analysis_id}`}
                                value={annotation.inputs || ''}
                                onChange={(e) => 
                                  handleAnnotationChange(annotation, 'inputs', e.target.value || null)
                                }
                                placeholder="What led to this event..."
                                rows={2}
                                className="resize-none flex-1"
                              />
                            </div>

                            <div className="flex items-start space-x-3">
                              <Label htmlFor={`outputs-${annotation.analysis_id}`} className="min-w-[140px] text-sm pt-2">
                                Outputs:
                              </Label>
                              <Textarea
                                id={`outputs-${annotation.analysis_id}`}
                                value={annotation.outputs || ''}
                                onChange={(e) => 
                                  handleAnnotationChange(annotation, 'outputs', e.target.value || null)
                                }
                                placeholder="What this event produced..."
                                rows={2}
                                className="resize-none flex-1"
                              />
                            </div>

                            <div className="flex items-start space-x-3">
                              <Label htmlFor={`business-logic-${annotation.analysis_id}`} className="min-w-[140px] text-sm pt-2">
                                Business Logic:
                              </Label>
                              <Textarea
                                id={`business-logic-${annotation.analysis_id}`}
                                value={annotation.business_logics || ''}
                                onChange={(e) => 
                                  handleAnnotationChange(annotation, 'business_logics', e.target.value || null)
                                }
                                placeholder="Business rules governing this event..."
                                rows={2}
                                className="resize-none flex-1"
                              />
                            </div>
                          </div>
                        )}

                        

                        {/* Expandable Raw JSON Section */}
                        {expandedEvents.has(annotation.raw_event_id || annotation.analysis_id) && (
                          <div className="border-t pt-3 mt-3">
                            {renderRawJsonPayload(annotation)}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setAddEventModalState({ isOpen: true, workflow: null, step: null, substep: null })}
                >
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Add Event
                </Button>
               </Card>
            ))}
            </>
          )}
        </div>
      ) : (
        /* Workflow View */
        <div className="max-h-[600px] overflow-y-auto w-full space-y-6 pr-2">
          {workflowHierarchy.length === 0 ? (
            <div className="text-center py-12 text-gray-600 border border-black rounded-lg bg-gray-50">
              No related workflow mappings found.
            </div>
          ) : (
            workflowHierarchy.map((workflow, workflowIndex) => (
              <div key={workflowIndex} className="border border-black rounded-lg bg-white">
                {/* Workflow Header */}
                <div className="border-b border-black p-4 bg-gray-50">
                  <div className="space-y-2 text-sm">
                    <div className="font-bold text-lg text-gray-900">{workflow.template_name}</div>
                    <div className="text-gray-700"><span className="font-medium">Type:</span> {workflow.type_name}</div>
                    <div className="text-gray-700"><span className="font-medium">Instance:</span> {workflow.instance_name}</div>
                  </div>
                </div>

                {/* Steps */}
                <div className="p-4 space-y-4">
                  {Object.values(workflow.steps).map((step, stepIndex) => (
                    <div key={stepIndex} className="border border-black rounded-lg bg-gray-50">
                      <div className="p-3 bg-gray-100 border-b border-black">
                        <div className="font-medium text-gray-900">
                          <span className="font-medium">Step:</span> {step.step_name}
                        </div>
                      </div>
                      
                      {/* Substeps */}
                      <div className="p-3 space-y-3">
                        {Object.values(step.substeps).map((substep, substepIndex) => (
                          <div key={substepIndex} className="border border-black rounded-lg bg-white">
                            {/* Substep Header */}
                            <div className="border-b border-black p-3 bg-gray-50">
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

                            {/* Events in this substep */}
                            <div className="p-3 space-y-2">
                              {substep.events.map((event, eventIndex) => {
                                return (
                                  <div key={eventIndex} className={`border border-black rounded-lg p-2 bg-gray-50`}>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center space-x-2">
                                        <div className="text-xs text-gray-600">
                                          {new Date(event.timestamp).toLocaleString()}
                                        </div>
                                        <Badge variant="outline" className="text-xs">
                                          {event.event_type}
                                        </Badge>
                                        <Badge variant="outline" className="text-xs">
                                          Event #{event.raw_event_id}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => toggleEventExpansion(event.raw_event_id)}
                                          className="h-6 w-6 p-0"
                                        >
                                          {expandedEvents.has(event.raw_event_id) ? (
                                            <ChevronUp className="h-3 w-3" />
                                          ) : (
                                            <ChevronDown className="h-3 w-3" />
                                          )}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => handleRemoveEventFromWorkflow(event.annotation.analysis_id)}>
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                      </div>
                                    </div>
                                    
                                    {(event.inputs || event.outputs || event.business_logics) && (
                                      <div className="mt-2 text-xs text-gray-700 space-y-1">
                                        {event.inputs && (
                                          <div><span className="font-medium">Inputs:</span> {event.inputs}</div>
                                        )}
                                        {event.outputs && (
                                          <div><span className="font-medium">Outputs:</span> {event.outputs}</div>
                                        )}
                                        {event.business_logics && (
                                          <div><span className="font-medium">Business Logic:</span> {event.business_logics}</div>
                                        )}
                                      </div>
                                    )}

                                    {/* Expandable Raw JSON Section for Workflow View */}
                                    {expandedEvents.has(event.raw_event_id) && (
                                      <div className="mt-2 pt-2 border-t border-gray-300">
                                        {renderRawJsonPayload(event.annotation)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                               <Button
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                onClick={() => setAddEventModalState({ isOpen: true, workflow, step, substep })}
                              >
                                <PlusCircle className="h-4 w-4 mr-2" />
                                Add Event
                              </Button>
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

      {/* Add Event Modal */}
      <Dialog open={addEventModalState.isOpen} onOpenChange={(isOpen) => setAddEventModalState(s => ({...s, isOpen}))}>
          <DialogContent className="max-w-3xl">
              <DialogHeader>
                  <DialogTitle>Add event to {addEventModalState.substep?.substep_name}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto p-4 space-y-2">
                  {localAnnotations.filter(a => !a.is_workflow_related).length > 0 ? (
                    localAnnotations.filter(a => !a.is_workflow_related).map(unrelatedEvent => (
                      <Card key={unrelatedEvent.analysis_id} className="p-3">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <div className="font-semibold">{unrelatedEvent.step_title || 'Untitled Event'}</div>
                            <div className="text-sm text-muted-foreground">{new Date(unrelatedEvent.created_at).toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">
                              {unrelatedEvent.inputs ? `Input: ${unrelatedEvent.inputs}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleEventExpansion(unrelatedEvent.raw_event_id || unrelatedEvent.analysis_id)}
                              className="h-8 w-8 p-0"
                            >
                              {expandedEvents.has(unrelatedEvent.raw_event_id || unrelatedEvent.analysis_id) ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                            <Button 
                              size="sm"
                              onClick={() => handleAddEventToWorkflow(
                                unrelatedEvent,
                                addEventModalState.workflow!,
                                addEventModalState.step!,
                                addEventModalState.substep!
                              )}
                            >
                                <PlusCircle className="h-4 w-4 mr-2" />
                                Add
                            </Button>
                          </div>
                        </div>

                        {/* Expandable Raw JSON Section for Add Event Modal */}
                        {expandedEvents.has(unrelatedEvent.raw_event_id || unrelatedEvent.analysis_id) && (
                          <div className="mt-3 pt-3 border-t">
                            {renderRawJsonPayload(unrelatedEvent)}
                          </div>
                        )}
                      </Card>
                    ))
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                        No available events to add.
                    </div>
                  )}
              </div>
          </DialogContent>
      </Dialog>


      {/* Summary Stats */}
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold">{filteredAnnotations.length}</div>
            <div className="text-sm text-muted-foreground">Total Mappings</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {filteredAnnotations.filter(a => a.is_workflow_related).length}
            </div>
            <div className="text-sm text-muted-foreground">Workflow Related</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-600">
              {filteredAnnotations.filter(a => !a.is_workflow_related).length}
            </div>
            <div className="text-sm text-muted-foreground">Unrelated</div>
          </div>
        </div>
      </Card>
    </div>
  );
}; 