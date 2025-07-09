'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from '@/components/ui/separator';
import { Clock, CheckCircle, XCircle, AlertCircle, PlayCircle, Loader2, FileText, Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { Workflow, Execution, LiveExecutionStatus } from '@/lib/workflow-types';

type RecursiveObject = {
  [key: string]: string | number | boolean | RecursiveObject | null | undefined;
};

// New Recursive form component to render the nested variable structure
const RecursiveForm = ({ data, path, handleParamChange }: { data: RecursiveObject, path: string, handleParamChange: (path: string, value: string | number | boolean) => void }) => {
  return (
    <div className="space-y-3">
      {Object.entries(data).map(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return (
            <fieldset key={currentPath} className="border border-gray-200 rounded-md p-2 space-y-2">
              <legend className="text-xs font-mono font-medium px-1">{key}</legend>
              <RecursiveForm data={value as RecursiveObject} path={currentPath} handleParamChange={handleParamChange} />
            </fieldset>
          );
        } else if (typeof value === 'boolean') {
          return (
             <div key={currentPath} className="flex items-center space-x-2">
               <input
                 type="checkbox"
                 id={currentPath}
                 checked={!!value}
                 onChange={(e) => handleParamChange(currentPath, e.target.checked)}
                 className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
               />
               <Label htmlFor={currentPath} className="text-xs font-mono">
                 {key}
               </Label>
             </div>
          );
        } else {
          // Handle string, number, or other primitives
          return (
            <div key={currentPath} className="space-y-1">
              <Label htmlFor={currentPath} className="text-xs font-mono">
                {key}
              </Label>
              <Input
                id={currentPath}
                value={String(value ?? '')}
                onChange={(e) => handleParamChange(currentPath, e.target.value)}
                className="h-8 text-xs font-mono"
                placeholder={`Enter value for ${key}`}
              />
            </div>
          );
        }
      })}
    </div>
  );
};


interface WorkflowCardProps {
  workflow: Workflow;
  executions: Execution[];
  liveExecutions: LiveExecutionStatus[];
  executingWorkflows: Set<number>;
  onExecute: (workflow: Workflow, params?: Record<string, unknown>) => void;
  onFetchWorkflowDetails: (workflowId: number) => void;
  onFetchExecutionDetails: (executionId: number) => void;
  loadingDetails: boolean;
  loadingExecutionId: number | null;
}

