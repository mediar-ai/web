'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Terminal } from 'lucide-react';
import { CodeBlock, JsonBlock } from '@/components/ui/code-block';
import { WorkflowOverview } from '@/lib/workflow-types';
import { formatDuration } from './utils';

interface WorkflowDetailsDialogProps {
  workflow: WorkflowOverview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkflowDetailsDialog({ workflow, open, onOpenChange }: WorkflowDetailsDialogProps) {
  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto !mt-8 !mb-8 !top-8 !transform-none !translate-y-0">
        <DialogHeader>
          <DialogTitle className="text-2xl">{workflow.name}</DialogTitle>
          <DialogDescription>{workflow.description}</DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
            <TabsTrigger value="validation">Validation</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold mb-2">Metadata</h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Active Version:</dt>
                    <dd className="font-mono">{workflow.version}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Category:</dt>
                    <dd className="font-mono">{workflow.category}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Est. Duration:</dt>
                    <dd className="font-mono">{formatDuration(workflow.estimated_duration_seconds)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Timeout:</dt>
                    <dd className="font-mono">{workflow.timeout_minutes ? `${workflow.timeout_minutes} minutes` : '25 minutes'}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Performance</h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Total Runs:</dt>
                    <dd className="font-mono">{workflow.current_version_stats?.total_executions || workflow.total_executions || 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Success Rate:</dt>
                    <dd className="font-mono">
                      {(workflow.current_version_stats?.success_rate !== undefined && workflow.current_version_stats?.success_rate !== null)
                        ? `${Math.round(workflow.current_version_stats.success_rate)}%`
                        : (workflow.success_rate !== null ? `${Math.round(workflow.success_rate)}%` : '—')}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Successful:</dt>
                    <dd className="font-mono">{workflow.current_version_stats?.successful_runs || workflow.successful_runs || 0}</dd>
                  </div>
                </dl>
              </div>
            </div>
            
          </TabsContent>
          
          <TabsContent value="parameters" className="space-y-4">
            <div>
              <h4 className="font-semibold mb-3">Input Parameters</h4>
              {Object.keys(workflow.input_parameters).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(workflow.input_parameters).map(([key, param]) => (
                    <div key={key} className="border border-black rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <code className="text-sm font-mono">{key}</code>
                        <Badge variant="secondary" className="text-xs">
                          {param.type || 'string'}
                        </Badge>
                      </div>
                      {param.description && (
                        <p className="text-sm text-muted-foreground">{param.description}</p>
                      )}
                      {param.required && (
                        <Badge variant="destructive" className="text-xs mt-1">Required</Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No input parameters required</p>
              )}
            </div>
            
            <Separator />
            
            <div>
              <JsonBlock
                data={workflow.sample_inputs}
                title="Sample Input"
                theme="light"
                size="sm"
              />
            </div>
            
            <div>
              <JsonBlock
                data={workflow.expected_outputs}
                title="Expected Outputs"
                theme="light"
                size="sm"
              />
            </div>
          </TabsContent>
          
          <TabsContent value="usage" className="space-y-4">
            <Alert>
              <Terminal className="h-4 w-4" />
              <AlertDescription>
                Execute this workflow by making a POST request to the execution endpoint
              </AlertDescription>
            </Alert>
            
            <div>
              <CodeBlock
                language="curl"
                title="cURL Example"
                size="sm"
              >
{`curl -X POST \\
https://app.mediar.ai/api/remote-workflows/${workflow.id}/execute \\
-H "Content-Type: application/json" \\
-d '${JSON.stringify(workflow.sample_inputs || {}, null, 2)}'`}
              </CodeBlock>
            </div>
            
            <div>
              <CodeBlock
                language="javascript"
                title="JavaScript Example"
                size="sm"
              >
{`fetch('/api/remote-workflows/${workflow.id}/execute', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(${JSON.stringify(workflow.sample_inputs || {}, null, 2)})
}).then(response => response.json())`}
              </CodeBlock>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
} 