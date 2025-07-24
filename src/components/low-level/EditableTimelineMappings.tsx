'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { 
  Edit2, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Search,
  Trash2,
  PlusCircle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Types - using the structure from timeline-event-mappings API
interface TimelineAnnotation {
  user_id: string;
  raw_event_id: number;
  analysis_id: number;
  confidence_score: number;
  is_workflow_related: boolean;
  model_used: string;
  unrelated_reason: string | null;
  workflow_template_id: number | null;
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
  workflow_substeps?: WorkflowSubstep[];
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
  workflows: CanvasContent[];
  onAnnotationsChange: (annotations: TimelineAnnotation[]) => void;
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

    // Types - combine workflow ID and index to ensure uniqueness
    workflowComponents.workflow_types?.forEach((type: WorkflowType, typeIndex: number) => {
      components.types.push({
        id: workflow.id * 1000000 + typeIndex + 1000000, // Unique across all workflows
        name: type.type_name,
        template_id: workflow.id
      });
    });

    // Instances - combine workflow ID and index to ensure uniqueness
    workflowComponents.workflow_instances?.forEach((instance: WorkflowInstance, instanceIndex: number) => {
      components.instances.push({
        id: workflow.id * 1000000 + instanceIndex + 2000000, // Unique across all workflows
        name: instance.instance_name,
        template_id: workflow.id
      });
    });

