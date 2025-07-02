'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Clock, CheckCircle, XCircle, AlertCircle, PlayCircle, Loader2, FileText, Terminal, Activity, ChevronDown, ChevronRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Types for workflow system
interface AutomationStep {
  action?: string;
  description?: string;
  url?: string;
  selector?: string;
  step_number?: number;
  estimated_duration?: number;
  [key: string]: unknown;
}

interface InputParameter {
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  example?: unknown;
  values?: unknown[];
  [key: string]: unknown;
}

interface ValidationCheck {
  name: string;
  description: string;
  type: string;
  condition?: string;
}

interface ErrorHandlingRule {
  error_condition: string;
  recovery_actions: Array<{
    action: string;
    description: string;
  }>;
}

interface WorkflowOverview {
  id: number;
  name: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  difficulty_level: string;
  estimated_duration_seconds: number;
  total_steps?: number;
  automation_sequence: AutomationStep[];
  input_parameters: Record<string, InputParameter>;
  expected_outputs: Record<string, unknown>;
  sample_inputs: Record<string, unknown>;
  performance_metrics?: {
    successful_runs: number;
    failed_runs: number;
    total_executions: number;
    success_rate: number;
  };
  validation_checks: ValidationCheck[];
  error_handling: ErrorHandlingRule[];
  deployment_status: string;
  modal_function_name: string;
  last_updated?: string;
}

interface Workflow {
  id: number;
  name: string;
  description: string;
  version?: string;
  status?: string;
  category: string;
  tags: string[];
  difficulty_level: string;
  estimated_duration_seconds: number;
  success_rate: number | null;
  deployment_status: string;
  input_parameters: Record<string, InputParameter>;
  expected_outputs: Record<string, unknown>;
  successful_runs?: number;
  failed_runs?: number;
  total_executions?: number;
  automation_sequence?: AutomationStep[];
  validation_checks?: ValidationCheck[];
  error_handling?: ErrorHandlingRule[];
  sample_inputs?: Record<string, unknown>;
  modal_function_name?: string;
  last_successful_execution?: string;
  last_failed_execution?: string;
  reliability_score?: number;
}

interface ExecutionResult {
  quotes?: Array<{
    provider: string;
    premium: number;
    coverage: string;
    [key: string]: unknown;
  }>;
  error_details?: string;
  execution_summary?: {
    workflow_completed: boolean;
  };
  performance_metrics?: {
    successful_steps: number;
    failed_steps: number;
    total_steps: number;
  };
  error_stage?: string;
}

interface Execution {
  execution_id: number;
  workflow_id: number;
  workflow_name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'error';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  execution_duration_seconds?: number;
  modal_call_id: string;
  error_message?: string;
  client_id?: string;
  execution_params?: Record<string, unknown>;
  results?: ExecutionResult;
  formatted_output?: string;
  raw_logs?: string;
  raw_mcp_response?: Record<string, unknown>;
  execution_logs?: Array<{
    timestamp: string;
    level: string;
    message: string;
  }>;
  progress_percentage?: number;
  current_step_index?: number;
  total_steps?: number;
  current_step_description?: string;
}