const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      deployed: 'bg-black text-white',
      pending: 'bg-gray-200 text-black',
      error: 'bg-red-800 text-white',
      running: 'bg-black text-white',
      completed: 'bg-black text-white',
      failed: 'bg-red-600 text-white',
      cancelled: 'bg-gray-600 text-white',
      queued: 'bg-gray-400 text-white'
    };
    return colors[status] || 'bg-gray-100 text-black';
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
  onExecute,
  onFetchWorkflowDetails,
  onFetchExecutionDetails,
  loadingDetails,
  loadingExecutionId,
}: WorkflowCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showParamsDropdown, setShowParamsDropdown] = useState(false);
  const [executionParams, setExecutionParams] = useState<Record<string, unknown>>({});
  const [localTimeOffsets, setLocalTimeOffsets] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    // The source of truth for execution parameters is now input_parameters,
    // which is dynamically generated from the workflow's variables block.
    if (workflow.input_parameters) {
      setExecutionParams(workflow.input_parameters);
    }
  }, [workflow]);

  const handleParamChange = (path: string, value: string | number | boolean) => {
    setExecutionParams(prev => {
      const newParams = JSON.parse(JSON.stringify(prev)); // Deep copy
      const keys = path.split('.');
      let current = newParams;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]] = current[keys[i]] || {};
      }
      current[keys[keys.length - 1]] = value;
      return newParams;
    });
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalTimeOffsets(prev => {
        const newMap = new Map(prev);
        liveExecutions.forEach(exec => {
          if (exec.workflow_id === workflow.id && exec.status === 'running' && exec.started_at) {
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
  
  const hasExecutions = workflowLiveExecutions.length > 0 || recentExecutions.length > 0;

  return (
    <Card className="border-black">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-bold font-mono">{workflow.name}</h3>
              <span className="text-xs font-mono px-2 py-1 bg-black text-white rounded">
                v{workflow.version || '1.0.0'}
              </span>
              <Button 
                onClick={() => onFetchWorkflowDetails(workflow.id)}
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
            
            <div className="bg-gray-50 border border-gray-300 rounded-md p-3 mb-3">
              <h4 className="text-xs font-mono font-bold text-black mb-1">SUCCESS CRITERIA</h4>
              <ul className="text-xs space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span className="text-gray-700">All workflow steps must complete successfully (100% completion)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span className="text-gray-700">At least one insurance quote must be found and extracted</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span className="text-gray-700">Partial completion or no quotes found = FAILED</span>
                </li>
              </ul>
            </div>
            
            <div className="flex flex-wrap gap-4 text-xs font-mono text-black mb-3">
              <span>DIFFICULTY: {workflow.difficulty_level?.toUpperCase() || 'MEDIUM'}</span>
              {workflow.estimated_duration_seconds && (
                <span>EST. DURATION: {formatDuration(workflow.estimated_duration_seconds)}</span>
              )}
            </div>
            
            {workflow.tags && workflow.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {workflow.tags.map((tag: string, index: number) => (
                  <span key={`${workflow.id}-tag-${index}`} className="text-xs px-2 py-1 bg-white text-black border border-black rounded font-mono">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            
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
            {workflow.input_parameters && Object.keys(workflow.input_parameters).length > 0 ? (
              <DropdownMenu open={showParamsDropdown} onOpenChange={setShowParamsDropdown}>
                <DropdownMenuTrigger asChild>
                  <Button 
                    className="bg-black text-white hover:bg-gray-800 font-mono text-xs mt-4"
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
                <DropdownMenuContent className="w-96 p-4 max-h-[70vh] overflow-y-auto" align="end">
                  <div className="space-y-4">
                    <div className="font-mono text-sm font-bold">EXECUTION PARAMETERS</div>
                    
                    <RecursiveForm data={executionParams as RecursiveObject} path="" handleParamChange={handleParamChange} />
                    
                    <div className="flex gap-2 pt-2">
                      <Button
                        onClick={() => {
                          onExecute(workflow, executionParams);
                          setShowParamsDropdown(false);
                        }}
                        className="bg-black text-white hover:bg-gray-800 font-mono text-xs flex-1"
                        size="sm"
                        disabled={executingWorkflows.has(workflow.id)}
                      >
                        <PlayCircle className="w-3 h-3 mr-1" />
                        RUN WITH PARAMS
                      </Button>
                      <Button
                        onClick={() => setShowParamsDropdown(false)}
                        variant="outline"
                        className="font-mono text-xs"
                        size="sm"
                      >
                        CANCEL
                      </Button>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button 
                onClick={() => onExecute(workflow)}
                className="bg-black text-white hover:bg-gray-800 font-mono text-xs mt-4"
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
        {hasExecutions && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded hover:bg-gray-100 transition-colors cursor-pointer">
                <div className="flex items-center gap-2">
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-sm font-bold font-mono text-black">EXECUTION HISTORY</span>
                  <div className="flex gap-2">
                    {workflowLiveExecutions.length > 0 && (
                      <Badge variant="secondary" className="text-xs">{workflowLiveExecutions.length} LIVE</Badge>
                    )}
                    {recentExecutions.length > 0 && (
                      <Badge variant="outline" className="text-xs">{recentExecutions.length} RECENT</Badge>
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <div className="mt-2 max-h-[300px] overflow-y-auto p-2 border rounded-lg bg-white">
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
                          className={`bg-gray-50 px-2 py-1 border border-gray-200 rounded transition-colors ${
                            loadingExecutionId === execution.id 
                              ? 'bg-blue-50 border-blue-300 cursor-wait' 
                              : 'hover:bg-gray-100 hover:border-gray-400 cursor-pointer'
                          }`}
                          onClick={() => loadingExecutionId === null && onFetchExecutionDetails(execution.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-black font-semibold">#{execution.id}</span>
                            {loadingExecutionId === execution.id ? (
                              <div className="flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                                <span className="text-xs font-mono text-blue-600">LOADING...</span>
                              </div>
                            ) : (
                              <Badge className={`${getStatusBadge(execution.status)} h-5 px-1.5 text-xs`}>
                                {getStatusIcon(execution.status)}
                                <span className="ml-0.5">{execution.status.toUpperCase()}</span>
                              </Badge>
                            )}
                            {execution.status === 'running' && (
                              <div className="w-1.5 h-1.5 bg-black rounded-full animate-pulse"></div>
                            )}
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {execution.started_at && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  Started {new Date(execution.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              {(execution.runtime_seconds !== undefined || localTimeOffsets.has(execution.id)) && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className="font-mono">
                                    {(() => {
                                      const seconds = localTimeOffsets.get(execution.id) ?? execution.runtime_seconds ?? 0;
                                      return execution.status === 'running' ? (
                                        <>
                                          <span className="text-black font-bold">{seconds}s</span>
                                          {seconds >= 60 && <span className="text-gray-500 ml-1">({formatDuration(seconds)})</span>}
                                        </>
                                      ) : formatDuration(seconds);
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
                
                {workflowLiveExecutions.length > 0 && recentExecutions.length > 0 && (
                  <Separator className="my-2" />
                )}
                
                {recentExecutions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold font-mono mb-1 text-black">RECENT EXECUTIONS</h4>
                    <div className="space-y-1">
                      {recentExecutions.map((execution) => (
                        <div 
                          key={`exec-${execution.execution_id}`} 
                          className={`bg-white px-2 py-1 border border-black rounded transition-colors ${
                            loadingExecutionId === execution.execution_id 
                              ? 'bg-blue-50 border-blue-300 cursor-wait' 
                              : 'hover:bg-gray-50 hover:border-gray-600 cursor-pointer'
                          }`}
                          onClick={() => loadingExecutionId === null && onFetchExecutionDetails(execution.execution_id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-black font-semibold">
                              #{execution.execution_id}
                            </span>
                            {loadingExecutionId === execution.execution_id ? (
                              <div className="flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                                <span className="text-xs font-mono text-blue-600">LOADING...</span>
                              </div>
                            ) : (
                              <Badge className={`${getStatusBadge(execution.status)} h-5 px-1.5 text-xs`}>
                                {getStatusIcon(execution.status)}
                                <span className="ml-0.5">{execution.status.toUpperCase()}</span>
                              </Badge>
                            )}
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {execution.completed_at && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
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
                                  <div className="flex items-center gap-1.5 text-xs">
                                    {(() => {
                                      try {
                                        const quotes = JSON.parse(execution.formatted_output);
                                        if (Array.isArray(quotes) && quotes.length > 0) {
                                          const quotesToShow = quotes.slice(0, 2);
                                          const quoteDisplay = quotesToShow.map(q => `${q.carrierProduct?.split(':')[0]}: ${q.quoteValue || ''}`).join(' | ');
                                          const fullTitle = quotes.map(q => `${q.carrierProduct}: ${q.quoteValue || ''}`).join(', ');
                                          
                                          return (
                                            <div className="flex items-center gap-2">
                                              <span className="text-green-700">{quotes.length} quote{quotes.length > 1 ? 's' : ''} found:</span>
                                              <span className="font-mono bg-gray-100 px-2 py-0.5 rounded-full text-gray-700 truncate max-w-[400px]" title={fullTitle}>
                                                {quoteDisplay}
                                              </span>
                                              {quotes.length > 2 && <span className="text-gray-500">...</span>}
                                            </div>
                                          )
                                        }
                                        return <span className="text-green-700 truncate inline-block max-w-[550px]" title={execution.formatted_output}>{execution.formatted_output.split('\n')[0]}</span>
                                      } catch {
                                        return <span className="text-green-700 truncate inline-block max-w-[550px]" title={execution.formatted_output}>{execution.formatted_output.split('\n')[0]}</span>
                                      }
                                    })()}
                                  </div>
                                </>
                              )}
                              {execution.status === 'failed' && (execution.error_message || execution.formatted_output) && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className="text-red-600 truncate inline-block max-w-[550px]" title={execution.error_message || execution.formatted_output}>
                                    {(() => {
                                      if (execution.error_message) return execution.error_message;
                                      if (execution.formatted_output) {
                                        const lines = execution.formatted_output.split('\n');
                                        const hasCompletedMessage = lines.some(line => line.includes('✅ Workflow execution completed!'));
                                        const hasNoQuotesFound = lines.some(line => line.includes('❌ No Eligible Quotes Found') || line.includes('No Eligible Quotes Found'));
                                        if (hasCompletedMessage && hasNoQuotesFound) {
                                          const successfulStepsLine = lines.find(line => line.includes('Successful Steps:'));
                                          if (successfulStepsLine && successfulStepsLine.includes('Successful Steps: 0')) return 'Workflow failed - No steps completed successfully';
                                          else if (hasNoQuotesFound) return 'Workflow incomplete - No quotes found';
                                        }
                                        const errorLine = lines.find(line => line.includes('❌') || line.includes('Message:') || line.includes('Error:') || line.includes('Failed:') || line.includes('failed!'));
                                        if (errorLine) return errorLine.replace(/^\s*Message:\s*/, '').replace(/^\s*Error:\s*/, '').replace(/^❌\s*/, '').trim();
                                        return lines.find(line => line.trim() && !line.includes('===') && !line.includes('---')) || 'Workflow execution failed';
                                      }
                                      return 'Workflow execution failed';
                                    })()}
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
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
} 