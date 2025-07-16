'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Clock, CheckCircle, XCircle, AlertCircle, PlayCircle, Loader2, FileText, Activity, ChevronDown, ChevronRight, Play, Upload } from 'lucide-react';
import { WorkflowWithSettings, Execution, LiveExecutionStatus } from '@/lib/workflow-types';
import { BatchTestDialog } from '@/components/deployments/BatchTestDialog';
import { VersionUploadDialog } from '@/components/deployments/VersionUploadDialog';

interface WorkflowCardProps {
  workflow: WorkflowWithSettings;
  executions: Execution[];
  liveExecutions: LiveExecutionStatus[];
  executingWorkflows: Set<number>;
  onFetchWorkflowDetails: (workflowId: number) => void;
  onFetchExecutionDetails: (executionId: number) => void;
  loadingDetails: boolean;
  loadingExecutionId: number | null;
  loadingExecutions?: boolean;
  onBatchSubmit?: () => void;
  isNested?: boolean; // For styling nested settings workflows
  realtimeConnected?: boolean; // Connection status for display
}

const getStatusBadge = (status: string) => {
    // Using consistent black and white design for all statuses
    const statusStyles: Record<string, string> = {
      deployed: 'bg-black text-white border border-black', // Active status - filled black
      pending: 'bg-white text-black border border-black', // Default outline
      error: 'bg-white text-black border border-black font-bold', // Bold text for emphasis
      running: 'bg-black text-white border border-black', // Active status - filled black
      completed: 'bg-white text-black border border-black', // Default outline
      failed: 'bg-white text-black border border-black font-bold', // Bold text for emphasis
      cancelled: 'bg-gray-100 text-gray-600 border border-black', // Slightly muted
      queued: 'bg-white text-black border border-black', // Default outline
      paused: 'bg-gray-100 text-black border border-black' // Slightly muted
    };
    return statusStyles[status] || 'bg-white text-black border border-black';
};

const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-3.5 h-3.5" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-3.5 h-3.5" />;
      case 'cancelled':
        return <AlertCircle className="w-3.5 h-3.5" />;
      case 'queued':
        return <Clock className="w-3.5 h-3.5" />;
      default:
        return <Activity className="w-3.5 h-3.5" />;
    }
};