interface LiveExecutionStatus {
  id: number;
  workflow_id: number;
  workflow_name: string;
  workflow_description: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress_percentage: number;
  current_step_index: number;
  total_steps: number;
  current_step_description: string | null;
  step_start_time: string | null;
  estimated_completion_time: string | null;
  started_at: string | null;
  created_at: string;
  execution_duration_seconds: number | null;
  modal_call_id: string;
  client_id: string;
  estimated_seconds_remaining: number | null;
  steps_per_minute: number | null;
  runtime_seconds?: number;
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [liveStats, setLiveStats] = useState({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
  const [loading, setLoading] = useState(true);
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(new Set());
  
  // New state for enhanced UI
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOverview | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [expandedExecutions, setExpandedExecutions] = useState<Set<number>>(new Set());
  const [localTimeOffsets, setLocalTimeOffsets] = useState<Map<number, number>>(new Map());
  const [executionParams, setExecutionParams] = useState<Record<number, Record<string, unknown>>>({});
  const [showParamsDropdown, setShowParamsDropdown] = useState<Record<number, boolean>>({});

  // Toggle execution history expansion
  const toggleExecutionHistory = (workflowId: number) => {
    setExpandedExecutions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(workflowId)) {
        newSet.delete(workflowId);
      } else {
        newSet.add(workflowId);
      }
      return newSet;
    });
  };

  // Fetch workflows
  const fetchWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/remote-workflows/list');
      const data = await response.json();
      if (data.success) {
        setWorkflows(data.workflows || []);
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch detailed workflow overview
  const fetchWorkflowOverview = useCallback(async (workflowId: number) => {
    try {
      setLoadingDetails(true);
      const response = await fetch(`/api/remote-workflows/${workflowId}`);
      const data = await response.json();
      if (response.ok && data.success) {
        setSelectedWorkflow(data.workflow);
        setWorkflowDetailsOpen(true);
      }
    } catch (error) {
      console.error('Failed to fetch workflow overview:', error);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  // Fetch detailed execution data
  const fetchExecutionDetails = useCallback(async (executionId: number) => {
    try {
      setLoadingDetails(true);
      const response = await fetch(`/api/remote-workflows/executions/${executionId}`);
      const data = await response.json();
      if (data.success) {
        setSelectedExecution(data.execution);
        setExecutionDetailsOpen(true);
      }
    } catch (error) {
      console.error('Failed to fetch execution details:', error);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  // Fetch executions
  const fetchExecutions = useCallback(async () => {
    try {
      const response = await fetch('/api/remote-workflows/executions');
      const data = await response.json();
      if (data.success) {
        setExecutions(data.executions || []);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
      setExecutions([]);
    }
  }, []);

  // Fetch live executions
  const fetchLiveExecutions = useCallback(async () => {
    try {
      const response = await fetch('/api/remote-workflows/executions/live?status=active&limit=20');
      if (!response.ok) {
        // API endpoint might not be available yet (migration not run)
        setLiveExecutions([]);
        setLiveStats({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
        return;
      }
      const data = await response.json();
      if (data.success && data.data) {
        setLiveExecutions(data.data.executions || []);
        setLiveStats(data.data.summary || { total_active: 0, running: 0, queued: 0, average_progress: 0 });
      } else {
        setLiveExecutions([]);
        setLiveStats({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
      }
    } catch (error) {
      console.error('Failed to fetch live executions:', error);
      setLiveExecutions([]);
      setLiveStats({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
    }
  }, []);

  // Execute workflow with optional custom parameters
  const executeWorkflow = async (workflow: Workflow, customParams?: Record<string, unknown>) => {
    setExecutingWorkflows(prev => new Set([...prev, workflow.id]));
    
    try {
      const params = customParams || executionParams[workflow.id] || workflow.sample_inputs || {};
      
      const response = await fetch(`/api/remote-workflows/${workflow.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: `web-${Date.now()}`,
          execution_mode: 'async',
          parameters: params
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        // Add to executions list
        setExecutions(prev => [
          {
            execution_id: result.execution_id,
            workflow_id: workflow.id,
            workflow_name: result.workflow_name || workflow.name,
            status: result.status,
            created_at: result.created_at,
            modal_call_id: result.modal_call_id
          },
          ...prev
        ]);
      } else {
        alert(`Execution failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to execute workflow:', error);
      alert('Failed to execute workflow');
    }
    
    setExecutingWorkflows(prev => {
      const newSet = new Set(prev);
      newSet.delete(workflow.id);
      return newSet;
    });
  };

  // Generate sample inputs from input_parameters
  const generateSampleInputs = (inputParams: Record<string, InputParameter>): Record<string, unknown> => {
    const samples: Record<string, unknown> = {};
    Object.entries(inputParams).forEach(([key, param]) => {
      if (param.example) {
        samples[key] = param.example;
      } else if (param.default !== undefined) {
        samples[key] = param.default;
      } else {
        // Generate default based on type
        switch (param.type) {
          case 'string':
          case 'enum':
            samples[key] = param.values?.[0] || 'example';
            break;
          case 'number':
            samples[key] = 0;
            break;
          case 'boolean':
            samples[key] = false;
            break;
          default:
            samples[key] = '';
        }
      }
    });
    return samples;
  };

  // Initialize execution parameters for a workflow
  const initializeParams = (workflow: Workflow) => {
    if (!executionParams[workflow.id]) {
      // Use sample_inputs if available, otherwise generate from input_parameters
      const params = workflow.sample_inputs && Object.keys(workflow.sample_inputs).length > 0
        ? workflow.sample_inputs
        : generateSampleInputs(workflow.input_parameters || {});
      setExecutionParams(prev => ({
        ...prev,
        [workflow.id]: params
      }));
    }
  };

  // Update parameter value
  const updateParam = (workflowId: number, key: string, value: string) => {
    setExecutionParams(prev => ({
      ...prev,
      [workflowId]: {
        ...prev[workflowId],
        [key]: value
      }
    }));
  };

  // Initial load
  useEffect(() => {
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions]);

  // Auto-refresh executions and live status
  useEffect(() => {
    const interval = setInterval(() => {
      fetchExecutions();
      fetchLiveExecutions();
    }, 2000); // Refresh every 2 seconds for live updates
    return () => clearInterval(interval);
  }, [fetchExecutions, fetchLiveExecutions]);

  // Local timer for smooth second updates on running executions
  useEffect(() => {
    const timer = setInterval(() => {
      setLocalTimeOffsets(prev => {
        const newMap = new Map(prev);
        liveExecutions.forEach(exec => {
          if (exec.status === 'running' && exec.started_at) {
            const startTime = new Date(exec.started_at).getTime();
            const now = Date.now();
            const runtimeSeconds = Math.floor((now - startTime) / 1000);
            newMap.set(exec.id, runtimeSeconds);
          } else {
            newMap.delete(exec.id);
          }
        });
        return newMap;
      });
    }, 1000); // Update every second
    
    return () => clearInterval(timer);
  }, [liveExecutions]);

  const getStatusBadge = (status: string) => {
    const colors = {
      deployed: 'bg-black text-white',
      pending: 'bg-gray-200 text-black',
      error: 'bg-red-800 text-white',
      running: 'bg-black text-white',
      completed: 'bg-black text-white',
      failed: 'bg-red-600 text-white',
      cancelled: 'bg-gray-600 text-white',
      queued: 'bg-gray-400 text-white'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-black';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-2.5 h-2.5 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-2.5 h-2.5" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-2.5 h-2.5" />;
      case 'cancelled':
        return <AlertCircle className="w-2.5 h-2.5" />;
      case 'queued':
        return <Clock className="w-2.5 h-2.5" />;
      default:
        return <Activity className="w-2.5 h-2.5" />;
    }
  };

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };



  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg font-mono">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Remote Workflow Execution</h1>
          <p className="text-muted-foreground">Execute and monitor automated workflows remotely</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => window.open('/docs/api/remote-workflows', '_blank')}
            variant="outline" 
            size="sm" 
            className="bg-white text-black border-black hover:bg-black hover:text-white"
          >
            API DOCS
          </Button>
          <Button 
            onClick={() => window.open('https://www.postman.com/matt-3648038/mediar-deployed-workflows-workspace/overview', '_blank')}
            variant="outline" 
            size="sm" 
            className="bg-white text-black border-black hover:bg-black hover:text-white"
          >
            POSTMAN COLLECTION
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-sm font-mono text-black">AVAILABLE WORKFLOWS</p>
              <p className="text-3xl font-mono font-bold text-black">{workflows.length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-sm font-mono text-black">ACTIVE EXECUTIONS</p>
              <p className="text-3xl font-mono font-bold text-black">
                {liveStats.total_active || executions.filter(e => e.status === 'running' || e.status === 'queued').length}
              </p>
              {liveStats.running > 0 && (
                <p className="text-xs font-mono text-black mt-1">
                  {liveStats.running} RUNNING • {Math.round(liveStats.average_progress)}% AVG
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-sm font-mono text-black">SUCCESS RATE</p>
              <p className="text-3xl font-mono font-bold text-black">
                {workflows.length > 0 
                  ? `${Math.round(workflows.reduce((acc, w) => acc + (w.success_rate || 0), 0) / workflows.length)}%`
                  : '0%'
                }
              </p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-sm font-mono text-black">TOTAL EXECUTIONS</p>
              <p className="text-3xl font-mono font-bold text-black">
                {workflows.reduce((total, workflow) => total + (workflow.total_executions || 0), 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workflow Details Dialog */}
      <Dialog open={workflowDetailsOpen} onOpenChange={setWorkflowDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto !mt-8 !mb-8 !top-8 !transform-none !translate-y-0">
          {selectedWorkflow && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">{selectedWorkflow.name}</DialogTitle>
                <DialogDescription>{selectedWorkflow.description}</DialogDescription>
              </DialogHeader>
              
              <Tabs defaultValue="overview" className="mt-6">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="steps">Steps</TabsTrigger>
                  <TabsTrigger value="parameters">Parameters</TabsTrigger>
                  <TabsTrigger value="validation">Validation</TabsTrigger>
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                </TabsList>
                
                <TabsContent value="overview" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold mb-2">Metadata</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Version:</dt>
                          <dd className="font-mono">{selectedWorkflow.version}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Category:</dt>
                          <dd className="font-mono">{selectedWorkflow.category}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Difficulty:</dt>
                          <dd className="font-mono">{selectedWorkflow.difficulty_level}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Est. Duration:</dt>
                          <dd className="font-mono">{formatDuration(selectedWorkflow.estimated_duration_seconds)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Total Steps:</dt>
                          <dd className="font-mono">{selectedWorkflow.total_steps}</dd>
                        </div>
                      </dl>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold mb-2">Performance</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Total Runs:</dt>
                          <dd className="font-mono">{selectedWorkflow.performance_metrics?.total_executions || 0}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Success Rate:</dt>
                          <dd className="font-mono">
                            {selectedWorkflow.performance_metrics?.success_rate !== undefined
                              ? `${selectedWorkflow.performance_metrics.success_rate}%` 
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Successful:</dt>
                          <dd className="font-mono">{selectedWorkflow.performance_metrics?.successful_runs || 0}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  

                  
                  {selectedWorkflow.tags.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">Tags</h4>
                      <div className="flex flex-wrap gap-1">
                        {selectedWorkflow.tags.map((tag, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="steps" className="space-y-4">
                  <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                    <div className="space-y-3">
                      {selectedWorkflow.automation_sequence.map((step, idx) => (
                        <div key={step.step_number || idx + 1} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                          <div className="flex-shrink-0 w-8 h-8 bg-black text-white rounded-full flex items-center justify-center text-sm font-mono">
                            {step.step_number || idx + 1}
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-sm">{(step.action || 'unknown').toUpperCase()}</div>
                            <div className="text-sm text-muted-foreground">{step.description || 'No description'}</div>
                            {step.selector && (
                              <div className="text-xs font-mono bg-gray-200 px-2 py-1 rounded mt-1">
                                {step.selector}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
                
                <TabsContent value="parameters" className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-3">Input Parameters</h4>
                    {Object.keys(selectedWorkflow.input_parameters).length > 0 ? (
                      <div className="space-y-2">
                        {Object.entries(selectedWorkflow.input_parameters).map(([key, param]) => (
                          <div key={key} className="border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <code className="text-sm font-mono">{key}</code>
                              <Badge variant="secondary" className="text-xs">
                                {param.type || 'string'}
                              </Badge>
                            </div>
                            {param.description && (
                              <p className="text-sm text-muted-foreground">{param.description}</p>
                            )}
                            {param.required && (
                              <Badge variant="destructive" className="text-xs mt-1">Required</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No input parameters required</p>
                    )}
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <h4 className="font-semibold mb-3">Sample Input</h4>
                    <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
                      <code className="text-sm">
                        {JSON.stringify(selectedWorkflow.sample_inputs, null, 2)}
                      </code>
                    </pre>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-3">Expected Outputs</h4>
                    <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
                      <code className="text-sm">
                        {JSON.stringify(selectedWorkflow.expected_outputs, null, 2)}
                      </code>
                    </pre>
                  </div>
                </TabsContent>
                
                <TabsContent value="validation" className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-3">Validation Checks</h4>
                    {selectedWorkflow.validation_checks.length > 0 ? (
                      <div className="space-y-2">
                        {selectedWorkflow.validation_checks.map((check, idx) => (
                          <div key={idx} className="border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm">{check.name}</span>
                              <Badge variant="outline" className="text-xs">{check.type}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{check.description}</p>
                            {check.condition && (
                              <code className="text-xs bg-gray-100 px-2 py-1 rounded mt-1 inline-block">
                                {check.condition}
                              </code>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No validation checks defined</p>
                    )}
                  </div>
                  
                  <Separator />
                  
                                      <div>
                      <h4 className="font-semibold mb-3">Error Handling Rules</h4>
                      {selectedWorkflow.error_handling.length > 0 ? (
                        <div className="space-y-2">
                          {selectedWorkflow.error_handling.map((rule, idx) => (
                            <div key={idx} className="border rounded-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-sm">{rule.error_condition}</span>
                              </div>
                              <div className="space-y-1">
                                {rule.recovery_actions.map((recovery, recoveryIdx) => (
                                  <div key={recoveryIdx} className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-xs">{recovery.action}</Badge>
                                    <span className="text-sm text-muted-foreground">{recovery.description}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No error handling rules defined</p>
                      )}
                    </div>
                </TabsContent>
                
                <TabsContent value="usage" className="space-y-4">
                  <Alert>
                    <Terminal className="h-4 w-4" />
                    <AlertDescription>
                      Execute this workflow by making a POST request to the execution endpoint
                    </AlertDescription>
                  </Alert>
                  
                  <div>
                    <h4 className="font-semibold mb-2">cURL Example</h4>
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                      <code className="text-sm">
{`curl -X POST \\
  https://app.mediar.ai/api/remote-workflows/${selectedWorkflow.id}/execute \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(selectedWorkflow.sample_inputs || {}, null, 2)}'`}
                      </code>
                    </pre>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2">JavaScript Example</h4>
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                      <code className="text-sm">
{`fetch('/api/remote-workflows/${selectedWorkflow.id}/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(selectedWorkflow.sample_inputs || {}, null, 2)})
}).then(response => response.json())`}
                      </code>
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Execution Details Dialog */}
      <Dialog open={executionDetailsOpen} onOpenChange={setExecutionDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto !mt-8 !mb-8 !top-8 !transform-none !translate-y-0">
          {selectedExecution && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl flex items-center gap-2">
                  Execution #{selectedExecution.execution_id}
                  <Badge className={getStatusBadge(selectedExecution.status)}>
                    {getStatusIcon(selectedExecution.status)}
                    <span className="ml-1">{selectedExecution.status.toUpperCase()}</span>
                  </Badge>
                </DialogTitle>
                <DialogDescription>{selectedExecution.workflow_name}</DialogDescription>
              </DialogHeader>
              
              <Tabs defaultValue="summary" className="mt-6">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                  <TabsTrigger value="results">Results</TabsTrigger>
                  <TabsTrigger value="debug">Debug</TabsTrigger>
                </TabsList>
                
                <TabsContent value="summary" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold mb-2">Execution Info</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Workflow ID:</dt>
                          <dd className="font-mono">{selectedExecution.workflow_id}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Client ID:</dt>
                          <dd className="font-mono text-xs">{selectedExecution.client_id || '—'}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Modal Call ID:</dt>
                          <dd className="font-mono text-xs truncate max-w-[400px]" title={selectedExecution.modal_call_id}>
                            {selectedExecution.modal_call_id}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold mb-2">Timing</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Created:</dt>
                          <dd className="text-xs">{new Date(selectedExecution.created_at).toLocaleString()}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Started:</dt>
                          <dd className="text-xs">
                            {selectedExecution.started_at 
                              ? new Date(selectedExecution.started_at).toLocaleString() 
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Completed:</dt>
                          <dd className="text-xs">
                            {selectedExecution.completed_at 
                              ? new Date(selectedExecution.completed_at).toLocaleString() 
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Duration:</dt>
                          <dd className="font-mono">{formatDuration(selectedExecution.execution_duration_seconds)}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  
                  {selectedExecution.error_message && (
                    <Alert variant="default" className="border-black bg-gray-100">
                      <XCircle className="h-4 w-4" />
                      <AlertDescription>{selectedExecution.error_message}</AlertDescription>
                    </Alert>
                  )}
                  
                  {selectedExecution.execution_params && Object.keys(selectedExecution.execution_params).length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">Execution Parameters</h4>
                      <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
                        <code className="text-sm">
                          {JSON.stringify(selectedExecution.execution_params, null, 2)}
                        </code>
                      </pre>
                    </div>
                  )}
                  
                  {selectedExecution.formatted_output && (
                    <div>
                      <h4 className="font-semibold mb-2">Formatted Output</h4>
                      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                        <code className="text-sm">
                          {selectedExecution.formatted_output}
                        </code>
                      </pre>
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="logs" className="space-y-4">
                  {selectedExecution.execution_logs && selectedExecution.execution_logs.length > 0 ? (
                    <ScrollArea className="h-[400px] w-full rounded-md border">
                      <div className="p-4 space-y-2">
                        {selectedExecution.execution_logs.map((log, idx) => (
                          <div key={idx} className="flex gap-2 text-xs font-mono">
                            <span className="text-muted-foreground">{log.timestamp}</span>
                            <Badge variant={log.level === 'error' ? 'outline' : 'secondary'} className={log.level === 'error' ? 'border-black text-black' : 'text-xs'}>
                              {log.level}
                            </Badge>
                            <span className="flex-1">{log.message}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No execution logs available</p>
                  )}
                </TabsContent>
                
                <TabsContent value="results" className="space-y-4">
                  {selectedExecution.results ? (
                    <div>
                      <h4 className="font-semibold mb-2">Execution Results</h4>
                      <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
                        <code className="text-sm">
                          {JSON.stringify(selectedExecution.results, null, 2)}
                        </code>
                      </pre>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No results available</p>
                  )}
                </TabsContent>
                
                <TabsContent value="debug" className="space-y-4">
                  {selectedExecution.raw_logs && (
                    <div>
                      <h4 className="font-semibold mb-2">Raw Logs</h4>
                      <ScrollArea className="h-[300px] w-full rounded-md border">
                        <pre className="p-4 text-xs">
                          <code>{selectedExecution.raw_logs}</code>
                        </pre>
                      </ScrollArea>
                    </div>
                  )}
                  
                  {selectedExecution.raw_mcp_response && (
                    <div>
                      <h4 className="font-semibold mb-2">Raw MCP Response</h4>
                      <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs">
                        <code>
                          {JSON.stringify(selectedExecution.raw_mcp_response, null, 2)}
                        </code>
                      </pre>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Available Workflows */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold font-mono mb-4">AVAILABLE WORKFLOWS</h2>
        <div className="grid gap-4">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="border-black">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold font-mono">{workflow.name}</h3>
                      <span className="text-xs font-mono px-2 py-1 bg-black text-white rounded">
                        v{workflow.version || '1.0.0'}
                      </span>
                      <Button 
                        onClick={() => fetchWorkflowOverview(workflow.id)}
                        variant="outline"
                        size="sm"
                        className="font-mono text-xs h-6"
                        disabled={loadingDetails}
                      >
                        {loadingDetails ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                        <span className="ml-1">DETAILS</span>
                      </Button>
                    </div>
                    <p className="text-black text-sm mb-2">{workflow.description}</p>
                    
                    {/* Workflow Metadata */}
                    <div className="flex flex-wrap gap-4 text-xs font-mono text-black mb-3">
                      <span>DIFFICULTY: {workflow.difficulty_level?.toUpperCase() || 'MEDIUM'}</span>
                      {workflow.estimated_duration_seconds && (
                        <span>EST. DURATION: {formatDuration(workflow.estimated_duration_seconds)}</span>
                      )}
                    </div>
                    
                    {/* Tags */}
                    {workflow.tags && workflow.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {workflow.tags.map((tag: string, index: number) => (
                          <span key={`${workflow.id}-tag-${index}`} className="text-xs px-2 py-1 bg-white text-black border border-black rounded font-mono">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {/* Execution Stats */}
                    <div className="flex gap-4 text-xs font-mono text-black">
                      <span>RUNS: {workflow.total_executions || 0}</span>
                      <span className="text-gray-700">SUCCESS: {workflow.successful_runs || 0}</span>
                      <span className="text-red-600">FAILED: {workflow.failed_runs || 0}</span>
                      {(workflow.total_executions || 0) > 0 && (
                        <span>SUCCESS RATE: {Math.round(((workflow.successful_runs || 0) / (workflow.total_executions || 1)) * 100)}%</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end">
                    <Badge className={getStatusBadge(workflow.deployment_status)}>
                      {workflow.deployment_status.toUpperCase()}
                    </Badge>
                    {/* Check input_parameters instead of sample_inputs for dropdown */}
                    {workflow.input_parameters && Object.keys(workflow.input_parameters).length > 0 ? (
                      <DropdownMenu open={showParamsDropdown[workflow.id]} onOpenChange={(open) => {
                        if (open) {
                          initializeParams(workflow);
                        }
                        setShowParamsDropdown(prev => ({ ...prev, [workflow.id]: open }));
                      }}>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            className="bg-black text-white hover:bg-gray-800 font-mono text-xs mt-16"
                            disabled={workflow.deployment_status !== 'deployed' || executingWorkflows.has(workflow.id)}
                            size="sm"
                          >
                            {executingWorkflows.has(workflow.id) ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                RUNNING...
                              </>
                            ) : (
                              <>
                                <PlayCircle className="w-3 h-3 mr-1" />
                                TEST RUN
                                <ChevronDown className="w-3 h-3 ml-1" />
                              </>
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-80 p-4" align="end">
                          <div className="space-y-4">
                            <div className="font-mono text-sm font-bold">EXECUTION PARAMETERS</div>
                            
                            <div className="space-y-3">
                              {Object.entries(workflow.input_parameters).map(([key, param]) => (
                                <div key={key} className="space-y-1">
                                  <Label htmlFor={`${workflow.id}-${key}`} className="text-xs font-mono">
                                    {key}
                                    {param.required && <span className="text-red-500 ml-1">*</span>}
                                  </Label>
                                  <Input
                                    id={`${workflow.id}-${key}`}
                                    value={String(executionParams[workflow.id]?.[key] ?? param.example ?? param.default ?? '')}
                                    onChange={(e) => updateParam(workflow.id, key, e.target.value)}
                                    className="h-8 text-xs font-mono"
                                    placeholder={String(param.example || param.default || `Enter ${param.type || 'value'}`)}
                                  />
                                  {param.description && (
                                    <p className="text-xs text-muted-foreground">{param.description}</p>
                                  )}
                                </div>
                              ))}
                              
                              <div className="flex gap-2 pt-2">
                                <Button
                                  onClick={() => {
                                    executeWorkflow(workflow);
                                    setShowParamsDropdown(prev => ({ ...prev, [workflow.id]: false }));
                                  }}
                                  className="bg-black text-white hover:bg-gray-800 font-mono text-xs flex-1"
                                  size="sm"
                                  disabled={executingWorkflows.has(workflow.id)}
                                >
                                  <PlayCircle className="w-3 h-3 mr-1" />
                                  RUN WITH PARAMS
                                </Button>
                                <Button
                                  onClick={() => setShowParamsDropdown(prev => ({ ...prev, [workflow.id]: false }))}
                                  variant="outline"
                                  className="font-mono text-xs"
                                  size="sm"
                                >
                                  CANCEL
                                </Button>
                              </div>
                            </div>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Button 
                        onClick={() => executeWorkflow(workflow)}
                        className="bg-black text-white hover:bg-gray-800 font-mono text-xs mt-16"
                        disabled={workflow.deployment_status !== 'deployed' || executingWorkflows.has(workflow.id)}
                        size="sm"
                      >
                        {executingWorkflows.has(workflow.id) ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            RUNNING...
                          </>
                        ) : (
                          <>
                            <PlayCircle className="w-3 h-3 mr-1" />
                            TEST RUN
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              
              <CardContent>
                {/* Execution History Dropdown */}
                {(() => {
                  // Sort function to prioritize running executions
                  const statusPriority = (status: string) => {
                    switch (status) {
                      case 'running': return 0;
                      case 'queued': return 1;
                      case 'failed':
                      case 'error': return 2;
                      default: return 3;
                    }
                  };
                  
                  const workflowLiveExecutions = liveExecutions
                    .filter(exec => exec.workflow_id === workflow.id)
                    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status));
                    
                  const recentExecutions = executions
                    .filter(exec => exec.workflow_id === workflow.id)
                    .filter(exec => !['running', 'queued'].includes(exec.status)) // Exclude running/queued since they're in live section
                    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status));
                  
                  const hasExecutions = workflowLiveExecutions.length > 0 || recentExecutions.length > 0;
                  
                  if (!hasExecutions) return null;
                  
                  return (
                    <Collapsible open={expandedExecutions.has(workflow.id)}>
                      <CollapsibleTrigger 
                        onClick={() => toggleExecutionHistory(workflow.id)}
                        className="w-full"
                      >
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded hover:bg-gray-100 transition-colors cursor-pointer">
                          <div className="flex items-center gap-2">
                            {expandedExecutions.has(workflow.id) ? 
                              <ChevronDown className="w-4 h-4" /> : 
                              <ChevronRight className="w-4 h-4" />
                            }
                            <span className="text-sm font-bold font-mono text-black">EXECUTION HISTORY</span>
                            <div className="flex gap-2">
                              {workflowLiveExecutions.length > 0 && (
                                <Badge variant="secondary" className="text-xs">
                                  {workflowLiveExecutions.length} LIVE
                                </Badge>
                              )}
                              {recentExecutions.length > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  {recentExecutions.length} RECENT
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent>
                        <div className="mt-2 max-h-[300px] overflow-y-auto p-2 border rounded-lg bg-white">
                          {/* Live Executions */}
                          {workflowLiveExecutions.length > 0 && (
                            <div className="mb-2">
                              <h4 className="text-sm font-bold font-mono mb-1 text-black flex items-center gap-2">
                                <Activity className="w-4 h-4" />
                                LIVE EXECUTIONS ({workflowLiveExecutions.length})
                              </h4>
                              <div className="space-y-1">
                                {workflowLiveExecutions.map((execution) => (
                                  <div 
                                    key={`live-${execution.id}`} 
                                    className="bg-gray-50 px-2 py-1 border border-gray-200 rounded hover:bg-gray-100 hover:border-gray-400 cursor-pointer transition-colors"
                                    onClick={() => fetchExecutionDetails(execution.id)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-mono text-black font-semibold">#{execution.id}</span>
                                      <Badge className={`${getStatusBadge(execution.status)} h-5 px-1.5 text-xs`}>
                                        {getStatusIcon(execution.status)}
                                        <span className="ml-0.5">{execution.status.toUpperCase()}</span>
                                      </Badge>
                                      {execution.status === 'running' && (
                                        <div className="w-1.5 h-1.5 bg-black rounded-full animate-pulse"></div>
                                      )}
                                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        {execution.started_at && (
                                          <span className="flex items-center gap-0.5">
                                            <Clock className="w-2.5 h-2.5" />
                                            Started {new Date(execution.started_at).toLocaleTimeString('en-US', { 
                                              hour: '2-digit', 
                                              minute: '2-digit'
                                            })}
                                          </span>
                                        )}
                                        {(execution.runtime_seconds !== undefined || localTimeOffsets.has(execution.id)) && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span className="font-mono">
                                              {(() => {
                                                const seconds = localTimeOffsets.get(execution.id) ?? execution.runtime_seconds ?? 0;
                                                if (execution.status === 'running') {
                                                  // For running executions, show both raw seconds and formatted
                                                  return (
                                                    <>
                                                      <span className="text-black font-bold">{seconds}s</span>
                                                      {seconds >= 60 && (
                                                        <span className="text-gray-500 ml-1">({formatDuration(seconds)})</span>
                                                      )}
                                                    </>
                                                  );
                                                } else {
                                                  // For completed/failed, just show formatted
                                                  return formatDuration(seconds);
                                                }
                                              })()}
                                            </span>
                                          </>
                                        )}
                                        {execution.progress_percentage !== undefined && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span>{execution.progress_percentage}%</span>
                                          </>
                                        )}
                                        {execution.current_step_description && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span className="text-blue-600 truncate inline-block max-w-[550px]" title={execution.current_step_description}>
                                              {execution.current_step_description}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Separator if both sections exist */}
                          {workflowLiveExecutions.length > 0 && recentExecutions.length > 0 && (
                            <Separator className="my-2" />
                          )}
                          
                          {/* Recent Completed Executions */}
                          {recentExecutions.length > 0 && (
                            <div>
                              <h4 className="text-sm font-bold font-mono mb-1 text-black">RECENT EXECUTIONS</h4>
                              <div className="space-y-1">
                                {recentExecutions.map((execution) => (
                                  <div 
                                    key={`exec-${execution.execution_id}`} 
                                    className="bg-white px-2 py-1 border border-black rounded hover:bg-gray-50 hover:border-gray-600 cursor-pointer transition-colors"
                                    onClick={() => fetchExecutionDetails(execution.execution_id)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-mono text-black font-semibold">
                                        #{execution.execution_id}
                                      </span>
                                      <Badge className={`${getStatusBadge(execution.status)} h-5 px-1.5 text-xs`}>
                                        {getStatusIcon(execution.status)}
                                        <span className="ml-0.5">{execution.status.toUpperCase()}</span>
                                      </Badge>
                                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        {execution.completed_at && (
                                          <span className="flex items-center gap-0.5">
                                            <Clock className="w-2.5 h-2.5" />
                                            {new Date(execution.completed_at).toLocaleString('en-US', { 
                                              month: 'short', 
                                              day: 'numeric', 
                                              hour: '2-digit', 
                                              minute: '2-digit'
                                            })}
                                          </span>
                                        )}
                                        {execution.execution_duration_seconds !== undefined && execution.execution_duration_seconds !== null && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span>{formatDuration(execution.execution_duration_seconds)}</span>
                                          </>
                                        )}
                                        {/* Show contextual info based on status */}
                                        {execution.status === 'failed' && execution.error_message && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span className="text-red-600 truncate inline-block max-w-[550px]" title={execution.error_message}>
                                              {execution.error_message}
                                            </span>
                                          </>
                                        )}
                                        {execution.status === 'completed' && execution.formatted_output && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span className="text-green-700 truncate inline-block max-w-[550px]" title={execution.formatted_output}>
                                              {execution.formatted_output.split('\n')[0]}
                                            </span>
                                          </>
                                        )}
                                        {execution.status === 'running' && execution.current_step_description && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span className="text-blue-600 truncate inline-block max-w-[550px]" title={execution.current_step_description}>
                                              {execution.current_step_description}
                                            </span>
                                          </>
                                        )}
                                        {/* Show progress for running/queued */}
                                        {['running', 'queued'].includes(execution.status) && execution.progress_percentage !== undefined && (
                                          <>
                                            <span className="text-gray-400">•</span>
                                            <span>{execution.progress_percentage}%</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
