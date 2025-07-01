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
import { Clock, CheckCircle, XCircle, AlertCircle, PlayCircle, Loader2, Code, FileText, Terminal, Activity } from 'lucide-react';

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
  [key: string]: unknown;
}

interface ValidationCheck {
  name: string;
  description: string;
  type: string;
  condition?: string;
}

interface ErrorHandlingRule {
  error_type: string;
  action: string;
  retry_count?: number;
  fallback?: string;
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
  total_steps: number;
  step_overview: Array<{
    step_number: number;
    action: string;
    description: string;
    estimated_duration: number;
  }>;
  required_applications: string[];
  input_parameters: Record<string, InputParameter>;
  expected_outputs: Record<string, unknown>;
  sample_inputs: Record<string, unknown>;
  statistics: {
    total_executions: number;
    successful_runs: number;
    failed_runs: number;
    success_rate_percent: number | null;
    reliability_score: string;
    last_successful_execution: string | null;
    last_failed_execution: string | null;
  };
  validation_checks: ValidationCheck[];
  error_handling: ErrorHandlingRule[];
  deployment_status: string;
  modal_function_name: string;
  last_updated: string;
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
  const [liveStats, setLiveStats] = useState<{ total_active: number; running: number; queued: number; average_progress: number }>({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
  const [loading, setLoading] = useState(true);
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(new Set());
  
  // New state for enhanced UI
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOverview | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

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
      const response = await fetch(`/api/remote-workflows/${workflowId}/overview`);
      const data = await response.json();
      if (response.ok) {
        setSelectedWorkflow(data);
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
      if (data.success) {
        setLiveExecutions(data.executions || []);
        setLiveStats(data.summary || { total_active: 0, running: 0, queued: 0, average_progress: 0 });
      }
    } catch (error) {
      console.error('Failed to fetch live executions:', error);
      setLiveExecutions([]);
      setLiveStats({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
    }
  }, []);

  // Execute workflow directly
  const executeWorkflow = async (workflow: Workflow) => {
    setExecutingWorkflows(prev => new Set([...prev, workflow.id]));
    
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: `web-${Date.now()}`,
          execution_mode: 'async',
          parameters: {} // Execute with default/empty parameters
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
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4" />;
      case 'cancelled':
        return <AlertCircle className="w-4 h-4" />;
      case 'queued':
        return <Clock className="w-4 h-4" />;
      default:
        return <Activity className="w-4 h-4" />;
    }
  };

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getReliabilityBadge = (score: string) => {
    const colors = {
      excellent: 'bg-black text-white',
      good: 'bg-gray-700 text-white',
      fair: 'bg-gray-500 text-white',
      poor: 'bg-gray-300 text-black',
      insufficient_data: 'bg-gray-100 text-gray-600'
    };
    return colors[score as keyof typeof colors] || 'bg-gray-100 text-gray-800';
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
              <p className="text-3xl font-mono font-bold text-black">{executions.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workflow Details Dialog */}
      <Dialog open={workflowDetailsOpen} onOpenChange={setWorkflowDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
                          <dd className="font-mono">{selectedWorkflow.statistics.total_executions}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Success Rate:</dt>
                          <dd className="font-mono">
                            {selectedWorkflow.statistics.success_rate_percent !== null 
                              ? `${selectedWorkflow.statistics.success_rate_percent}%` 
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Reliability:</dt>
                          <dd>
                            <Badge className={getReliabilityBadge(selectedWorkflow.statistics.reliability_score)}>
                              {selectedWorkflow.statistics.reliability_score.replace('_', ' ')}
                            </Badge>
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  
                  {selectedWorkflow.required_applications.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">Required Applications</h4>
                      <div className="flex gap-2">
                        {selectedWorkflow.required_applications.map((app, idx) => (
                          <Badge key={idx} variant="secondary">{app}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
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
                      {selectedWorkflow.step_overview.map((step) => (
                        <div key={step.step_number} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                          <div className="flex-shrink-0 w-8 h-8 bg-black text-white rounded-full flex items-center justify-center text-sm font-mono">
                            {step.step_number}
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-sm">{step.action.toUpperCase()}</div>
                            <div className="text-sm text-muted-foreground">{step.description}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Est. duration: {formatDuration(step.estimated_duration)}
                            </div>
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
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm">{rule.error_type}</span>
                              <Badge variant="secondary" className="text-xs">{rule.action}</Badge>
                            </div>
                            {rule.retry_count && (
                              <p className="text-sm text-muted-foreground">
                                Retry count: {rule.retry_count}
                              </p>
                            )}
                            {rule.fallback && (
                              <p className="text-sm text-muted-foreground">
                                Fallback: {rule.fallback}
                              </p>
                            )}
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
                          <dd className="font-mono text-xs truncate max-w-[200px]" title={selectedExecution.modal_call_id}>
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
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold font-mono">{workflow.name}</h3>
                      <span className="text-xs font-mono px-2 py-1 bg-black text-white rounded">
                        v{workflow.version || '1.0.0'}
                      </span>
                    </div>
                    <p className="text-black text-sm mb-2">{workflow.description}</p>
                    
                    {/* Workflow Metadata */}
                    <div className="flex flex-wrap gap-4 text-xs font-mono text-black mb-3">
                      <span>CATEGORY: {workflow.category?.toUpperCase() || 'GENERAL'}</span>
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
                  
                  <div className="flex flex-col items-end gap-2">
                    <Badge className={getStatusBadge(workflow.deployment_status)}>
                      {workflow.deployment_status.toUpperCase()}
                    </Badge>
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => fetchWorkflowOverview(workflow.id)}
                        variant="outline"
                        size="sm"
                        className="font-mono text-xs"
                        disabled={loadingDetails}
                      >
                        {loadingDetails ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                        <span className="ml-1">DETAILS</span>
                      </Button>
                      <Button 
                        onClick={() => executeWorkflow(workflow)}
                        className="bg-black text-white hover:bg-gray-800 font-mono text-xs"
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
                    </div>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent>
                {/* Live Executions for this workflow */}
                {(() => {
                  const workflowLiveExecutions = liveExecutions.filter(exec => exec.workflow_id === workflow.id);
                  
                  if (workflowLiveExecutions.length > 0) {
                    return (
                      <div className="mb-4">
                        <h4 className="text-sm font-bold font-mono mb-2 text-black flex items-center gap-2">
                          <Activity className="w-4 h-4" />
                          LIVE EXECUTIONS ({workflowLiveExecutions.length})
                        </h4>
                        <div className="space-y-2">
                          {workflowLiveExecutions.map((execution) => (
                            <div key={`live-${execution.id}`} className="bg-gray-50 p-3 border border-gray-200 rounded">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-black font-semibold">ID: {execution.id}</span>
                                  <Badge className={getStatusBadge(execution.status)}>
                                    {getStatusIcon(execution.status)}
                                    <span className="ml-1">{execution.status.toUpperCase()}</span>
                                  </Badge>
                                  {execution.status === 'running' && (
                                    <div className="w-2 h-2 bg-black rounded-full animate-pulse"></div>
                                  )}
                                </div>
                                <Button
                                  onClick={() => fetchExecutionDetails(execution.id)}
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs"
                                >
                                  <Code className="w-3 h-3" />
                                </Button>
                              </div>
                              
                              {/* Live execution progress */}
                              {execution.progress_percentage !== null && (
                                <div className="mb-2">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-mono text-black">Progress: {execution.progress_percentage}%</span>
                                    {execution.current_step_index && execution.total_steps && (
                                      <span className="text-xs font-mono text-black">
                                        Step {execution.current_step_index}/{execution.total_steps}
                                      </span>
                                    )}
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div 
                                      className="bg-black h-2 rounded-full transition-all duration-300" 
                                      style={{ width: `${execution.progress_percentage}%` }}
                                    ></div>
                                  </div>
                                  {execution.current_step_description && (
                                    <div className="text-xs font-mono text-black mt-1 truncate">
                                      {execution.current_step_description}
                                    </div>
                                  )}
                                  {execution.estimated_seconds_remaining && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      Est. time remaining: {formatDuration(execution.estimated_seconds_remaining)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  
                  return null;
                })()}
                
                {/* Recent Completed Executions */}
                {(() => {
                  const recentExecutions = executions
                    .filter(exec => exec.workflow_id === workflow.id)
                    .slice(0, 3);
                  
                  if (recentExecutions.length === 0) return null;
                  
                  return (
                    <div>
                      <h4 className="text-sm font-bold font-mono mb-2 text-black">RECENT EXECUTIONS</h4>
                      <div className="space-y-2">
                        {recentExecutions.map((execution) => (
                          <div key={`exec-${execution.execution_id}`} className="bg-white p-3 border border-black rounded">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-black font-semibold">
                                  #{execution.execution_id}
                                </span>
                                <Badge className={getStatusBadge(execution.status)}>
                                  {getStatusIcon(execution.status)}
                                  <span className="ml-1">{execution.status.toUpperCase()}</span>
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {formatDuration(execution.execution_duration_seconds)}
                                </span>
                                <Button
                                  onClick={() => fetchExecutionDetails(execution.execution_id)}
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs"
                                >
                                  <Code className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
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
