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
import { Loader2, Terminal, XCircle, Sparkles, Download, FolderOpen, FileText, ChevronDown, ChevronRight, Monitor } from 'lucide-react';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { toast } from 'sonner';
import { formatDuration, getStatusBadge, getStatusIcon } from './utils';
import { ExecutionAIChat } from './ExecutionAIChat';
import { Button } from '@/components/ui/button';
import Image from 'next/image';

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

interface AgentScreenTabProps {
  executionId: number;
}

const AgentScreenTab = ({ executionId }: AgentScreenTabProps) => {
  const [rdpUrl, setRdpUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<{
    machine_name?: string;
    connection_name?: string;
  } | null>(null);

  useEffect(() => {
    const fetchRdpUrl = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/rdp/access?execution_id=${executionId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to get RDP access');
        }

        setRdpUrl(data.connection_url);
        setConnectionInfo({
          machine_name: data.machine_name,
          connection_name: data.connection_name,
        });
      } catch (err) {
        console.error('Error fetching RDP URL:', err);
        setError(err instanceof Error ? err.message : 'Failed to load RDP connection');
      } finally {
        setLoading(false);
      }
    };

    fetchRdpUrl();
  }, [executionId]);

  if (loading) {
    return (
      <div className="h-full flex flex-col gap-4">
        <Alert className="border-black bg-blue-50">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>
            <p className="font-semibold">Loading agent screen access...</p>
            <p className="text-sm mt-1">Authenticating and establishing secure connection</p>
          </AlertDescription>
        </Alert>
        <div className="flex-1 border-2 border-black rounded-md overflow-hidden bg-white flex items-center justify-center" style={{ minHeight: '600px' }}>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    const isMachineNotFound = error.includes('Machine not found') || error.includes('no assigned machine');

    return (
      <div className="h-full flex flex-col gap-4">
        <Alert className="border-black bg-yellow-50">
          <XCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription>
            <p className="font-semibold text-yellow-900">
              {isMachineNotFound ? 'No Agent Machine Assigned' : 'Unable to connect to agent screen'}
            </p>
            <p className="text-sm mt-1 text-yellow-800">
              {isMachineNotFound
                ? 'This execution was run without a specific machine assignment. Agent screen viewing is only available for executions with assigned machines.'
                : error
              }
            </p>
          </AlertDescription>
        </Alert>
        <div className="flex-1 border-2 border-black rounded-md overflow-hidden bg-white flex items-center justify-center" style={{ minHeight: '600px' }}>
          <div className="text-center text-muted-foreground">
            <XCircle className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p className="text-sm">
              {isMachineNotFound
                ? 'This execution has no machine assignment'
                : 'RDP connection unavailable'
              }
            </p>
          </div>
        </div>
      </div>
    );
  }

  const openCrispChat = () => {
    // Trigger Crisp chat widget
    if (typeof window !== 'undefined' && (window as any).$crisp) {
      (window as any).$crisp.push(['do', 'chat:open']);
      (window as any).$crisp.push(['do', 'message:send', ['text', 'Hi! I\'m interested in learning more about the production plan for Agent Screen.']]);
    }
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Security Warning Banner */}
      <div className="bg-red-50 border-2 border-red-600 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="text-left flex-1">
            <h4 className="font-bold text-red-900 mb-1">Important Security Notice</h4>
            <p className="text-sm text-red-800 mb-2">
              Please do not expose sensitive data on this machine. These are shared development environments.
            </p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-red-800">
                Need a production plan with dedicated, isolated machines?
              </p>
              <button
                onClick={openCrispChat}
                className="px-3 py-1 bg-white text-black border-2 border-black hover:bg-black hover:text-white font-bold text-xs uppercase transition-all whitespace-nowrap"
              >
                Talk to Us
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded Guacamole Viewer */}
      <div className="flex-1 border-2 border-black rounded-md overflow-hidden bg-white" style={{ minHeight: '600px' }}>
        <iframe
          src={rdpUrl}
          className="w-full h-full"
          style={{ border: 'none' }}
          title={`Agent Screen - ${connectionInfo?.machine_name || 'Machine'}`}
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
};

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection = ({ title, children, defaultOpen = true }: CollapsibleSectionProps) => {
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
      {isOpen && (
        <div className="p-4 border-t-2 border-black">
          {children}
        </div>
      )}
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

  // Helper function to open file in Windows Explorer or with default app
  const openFileInExplorer = async (filePath: string, action: 'select' | 'open' = 'select') => {
    try {
      const response = await fetch('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, action }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const message = action === 'open' ? 'Opening file...' : 'Opening in Explorer...';
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
      const output = typeof execution.formatted_output === 'string'
        ? JSON.parse(execution.formatted_output)
        : execution.formatted_output;

      // Check if file_info exists at root or nested in data
      const fileInfo = output.file_info || output.data?.file_info;

      if (fileInfo && fileInfo.file_path && fileInfo.original_file) {
        const filePath = fileInfo.file_path;
        const fileName = fileInfo.original_file;

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-2 border-black bg-gray-50 p-3 rounded">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                <span className="text-sm font-mono font-semibold">{fileName}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="black-outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => openFileInExplorer(filePath, 'open')}
                >
                  <FileText className="w-3 h-3 mr-1" />
                  Open File
                </Button>
                <Button
                  variant="black-outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => openFileInExplorer(filePath, 'select')}
                >
                  <FolderOpen className="w-3 h-3 mr-1" />
                  Show in Folder
                </Button>
              </div>
            </div>
            <CodeBlock
              title="Formatted Output"
              language="json"
              size="sm"
            >
              {execution.formatted_output}
            </CodeBlock>
          </div>
        );
      }

      // No file path found, render normal CodeBlock
      return (
        <CodeBlock
          title="Formatted Output"
          language="json"
          size="sm"
        >
          {execution.formatted_output}
        </CodeBlock>
      );
    } catch (error) {
      // If parsing fails, render normal CodeBlock
      return (
        <CodeBlock
          title="Formatted Output"
          language="json"
          size="sm"
        >
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
        console.error('No execution data available for download', {
          execution_id: execution.execution_id,
          status: execution.status,
          has_results: !!execution.results,
          has_rawMcpResponse: !!rawMcpResponse,
          has_executionResults: !!executionResults
        });
        toast.error('No execution data available for download', {
          description: 'The execution may not have completed or results were not stored.'
        });
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

      toast.success('Download started', {
        description: `Downloading ${filename}`
      });
    } catch (error) {
      console.error('Error downloading execution logs:', error, {
        execution_id: execution?.execution_id,
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      toast.error('Failed to download execution logs', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
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
          has_executionResults: !!executionResults
        });
        toast.error('No results data available for download', {
          description: 'The execution may not have completed or results were not stored.'
        });
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

      toast.success('Download started', {
        description: `Downloading ${filename}`
      });
    } catch (error) {
      console.error('Error downloading results:', error, {
        execution_id: execution?.execution_id,
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      toast.error('Failed to download results', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
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
            <TabsList className={`grid w-full ${execution?.assigned_machine_id ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="logs">Orchestrator server logs</TabsTrigger>
              <TabsTrigger value="qa" className="flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Q&A
              </TabsTrigger>
              {execution?.assigned_machine_id && (
                <TabsTrigger value="agent-screen" className="flex items-center gap-1">
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
                  <CollapsibleSection title="Execution Info & Timing" defaultOpen={true}>
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
                  </CollapsibleSection>

                  {execution.error_message && (
                    <CollapsibleSection title="Error Message" defaultOpen={true}>
                      <Alert
                        variant="default"
                        className="border-black bg-gray-100"
                      >
                        <XCircle className="h-4 w-4" />
                        <AlertDescription className="break-words overflow-wrap-anywhere whitespace-pre-wrap">
                          {execution.error_message}
                        </AlertDescription>
                      </Alert>
                    </CollapsibleSection>
                  )}

                  {execution.error_analysis && (
                    <CollapsibleSection title="🤖 AI Error Analysis" defaultOpen={true}>
                      <div className="space-y-2">
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
                    </CollapsibleSection>
                  )}

                  {execution.screenshots && execution.screenshots.length > 0 && (
                    <CollapsibleSection title="📸 Monitor Screenshots" defaultOpen={true}>
                      <div className="grid grid-cols-2 gap-4">
                        {execution.screenshots.map((screenshot, idx) => {
                          const isUrl = screenshot.startsWith('http://') || screenshot.startsWith('https://');

                          // If URL contains supabase storage, route through API for org-level access control
                          let imageSrc = isUrl ? screenshot : `data:image/png;base64,${screenshot}`;
                          if (isUrl && screenshot.includes('supabase')) {
                            // Extract filename from Supabase URL path
                            // URL format: https://...supabase.../workflow-screenshots/{execution_id}/monitor_1.png
                            const filename = screenshot.split('/').pop() || `monitor_${idx + 1}.png`;
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
                    <CollapsibleSection title="Full Execution Data" defaultOpen={true}>
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
                    <CollapsibleSection title="Formatted Output" defaultOpen={true}>
                      {renderFormattedOutputWithFileLinks()}
                    </CollapsibleSection>
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
            {execution?.assigned_machine_id && (
              <TabsContent value="agent-screen" className="h-full">
                {isTabLoading || !execution ? (
                  <LoadingSkeleton />
                ) : (
                  <AgentScreenTab executionId={execution.execution_id} />
                )}
              </TabsContent>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
