'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  RefreshCw,
  Code,
  Zap,
  AlertCircle,
  CheckCircle,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import WorkflowGraphViewer from '@/components/workflow-graph-viewer';
import { WorkflowMetadata } from '@/lib/typescript-workflow-parser';

interface TypeScriptWorkflowTabProps {
  workflowId: number;
  workflowFormat?: string;
}

export function TypeScriptWorkflowTab({
  workflowId,
  workflowFormat,
}: TypeScriptWorkflowTabProps) {
  const [metadata, setMetadata] = useState<WorkflowMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'cached' | 'parsed' | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetadata = useCallback(
    async (forceRefresh = false) => {
      try {
        setLoading(true);
        setError(null);

        const endpoint = forceRefresh
          ? `/api/remote-workflows/${workflowId}/typescript-metadata`
          : `/api/remote-workflows/${workflowId}/typescript-metadata`;

        const response = await fetch(endpoint, {
          method: forceRefresh ? 'POST' : 'GET',
        });

        const data = await response.json();

        if (data.success) {
          setMetadata(data.metadata);
          setSource(data.source);
        } else {
          setError(data.error || 'Failed to load TypeScript metadata');
        }
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [workflowId]
  );

  useEffect(() => {
    if (workflowFormat === 'typescript') {
      fetchMetadata();
    }
  }, [workflowId, workflowFormat, fetchMetadata]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMetadata(true);
  };

  // Show message if not a TypeScript workflow
  if (workflowFormat !== 'typescript') {
    return (
      <div className="p-6">
        <Alert className="border-2 border-black rounded-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This workflow is not in TypeScript format. TypeScript visualization
            is only available for workflows created with the{' '}
            <code className="font-mono text-sm">@mediar-ai/workflow</code> SDK.
            <div className="mt-2 text-sm text-muted-foreground">
              Current format:{' '}
              <Badge variant="outline">{workflowFormat || 'unknown'}</Badge>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Loading state
  if (loading && !metadata) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm text-muted-foreground">
            Parsing TypeScript workflow...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <Alert className="border-2 border-black rounded-lg">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold mb-1">
              Failed to load TypeScript workflow
            </div>
            <div className="text-sm">{error}</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchMetadata()}
              className="mt-3 border-2 border-black"
            >
              <RefreshCw className="w-3 h-3 mr-2" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!metadata) {
    return (
      <div className="p-6">
        <Alert className="border-2 border-black rounded-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No metadata available for this workflow.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code className="w-5 h-5" />
          <h3 className="font-mono font-bold text-lg uppercase">
            TypeScript Workflow
          </h3>
          {source && (
            <Badge
              variant={source === 'cached' ? 'secondary' : 'default'}
              className="font-mono"
            >
              {source === 'cached' ? 'Cached' : 'Live Parsed'}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="border-2 border-black"
        >
          {refreshing ? (
            <>
              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              Refreshing...
            </>
          ) : (
            <>
              <RefreshCw className="w-3 h-3 mr-2" />
              Refresh
            </>
          )}
        </Button>
      </div>

      {/* Workflow Info */}
      <Card className="border-2 border-black">
        <CardHeader className="bg-black text-white">
          <CardTitle className="font-mono text-sm uppercase flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Workflow Information
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground uppercase font-mono mb-1">
                Name
              </div>
              <div className="font-mono text-sm">{metadata.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase font-mono mb-1">
                Version
              </div>
              <div className="font-mono text-sm">v{metadata.version}</div>
            </div>
          </div>
          {metadata.description && (
            <div>
              <div className="text-xs text-muted-foreground uppercase font-mono mb-1">
                Description
              </div>
              <div className="text-sm">{metadata.description}</div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <div>
                <div className="text-xs text-muted-foreground font-mono">
                  Steps
                </div>
                <div className="font-bold font-mono">
                  {metadata.steps.length}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4" />
              <div>
                <div className="text-xs text-muted-foreground font-mono">
                  Inputs
                </div>
                <div className="font-bold font-mono">
                  {metadata.inputs.length}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              <div>
                <div className="text-xs text-muted-foreground font-mono">
                  Error Handler
                </div>
                <div className="font-bold font-mono">
                  {metadata.errorHandler ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Input Schema */}
      {metadata.inputs.length > 0 && (
        <Card className="border-2 border-black">
          <CardHeader className="bg-white border-b-2 border-black">
            <CardTitle className="font-mono text-sm uppercase">
              Input Schema
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              {metadata.inputs.map((input, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-2 border-2 border-black rounded"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-sm">
                        {input.name}
                      </span>
                      <Badge
                        variant={input.required ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {input.required ? 'Required' : 'Optional'}
                      </Badge>
                      <Badge variant="outline" className="text-xs font-mono">
                        {input.type}
                      </Badge>
                    </div>
                    {input.description && (
                      <p className="text-xs text-muted-foreground">
                        {input.description}
                      </p>
                    )}
                    {input.defaultValue !== undefined && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Default:{' '}
                        <code className="font-mono">
                          {JSON.stringify(input.defaultValue)}
                        </code>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Workflow Graph Visualization */}
      <Card className="border-2 border-black">
        <CardHeader className="bg-black text-white">
          <CardTitle className="font-mono text-sm uppercase flex items-center gap-2">
            <ArrowRight className="w-4 h-4" />
            Workflow Visualization
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <WorkflowGraphViewer metadata={metadata as any} />
        </CardContent>
      </Card>

      {/* Steps List */}
      <Card className="border-2 border-black">
        <CardHeader className="bg-white border-b-2 border-black">
          <CardTitle className="font-mono text-sm uppercase">
            Steps ({metadata.steps.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-2">
            {metadata.steps.map((step, index) => (
              <div
                key={step.id}
                className="flex items-start gap-3 p-3 border-2 border-black rounded hover:bg-gray-50 transition-colors"
              >
                <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-black text-white font-mono font-bold text-sm rounded">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-bold text-sm">
                      {step.name}
                    </span>
                    <Badge
                      variant={
                        step.type === 'condition'
                          ? 'default'
                          : step.type === 'error_handler'
                            ? 'destructive'
                            : 'secondary'
                      }
                      className="text-xs"
                    >
                      {step.type}
                    </Badge>
                  </div>
                  {step.description && (
                    <p className="text-xs text-muted-foreground mb-1">
                      {step.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                    <span>ID: {step.id}</span>
                    {step.next && step.next.length > 0 && (
                      <span className="flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" />
                        Next: {step.next.join(', ')}
                      </span>
                    )}
                    {step.onError && (
                      <span className="text-red-600">
                        Error → {step.onError}
                      </span>
                    )}
                  </div>
                  {step.condition && (
                    <div className="mt-2 p-2 bg-gray-100 rounded border border-gray-300">
                      <div className="text-xs font-mono text-gray-700 break-all">
                        {step.condition.length > 100
                          ? `${step.condition.substring(0, 100)}...`
                          : step.condition}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error Handler Info */}
      {metadata.errorHandler && (
        <Card className="border-2 border-black rounded-lg">
          <CardHeader className="border-b-2 border-black">
            <CardTitle className="font-mono text-sm uppercase flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Global Error Handler
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="font-mono">
                  {metadata.errorHandler.type}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Global error handling is configured for this workflow
                </span>
              </div>
              {metadata.errorHandler.code && (
                <div className="mt-3 p-3 bg-gray-100 rounded border border-gray-300 font-mono text-xs overflow-x-auto">
                  <pre>{metadata.errorHandler.code.substring(0, 300)}...</pre>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
