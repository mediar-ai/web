'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  WorkflowWithSettings,
  Execution,
  LiveExecutionStatus,
  WorkflowOverview,
} from '@/lib/workflow-types';
import { WorkflowCard } from '@/components/deployments/WorkflowCard';
import { ExecutionDetailsDialog } from '@/components/deployments/ExecutionDetailsDialog';
import { WorkflowDetailsDialog } from '@/components/deployments/WorkflowDetailsDialog';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth, SignIn, useOrganization } from '@clerk/nextjs';
import Link from 'next/link';

// Floating Delta Component
const FloatingDelta = ({ value }: { value: number }) => {
  const [deltas, setDeltas] = useState<{ id: string, value: number }[]>([]);

  useEffect(() => {
    if (value !== 0) {
      const newDelta = { id: `${Date.now()}-${Math.random()}`, value };
      setDeltas(d => [...d, newDelta]);
      setTimeout(() => {
        setDeltas(d => d.filter(delta => delta.id !== newDelta.id));
      }, 2000); // Corresponds to animation duration
    }
  }, [value]);

  if (deltas.length === 0) return null;

  return (
    <>
      {deltas.map(delta => (
        <span
          key={delta.id}
          className={`absolute -top-2 -right-6 px-2 py-1 text-sm font-bold rounded-full animate-bounce-in-out ${
            delta.value > 0 ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {delta.value > 0 ? `+${delta.value}` : delta.value}
        </span>
      ))}
    </>
  );
};

export default function WorkflowsPage() {
  const { isLoaded, userId, has } = useAuth();
  const { organization, membership } = useOrganization();
  
  // Show loading while Clerk is initializing
  if (!isLoaded) {
    return (
      <div className="container mx-auto py-4">
        <div>Loading...</div>
      </div>
    );
  }
  
  // Show sign-in if not authenticated
  if (!userId) {
    return (
      <div className="container mx-auto py-4 flex justify-center">
        <SignIn />
      </div>
    );
  }

  // Check if user has required role for deployment access
  const hasAdminRole = has({ role: 'org:admin' });
  const hasMemberRole = has({ role: 'org:member' });
  
  if (!hasAdminRole && !hasMemberRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">You need admin or member privileges to access deployments.</p>
          <Link href="/admin">
            <Button variant="outline">Return to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Pass authentication context to the main component
  return (
    <AuthenticatedWorkflowsPage 
      isAdmin={hasAdminRole}
      organizationName={organization?.name}
      userRole={membership?.role}
    />
  );
}

interface AuthenticatedWorkflowsPageProps {
  isAdmin: boolean;
  organizationName?: string;
  userRole?: string;
}

function AuthenticatedWorkflowsPage({ 
  isAdmin, 
  organizationName, 
  userRole 
}: AuthenticatedWorkflowsPageProps) {
  const [workflows, setWorkflows] = useState<WorkflowWithSettings[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [liveStats, setLiveStats] = useState({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
  const [loading, setLoading] = useState(true);
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(new Set());
  const previousWorkflows = useRef<WorkflowWithSettings[]>([]);
  const previousLiveStats = useRef({ total_active: 0, running: 0, queued: 0, average_progress: 0 });
  
  // New state for enhanced UI
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOverview | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingExecutionId, setLoadingExecutionId] = useState<number | null>(null);
  const [loadingExecutions, setLoadingExecutions] = useState(true);

  // Add connection status tracking
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<number | null>(null);

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
  const fetchExecutions = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoadingExecutions(true);
      }
      const response = await fetch('/api/remote-workflows/executions');
      const data = await response.json();
      if (data.success) {
        setExecutions(data.executions || []);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
      setExecutions([]);
    } finally {
      if (showLoading) {
        setLoadingExecutions(false);
      }
    }
  }, []);

  // Fetch live executions
  const fetchLiveExecutions = useCallback(async () => {
    try {
      const response = await fetch('/api/remote-workflows/executions/live?status=active&limit=200');
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

  // Initial load
  useEffect(() => {
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions]);

  // Enhanced polling fallback system
  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;
    
    if (pollingInterval && pollingInterval > 0) {
      console.log(`📊 [POLLING] Starting enhanced polling every ${pollingInterval}ms`);
      
      const doPoll = () => {
        console.log('📊 [POLLING] Refreshing data...');
        fetchLiveExecutions();
        fetchExecutions(false);
        fetchWorkflows(false);
      };
      
      // Initial poll
      doPoll();
      
      // Set up interval
      pollTimer = setInterval(doPoll, pollingInterval);
    }
    
    return () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        console.log('📊 [POLLING] Stopped polling');
      }
    };
  }, [pollingInterval, fetchLiveExecutions, fetchExecutions, fetchWorkflows]);

  // Real-time subscriptions for live updates
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;
    let connectionAttempts = 0;
    const MAX_RETRY_ATTEMPTS = 5;
    const RETRY_DELAY = 2000;

    const setupRealtimeSubscription = async () => {
      try {
        connectionAttempts++;
        console.log(`📡 [SUBSCRIPTION] Attempt ${connectionAttempts}/${MAX_RETRY_ATTEMPTS} - Setting up realtime subscription...`);

        // Clean up existing channel
        if (channel) {
          await supabase.removeChannel(channel);
          channel = null;
        }

        // Create channel with improved configuration
        channel = supabase
          .channel('workflow-dashboard-updates', {
            config: {
              broadcast: { self: false },
              presence: { key: 'user_id' }
            }
          })
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'workflow_executions'
          }, (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            console.log('📡 [REALTIME] workflow_executions change:', payload);
            
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              // Force refresh execution data to get latest changes
              fetchLiveExecutions();
              
              // Also refresh the main executions list if needed
              if (payload.eventType === 'INSERT') {
                // New execution created - refresh the main list too
                fetchExecutions(false);
              }
            }
          })
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'deployed_workflows'
          }, (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            console.log('📡 [REALTIME] deployed_workflows change:', payload);
            // Refetch workflows when they change
            fetchWorkflows();
          })
          .subscribe(async (status: string, err?: Error) => {
            console.log('📡 [SUBSCRIPTION] Status change:', {
              status,
              error: err,
              timestamp: new Date().toISOString(),
              attempt: connectionAttempts
            });
            
            if (status === 'SUBSCRIBED') {
              console.log('📡 [SUBSCRIPTION] ✅ Successfully connected to realtime');
              setRealtimeConnected(true);
              connectionAttempts = 0; // Reset counter on success
              
              // Clear any pending retries
              if (retryTimeout) {
                clearTimeout(retryTimeout);
                retryTimeout = null;
              }
              
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              console.log(`📡 [SUBSCRIPTION] ⚠️ Connection failed: ${status}`);
              
              // If we have retry attempts left, try again
              if (connectionAttempts < MAX_RETRY_ATTEMPTS) {
                console.log(`📡 [SUBSCRIPTION] 🔄 Retrying in ${RETRY_DELAY}ms...`);
                retryTimeout = setTimeout(() => {
                  setupRealtimeSubscription();
                }, RETRY_DELAY);
              } else {
                console.log('📡 [SUBSCRIPTION] ❌ Max retry attempts reached, falling back to polling');
                setRealtimeConnected(false);
                // Fall back to polling every 10 seconds
                setPollingInterval(10000);
              }
            }
          });

      } catch (error) {
        console.error('📡 [SUBSCRIPTION] Setup error:', error);
        
        // Retry if we haven't exceeded max attempts
        if (connectionAttempts < MAX_RETRY_ATTEMPTS) {
          retryTimeout = setTimeout(() => {
            setupRealtimeSubscription();
          }, RETRY_DELAY);
        } else {
          console.log('📡 [SUBSCRIPTION] Falling back to polling mode');
          setRealtimeConnected(false);
          setPollingInterval(10000);
        }
      }
    };

    // Initial setup
    setupRealtimeSubscription();

    // Cleanup function
    return () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [fetchLiveExecutions, fetchWorkflows]);

  useEffect(() => {
    previousWorkflows.current = workflows;
    previousLiveStats.current = liveStats;
  }, [workflows, liveStats]);

  useEffect(() => {
    const currentlyExecuting = new Set<number>();
    liveExecutions.forEach(exec => {
      if (exec.status === 'running' || exec.status === 'queued') {
        currentlyExecuting.add(exec.workflow_id);
      }
    });
    setExecutingWorkflows(currentlyExecuting);
  }, [liveExecutions]);

  // Calculate stats using deployed version data (current_version_stats) instead of overall historical data
  const totalExecutions = workflows.reduce((total, workflow) => total + (workflow.current_version_stats?.total_executions || 0), 0);
  const prevTotalExecutions = previousWorkflows.current.reduce((total, workflow) => total + (workflow.current_version_stats?.total_executions || 0), 0);
  
  const totalSuccessfulRuns = workflows.reduce((acc, w) => acc + (w.current_version_stats?.successful_runs || 0), 0);
  const successRate = totalExecutions > 0 ? Math.round((totalSuccessfulRuns / totalExecutions) * 100) : 0;

  const prevTotalSuccessfulRuns = previousWorkflows.current.reduce((acc, w) => acc + (w.current_version_stats?.successful_runs || 0), 0);
  const prevSuccessRate = prevTotalExecutions > 0 ? Math.round((prevTotalSuccessfulRuns / prevTotalExecutions) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl font-mono">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Remote Workflow Execution</h1>
          <p className="text-muted-foreground text-lg">Execute and monitor automated workflows remotely</p>
          <div className="mt-2">
            <span className={`text-sm font-medium ${isAdmin ? 'text-blue-600' : 'text-green-600'}`}>
              {isAdmin && organizationName ? `Admin - ${organizationName}` : organizationName ? `Member - ${organizationName}` : "Organization Access"}
            </span>
            {userRole && (
              <span className="text-xs text-gray-500 ml-2">
                Role: {userRole}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => window.open('/docs/api/remote-workflows', '_blank')}
            variant="outline" 
            size="default" 
            className="bg-white text-black border-black hover:bg-black hover:text-white text-base font-mono cursor-pointer"
          >
            API DOCS
          </Button>
          <Button 
            onClick={() => window.open('/docs/api/mcp', '_blank')}
            variant="outline" 
            size="default" 
            className="bg-white text-black border-black hover:bg-black hover:text-white text-base font-mono cursor-pointer"
          >
            MCP DOCS
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-base font-mono text-black">AVAILABLE WORKFLOWS</p>
              <p className="relative inline-block text-4xl font-mono font-bold text-black">
                {workflows.length}
                <FloatingDelta value={workflows.length - previousWorkflows.current.length} />
              </p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-base font-mono text-black">ACTIVE EXECUTIONS</p>
              <p className="relative inline-block text-4xl font-mono font-bold text-black">
                {liveStats.total_active}
                <FloatingDelta value={liveStats.total_active - previousLiveStats.current.total_active} />
              </p>
              {liveStats.running > 0 && (
                <p className="text-sm font-mono text-black mt-1">
                  {liveStats.running} RUNNING • {Math.round(liveStats.average_progress)}% AVG
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-base font-mono text-black">SUCCESS RATE</p>
              <p className="relative inline-block text-4xl font-mono font-bold text-black">
                {successRate}%
                <FloatingDelta value={successRate - prevSuccessRate} />
              </p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-base font-mono text-black">TOTAL EXECUTIONS</p>
              <p className="relative inline-block text-4xl font-mono font-bold text-black">
                {totalExecutions}
                <FloatingDelta value={totalExecutions - prevTotalExecutions} />
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
        <h2 className="text-2xl font-bold font-mono mb-4">AVAILABLE WORKFLOWS</h2>
        <div className="grid gap-4">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              executions={executions}
              liveExecutions={liveExecutions}
              executingWorkflows={executingWorkflows}
              onFetchWorkflowDetails={fetchWorkflowOverview}
              onFetchExecutionDetails={fetchExecutionDetails}
              loadingDetails={loadingDetails}
              loadingExecutionId={loadingExecutionId}
              loadingExecutions={loadingExecutions}
              realtimeConnected={realtimeConnected}

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
