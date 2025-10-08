'use client';

import { CopyToClipboardButton } from '@/components/common/CopyToClipboardButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  ApiRequestBlock,
  CodeBlock,
} from '@/components/ui/code-block';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Execution } from '@/lib/workflow-types';
import { Loader2, Terminal, XCircle, Sparkles, Download } from 'lucide-react';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { formatDuration, getStatusBadge, getStatusIcon } from './utils';
import { ExecutionAIChat } from './ExecutionAIChat';
import { Button } from '@/components/ui/button';

interface ExecutionDetailsDialogProps {
  execution: Execution | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LoadingSkeleton = () => (
  <div className="space-y-6 p-2">
    <div className="space-y-2">
      <Skeleton className="h-6 w-1/4" />
      <Skeleton className="h-16 w-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-6 w-1/4" />
      <Skeleton className="h-32 w-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-6 w-1/4" />
      <Skeleton className="h-24 w-full" />
    </div>
  </div>
);

export function ExecutionDetailsDialog({
  execution,
  open,
  onOpenChange,
}: ExecutionDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState('summary');
  const [isTabLoading, setIsTabLoading] = useState(false);

  // Lazy loaded data state
  const [executionLogs, setExecutionLogs] = useState<any[] | null>(null);
  const [executionResults, setExecutionResults] = useState<any | null>(null);
  const [formattedOutput, setFormattedOutput] = useState<string | null>(null);
  const [rawMcpResponse, setRawMcpResponse] = useState<any | null>(null);
  const [loadingStates, setLoadingStates] = useState({
    logs: false,
    results: false,
    formattedOutput: false,
    rawMcpResponse: false,
  });
  const [isDownloadingLogs, setIsDownloadingLogs] = useState(false);
  const [isDownloadingResults, setIsDownloadingResults] = useState(false);

  // Fetch logs on demand using dedicated endpoint
  const fetchExecutionLogs = useCallback(async () => {
    if (!execution || executionLogs !== null || loadingStates.logs) return;

    setLoadingStates(prev => ({ ...prev, logs: true }));
    try {
      // Use dedicated logs endpoint for better performance
      const response = await fetch(
        `/api/remote-workflows/executions/${execution.execution_id}/logs`
      );
      const data = await response.json();
      if (data.success && data.logs) {
        setExecutionLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Failed to fetch execution logs:', error);
      setExecutionLogs([]);
    } finally {
      setLoadingStates(prev => ({ ...prev, logs: false }));
    }
  }, [execution, executionLogs, loadingStates.logs]);

  // Fetch results for download
  const fetchExecutionResults = async () => {
    if (!execution || executionResults !== null || loadingStates.results) return;

    setLoadingStates(prev => ({ ...prev, results: true }));
    try {
      const response = await fetch(
        `/api/remote-workflows/executions/${execution.execution_id}?full_detailed_response=true`
      );
      const data = await response.json();
      if (data.success && data.execution) {
        setExecutionResults(data.execution.results);
        if (data.execution.formatted_output) setFormattedOutput(data.execution.formatted_output);
        if (data.execution.execution_logs) setExecutionLogs(data.execution.execution_logs);
        if (data.execution.raw_mcp_response) setRawMcpResponse(data.execution.raw_mcp_response);
      }
    } catch (error) {
      console.error('Failed to fetch execution results:', error);
    } finally {
      setLoadingStates(prev => ({ ...prev, results: false }));
    }
  };

  // Fetch raw MCP response for complete logs download
  const fetchRawMcpResponse = async () => {
    if (!execution || rawMcpResponse !== null || loadingStates.rawMcpResponse) return rawMcpResponse;

    setLoadingStates(prev => ({ ...prev, rawMcpResponse: true }));
    try {
      const response = await fetch(
        `/api/remote-workflows/executions/${execution.execution_id}/results`
      );
      const data = await response.json();
      if (data.success && data.execution && data.execution.results) {
        // Store results in the same state variable for compatibility
        setRawMcpResponse(data.execution.results);
        return data.execution.results;
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch execution results:', error);
      return null;
    } finally {
      setLoadingStates(prev => ({ ...prev, rawMcpResponse: false }));
    }
  };

  // Helper function to download complete execution logs as JSON (using results field)
  const downloadLogsAsText = async () => {
    if (!execution) return;

    setIsDownloadingLogs(true);
    try {
      // Fetch results if not already loaded
      let resultsToDownload = rawMcpResponse || executionResults || execution.results;

      if (!resultsToDownload) {
        const fetchedResults = await fetchRawMcpResponse();
        resultsToDownload = fetchedResults;
      }

      if (!resultsToDownload) {
        alert('No execution data available for download. The execution may not have completed or results were not stored.');
        return;
      }

      // Format timestamp for filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `execution-${execution.execution_id}-complete-execution-${timestamp}.json`;

      // Create a comprehensive execution data object with metadata
      const completeExecutionData = {
        execution_metadata: {
          execution_id: execution.execution_id,
          workflow_name: execution.workflow_name || 'N/A',
          workflow_id: execution.workflow_id,
          status: execution.status,
          created_at: execution.created_at,
          started_at: execution.started_at,
          completed_at: execution.completed_at,
          duration_seconds: execution.execution_duration_seconds,
          machine: execution.assigned_machine_name || null,
          version: execution.version_number ? `v${execution.version_number}` : null,
          client_id: execution.client_id || null,
          modal_call_id: execution.modal_call_id || null,
          error_message: execution.error_message || null,
        },
        execution_results: resultsToDownload,
        download_timestamp: new Date().toISOString(),
        download_note: 'This file contains the complete execution data including all step results, environment variables, and logs'
      };

      // Create blob and trigger download as JSON
      const jsonString = JSON.stringify(completeExecutionData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloadingLogs(false);
    }
  };

  // Helper function to download results as JSON file
  const downloadResultsAsJson = async () => {
    if (!execution) return;

    setIsDownloadingResults(true);
    try {
      // Fetch results if not already loaded
      if (!executionResults) {
        await fetchExecutionResults();
      }

      const resultsToDownload = executionResults || execution.results;
      if (!resultsToDownload) {
        return;
      }

      // Format timestamp for filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `execution-${execution.execution_id}-results-${timestamp}.json`;

      // Create a comprehensive results object
      const resultsData = {
        execution: {
          id: execution.execution_id,
          workflow: execution.workflow_name || 'N/A',
          status: execution.status,
          started_at: execution.started_at,
          completed_at: execution.completed_at,
          duration_seconds: execution.execution_duration_seconds,
          machine: execution.assigned_machine_name || null,
          version: execution.version_number ? `v${execution.version_number}` : null,
          error: execution.error_message || null,
        },
        results: resultsToDownload,
        formatted_output: formattedOutput || execution.formatted_output ?
          (typeof execution.formatted_output === 'string' ?
            JSON.parse(execution.formatted_output) :
            execution.formatted_output) : null,
        generated_at: new Date().toISOString(),
      };

      // Create blob and trigger download
      const jsonString = JSON.stringify(resultsData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloadingResults(false);
    }
  };

  useEffect(() => {
    // When a new execution is selected, reset to summary tab and clear lazy loaded data
    if (open) {
      setActiveTab('summary');
      setIsTabLoading(false);
      // Clear lazy loaded data when dialog opens with new execution
      setExecutionLogs(null);
      setExecutionResults(null);
      setFormattedOutput(null);
      setRawMcpResponse(null);
      setLoadingStates({
        logs: false,
        results: false,
        formattedOutput: false,
        rawMcpResponse: false,
      });
    }
  }, [execution, open]);

  useEffect(() => {
    // Fetch data when tab changes
    if (activeTab === 'logs' && executionLogs === null) {
      fetchExecutionLogs();
    }
  }, [activeTab, executionLogs, fetchExecutionLogs]);

  useEffect(() => {
    if (isTabLoading) {
      // Short delay to allow the loading skeleton to render before the potentially blocking content
      const timer = setTimeout(() => setIsTabLoading(false), 50);
      return () => clearTimeout(timer);
    }
  }, [isTabLoading]);

  const handleTabChange = (value: string) => {
    if (value !== activeTab) {
      setIsTabLoading(true);
      setActiveTab(value);
    }
  };

  if (!execution && !open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 overflow-hidden">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              {execution ? (
                <>
                  Execution #{execution.execution_id}
                  <Badge className={getStatusBadge(execution.status)}>
                    {getStatusIcon(execution.status)}
                    <span className="ml-1">
                      {execution.status.toUpperCase()}
                    </span>
                  </Badge>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Loading Execution Details...
                  </div>
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {execution?.workflow_name || 'Loading...'}
            </DialogDescription>
          </DialogHeader>
        </div>
        <Tabs
          defaultValue="summary"
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="logs">Orchestrator server logs</TabsTrigger>
              <TabsTrigger value="qa" className="flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Q&A
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <TabsContent value="summary">
              {isTabLoading || !execution ? (
                <LoadingSkeleton />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold mb-2">Execution Info</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">
                            Workflow ID:
                          </dt>
                          <dd className="font-mono">{execution.workflow_id}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Client ID:</dt>
                          <dd className="font-mono text-xs">
                            {execution.client_id || '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">
                            Modal Call ID:
                          </dt>
                          <dd
                            className="font-mono text-xs truncate max-w-[400px]"
                            title={execution.modal_call_id}
                          >
                            {execution.modal_call_id}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">
                            Workflow Version:
                          </dt>
                          <dd className="font-mono text-sm font-semibold">
                            {execution.version_number
                              ? `v${execution.version_number}`
                              : '—'}
                          </dd>
                        </div>
                        {execution.assigned_machine_name && (
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">
                              Executed On:
                            </dt>
                            <dd className="font-mono text-sm">
                              {execution.assigned_machine_name}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">Timing</h4>
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Created:</dt>
                          <dd className="text-xs">
                            {execution.created_at
                              ? new Date(execution.created_at).toLocaleString()
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Started:</dt>
                          <dd className="text-xs">
                            {execution.started_at
                              ? new Date(execution.started_at).toLocaleString()
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Completed:</dt>
                          <dd className="text-xs">
                            {execution.completed_at
                              ? new Date(
                                  execution.completed_at
                                ).toLocaleString()
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Duration:</dt>
                          <dd className="font-mono">
                            {formatDuration(
                              execution.execution_duration_seconds
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  {execution.error_message && (
                    <Alert
                      variant="default"
                      className="border-black bg-gray-100"
                    >
                      <XCircle className="h-4 w-4" />
                      <AlertDescription>
                        {execution.error_message}
                      </AlertDescription>
                    </Alert>
                  )}

                  {execution.error_analysis && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <span className="text-lg">🤖</span> AI Error Analysis
                      </h3>
                      <div className="prose prose-sm max-w-none bg-blue-50 p-4 rounded-lg border border-blue-200">
                        <div
                          dangerouslySetInnerHTML={{
                            __html: execution.error_analysis
                              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                              .replace(/^- (.*?)$/gm, '<li>$1</li>')
                              .replace(/(<li>[\s\S]*<\/li>)/, '<ul>$1</ul>')
                              .replace(/\n\n/g, '</p><p>')
                              .replace(/^/, '<p>')
                              .replace(/$/, '</p>')
                          }}
                        />
                      </div>
                      {execution.error_analyzed_at && (
                        <p className="text-xs text-muted-foreground">
                          Analyzed at: {new Date(execution.error_analyzed_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <ApiRequestBlock
                      method="POST"
                      url={`/api/remote-workflows/${execution.workflow_id}/execute`}
                      headers={{ 'Content-Type': 'application/json' }}
                      body={
                        execution.execution_params &&
                        Object.keys(execution.execution_params).length > 0
                          ? execution.execution_params
                          : '// No parameters provided for this execution.'
                      }
                      title="API Request"
                      size="sm"
                    />
                  </div>

                  {(execution.results || execution.execution_logs) && (
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-medium">Full Execution Data</h3>
                      <div className="flex gap-2">
                        {execution.results && (
                          <Button
                            variant="black-outline"
                            size="sm"
                            className="h-8 px-3"
                            onClick={downloadResultsAsJson}
                            disabled={isDownloadingResults}
                          >
                            {isDownloadingResults ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4 mr-2" />
                            )}
                            Download Results (JSON)
                          </Button>
                        )}
                        <Button
                          variant="black-outline"
                          size="sm"
                          className="h-8 px-3"
                          onClick={downloadLogsAsText}
                          disabled={isDownloadingLogs}
                        >
                          {isDownloadingLogs ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4 mr-2" />
                          )}
                          Download Complete Logs (JSON)
                        </Button>
                      </div>
                    </div>
                  )}

                  {execution.formatted_output && (
                    <div>
                      <CodeBlock
                        title="Formatted Output"
                        language="json"
                        size="sm"
                      >
                        {execution.formatted_output}
                      </CodeBlock>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
            <TabsContent value="logs">
              {isTabLoading || !execution || loadingStates.logs ? (
                <LoadingSkeleton />
              ) : (
                <div className="space-y-4 h-full flex flex-col">
                  {executionLogs && executionLogs.length > 0 ? (
                    <div className="space-y-2 flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          Real-time server logs from the orchestrator during workflow
                          execution.
                        </p>
                        <div className="flex items-center gap-2">
                          <CopyToClipboardButton
                            contentToCopy={
                              executionLogs
                                ?.map(
                                  log =>
                                    `${log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''} [${log.level}] ${log.message}`
                                )
                                .join('\n') || ''
                            }
                          />
                          <Button
                            variant="black-outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={downloadLogsAsText}
                            disabled={isDownloadingLogs}
                          >
                            {isDownloadingLogs ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Download className="w-3 h-3 mr-1" />
                            )}
                            Download Complete (JSON)
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-auto border border-black rounded-md bg-white p-4">
                        {executionLogs.map((log, idx) => (
                          <div
                            key={idx}
                            className="flex gap-2 text-xs font-mono"
                          >
                            <span className="text-muted-foreground">
                              {log.timestamp
                                ? new Date(log.timestamp).toLocaleTimeString()
                                : ''}
                            </span>
                            <Badge
                              variant={
                                log.level === 'error' ? 'outline' : 'secondary'
                              }
                              className={
                                log.level === 'error'
                                  ? 'border-black text-black'
                                  : 'text-xs'
                              }
                            >
                              {log.level}
                            </Badge>
                            <span className="flex-1">{log.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Alert className="text-center">
                      <Terminal className="h-4 w-4" />
                      <AlertDescription>
                        No orchestrator server logs available for this run.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </TabsContent>
            <TabsContent value="qa" className="h-full">
              {isTabLoading || !execution ? (
                <LoadingSkeleton />
              ) : (
                <div className="h-full">
                  <Suspense fallback={<LoadingSkeleton />}>
                    <ExecutionAIChat execution={execution} />
                  </Suspense>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
