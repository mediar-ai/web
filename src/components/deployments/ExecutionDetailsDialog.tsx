'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { XCircle, Terminal, FileText } from 'lucide-react';
import { CopyToClipboardButton } from '@/components/common/CopyToClipboardButton';
import { Execution } from '@/lib/workflow-types';
import { getStatusBadge, getStatusIcon, formatDuration } from './utils';

interface ExecutionDetailsDialogProps {
  execution: Execution | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExecutionDetailsDialog({ execution, open, onOpenChange }: ExecutionDetailsDialogProps) {
  if (!execution) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              Execution #{execution.execution_id}
              <Badge className={getStatusBadge(execution.status)}>
                {getStatusIcon(execution.status)}
                <span className="ml-1">{execution.status.toUpperCase()}</span>
              </Badge>
            </DialogTitle>
            <DialogDescription>{execution.workflow_name}</DialogDescription>
          </DialogHeader>
        </div>
        <Tabs defaultValue="summary" className="flex-1 flex flex-col min-h-0">
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="debug">Debug</TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <TabsContent value="summary">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-semibold mb-2">Execution Info</h4>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Workflow ID:</dt>
                        <dd className="font-mono">{execution.workflow_id}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Client ID:</dt>
                        <dd className="font-mono text-xs">{execution.client_id || '—'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Modal Call ID:</dt>
                        <dd className="font-mono text-xs truncate max-w-[400px]" title={execution.modal_call_id}>
                          {execution.modal_call_id}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2">Timing</h4>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Created:</dt>
                        <dd className="text-xs">{execution.created_at ? new Date(execution.created_at).toLocaleString() : '—'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Started:</dt>
                        <dd className="text-xs">
                          {execution.started_at ? new Date(execution.started_at).toLocaleString() : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Completed:</dt>
                        <dd className="text-xs">
                          {execution.completed_at ? new Date(execution.completed_at).toLocaleString() : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Duration:</dt>
                        <dd className="font-mono">{formatDuration(execution.execution_duration_seconds)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
                
                {execution.error_message && (
                  <Alert variant="default" className="border-black bg-gray-100">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{execution.error_message}</AlertDescription>
                  </Alert>
                )}
                
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">API Request Details</h4>
                    <CopyToClipboardButton
                      contentToCopy={`POST /api/remote-workflows/${execution.workflow_id}/execute\n\nRequest Body:\n${JSON.stringify(execution.execution_params || {}, null, 2)}`}
                    />
                  </div>
                  <div className="bg-gray-900 text-gray-100 p-3 rounded-lg font-mono text-sm overflow-x-auto">
                    <div className="text-green-400 mb-2">POST /api/remote-workflows/{execution.workflow_id}/execute</div>
                    <div className="text-gray-400 text-xs">Content-Type: application/json</div>
                  </div>
                </div>
                
                {execution.execution_params && Object.keys(execution.execution_params).length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Request Body</h4>
                      <CopyToClipboardButton
                        contentToCopy={JSON.stringify(execution.execution_params, null, 2)}
                      />
                    </div>
                    <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto">
                      <code className="text-sm">
                        {JSON.stringify(execution.execution_params, null, 2)}
                      </code>
                    </pre>
                  </div>
                )}
                
                {execution.formatted_output && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Formatted Output</h4>
                      <CopyToClipboardButton
                        contentToCopy={execution.formatted_output || ''}
                      />
                    </div>
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                      <code className="text-sm">
                        {execution.formatted_output}
                      </code>
                    </pre>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="logs">
              <div className="space-y-4 h-full flex flex-col">
                {execution.execution_logs && execution.execution_logs.length > 0 ? (
                  <div className="space-y-2 flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Execution Logs</h4>
                      <CopyToClipboardButton
                        contentToCopy={execution.execution_logs?.map(log => 
                            `${log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''} [${log.level}] ${log.message}`
                          ).join('\n') || ''}
                      />
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto border rounded-md bg-white p-4">
                      {execution.execution_logs.map((log, idx) => (
                        <div key={idx} className="flex gap-2 text-xs font-mono">
                          <span className="text-muted-foreground">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}</span>
                          <Badge variant={log.level === 'error' ? 'outline' : 'secondary'} className={log.level === 'error' ? 'border-black text-black' : 'text-xs'}>
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
                      No structured execution logs available for this run.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>
            <TabsContent value="results">
              <div className="space-y-4">
                {execution.results ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Execution Results</h4>
                      <CopyToClipboardButton
                        contentToCopy={JSON.stringify(execution.results, null, 2)}
                      />
                    </div>
                    <pre className="p-3 text-xs overflow-auto border rounded-md">
                      <code>
                        {JSON.stringify(execution.results, null, 2)}
                      </code>
                    </pre>
                  </div>
                ) : (
                  <Alert className="text-center">
                    <FileText className="h-4 w-4" />
                    <AlertDescription>
                      No results available for this execution.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>
            <TabsContent value="debug">
              <div className="space-y-4">
                {execution.raw_data?.raw_logs && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Raw Logs</h4>
                      <CopyToClipboardButton
                        contentToCopy={execution.raw_data?.raw_logs || ''}
                      />
                    </div>
                    <pre className="p-4 text-xs border rounded-md bg-white overflow-auto max-h-[400px]">
                      <code>{execution.raw_data.raw_logs}</code>
                    </pre>
                  </div>
                )}
                {execution.raw_data?.raw_mcp_response && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Raw MCP Response</h4>
                      <CopyToClipboardButton
                        contentToCopy={JSON.stringify(execution.raw_data?.raw_mcp_response || {}, null, 2)}
                      />
                    </div>
                    <pre className="bg-gray-100 p-3 rounded-lg overflow-auto text-xs border max-h-[400px]">
                      <code>
                        {JSON.stringify(execution.raw_data.raw_mcp_response, null, 2)}
                      </code>
                    </pre>
                  </div>
                )}
                {!execution.raw_data?.raw_logs && !execution.raw_data?.raw_mcp_response && (
                  <Alert className="text-center">
                    <Terminal className="h-4 w-4" />
                    <AlertDescription>
                      No raw logs or debug information were captured for this run.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
} 