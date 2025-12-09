'use client';

import { CopyToClipboardButton } from '@/components/common/CopyToClipboardButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ApiRequestBlock, CodeBlock } from '@/components/ui/code-block';
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
import {
  Loader2,
  Terminal,
  XCircle,
  Sparkles,
  Download,
  FolderOpen,
  FileText,
  ChevronDown,
  ChevronRight,
  Monitor,
  Info,
  Search,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { useEffect, useState, Suspense, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { formatDuration, getStatusBadge, getStatusIcon } from './utils';
import { ExecutionAIChat } from './ExecutionAIChat';
import { AgentScreenTab } from './AgentScreenTab';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection = ({
  title,
  children,
  defaultOpen = true,
}: CollapsibleSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-2 border-black rounded">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-white hover:bg-gray-50 transition-colors"
      >
        <h3 className="font-mono font-bold text-sm uppercase">{title}</h3>
        {isOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>
      {isOpen && <div className="p-4 border-t-2 border-black">{children}</div>}
    </div>
  );
};

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
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null);

  // SSE streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [newLogIndices, setNewLogIndices] = useState<Set<number>>(new Set());
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Helper function to highlight search query in text
  const highlightText = (text: string, query: string) => {
    if (!query || !text) return text;

    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, index) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={index} className="bg-black text-white px-0.5 rounded">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  // Helper function to open file in Windows Explorer or with default app
  const openFileInExplorer = async (
    filePath: string,
    action: 'select' | 'open' = 'select'
  ) => {
    try {
      const response = await fetch('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, action }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const message =
          action === 'open' ? 'Opening file...' : 'Opening in Explorer...';
        toast.success(message, {
          description: data.path,
        });
      } else {
        // Show detailed error message with suggestions if available
        const errorDescription = data.suggestions
          ? `${data.details}\n\nSuggestions:\n${data.suggestions.map((s: string) => `• ${s}`).join('\n')}`
          : data.details || data.error || 'Unknown error';

        toast.error(data.error || 'Failed to open file', {
          description: errorDescription,
          duration: 8000, // Longer duration for error messages with suggestions
        });
      }
    } catch (error) {
      console.error('Error opening file:', error);
      toast.error('Failed to open file', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  // Helper function to render formatted output with clickable file paths
  const renderFormattedOutputWithFileLinks = () => {
    if (!execution || !execution.formatted_output) return null;

    try {
      const output =
        typeof execution.formatted_output === 'string'
          ? JSON.parse(execution.formatted_output)
          : execution.formatted_output;

      // Check for human-readable markdown summary
      const humanSummary = output.summary || output.human;

      // Check if file_info exists at root or nested in data
      const fileInfo = output.file_info || output.data?.file_info;

      return (
        <div className="space-y-3">
          {/* Render human-readable markdown summary if present */}
          {humanSummary && (
            <div className="border-2 border-black p-4 bg-white rounded">
              <div className="prose prose-sm max-w-none prose-headings:font-bold prose-headings:text-black prose-p:text-gray-700 prose-strong:text-black ">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-4">
                        <table className="min-w-full border-collapse border border-gray-300 text-sm">
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead className="bg-gray-100">{children}</thead>
                    ),
                    th: ({ children }) => (
                      <th className="border border-gray-300 px-3 py-2 text-left font-semibold text-black">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-gray-300 px-3 py-2 font-mono">
                        {children}
                      </td>
                    ),
                    h1: ({ children }) => (
                      <h1 className="text-xl font-bold mt-0 mb-3 text-black">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-lg font-bold mt-6 mb-2 text-black border-b border-gray-200 pb-1">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-base font-semibold mt-4 mb-2 text-black">{children}</h3>
                    ),
                    p: ({ children }) => (
                      <p className="my-2 text-gray-700">{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>
                    ),
                    li: ({ children }) => (
                      <li className="text-gray-700">{children}</li>
                    ),
                    code: ({ children }) => (
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800">
                        {children}
                      </code>
                    ),
                    hr: () => <hr className="my-4 border-gray-300" />,
                  }}
                >
                  {humanSummary}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {fileInfo && fileInfo.file_path && fileInfo.original_file && (
            <div className="flex items-center justify-between border-2 border-black bg-gray-50 p-3 rounded">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                <span className="text-sm font-mono font-semibold">
                  {fileInfo.original_file}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="black-outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => openFileInExplorer(fileInfo.file_path, 'open')}
                >
                  <FileText className="w-3 h-3 mr-1" />
                  Open File
                </Button>
                <Button
                  variant="black-outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => openFileInExplorer(fileInfo.file_path, 'select')}
                >
                  <FolderOpen className="w-3 h-3 mr-1" />
                  Show in Folder
                </Button>
              </div>
            </div>
          )}

          <CodeBlock title="Formatted Output" language="json" size="sm">
            {execution.formatted_output}
          </CodeBlock>
        </div>
      );
    } catch (error) {
      // If parsing fails, render normal CodeBlock
      return (
        <CodeBlock title="Formatted Output" language="json" size="sm">
          {execution.formatted_output}
        </CodeBlock>
      );
    }
  };

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

  const forceRefreshLogs = async () => {
    if (!execution || loadingStates.logs) return;

    setLoadingStates(prev => ({ ...prev, logs: true }));
    try {
      const response = await fetch(
        `/api/remote-workflows/executions/${execution.execution_id}/logs`
      );
      const data = await response.json();
      if (data.success && data.logs) {
        setExecutionLogs(data.logs || []);
        toast.success('Logs refreshed');
      }
    } catch (error) {
      console.error('Failed to fetch execution logs:', error);
      toast.error('Failed to refresh logs');
    } finally {
      setLoadingStates(prev => ({ ...prev, logs: false }));
    }
  };

  // Fetch results for download
  const fetchExecutionResults = async () => {
    if (!execution || executionResults !== null || loadingStates.results)
      return;

    setLoadingStates(prev => ({ ...prev, results: true }));
    try {
      const response = await fetch(
        `/api/remote-workflows/executions/${execution.execution_id}?full_detailed_response=true`
      );
      const data = await response.json();
      if (data.success && data.execution) {
        setExecutionResults(data.execution.results);
        if (data.execution.formatted_output)
          setFormattedOutput(data.execution.formatted_output);
        if (data.execution.execution_logs)
          setExecutionLogs(data.execution.execution_logs);
        if (data.execution.raw_mcp_response)
          setRawMcpResponse(data.execution.raw_mcp_response);
      }
    } catch (error) {
      console.error('Failed to fetch execution results:', error);
    } finally {
      setLoadingStates(prev => ({ ...prev, results: false }));
    }
  };

  // Fetch raw MCP response for complete logs download
  const fetchRawMcpResponse = async () => {
    if (!execution || rawMcpResponse !== null || loadingStates.rawMcpResponse)
      return rawMcpResponse;

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
      let resultsToDownload =
        rawMcpResponse || executionResults || execution.results;

      if (!resultsToDownload) {
        const fetchedResults = await fetchRawMcpResponse();
        resultsToDownload = fetchedResults;
      }

      if (!resultsToDownload) {
        console.error('No execution data available for download', {
          execution_id: execution.execution_id,
          status: execution.status,
          has_results: !!execution.results,
          has_rawMcpResponse: !!rawMcpResponse,
          has_executionResults: !!executionResults,
        });
        toast.error('No execution data available for download', {
          description:
            'The execution may not have completed or results were not stored.',
        });
        return;
      }

      // Format timestamp for filename
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, -5);
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
          version: execution.version_number
            ? `v${execution.version_number}`
            : null,
          client_id: execution.client_id || null,
          modal_call_id: execution.modal_call_id || null,
          error_message: execution.error_message || null,
        },
        execution_results: resultsToDownload,
        download_timestamp: new Date().toISOString(),
        download_note:
          'This file contains the complete execution data including all step results, environment variables, and logs',
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

      toast.success('Download started', {
        description: `Downloading ${filename}`,
      });
    } catch (error) {
      console.error('Error downloading execution logs:', error, {
        execution_id: execution?.execution_id,
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
      toast.error('Failed to download execution logs', {
        description:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred',
      });
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
        console.error('No results data available for download', {
          execution_id: execution.execution_id,
          status: execution.status,
          has_results: !!execution.results,
          has_executionResults: !!executionResults,
        });
        toast.error('No results data available for download', {
          description:
            'The execution may not have completed or results were not stored.',
        });
        return;
      }

      // Format timestamp for filename
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, -5);
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
          version: execution.version_number
            ? `v${execution.version_number}`
            : null,
          error: execution.error_message || null,
        },
        results: resultsToDownload,
        formatted_output:
          formattedOutput || execution.formatted_output
            ? typeof execution.formatted_output === 'string'
              ? JSON.parse(execution.formatted_output)
              : execution.formatted_output
            : null,
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

      toast.success('Download started', {
        description: `Downloading ${filename}`,
      });
    } catch (error) {
      console.error('Error downloading results:', error, {
        execution_id: execution?.execution_id,
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
      toast.error('Failed to download results', {
        description:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred',
      });
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

  // SSE streaming for real-time logs
  useEffect(() => {
    const isRunning =
      execution &&
      ['running', 'queued'].includes(execution.status.toLowerCase());
    const isRustExecutor = execution?.executor_type === 'rust';

    // Connect to SSE stream when logs tab is active and execution is running
    if (
      open &&
      activeTab === 'logs' &&
      isRunning &&
      isRustExecutor &&
      execution
    ) {
      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(
        `/api/remote-workflows/executions/${execution.execution_id}/logs/stream`
      );
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsStreaming(true);
      };

      eventSource.onmessage = event => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'logs' && data.logs) {
            setExecutionLogs(prev => {
              const currentLogs = prev || [];
              const newLogs = [...currentLogs, ...data.logs];

              // Track new log indices for highlighting
              const startIndex = currentLogs.length;
              const newIndices = new Set<number>();
              for (let i = startIndex; i < newLogs.length; i++) {
                newIndices.add(i);
              }
              setNewLogIndices(newIndices);

              // Clear highlighting after 2 seconds
              setTimeout(() => {
                setNewLogIndices(new Set());
              }, 2000);

              return newLogs;
            });
          } else if (data.type === 'completed') {
            setIsStreaming(false);
          } else if (data.type === 'error') {
            console.error('[SSE] Error:', data.message);
          }
        } catch (error) {
          console.error('[SSE] Parse error:', error);
        }
      };

      eventSource.onerror = () => {
        setIsStreaming(false);
        eventSource.close();
        eventSourceRef.current = null;

        // Fallback to regular fetch if SSE fails
        fetchExecutionLogs();
      };

      return () => {
        eventSource.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
      };
    } else if (!isRunning && eventSourceRef.current) {
      // Close connection when execution completes
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsStreaming(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    activeTab,
    execution?.execution_id,
    execution?.status,
    execution?.executor_type,
  ]);

  // Polling fallback for running executions when SSE isn't active
  useEffect(() => {
    const isRunning =
      execution &&
      ['running', 'queued'].includes(execution.status.toLowerCase());

    // Only poll if running, logs tab active, and NOT using SSE streaming
    if (open && activeTab === 'logs' && isRunning && !isStreaming) {
      const pollInterval = setInterval(() => {
        fetchExecutionLogs();
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(pollInterval);
    }
  }, [open, activeTab, execution, isStreaming, fetchExecutionLogs]);

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
            <TabsList
              className={`grid w-full ${execution?.assigned_machine_id ? 'grid-cols-4' : 'grid-cols-3'}`}
            >
              <TabsTrigger value="summary" className="flex items-center gap-1">
                <Info className="w-3 h-3" />
                Summary
              </TabsTrigger>
              <TabsTrigger value="logs" className="flex items-center gap-1">
                <Terminal className="w-3 h-3" />
                Logs
              </TabsTrigger>
              <TabsTrigger value="qa" className="flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Q&A
              </TabsTrigger>
              {execution?.assigned_machine_id && (
                <TabsTrigger
                  value="agent-screen"
                  className="flex items-center gap-1"
                >
                  <Monitor className="w-3 h-3" />
                  Agent Screen
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <TabsContent value="summary">
              {isTabLoading || !execution ? (
                <LoadingSkeleton />
              ) : (
                <div className="space-y-4">
                  <CollapsibleSection
                    title="Execution Info & Timing"
                    defaultOpen={true}
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-semibold mb-2">Execution Info</h4>
                        <dl className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">
                              Workflow ID:
                            </dt>
                            <dd className="font-mono">
                              {execution.workflow_id}
                            </dd>
                          </div>
                          {/*<div className="flex justify-between">
                            <dt className="text-muted-foreground">
                              Client ID:
                            </dt>
                            <dd className="font-mono text-xs">
                              {execution.client_id || '—'}
                            </dd>
                          </div>*/}
                          {/*<div className="flex justify-between">
                            <dt className="text-muted-foreground">
                              Modal Call ID:
                            </dt>
                            <dd
                              className="font-mono text-xs truncate max-w-[400px]"
                              title={execution.modal_call_id}
                            >
                              {execution.modal_call_id}
                            </dd>
                          </div>*/}
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
                          {(execution as any).assigned_machine_mcp_version && (
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">
                                MCP Version:
                              </dt>
                              <dd className="font-mono text-sm">
                                {
                                  (execution as any)
                                    .assigned_machine_mcp_version
                                }
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
                                ? new Date(
                                    execution.created_at
                                  ).toLocaleString()
                                : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">Started:</dt>
                            <dd className="text-xs">
                              {execution.started_at
                                ? new Date(
                                    execution.started_at
                                  ).toLocaleString()
                                : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">
                              Completed:
                            </dt>
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
                  </CollapsibleSection>

                  {execution.error_message && (
                    <CollapsibleSection
                      title="Error Message"
                      defaultOpen={true}
                    >
                      <Alert
                        variant="default"
                        className="border-black bg-gray-100 relative"
                      >
                        <XCircle className="h-4 w-4" />
                        <AlertDescription className="break-words overflow-wrap-anywhere whitespace-pre-wrap pr-8">
                          {execution.error_message}
                        </AlertDescription>
                        <div className="absolute top-2 right-2">
                          <CopyToClipboardButton
                            contentToCopy={execution.error_message}
                            size="sm"
                          />
                        </div>
                      </Alert>
                    </CollapsibleSection>
                  )}

                  {execution.error_analysis && (
                    <CollapsibleSection
                      title="🤖 AI Error Analysis"
                      defaultOpen={true}
                    >
                      <div className="space-y-2">
                        <div className="prose prose-sm max-w-none bg-blue-50 p-4 rounded-lg border border-blue-200">
                          <div
                            dangerouslySetInnerHTML={{
                              __html: execution.error_analysis
                                .replace(
                                  /\*\*(.*?)\*\*/g,
                                  '<strong>$1</strong>'
                                )
                                .replace(/^- (.*?)$/gm, '<li>$1</li>')
                                .replace(/(<li>[\s\S]*<\/li>)/, '<ul>$1</ul>')
                                .replace(/\n\n/g, '</p><p>')
                                .replace(/^/, '<p>')
                                .replace(/$/, '</p>'),
                            }}
                          />
                        </div>
                        {execution.error_analyzed_at && (
                          <p className="text-xs text-muted-foreground">
                            Analyzed at:{' '}
                            {new Date(
                              execution.error_analyzed_at
                            ).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </CollapsibleSection>
                  )}

                  {execution.screenshots &&
                    execution.screenshots.length > 0 && (
                      <CollapsibleSection
                        title="📸 Monitor Screenshots"
                        defaultOpen={true}
                      >
                        <div className="grid grid-cols-2 gap-4">
                          {execution.screenshots.map((screenshot, idx) => {
                            const isUrl =
                              screenshot.startsWith('http://') ||
                              screenshot.startsWith('https://');

                            // If URL contains supabase storage, route through API for org-level access control
                            let imageSrc = isUrl
                              ? screenshot
                              : `data:image/png;base64,${screenshot}`;
                            if (isUrl && screenshot.includes('supabase')) {
                              // Extract filename from Supabase URL path
                              // URL format: https://...supabase.../workflow-screenshots/{execution_id}/monitor_1.png
                              const filename =
                                screenshot.split('/').pop() ||
                                `monitor_${idx + 1}.png`;
                              imageSrc = `/api/workflows/executions/screenshot/${execution.execution_id}/${filename}`;
                            }

                            return (
                              <div key={idx} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-mono text-muted-foreground">
                                    Monitor {idx + 1}
                                  </p>
                                  <a
                                    href={imageSrc}
                                    download={`execution-${execution.execution_id}-monitor-${idx + 1}.png`}
                                    className="text-xs font-mono hover:underline"
                                  >
                                    Download
                                  </a>
                                </div>
                                <div className="border-2 border-black rounded-md overflow-hidden bg-gray-50">
                                  <Image
                                    src={imageSrc}
                                    alt={`Monitor ${idx + 1} screenshot`}
                                    className="w-full h-auto"
                                    width={1920}
                                    height={1080}
                                    unoptimized
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleSection>
                    )}

                  <CollapsibleSection title="API Request" defaultOpen={false}>
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
                  </CollapsibleSection>

                  {(execution.results || execution.execution_logs) && (
                    <CollapsibleSection
                      title="Full Execution Data"
                      defaultOpen={true}
                    >
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
                    </CollapsibleSection>
                  )}

                  {execution.formatted_output && (
                    <CollapsibleSection
                      title="Formatted Output"
                      defaultOpen={true}
                    >
                      {renderFormattedOutputWithFileLinks()}
                    </CollapsibleSection>
                  )}
                </div>
              )}
            </TabsContent>
            <TabsContent value="logs">
              {isTabLoading ||
              !execution ||
              (loadingStates.logs && !executionLogs) ? (
                <LoadingSkeleton />
              ) : (
                <div className="space-y-3 h-full flex flex-col">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {executionLogs && executionLogs.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs font-mono px-2 py-1"
                        >
                          {executionLogs.length} logs
                        </Badge>
                      )}
                      {isStreaming && (
                        <Badge className="bg-black text-white animate-pulse flex items-center gap-1.5 text-xs px-2 py-1">
                          <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                          LIVE
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {execution?.executor_type === 'rust' && (
                        <Button
                          variant="black-outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={forceRefreshLogs}
                          disabled={loadingStates.logs || isStreaming}
                        >
                          <RefreshCw
                            className={`w-3 h-3 mr-1 ${
                              loadingStates.logs ? 'animate-spin' : ''
                            }`}
                          />
                          Refresh
                        </Button>
                      )}
                      {executionLogs && executionLogs.length > 0 && (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>

                  {executionLogs && executionLogs.length > 0 ? (
                    <div className="space-y-2 flex-1 flex flex-col min-h-0">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search logs..."
                          value={logSearchQuery}
                          onChange={e => setLogSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border-2 border-black rounded-md focus:outline-none focus:ring-2 focus:ring-black font-mono text-sm"
                        />
                      </div>
                      <div
                        ref={logsContainerRef}
                        className="flex-1 min-h-0 overflow-auto space-y-1"
                      >
                        {[...executionLogs]
                          .reverse() // Show newest logs first
                          .filter(log => {
                            if (!logSearchQuery) return true;
                            const searchLower = logSearchQuery.toLowerCase();
                            return (
                              log.message
                                ?.toLowerCase()
                                .includes(searchLower) ||
                              log.level?.toLowerCase().includes(searchLower) ||
                              (log.timestamp &&
                                new Date(log.timestamp)
                                  .toLocaleTimeString()
                                  .toLowerCase()
                                  .includes(searchLower))
                            );
                          })
                          .map((log, idx, filteredArray) => {
                            // Find original index for highlight tracking (from original array)
                            const originalIndex =
                              executionLogs?.indexOf(log) ?? idx;
                            // Display number should be reversed (newest = highest number)
                            const displayNumber = executionLogs
                              ? executionLogs.length -
                                executionLogs.indexOf(log)
                              : idx + 1;
                            const isExpanded = expandedLogIndex === idx;
                            const isNew = newLogIndices.has(originalIndex);
                            const level = log.level || 'info';
                            const timestamp = log.timestamp
                              ? new Date(log.timestamp)
                              : null;
                            const service = (log as any).service || '';
                            const isMcpAgent =
                              service === 'terminator-mcp-agent';

                            return (
                              <div
                                key={idx}
                                className={`transition-all duration-500 ${isNew ? 'bg-gray-100 border-l-2 border-l-black' : ''}`}
                              >
                                {/* Compact Log Line */}
                                <button
                                  onClick={() =>
                                    setExpandedLogIndex(isExpanded ? null : idx)
                                  }
                                  className={`w-full border hover:border-black hover:bg-gray-50 p-2 text-left transition-colors ${
                                    isNew ? 'border-black' : 'border-gray-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 font-mono text-xs">
                                    {/* Log Number */}
                                    <span className="text-gray-400 w-8 flex-shrink-0 text-right">
                                      {originalIndex + 1}
                                    </span>
                                    <span className="text-gray-300">|</span>

                                    {/* Time */}
                                    <span className="text-gray-500 w-20 flex-shrink-0">
                                      {timestamp
                                        ? timestamp.toLocaleTimeString()
                                        : '-'}
                                    </span>

                                    {/* Service Badge */}
                                    {service && (
                                      <span
                                        className={`px-1.5 py-0.5 border rounded-sm text-[10px] flex-shrink-0 flex items-center gap-1 ${
                                          isMcpAgent
                                            ? 'border-gray-500 bg-gray-100 text-gray-600'
                                            : 'border-black bg-black text-white'
                                        }`}
                                      >
                                        <Monitor className="w-2.5 h-2.5" />
                                        {isMcpAgent ? 'SERVER' : 'CLIENT'}
                                      </span>
                                    )}

                                    {/* Level Badge */}
                                    <span
                                      className={`px-2 py-0.5 border rounded-sm flex items-center gap-1 flex-shrink-0 ${
                                        level === 'error'
                                          ? 'border-black bg-black text-white'
                                          : level === 'warn' ||
                                              level === 'warning'
                                            ? 'border-black bg-white text-black'
                                            : 'border-gray-400 bg-gray-100 text-gray-700'
                                      }`}
                                    >
                                      {level === 'error' && (
                                        <AlertCircle className="w-3 h-3" />
                                      )}
                                      {(level === 'warn' ||
                                        level === 'warning') && (
                                        <AlertTriangle className="w-3 h-3" />
                                      )}
                                      {level === 'info' && (
                                        <Info className="w-3 h-3" />
                                      )}
                                      {level.toUpperCase()}
                                    </span>

                                    {/* Message (truncated) */}
                                    <span className="flex-1 truncate text-black">
                                      {log.message}
                                    </span>

                                    {/* Expand Icon */}
                                    <ChevronDown
                                      className={`w-4 h-4 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                    />
                                  </div>
                                </button>

                                {/* Expanded Details */}
                                {isExpanded && (
                                  <div className="border-2 border-black bg-gray-50 p-4 space-y-3 mb-1 font-mono text-xs">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                      <div>
                                        <span className="font-bold uppercase text-gray-600">
                                          Timestamp:
                                        </span>
                                        <div className="mt-1">
                                          {timestamp
                                            ? timestamp.toISOString()
                                            : 'N/A'}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="font-bold uppercase text-gray-600">
                                          Level:
                                        </span>
                                        <div className="mt-1">
                                          {level.toUpperCase()}
                                        </div>
                                      </div>
                                      {service && (
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">
                                            Service:
                                          </span>
                                          <div className="mt-1">
                                            {isMcpAgent
                                              ? 'MCP Agent'
                                              : 'Executor'}{' '}
                                            <span className="text-gray-500 text-[10px]">
                                              ({service})
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                      {(log as any).host_name && (
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">
                                            Host:
                                          </span>
                                          <div className="mt-1">
                                            {(log as any).host_name}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Module/Scope name for Rust logs */}
                                    {(log as any).scope_name && (
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">
                                            Module:
                                          </span>
                                          <div className="mt-1 text-gray-700">
                                            {(log as any).scope_name}
                                          </div>
                                        </div>
                                        {(log as any).span_id && (
                                          <div>
                                            <span className="font-bold uppercase text-gray-600">
                                              Span ID:
                                            </span>
                                            <div className="mt-1 text-gray-500">
                                              {(log as any).span_id}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    <div className="border-t-2 border-gray-300 pt-3">
                                      <span className="font-bold uppercase text-gray-600 mb-2 block">
                                        Message:
                                      </span>
                                      <div className="p-3 bg-white border border-gray-300 break-all whitespace-pre-wrap">
                                        {log.message}
                                      </div>
                                    </div>

                                    {/* Additional context if available */}
                                    {(log as any).context && (
                                      <div className="border-t-2 border-gray-300 pt-3">
                                        <span className="font-bold uppercase text-gray-600 mb-2 block">
                                          Context:
                                        </span>
                                        <div className="p-3 bg-white border border-gray-300">
                                          <pre className="text-xs overflow-auto">
                                            {JSON.stringify(
                                              (log as any).context,
                                              null,
                                              2
                                            )}
                                          </pre>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ) : (
                    <Alert className="text-center">
                      <Terminal className="h-4 w-4" />
                      <AlertDescription>
                        No logs available for this run.
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
            {execution?.assigned_machine_id && (
              <TabsContent value="agent-screen" className="h-full">
                {isTabLoading || !execution ? (
                  <LoadingSkeleton />
                ) : (
                  <AgentScreenTab executionId={execution.execution_id} machineId={execution.assigned_machine_id} isLive={execution.status === "running" || execution.status === "queued"} />
                )}
              </TabsContent>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
