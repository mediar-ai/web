'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Workflow,
  Execution,
  LiveExecutionStatus,
  WorkflowOverview,
} from '@/lib/workflow-types';
import { WorkflowCard } from '@/components/deployments/WorkflowCard';
import { ExecutionDetailsDialog } from '@/components/deployments/ExecutionDetailsDialog';
import { WorkflowDetailsDialog } from '@/components/deployments/WorkflowDetailsDialog';

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
  const [loadingExecutionId, setLoadingExecutionId] = useState<number | null>(null);

  // Fetch workflows
  const fetchWorkflows = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await fetch('/api/remote-workflows/list');
      const data = await response.json();
      if (data.success) {
        setWorkflows(data.workflows || []);
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // Fetch detailed workflow overview
  const fetchWorkflowOverview = useCallback(async (workflowId: number) => {
    try {
      setLoadingDetails(true);
      const response = await fetch(`/api/remote-workflows/${workflowId}/overview`);
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
      setLoadingExecutionId(executionId);
      
      // Open the dialog immediately to show loading skeleton
      setSelectedExecution(null);
      setExecutionDetailsOpen(true);
      
      const response = await fetch(`/api/remote-workflows/executions/${executionId}`);
      const data = await response.json();
      if (data.success) {
        setSelectedExecution(data.execution);
      }
    } catch (error) {
      console.error('Failed to fetch execution details:', error);
      // Close dialog on error
      setExecutionDetailsOpen(false);
    } finally {
      setLoadingDetails(false);
      setLoadingExecutionId(null);
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
      const response = await fetch(`/api/remote-workflows/${workflow.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: `web-${Date.now()}`,
          execution_mode: 'async',
          parameters: customParams || {}
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
      fetchWorkflows(false); // Refresh workflows without showing loading state
    }, 2000); // Refresh every 2 seconds for live updates
    return () => clearInterval(interval);
  }, [fetchExecutions, fetchLiveExecutions, fetchWorkflows]);

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
      <WorkflowDetailsDialog
        workflow={selectedWorkflow}
        open={workflowDetailsOpen}
        onOpenChange={setWorkflowDetailsOpen}
      />

      {/* Execution Details Dialog */}
      <ExecutionDetailsDialog
        execution={selectedExecution}
        open={executionDetailsOpen}
        onOpenChange={setExecutionDetailsOpen}
      />

      {/* Available Workflows */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold font-mono mb-4">AVAILABLE WORKFLOWS</h2>
        <div className="grid gap-4">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              executions={executions}
              liveExecutions={liveExecutions}
              executingWorkflows={executingWorkflows}
              onExecute={executeWorkflow}
              onFetchWorkflowDetails={fetchWorkflowOverview}
              onFetchExecutionDetails={fetchExecutionDetails}
              loadingDetails={loadingDetails}
              loadingExecutionId={loadingExecutionId}
              onBatchSubmit={() => {
                fetchExecutions();
                fetchLiveExecutions();
              }}
            />
          ))}
                          </div>
                      </div>
                    </div>
  );
}