    // Steps and substeps - combine workflow ID and index to ensure uniqueness
    workflowComponents.steps?.forEach((step: WorkflowStep, stepIndex: number) => {
      const stepId = workflow.id * 1000000 + stepIndex + 3000000; // Unique across all workflows
      components.steps.push({
        id: stepId,
        name: step.step_name,
        template_id: workflow.id
      });

      step.workflow_substeps?.forEach((substep: WorkflowSubstep, substepIndex: number) => {
        components.substeps.push({
          id: workflow.id * 1000000 + substepIndex + 4000000, // Unique across all workflows
          name: substep.substep_name,
          step_id: stepId
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
}) => {
  // Local state management with debounced updates (same pattern as synthesis)
  const [localAnnotations, setLocalAnnotations] = useState<TimelineAnnotation[]>(annotations);
  
  // Note: readOnly mode support available if needed
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'related' | 'unrelated'>('all');
  const [sortBy, setSortBy] = useState<'timestamp' | 'confidence' | 'event_type'>('timestamp');
  const [viewMode, setViewMode] = useState<'events' | 'workflows'>('workflows');
  const [addEventModalState, setAddEventModalState] = useState<{
    isOpen: boolean;
    workflow: WorkflowInHierarchy | null;
    step: StepInHierarchy | null;
    substep: SubstepInHierarchy | null;
  }>({ isOpen: false, workflow: null, step: null, substep: null });

  // Keep local state in sync when parent updates
  useEffect(() => {
    setLocalAnnotations(annotations);
  }, [annotations]);

  // Debounce updates to parent to avoid excessive renders
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

    // Remove duplicates based on analysis_id, keep the latest one
    const deduplicatedMap = new Map();
    filtered.forEach(annotation => {
      const key = annotation.analysis_id;
      if (!deduplicatedMap.has(key) || 
          new Date(annotation.created_at) > new Date(deduplicatedMap.get(key).created_at)) {
        deduplicatedMap.set(key, annotation);
      }
    });

    const deduplicated = Array.from(deduplicatedMap.values());

    // Sort
    deduplicated.sort((a, b) => {
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

    return deduplicated;
  }, [localAnnotations, searchTerm, filterStatus, sortBy]);

  // Group annotations by workflow hierarchy for workflow view
  const workflowHierarchy = useMemo(() => {
    const workflows: Record<string, WorkflowInHierarchy> = {};

    filteredAnnotations
      .filter(a => a.is_workflow_related)
      .forEach(annotation => {
        const workflowKey = `${annotation.workflow_template_id || 'unknown'}`;
        const stepKey = `${annotation.workflow_step_id || 'unknown'}`;
        const substepKey = `${annotation.workflow_substep_id || 'unknown'}`;
        
        if (!workflows[workflowKey]) {
          workflows[workflowKey] = {
            template_id: annotation.workflow_template_id,
            template_name: annotation.template_name || 'Unknown Workflow',
            type_id: annotation.workflow_type_id,
            type_name: annotation.type_name || 'Unknown Type',
            instance_id: annotation.workflow_instance_id,
            instance_name: annotation.instance_name || 'Unknown Instance',
            steps: {}
          };
        }

        if (!workflows[workflowKey].steps[stepKey]) {
          workflows[workflowKey].steps[stepKey] = {
            step_id: annotation.workflow_step_id,
            step_name: annotation.step_name || 'Unknown Step',
            substeps: {}
          };
        }

        if (!workflows[workflowKey].steps[stepKey].substeps[substepKey]) {
          workflows[workflowKey].steps[stepKey].substeps[substepKey] = {
            substep_id: annotation.workflow_substep_id,
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

  const relatedCount = filteredAnnotations.filter(a => a.is_workflow_related).length;
  const unrelatedCount = filteredAnnotations.filter(a => !a.is_workflow_related).length;

  const handleAnnotationChange = (
    annotationIndex: number,
    field: keyof TimelineAnnotation,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any
  ) => {
    const updated = [...localAnnotations];
    const actualIndex = localAnnotations.findIndex(
      ann => ann.analysis_id === filteredAnnotations[annotationIndex].analysis_id
    );
    
    if (actualIndex !== -1) {
      updated[actualIndex] = {
        ...updated[actualIndex],
        [field]: value,
      };

      setLocalAnnotations(updated);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onAnnotationsChange(updated);
      }, 300);
    }
  };

  const handleRemoveEventFromWorkflow = (analysisId: number) => {
    const updated = [...localAnnotations];
    const actualIndex = updated.findIndex(ann => ann.analysis_id === analysisId);
    
    if (actualIndex !== -1) {
        updated[actualIndex] = {
            ...updated[actualIndex],
            is_workflow_related: false,
            workflow_template_id: null,
            workflow_type_id: null,
            workflow_instance_id: null,
            workflow_step_id: null,
            workflow_substep_id: null,
        };

        setLocalAnnotations(updated);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onAnnotationsChange(updated);
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
        updated[actualIndex] = {
            ...updated[actualIndex],
            is_workflow_related: true,
            workflow_template_id: workflow.template_id,
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
        
        setLocalAnnotations(updated);

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onAnnotationsChange(updated);
        }, 300);

        setAddEventModalState({ isOpen: false, workflow: null, step: null, substep: null });
    }
  };


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
        <span>Review and edit timeline event mappings below:</span>
      </div>

      {/* Search and Filter Controls */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search mappings..."
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
              <SelectItem value="all">All Mappings</SelectItem>
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

      {/* Mappings List */}
      {viewMode === 'events' ? (
        <div className="space-y-3">
          {filteredAnnotations.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>No timeline mappings found matching your criteria.</p>
            </Card>
          ) : (
            filteredAnnotations.map((annotation, index) => {
              
              return (
                <Card key={`${annotation.analysis_id}-${index}`} className={`${annotation.is_workflow_related ? 'ring-2 ring-primary' : ''}`}>
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
                            handleAnnotationChange(index, 'is_workflow_related', checked)
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
                            handleAnnotationChange(index, 'confidence_score', parseInt(e.target.value || '0') / 100)
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
                            value={annotation.workflow_template_id?.toString() || ""}
                            onValueChange={(value) => 
                              handleAnnotationChange(index, 'workflow_template_id', parseInt(value))
                            }
                          >
                            <SelectTrigger id={`template-${annotation.analysis_id}`} className="flex-1">
                              <SelectValue placeholder="Select template..." />
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
                              handleAnnotationChange(index, 'workflow_type_id', parseInt(value))
                            }
                          >
                            <SelectTrigger id={`type-${annotation.analysis_id}`} className="flex-1">
                              <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                              {workflowComponents.types
                                .filter(type => type.template_id === annotation.workflow_template_id)
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
                              handleAnnotationChange(index, 'workflow_instance_id', parseInt(value))
                            }
                          >
                            <SelectTrigger id={`instance-${annotation.analysis_id}`} className="flex-1">
                              <SelectValue placeholder="Select instance..." />
                            </SelectTrigger>
                            <SelectContent>
                              {workflowComponents.instances
                                .filter(instance => instance.template_id === annotation.workflow_template_id)
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
                              handleAnnotationChange(index, 'workflow_step_id', parseInt(value))
                            }
                          >
                            <SelectTrigger id={`step-${annotation.analysis_id}`} className="flex-1">
                              <SelectValue placeholder="Select step..." />
                            </SelectTrigger>
                            <SelectContent>
                              {workflowComponents.steps
                                .filter(step => step.template_id === annotation.workflow_template_id)
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
                              handleAnnotationChange(index, 'workflow_substep_id', value === "none" ? null : parseInt(value))
                            }
                          >
                            <SelectTrigger id={`substep-${annotation.analysis_id}`} className="flex-1">
                              <SelectValue placeholder="Select substep (optional)..." />
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
                      <div className="bg-gray-50 p-3 rounded-md border">
                        <div className="flex items-center space-x-2 mb-2">
                          <XCircle className="w-4 h-4 text-red-500" />
                          <span className="text-sm font-medium text-gray-700">Unrelated to Workflow</span>
                        </div>
                        {annotation.unrelated_reason && (
                          <p className="text-xs text-gray-600 italic">
                            <strong>Reason:</strong> {annotation.unrelated_reason}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Event Details Section */}
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
                            handleAnnotationChange(index, 'inputs', e.target.value || null)
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
                            handleAnnotationChange(index, 'outputs', e.target.value || null)
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
                            handleAnnotationChange(index, 'business_logics', e.target.value || null)
                          }
                          placeholder="Business rules governing this event..."
                          rows={2}
                          className="resize-none flex-1"
                        />
                      </div>
                    </div>

                    {/* Labeling Data Section */}
                    {((annotation.selected_labels?.length ?? 0) > 0 || (annotation.suggested_labels?.length ?? 0) > 0) && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium text-gray-700">Labeling Data</h4>
                        
                        {annotation.selected_labels && annotation.selected_labels.length > 0 && (
                          <div className="flex items-start space-x-3">
                            <Label className="min-w-[140px] text-sm pt-2">Human Labels:</Label>
                            <div className="flex-1">
                              <div className="text-sm text-gray-900 bg-gray-50 border rounded-md p-2 min-h-[2.5rem] whitespace-pre-wrap break-words">
                                {annotation.selected_labels.join('\n\n')}
                              </div>
                            </div>
                          </div>
                        )}

                        {annotation.suggested_labels && annotation.suggested_labels.length > 0 && (
                          <div className="flex items-start space-x-3">
                            <Label className="min-w-[140px] text-sm pt-2">AI Suggested Labels:</Label>
                            <div className="flex-1">
                              <div className="text-sm text-gray-700 bg-gray-50 border rounded-md p-2 min-h-[2.5rem] whitespace-pre-wrap break-words">
                                {annotation.suggested_labels.join('\n\n')}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
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

                            {/* Events in this substep */}
                            <div className="p-3 space-y-2">
                              {substep.events.map((event, eventIndex) => {
                                return (
                                  <div key={eventIndex} className={`border rounded-lg p-2 bg-gray-50`}>
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
                                      <Button variant="ghost" size="sm" onClick={() => handleRemoveEventFromWorkflow(event.annotation.analysis_id)}>
                                          <Trash2 className="h-4 w-4 text-red-500" />
                                      </Button>
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