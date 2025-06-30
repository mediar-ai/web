'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Types for workflow system
interface Workflow {
  id: number;
  name: string;
  description: string;
  category: string;
  tags: string[];
  difficulty_level: string;
  estimated_duration_seconds: number;
  success_rate: number | null;
  deployment_status: string;
  input_parameters: Record<string, any>;
  expected_outputs: Record<string, any>;
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

interface ExecutionResult {
  execution_id: number;
  results: any;
  compute_cost_cents: number;
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(new Set());

  // Fetch workflows
  const fetchWorkflows = useCallback(async () => {
    try {
      const response = await fetch('/api/remote-workflows/list');
      const data = await response.json();
      setWorkflows(data.workflows || []);
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    }
  }, []);

  // Fetch recent executions
  const fetchExecutions = useCallback(async () => {
    try {
      // Note: In real implementation, you'd have an endpoint to list executions
      // For now, we'll show a simplified view
      setExecutions([]);
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    }
    setLoading(false);
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
  }, [fetchWorkflows, fetchExecutions]);

  // Auto-refresh executions
  useEffect(() => {
    const interval = setInterval(fetchExecutions, 5000);
    return () => clearInterval(interval);
  }, [fetchExecutions]);

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'DONE';
      case 'failed': return 'FAIL';
      case 'running': return 'RUN';
      case 'queued': return 'WAIT';
      case 'cancelled': return 'STOP';
      default: return 'UNKN';
    }
  };

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
        <Button onClick={fetchWorkflows} variant="outline" size="sm" className="bg-white text-black border-black hover:bg-black hover:text-white">
          REFRESH
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-sm font-mono text-gray-600">AVAILABLE WORKFLOWS</p>
              <p className="text-3xl font-mono font-bold text-black">{workflows.length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-sm font-mono text-gray-600">ACTIVE EXECUTIONS</p>
              <p className="text-3xl font-mono font-bold text-black">{executions.filter(e => e.status === 'running' || e.status === 'queued').length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-sm font-mono text-gray-600">SUCCESS RATE</p>
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
              <p className="text-sm font-mono text-gray-600">TOTAL EXECUTIONS</p>
              <p className="text-3xl font-mono font-bold text-black">{executions.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="workflows" className="w-full">
        <TabsList className="bg-white border border-black">
          <TabsTrigger value="workflows" className="data-[state=active]:bg-black data-[state=active]:text-white">WORKFLOWS</TabsTrigger>
          <TabsTrigger value="executions" className="data-[state=active]:bg-black data-[state=active]:text-white">EXECUTIONS</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="space-y-4">
          <div className="grid gap-4">
            {workflows.map((workflow) => (
              <Card key={workflow.id} className="border-black">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2 font-mono">
                        {workflow.name}
                        <Badge className={getStatusBadge(workflow.deployment_status)}>
                          {workflow.deployment_status.toUpperCase()}
                        </Badge>
                      </CardTitle>
                      <p className="text-sm text-gray-600 font-mono">{workflow.description}</p>
                    </div>
                    
                    <Button 
                      onClick={() => executeWorkflow(workflow)}
                      disabled={workflow.deployment_status !== 'deployed' || executingWorkflows.has(workflow.id)}
                      className="bg-black text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500"
                    >
                      {executingWorkflows.has(workflow.id) ? 'EXECUTING...' : 'EXECUTE'}
                    </Button>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-mono">
                    <div>
                      <p className="font-bold text-black">CATEGORY</p>
                      <p className="text-gray-600 uppercase">{workflow.category}</p>
                    </div>
                    <div>
                      <p className="font-bold text-black">DURATION</p>
                      <p className="text-gray-600">{workflow.estimated_duration_seconds}S</p>
                    </div>
                    <div>
                      <p className="font-bold text-black">DIFFICULTY</p>
                      <p className="text-gray-600 uppercase">{workflow.difficulty_level}</p>
                    </div>
                  </div>
                  
                  <div className="mt-3 flex flex-wrap gap-1">
                    {workflow.tags.map((tag) => (
                      <Badge key={tag} className="text-xs bg-gray-200 text-black font-mono">
                        {tag.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="executions" className="space-y-4">
          <Card className="border-black">
            <CardHeader>
              <CardTitle className="font-mono">RECENT EXECUTIONS</CardTitle>
            </CardHeader>
            <CardContent>
              {executions.length === 0 ? (
                <p className="text-center text-gray-600 py-8 font-mono">
                  NO EXECUTIONS YET. EXECUTE A WORKFLOW TO SEE RESULTS HERE.
                </p>
              ) : (
                <div className="space-y-3">
                  {executions.map((execution) => (
                    <div key={execution.execution_id} className="flex items-center justify-between p-3 border border-black">
                      <div className="flex items-center gap-3">
                        <div className="font-mono text-sm font-bold bg-black text-white px-2 py-1">
                          {getStatusText(execution.status)}
                        </div>
                        <div>
                          <p className="font-mono font-bold">{execution.workflow_name}</p>
                          <p className="text-sm text-gray-600 font-mono">
                            {new Date(execution.created_at).toLocaleString()}
                            {execution.execution_duration_seconds && 
                              ` • ${execution.execution_duration_seconds}S`
                            }
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Badge className="bg-gray-200 text-black font-mono">
                          {execution.status.toUpperCase()}
                        </Badge>
                        {execution.status === 'completed' && (
                          <Button size="sm" className="bg-black text-white hover:bg-gray-800">
                            RESULTS
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
