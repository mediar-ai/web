'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { Loader2 } from 'lucide-react';
import { WorkflowCard } from '@/components/deployments/WorkflowCard';
import { Workflow, Execution, LiveExecutionStatus, WorkflowOverview } from '@/lib/workflow-types';
import { ExecutionDetailsDialog } from '@/components/deployments/ExecutionDetailsDialog';
import { WorkflowDetailsDialog } from '@/components/deployments/WorkflowDetailsDialog';

export default function DeploymentsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedWorkflowDetails, setSelectedWorkflowDetails] = useState<WorkflowOverview | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  
  const [selectedExecutionDetails, setSelectedExecutionDetails] = useState<Execution | null>(null);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingExecutionId, setLoadingExecutionId] = useState<number | null>(null);

  const { user } = useUser();

  const fetchWorkflows = useCallback(async () => {
    const orgId = user?.unsafeMetadata?.orgId as string || '';
    if (!orgId) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/remote-workflows/list?organization_id=${orgId}`);
      if (!response.ok) throw new Error('Failed to fetch workflows');
      const data = await response.json();
      setWorkflows(data.workflows);
    } catch (error) {
      console.error('Error fetching workflows:', error);
      setError('Failed to load workflows. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const fetchExecutions = useCallback(async () => {
    const orgId = user?.unsafeMetadata?.orgId as string || '';
    if (!orgId) return;
    try {
      const response = await fetch(`/api/remote-workflows/executions?organization_id=${orgId}`);
      if (!response.ok) throw new Error('Failed to fetch executions');
      const data = await response.json();
      setExecutions(data.executions);
    } catch (error) {
      console.error('Error fetching executions:', error);
      // Non-critical, so we don't set a top-level error state
    }
  }, [user]);

  const fetchLiveExecutions = useCallback(async () => {
    const orgId = user?.unsafeMetadata?.orgId as string || '';
    if (!orgId) return;
    try {
      const response = await fetch(`/api/remote-workflows/executions/live?organization_id=${orgId}`);
      if (response.ok) {
        const data = await response.json();
        setLiveExecutions(data.liveExecutions || []);
      }
    } catch (error) {
      console.error('Error fetching live executions:', error);
    }
  }, [user]);

  const fetchWorkflowOverview = useCallback(async (workflowId: number) => {
    setLoadingDetails(true);
    try {
      const orgId = user?.unsafeMetadata?.orgId as string || '';
      if (!orgId) return;
      const response = await fetch(`/api/remote-workflows/${workflowId}/overview?organization_id=${orgId}`);
      const data = await response.json();
      if (response.ok && data.success) {
        setSelectedWorkflowDetails(data.overview);
        setWorkflowDetailsOpen(true);
      } else {
        throw new Error(data.error || 'Failed to fetch workflow details');
      }
    } catch (err) {
      console.error('Error fetching workflow overview:', err);
      alert(`Could not load workflow details. Please try again.`);
    } finally {
      setLoadingDetails(false);
    }
  }, [user]);

  const fetchExecutionDetails = useCallback(async (executionId: number) => {
    setLoadingExecutionId(executionId);
    try {
      const orgId = user?.unsafeMetadata?.orgId as string || '';
      if (!orgId) return;
      const response = await fetch(`/api/remote-workflows/executions/${executionId}?organization_id=${orgId}`);
      const data = await response.json();
      if (response.ok && data.success) {
        setSelectedExecutionDetails(data.details);
        setExecutionDetailsOpen(true);
      } else {
        throw new Error(data.error || 'Failed to fetch execution details');
      }
    } catch (err) {
      console.error(`Error fetching details for execution ${executionId}:`, err);
      alert(`Could not load details for execution #${executionId}.`);
    } finally {
      setLoadingExecutionId(null);
    }
  }, [user]);
  
  useEffect(() => {
    if (user) {
      fetchWorkflows();
      fetchExecutions();
      
      const liveUpdateInterval = setInterval(fetchLiveExecutions, 2000); // Poll every 2 seconds for live data
      const executionsInterval = setInterval(fetchExecutions, 15000); // Refresh historical executions every 15 seconds

      return () => {
        clearInterval(liveUpdateInterval);
        clearInterval(executionsInterval);
      };
    }
  }, [user, fetchWorkflows, fetchExecutions, fetchLiveExecutions]);

  const handleBatchSubmit = () => {
    // A short delay to allow the backend to process the new execution
    setTimeout(() => {
      fetchExecutions();
      fetchLiveExecutions();
    }, 1000);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 text-center mt-10">{error}</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Workflow Deployments</h1>
        <p className="text-gray-600 mb-6">Monitor and manage your deployed workflows.</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              executions={executions}
              liveExecutions={liveExecutions}
              executingWorkflows={new Set()}
              onFetchWorkflowDetails={fetchWorkflowOverview}
              onFetchExecutionDetails={fetchExecutionDetails}
              loadingDetails={loadingDetails}
              loadingExecutionId={loadingExecutionId}
              onBatchSubmit={handleBatchSubmit}
            />
          ))}
        </div>
      </div>
      
      {selectedWorkflowDetails && (
        <WorkflowDetailsDialog 
          workflow={selectedWorkflowDetails}
          open={workflowDetailsOpen}
          onOpenChange={setWorkflowDetailsOpen}
        />
      )}

      {selectedExecutionDetails && (
        <ExecutionDetailsDialog
          execution={selectedExecutionDetails}
          open={executionDetailsOpen}
          onOpenChange={setExecutionDetailsOpen}
        />
      )}
    </div>
  );
}
