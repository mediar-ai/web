'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// Types for workflow system
interface AutomationStep {
  action?: string;
  description?: string;
  url?: string;
  selector?: string;
  [key: string]: unknown;
}

interface InputParameter {
  type?: string;
  [key: string]: unknown;
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
}

interface Execution {
  execution_id: number;
  workflow_id: number;
  workflow_name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  execution_duration_seconds?: number;
  modal_call_id: string;
  error_message?: string;
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
      error: 'bg-gray-800 text-white'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-black';
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
            onClick={() => window.open('https://www.postman.com/matt-3648038/mediar-deployed-workflows-workspace/overview', '_blank')}
            variant="outline" 
            size="sm" 
            className="bg-white text-black border-black hover:bg-black hover:text-white"
          >
            📮 POSTMAN COLLECTION
          </Button>
          <Button onClick={fetchWorkflows} variant="outline" size="sm" className="bg-white text-black border-black hover:bg-black hover:text-white">
            REFRESH
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
              <p className="text-sm font-mono text-black">INFRASTRUCTURE</p>
              <p className="text-3xl font-mono font-bold text-black">{executions.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

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
                        <span>EST. DURATION: {Math.round(workflow.estimated_duration_seconds / 60)}min</span>
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
                      <span className="text-green-600">SUCCESS: {workflow.successful_runs || 0}</span>
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
                    <Button 
                      onClick={() => executeWorkflow(workflow)}
                      className="bg-black text-white hover:bg-gray-800 font-mono text-xs"
                      disabled={workflow.deployment_status !== 'deployed' || executingWorkflows.has(workflow.id)}
                    >
                      {executingWorkflows.has(workflow.id) ? 'RUNNING TEST...' : 'TEST RUN'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent>
                {/* Workflow Sequence Preview */}
                {workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-bold font-mono mb-2 text-black">AUTOMATION SEQUENCE ({workflow.automation_sequence.length} steps)</h4>
                    <div className="bg-white p-3 rounded border border-black">
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {workflow.automation_sequence.slice(0, 5).map((step: AutomationStep, index: number) => (
                          <div key={`${workflow.id}-step-${index}`} className="flex items-center gap-2 text-xs font-mono">
                            <span className="bg-black text-white px-2 py-1 rounded">{index + 1}</span>
                            <span className="text-black font-semibold">{step.action?.toUpperCase() || 'ACTION'}</span>
                            <span className="text-black truncate">{step.description || step.url || step.selector || 'Step'}</span>
                          </div>
                        ))}
                        {workflow.automation_sequence.length > 5 && (
                          <div className="text-xs text-black font-mono">
                            ... and {workflow.automation_sequence.length - 5} more steps
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Input Parameters */}
                {workflow.input_parameters && Object.keys(workflow.input_parameters).length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-bold font-mono mb-2 text-black">INPUT PARAMETERS</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      {Object.entries(workflow.input_parameters).map(([key, value]: [string, InputParameter]) => (
                        <div key={`${workflow.id}-param-${key}`} className="bg-white p-2 border border-black rounded">
                          <span className="text-black font-semibold">{key}:</span>
                          <span className="text-black ml-1">{value?.type || 'string'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Executions for this workflow */}
                {(() => {
                  const workflowExecutions = executions.filter(exec => exec.workflow_id === workflow.id);
                  const workflowLiveExecutions = liveExecutions.filter(exec => exec.workflow_id === workflow.id);
                  const allExecutions = [...workflowLiveExecutions, ...workflowExecutions];
                  
                  if (allExecutions.length === 0) return null;
                  
                  return (
                    <div className="mb-4">
                      <h4 className="text-sm font-bold font-mono mb-2 text-black">EXECUTIONS ({allExecutions.length})</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {allExecutions.slice(0, 10).map((execution) => {
                          const isLive = 'progress_percentage' in execution;
                          const executionId = isLive ? execution.id : execution.execution_id;
                          return (
                            <div key={executionId} className="bg-white p-3 border border-black rounded">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-black font-semibold">ID: {executionId}</span>
                                  <Badge className={getStatusBadge(execution.status)}>
                                    {execution.status.toUpperCase()}
                                  </Badge>
                                  {isLive && execution.status === 'running' && (
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                  )}
                                </div>
                                <span className="text-xs font-mono text-black">
                                  {new Date(execution.created_at).toLocaleString()}
                                </span>
                              </div>
                              
                              {/* Live execution progress */}
                              {isLive && execution.progress_percentage !== null && (
                                <div className="mb-2">
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-mono text-black">Progress: {execution.progress_percentage}%</span>
                                    {execution.current_step_index && execution.total_steps && (
                                      <span className="text-xs font-mono text-black">Step {execution.current_step_index}/{execution.total_steps}</span>
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
                                </div>
                              )}
                              
                              {/* Execution timing */}
                              <div className="flex justify-between items-center text-xs font-mono text-black">
                                <span>Started: {new Date(execution.created_at).toLocaleString()}</span>
                                {!isLive && execution.completed_at && (
                                  <span>Completed: {new Date(execution.completed_at).toLocaleString()}</span>
                                )}
                              </div>
                              
                              {/* View result button for completed executions */}
                              {execution.status === 'completed' && (
                                <Button
                                  onClick={() => window.open(`/api/remote-workflows/executions/${executionId}/result`, '_blank')}
                                  className="w-full mt-2 bg-black text-white hover:bg-gray-800 font-mono text-xs"
                                >
                                  VIEW RESULT
                                </Button>
                              )}
                            </div>
                          );
                        })}
                        {allExecutions.length > 10 && (
                          <div className="text-xs text-black font-mono text-center py-2">
                            ... and {allExecutions.length - 10} more executions
                          </div>
                        )}
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