const formatDuration = (seconds: number | null | undefined): string => {
    if (seconds === null || seconds === undefined) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

export function WorkflowCard({
  workflow,
  executions,
  liveExecutions,
  executingWorkflows,
  onFetchWorkflowDetails,
  onFetchExecutionDetails,
  loadingDetails,
  loadingExecutionId,
  loadingExecutions = false,
  onBatchSubmit,
  isNested,
  realtimeConnected = false,
}: WorkflowCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [connectedWorkflowsExpanded, setConnectedWorkflowsExpanded] = useState(false);
  const [localTimeOffsets, setLocalTimeOffsets] = useState<Map<number, number>>(new Map());
  const [showBatchTestDialog, setShowBatchTestDialog] = useState(false);
  const [resumingWorkflow, setResumingWorkflow] = useState(false);

  // Resume workflow function
  const handleResumeWorkflow = async () => {
    setResumingWorkflow(true);
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (data.success) {
        console.log('Workflow resumed successfully:', data.message);
        // Trigger a refresh of the workflow data
        if (onBatchSubmit) {
          onBatchSubmit(); // This is used to refresh the parent component
        }
      } else {
        console.error('Failed to resume workflow:', data.error);
        alert(`Failed to resume workflow: ${data.error}`);
      }
    } catch (error) {
      console.error('Error resuming workflow:', error);
      alert('Failed to resume workflow. Please try again.');
    } finally {
      setResumingWorkflow(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalTimeOffsets(prev => {
        const newMap = new Map(prev);
        liveExecutions.forEach(exec => {
          if (exec.workflow_id === workflow.id) {
            if (exec.status === 'running' && exec.started_at) {
              // For running executions, show time since started
            const startTime = new Date(exec.started_at).getTime();
            const now = Date.now();
            const runtimeSeconds = Math.floor((now - startTime) / 1000);
            newMap.set(exec.id, runtimeSeconds);
            } else if (exec.status === 'queued' && exec.created_at) {
              // For queued executions, show negative time to indicate waiting
              const createdTime = new Date(exec.created_at).getTime();
              const now = Date.now();
              const waitingSeconds = Math.floor((now - createdTime) / 1000);
              newMap.set(exec.id, -waitingSeconds); // Negative to distinguish from running
          } else {
            newMap.delete(exec.id);
            }
          }
        });
        return newMap;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [liveExecutions, workflow.id]);

  const workflowLiveExecutions = liveExecutions
    .filter(exec => exec.workflow_id === workflow.id)
    .sort((a, b) => b.id - a.id);
    
  const recentExecutions = executions
    .filter(exec => exec.workflow_id === workflow.id)
    .filter(exec => !['running', 'queued'].includes(exec.status))
    .sort((a, b) => b.execution_id - a.execution_id);
  
  // Create unified execution list
  type UnifiedExecution = {
    execution_id: number;
    workflow_id: number;
    status: string;
    created_at: string;
    started_at?: string | null;
    completed_at?: string | null;
    execution_duration_seconds?: number | null;
    error_message?: string | null;
    formatted_output?: string | null;
    progress_percentage?: number;
    current_step_description?: string | null;
    isLive: boolean;
  };

  const unifiedExecutions: UnifiedExecution[] = [
    // Map live executions to have consistent structure
    ...workflowLiveExecutions.map(exec => ({
      execution_id: exec.id,
      workflow_id: exec.workflow_id,
      status: exec.status,
      created_at: exec.created_at,
      started_at: exec.started_at || null,
      completed_at: null,
      execution_duration_seconds: exec.execution_duration_seconds,
      error_message: null,
      formatted_output: null,
      progress_percentage: exec.progress_percentage,
      current_step_description: exec.current_step_description,
      isLive: true
    })),
    // Add recent executions with isLive flag
    ...recentExecutions.map(exec => ({
      execution_id: exec.execution_id,
      workflow_id: exec.workflow_id,
      status: exec.status,
      created_at: exec.created_at || '',
      started_at: exec.started_at || null,
      completed_at: exec.completed_at || null,
      execution_duration_seconds: exec.execution_duration_seconds,
      error_message: exec.error_message || null,
      formatted_output: exec.formatted_output || null,
      progress_percentage: exec.progress_percentage,
      current_step_description: null,
      isLive: false
    }))
  ]
    // Remove duplicates (in case of race conditions)
    .filter((exec, index, self) => 
      index === self.findIndex(e => e.execution_id === exec.execution_id)
    )
    // Sort by execution ID descending (newest first)
    .sort((a, b) => b.execution_id - a.execution_id);
  
  const hasExecutions = unifiedExecutions.length > 0;
  const shouldShowExecutionHistory = hasExecutions || loadingExecutions;

  return (
    <Card className={`border-black ${isNested ? 'bg-gray-50 border-l-4 border-l-black border-t border-r border-b' : ''}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* First line: Just the workflow title */}
            <h3 className="text-xl font-bold font-mono mb-2">{workflow.name}</h3>
            
            {/* Second line: Version, stats, play button, status, and action buttons */}
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-sm font-mono px-3 py-1.5 bg-black text-white rounded h-7 flex items-center">
                v{workflow.version || '1.0.0'}
              </span>
              
              {/* Stats */}
              <div className="flex items-center gap-3 text-sm font-mono text-gray-600">
                <span>RUNS: {workflow.total_executions || 0}</span>
                {(workflow.total_executions || 0) > 0 && (
                  <span className="text-black flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    {Math.round(((workflow.successful_runs || 0) / (workflow.total_executions || 1)) * 100)}%
                  </span>
                )}
                {workflow.estimated_duration_seconds && (
                  <span className="text-black">
                    in {workflow.estimated_duration_seconds} sec.
                  </span>
                )}
              </div>
              
              {/* Resume/Play button */}
              {workflow.status === 'paused' && (
                <button
                  onClick={handleResumeWorkflow}
                  disabled={resumingWorkflow}
                  className="p-1 border border-black rounded hover:bg-gray-100 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  title={resumingWorkflow ? 'Resuming...' : 'Resume workflow'}
                >
                  {resumingWorkflow ? (
                    <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 text-gray-600 hover:text-black" />
                  )}
                </button>
              )}
              
              {/* Status badge */}
              <Badge className={`${getStatusBadge(workflow.status)} text-sm h-7 px-3`}>
                {workflow.status.toUpperCase()}
              </Badge>
              
              {/* Action buttons */}
              <Button
                onClick={() => setShowBatchTestDialog(true)}
                className="bg-black text-white hover:bg-gray-800 hover:shadow-lg font-mono text-base h-10 px-6 cursor-pointer transition-all duration-200 transform hover:scale-105 rounded-lg font-bold"
                size="lg"
              >
                <PlayCircle className="w-5 h-5 mr-2" />
                TEST RUN
              </Button>
              
              <VersionUploadDialog 
                workflowId={workflow.id}
                workflowName={workflow.name}
                onUploadSuccess={() => {
                  // Refresh the workflow data after successful upload
                  if (onBatchSubmit) {
                    onBatchSubmit();
                  }
                }}
              >
                <Button
                  variant="black-outline"
                  size="lg"
                  className="font-mono text-base h-10 px-6 cursor-pointer transition-all duration-200 transform hover:scale-105 hover:shadow-lg rounded-lg font-bold border-2 hover:bg-gray-50"
                >
                  <Upload className="w-5 h-5 mr-2" />
                  UPLOAD VERSION
                </Button>
              </VersionUploadDialog>
              
              <Button 
                onClick={() => onFetchWorkflowDetails(workflow.id)}
                variant="black-outline"
                size="lg"
                className="font-mono text-base h-10 px-6 cursor-pointer transition-all duration-200 transform hover:scale-105 hover:shadow-lg rounded-lg font-bold border-2 hover:bg-gray-50"
                disabled={loadingDetails}
              >
                {loadingDetails ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                <span className="ml-2">DETAILS</span>
              </Button>
            </div>
            
            <p className="text-black text-base mb-2">{workflow.description}</p>
            
          </div>
        </div>
      </CardHeader>
        
      <CardContent>
        {/* Settings Workflows Section - Nested WorkflowCards */}
        {workflow.settings_workflows && workflow.settings_workflows.length > 0 && (
          <div className="mb-4 border-t border-gray-200 pt-4">
            <Collapsible open={connectedWorkflowsExpanded} onOpenChange={setConnectedWorkflowsExpanded}>
              <CollapsibleTrigger className="w-full cursor-pointer">
                <div className="flex items-center gap-2 p-3 bg-gray-50 border border-black rounded hover:bg-gray-100 transition-colors cursor-pointer">
                  {connectedWorkflowsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <h4 className="text-base font-bold font-mono text-black">
                    <span>CONNECTED WORKFLOWS ({workflow.settings_workflows.length})</span>
                  </h4>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 ml-4 mt-3">
                  {workflow.settings_workflows.map((settingsWorkflow) => (
                    <WorkflowCard
                      key={settingsWorkflow.id}
                      workflow={settingsWorkflow as WorkflowWithSettings}
                      executions={[]} // Settings workflows don't have executions yet
                      liveExecutions={[]} // Settings workflows don't have live executions yet
                      executingWorkflows={executingWorkflows}
                      onFetchWorkflowDetails={onFetchWorkflowDetails}
                      onFetchExecutionDetails={onFetchExecutionDetails}
                      loadingDetails={loadingDetails}
                      loadingExecutionId={loadingExecutionId}
                      loadingExecutions={false}
                      onBatchSubmit={onBatchSubmit}
                      isNested={true}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
        
        {shouldShowExecutionHistory && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="w-full cursor-pointer">
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-black rounded hover:bg-gray-100 transition-colors cursor-pointer">
                <div className="flex items-center gap-2">
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-base font-bold font-mono text-black">EXECUTION HISTORY</span>
                  <div className="flex gap-2">
                    {loadingExecutions ? (
                      <Badge variant="black-outline" className="text-sm h-7 px-3">
                        <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        LOADING
                      </Badge>
                    ) : (
                      <>
                        {workflowLiveExecutions.length > 0 && (
                          <Badge variant="black-outline" className="text-sm h-7 px-3">{workflowLiveExecutions.length} LIVE</Badge>
                        )}
                        {recentExecutions.length > 0 && (
                          <Badge variant="black-outline" className="text-sm h-7 px-3">{recentExecutions.length} RECENT</Badge>
                        )}
                        {/* Connection Status */}
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                          realtimeConnected 
                            ? 'bg-green-100 text-green-800 border border-green-200' 
                            : 'bg-gray-100 text-gray-700 border border-gray-300'
                        }`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            realtimeConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
                          }`} />
                          {realtimeConnected ? 'REALTIME' : 'POLLING'}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <div className="mt-2 max-h-[400px] overflow-y-auto border border-black rounded-lg bg-white">
                {loadingExecutions ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-600" />
                      <span className="text-base font-mono text-gray-600">Loading execution history...</span>
                    </div>
                  </div>
                ) : unifiedExecutions.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-base text-gray-500">No execution history available</span>
                  </div>
                ) : (
                  unifiedExecutions.map((execution, index) => (
                        <div 
                          key={`exec-${execution.execution_id}`}
                          className={`px-4 py-1.5 ${
                            index > 0 ? 'border-t border-gray-200' : ''
                          } ${
                            loadingExecutionId === execution.execution_id 
                              ? 'bg-blue-50 cursor-wait' 
                              : 'cursor-pointer hover:bg-gray-50'
                          }`}
                          onClick={() => loadingExecutionId === null && onFetchExecutionDetails(execution.execution_id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono text-black font-semibold">
                              #{execution.execution_id}
                            </span>
                            {loadingExecutionId === execution.execution_id ? (
                              <div className="flex items-center gap-1">
                                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                                <span className="text-sm font-mono text-blue-600">LOADING...</span>
                              </div>
                            ) : (
                              <Badge className={`${getStatusBadge(execution.status)} h-7 px-3 text-sm`}>
                                {getStatusIcon(execution.status)}
                                <span className="ml-0.5">{execution.status.toUpperCase()}</span>
                              </Badge>
                            )}
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
                              {execution.isLive ? (
                                <>
                                  {execution.status === 'queued' && !execution.started_at && (
                                    <span className="flex items-center gap-0.5">
                                      <Clock className="w-3.5 h-3.5" />
                                      Queued {new Date(execution.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                  {execution.status === 'running' && execution.started_at && (
                                    <span className="flex items-center gap-0.5">
                                      <Clock className="w-3.5 h-3.5" />
                                      Started {new Date(execution.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                  {localTimeOffsets.has(execution.execution_id) && (
                                    <>
                                      <span className="text-gray-400">•</span>
                                      <span className="font-mono">
                                        {(() => {
                                          const offset = localTimeOffsets.get(execution.execution_id) ?? 0;
                                          if (offset < 0) {
                                            // Queued - show waiting time
                                            const waitingSeconds = Math.abs(offset);
                                            return (
                                              <>
                                                <span className="text-orange-600">Waiting: </span>
                                                <span className="text-orange-600 font-bold">{waitingSeconds}s</span>
                                                {waitingSeconds >= 60 && <span className="text-gray-500 ml-1">({formatDuration(waitingSeconds)})</span>}
                                              </>
                                            );
                                          } else {
                                            // Running - show execution time
                                            return (
                                              <>
                                                <span className="text-black font-bold">{offset}s</span>
                                                {offset >= 60 && <span className="text-gray-500 ml-1">({formatDuration(offset)})</span>}
                                              </>
                                            );
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
                                      <span className="text-blue-600 truncate inline-block max-w-[450px]" title={execution.current_step_description}>
                                        {execution.current_step_description}
                                      </span>
                                    </>
                                  )}
                                </>
                              ) : (
                                <>
                              {execution.completed_at && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="w-3.5 h-3.5" />
                                  {new Date(execution.completed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              {execution.execution_duration_seconds !== undefined && execution.execution_duration_seconds !== null && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span>{formatDuration(execution.execution_duration_seconds)}</span>
                                </>
                              )}
                              {execution.status === 'completed' && execution.formatted_output && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <div className="flex items-center gap-1.5 text-sm flex-wrap">
                                    {(() => {
                                      try {
                                        const quotes = JSON.parse(execution.formatted_output);
                                        if (Array.isArray(quotes) && quotes.length > 0) {
                                          const quotesToShow = quotes.slice(0, 2);
                                          const quoteDisplay = quotesToShow.map(q => `${q.carrierProduct?.split(':')[0]}: ${q.quoteValue || ''}`).join(' | ');
                                          const fullTitle = quotes.map(q => `${q.carrierProduct}: ${q.quoteValue || ''}`).join(', ');
                                          
                                          return (
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-green-700">{quotes.length} quote{quotes.length > 1 ? 's' : ''} found:</span>
                                                  <span className="font-mono bg-gray-100 px-2 py-0.5 rounded-full text-gray-700 truncate max-w-[400px]" title={fullTitle}>
                                                {quoteDisplay}
                                              </span>
                                              {quotes.length > 2 && <span className="text-gray-500">...</span>}
                                            </div>
                                          )
                                        }
                                        return <span className="text-green-700 truncate inline-block max-w-[450px]" title={execution.formatted_output}>{execution.formatted_output.split('\n')[0]}</span>
                                      } catch {
                                        return <span className="text-green-700 truncate inline-block max-w-[450px]" title={execution.formatted_output}>{execution.formatted_output.split('\n')[0]}</span>
                                      }
                                    })()}
                                  </div>
                                </>
                              )}
                              {execution.status === 'failed' && (execution.error_message || execution.formatted_output) && (
                                <>
                                  <span className="text-gray-400">•</span>
                                      <span className="text-red-600 truncate inline-block max-w-[450px] text-sm" title={execution.error_message || execution.formatted_output || ''}>
                                    {(() => {
                                      if (execution.error_message) return execution.error_message;
                                      if (execution.formatted_output) {
                                        const lines = execution.formatted_output.split('\n');
                                            const hasCompletedMessage = lines.some((line: string) => line.includes('✅ Workflow execution completed!'));
                                            const hasNoQuotesFound = lines.some((line: string) => line.includes('❌ No Eligible Quotes Found') || line.includes('No Eligible Quotes Found'));
                                        if (hasCompletedMessage && hasNoQuotesFound) {
                                              const successfulStepsLine = lines.find((line: string) => line.includes('Successful Steps:'));
                                          if (successfulStepsLine && successfulStepsLine.includes('Successful Steps: 0')) return 'Workflow failed - No steps completed successfully';
                                          else if (hasNoQuotesFound) return 'Workflow incomplete - No quotes found';
                                        }
                                            const errorLine = lines.find((line: string) => line.includes('❌') || line.includes('Message:') || line.includes('Error:') || line.includes('Failed:') || line.includes('failed!'));
                                        if (errorLine) return errorLine.replace(/^\s*Message:\s*/, '').replace(/^\s*Error:\s*/, '').replace(/^❌\s*/, '').trim();
                                            return lines.find((line: string) => line.trim() && !line.includes('===') && !line.includes('---')) || 'Workflow execution failed';
                                      }
                                      return 'Workflow execution failed';
                                    })()}
                                  </span>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
      
      {/* Batch Test Dialog */}
      <BatchTestDialog 
        workflow={workflow}
        open={showBatchTestDialog}
        onOpenChange={setShowBatchTestDialog}
        onSubmit={onBatchSubmit}
      />
    </Card>
  );
} 