'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CheckCircle, XCircle, RefreshCw, Activity, Server, Clock, AlertTriangle, Zap } from 'lucide-react';

interface VMStatus {
  id: string;
  name: string;
  endpoint: string;
  status: 'online' | 'offline' | 'busy';
  lastSeen: string;
  activeWorkflows: number;
  health?: {
    cpu?: number;
    memory?: number;
    uptime?: number;
  };
  lastError?: string;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  workflowId?: string;
  step?: number;
  details?: any;
}

interface ExecutionHistory {
  id: string;
  workflowName: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  canRollback: boolean;
  rollbackInfo?: {
    lastSuccessfulStep?: string;
    failedStep?: string;
    stateBeforeFailure?: any;
  };
}

interface OTLPTrace {
  traceId: string;
  spans: any[];
  rootSpan: any;
  spanCount: number;
  startTime: string;
  duration: number;
}

export default function InternalDashboard() {
  const [clusterData, setClusterData] = useState<any>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedVM, setSelectedVM] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [otlpTraces, setOtlpTraces] = useState<OTLPTrace[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Fetch cluster status
  const fetchClusterStatus = async () => {
    try {
      const response = await fetch('/api/internal/cluster-status');
      const data = await response.json();
      setClusterData(data);
    } catch (error) {
      console.error('Failed to fetch cluster status:', error);
    }
  };

  // Fetch OTLP traces
  const fetchOTLPTraces = async () => {
    try {
      const response = await fetch('/api/internal/otlp/v1/traces?limit=20');
      const data = await response.json();
      setOtlpTraces(data.traces || []);
    } catch (error) {
      console.error('Failed to fetch OTLP traces:', error);
    }
  };

  // Start log streaming
  const startLogStream = async (vmId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setIsStreaming(true);
    setSelectedVM(vmId);
    
    const response = await fetch('/api/internal/cluster-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vmId }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const logData = JSON.parse(line.slice(6));
          setLogs(prev => [...prev.slice(-100), logData]); // Keep last 100 logs
        }
      }
    }
  };

  const stopLogStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  };

  // Handle rollback
  const handleRollback = async (execution: ExecutionHistory) => {
    if (!confirm(`Rollback workflow "${execution.workflowName}" to last successful state?`)) {
      return;
    }

    const rollbackLog: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: `🔄 ROLLBACK INITIATED: ${execution.workflowName}`,
      details: {
        executionId: execution.id,
        lastSuccessfulStep: execution.rollbackInfo?.lastSuccessfulStep,
        failedStep: execution.rollbackInfo?.failedStep,
        action: 'manual_rollback',
        operator: 'SAP', // Stand-in for human operator
      },
    };
    
    setLogs(prev => [...prev, rollbackLog]);
    
    // In production, this would trigger actual rollback
    console.log('Rollback details:', execution.rollbackInfo);
    
    // Add success log
    setTimeout(() => {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `✅ ROLLBACK COMPLETED: Restored to step ${execution.rollbackInfo?.lastSuccessfulStep}`,
      }]);
    }, 2000);
  };

  // Auto-refresh
  useEffect(() => {
    fetchClusterStatus();
    fetchOTLPTraces();
    
    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchClusterStatus();
        fetchOTLPTraces();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (!clusterData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'offline': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'busy': return <Activity className="w-4 h-4 text-yellow-500" />;
      default: return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: any = {
      'online': 'success',
      'offline': 'destructive',
      'busy': 'warning',
      'completed': 'success',
      'failed': 'destructive',
      'running': 'default',
    };
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">MCP Cluster Internal Dashboard</h1>
          <p className="text-gray-500">Real-time monitoring and rollback controls</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
          </Button>
          <Button onClick={fetchClusterStatus} variant="outline">
            Refresh Now
          </Button>
        </div>
      </div>

      {/* Cluster Overview */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cluster Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clusterData.cluster.health.toFixed(0)}%</div>
            <p className="text-xs text-gray-500">
              {clusterData.cluster.onlineVMs}/{clusterData.cluster.totalVMs} VMs online
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clusterData.cluster.activeWorkflows}</div>
            <p className="text-xs text-gray-500">Currently executing</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Failed Executions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {clusterData.recentExecutions.filter((e: any) => e.status === 'failed').length}
            </div>
            <p className="text-xs text-gray-500">Last 10 workflows</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Rollback Available</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">
              {clusterData.recentExecutions.filter((e: any) => e.canRollback).length}
            </div>
            <p className="text-xs text-gray-500">Ready for manual recovery</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="vms" className="space-y-4">
        <TabsList>
          <TabsTrigger value="vms">VM Status</TabsTrigger>
          <TabsTrigger value="logs">Live Logs</TabsTrigger>
          <TabsTrigger value="traces">OpenTelemetry Traces</TabsTrigger>
          <TabsTrigger value="rollback">Rollback Console</TabsTrigger>
        </TabsList>

        {/* VM Status Tab */}
        <TabsContent value="vms">
          <div className="grid grid-cols-2 gap-4">
            {clusterData.vms.map((vm: VMStatus) => (
              <Card key={vm.id}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Server className="w-4 h-4" />
                      {vm.name}
                    </CardTitle>
                    {getStatusBadge(vm.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Endpoint:</span>
                      <span className="font-mono text-xs">{vm.endpoint}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Active Workflows:</span>
                      <span>{vm.activeWorkflows}</span>
                    </div>
                    {vm.health && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">CPU:</span>
                          <span>{vm.health.cpu?.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Memory:</span>
                          <span>{(vm.health.memory! / 1024).toFixed(1)} GB</span>
                        </div>
                      </>
                    )}
                    {vm.lastError && (
                      <div className="mt-2 p-2 bg-red-50 rounded text-red-700 text-xs">
                        {vm.lastError}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => startLogStream(vm.id)}
                  >
                    Stream Logs
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Live Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Live Execution Logs</CardTitle>
                <div className="flex gap-2">
                  {selectedVM && (
                    <Badge variant="outline">
                      Streaming from: {clusterData.vms.find((v: any) => v.id === selectedVM)?.name}
                    </Badge>
                  )}
                  {isStreaming && (
                    <Button size="sm" variant="destructive" onClick={stopLogStream}>
                      Stop Stream
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] w-full rounded-md border p-4 font-mono text-sm">
                {logs.length === 0 ? (
                  <div className="text-center text-gray-500">
                    Select a VM to start streaming logs...
                  </div>
                ) : (
                  <div className="space-y-1">
                    {logs.map((log, index) => (
                      <div
                        key={index}
                        className={`flex gap-2 ${
                          log.level === 'error' ? 'text-red-600' :
                          log.level === 'warn' ? 'text-yellow-600' :
                          'text-gray-700'
                        }`}
                      >
                        <span className="text-gray-400 text-xs">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`font-bold uppercase text-xs ${
                          log.level === 'error' ? 'text-red-500' :
                          log.level === 'warn' ? 'text-yellow-500' :
                          'text-green-500'
                        }`}>
                          [{log.level}]
                        </span>
                        <span className="flex-1">{log.message}</span>
                        {log.details && (
                          <span className="text-xs text-gray-500">
                            {JSON.stringify(log.details)}
                          </span>
                        )}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OpenTelemetry Traces Tab */}
        <TabsContent value="traces">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-500" />
                OpenTelemetry Workflow Traces
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {otlpTraces.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No OpenTelemetry traces received yet.</p>
                    <p className="text-sm mt-2">Configure your Rust agents with:</p>
                    <code className="block mt-2 p-2 bg-gray-100 rounded text-xs">
                      OTEL_EXPORTER_OTLP_ENDPOINT=https://your-app.com/api/internal/otlp
                    </code>
                  </div>
                ) : (
                  otlpTraces.map((trace) => (
                    <div key={trace.traceId} className="border rounded-lg p-4 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold text-sm">
                            {trace.rootSpan?.name || 'Unknown Workflow'}
                          </h3>
                          <p className="text-xs text-gray-500 font-mono">
                            Trace ID: {trace.traceId.substring(0, 16)}...
                          </p>
                          <p className="text-sm text-gray-600">
                            {new Date(trace.startTime).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline">{trace.spanCount} spans</Badge>
                          <p className="text-sm mt-1">
                            {trace.duration ? `${trace.duration.toFixed(2)}ms` : 'In Progress'}
                          </p>
                        </div>
                      </div>
                      
                      {/* Span timeline */}
                      <div className="mt-3 space-y-1">
                        {trace.spans.slice(0, 5).map((span: any) => (
                          <div key={span.spanId} className="flex items-center gap-2 text-xs">
                            <div className={`w-2 h-2 rounded-full ${
                              span.status?.code === 2 ? 'bg-red-500' : 
                              span.status?.code === 1 ? 'bg-green-500' : 
                              'bg-gray-400'
                            }`} />
                            <span className="font-mono">{span.name}</span>
                            <span className="text-gray-500">
                              {span.duration ? `${span.duration.toFixed(0)}ms` : '...'}
                            </span>
                            {span.attributes?.['tool.name'] && (
                              <Badge variant="secondary" className="text-xs py-0">
                                {span.attributes['tool.name']}
                              </Badge>
                            )}
                          </div>
                        ))}
                        {trace.spans.length > 5 && (
                          <p className="text-xs text-gray-500 pl-4">
                            +{trace.spans.length - 5} more spans...
                          </p>
                        )}
                      </div>
                      
                      {/* Workflow attributes */}
                      {trace.rootSpan?.attributes && (
                        <div className="mt-2 pt-2 border-t">
                          <p className="text-xs font-medium mb-1">Attributes:</p>
                          <div className="grid grid-cols-2 gap-1 text-xs">
                            {Object.entries(trace.rootSpan.attributes)
                              .filter(([key]) => key.startsWith('workflow.'))
                              .slice(0, 4)
                              .map(([key, value]) => (
                                <div key={key} className="flex gap-1">
                                  <span className="text-gray-500">{key.replace('workflow.', '')}:</span>
                                  <span className="font-mono">{String(value)}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rollback Console Tab */}
        <TabsContent value="rollback">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                Manual Rollback Console (Human SAP)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {clusterData.recentExecutions
                  .filter((e: ExecutionHistory) => e.canRollback)
                  .map((execution: ExecutionHistory) => (
                    <div key={execution.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold">{execution.workflowName}</h3>
                          <p className="text-sm text-gray-500">
                            Failed at: {new Date(execution.startedAt).toLocaleString()}
                          </p>
                          {execution.error && (
                            <p className="text-sm text-red-600 mt-1">
                              Error: {execution.error}
                            </p>
                          )}
                        </div>
                        {getStatusBadge(execution.status)}
                      </div>
                      
                      {execution.rollbackInfo && (
                        <div className="bg-gray-50 p-3 rounded text-sm space-y-1">
                          <div>
                            <span className="font-medium">Last Successful Step:</span>{' '}
                            {execution.rollbackInfo.lastSuccessfulStep || 'N/A'}
                          </div>
                          <div>
                            <span className="font-medium">Failed Step:</span>{' '}
                            {execution.rollbackInfo.failedStep || 'N/A'}
                          </div>
                        </div>
                      )}
                      
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRollback(execution)}
                        className="w-full"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Initiate Manual Rollback
                      </Button>
                    </div>
                  ))}
                  
                {clusterData.recentExecutions.filter((e: ExecutionHistory) => e.canRollback).length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No failed workflows requiring rollback
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}