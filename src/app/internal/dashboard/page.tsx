'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  RefreshCw, 
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  Pause,
  Play,
  RotateCcw,
  Bell,
  ShieldAlert,
  Database,
  Eye,
  AlertCircle,
  FileText,
  MousePointer,
  Keyboard,
  Code,
  Search,
  Download
} from 'lucide-react';

// Risk levels for different tool types
const TOOL_RISK_LEVELS: Record<string, { level: 'high' | 'medium' | 'low'; label: string; icon: any }> = {
  'click_element': { level: 'high', label: 'Write Operation', icon: MousePointer },
  'type_into_element': { level: 'high', label: 'Data Entry', icon: Keyboard },
  'execute_javascript': { level: 'high', label: 'Code Execution', icon: Code },
  'submit_form': { level: 'high', label: 'Form Submission', icon: FileText },
  'navigate_browser': { level: 'low', label: 'Navigation', icon: Search },
  'read_element': { level: 'low', label: 'Read Operation', icon: Eye },
  'wait_for_output_parser': { level: 'medium', label: 'Data Extraction', icon: Download },
  'take_screenshot': { level: 'low', label: 'Screenshot', icon: Eye },
};

interface WorkflowExecution {
  id: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'rolled_back';
  startedAt: string;
  completedAt?: string;
  currentStep?: number;
  totalSteps: number;
  steps: WorkflowStep[];
  error?: string;
  canRollback: boolean;
  rollbackPoint?: number;
  metadata?: {
    source?: string;
    trigger?: string;
    dataProcessed?: number;
    criticalData?: boolean;
  };
}

interface WorkflowStep {
  id: string;
  name: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  riskLevel: 'high' | 'medium' | 'low';
  data?: any;
  error?: string;
  retryCount?: number;
  canRevert?: boolean;
  affectedData?: {
    entity?: string;
    count?: number;
    fields?: string[];
  };
}

interface TelemetryTrace {
  traceId: string;
  workflowId: string;
  spans: TelemetrySpan[];
  rootSpan: TelemetrySpan;
  spanCount: number;
  startTime: string;
  endTime?: string;
  duration?: number;
  status: 'ok' | 'error' | 'running';
  machineId: string;
  attributes?: Record<string, any>;
}

interface TelemetrySpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  status: { code: number; message?: string };
  attributes?: Record<string, any>;
  events?: Array<{
    time: string;
    name: string;
    attributes?: Record<string, any>;
  }>;
}

interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    type: 'error' | 'risk_threshold' | 'data_anomaly' | 'performance';
    threshold?: number;
    pattern?: string;
  };
  actions: ('email' | 'slack' | 'webhook' | 'pause_workflow')[];
}

export default function InternalDashboard() {
  const [activeWorkflows, setActiveWorkflows] = useState<WorkflowExecution[]>([]);
  const [completedWorkflows, setCompletedWorkflows] = useState<WorkflowExecution[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowExecution | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);
  const [riskAlerts, setRiskAlerts] = useState<any[]>([]);
  const [systemMetrics, setSystemMetrics] = useState({
    totalExecutions: 0,
    successRate: 0,
    avgDuration: 0,
    activeAgents: 0,
    dataProcessed: 0,
    criticalFailures: 0,
  });

  // Fetch workflow executions from telemetry
  const fetchWorkflowExecutions = async () => {
    try {
      const response = await fetch('/api/internal/telemetry/traces');
      const data = await response.json();
      
      if (data.success && data.traces) {
        // Transform traces into workflow executions
        const workflows = data.traces.map((trace: TelemetryTrace) => 
          transformTraceToWorkflow(trace)
        );
        
        // Separate active and completed workflows
        const active = workflows.filter((w: WorkflowExecution) => 
          w.status === 'running' || w.status === 'paused'
        );
        const completed = workflows.filter((w: WorkflowExecution) => 
          w.status !== 'running' && w.status !== 'paused'
        );
        
        setActiveWorkflows(active);
        setCompletedWorkflows(completed);
        
        // Calculate system metrics
        updateSystemMetrics(workflows);
        
        // Check for risk alerts
        checkRiskAlerts(workflows);
      }
    } catch (error) {
      console.error('Failed to fetch workflow executions:', error);
    }
  };

  // Transform telemetry trace to workflow execution
  const transformTraceToWorkflow = (trace: TelemetryTrace): WorkflowExecution => {
    const steps = (trace.spans || [])
      .filter(span => span.attributes?.['tool.name'])
      .map(span => ({
        id: span.spanId,
        name: span.name,
        toolName: span.attributes?.['tool.name'] || 'unknown',
        status: span.status?.code === 0 ? 'completed' : 
                span.status?.code === 2 ? 'failed' : 
                span.endTime ? 'completed' : 'running',
        startedAt: span.startTime,
        completedAt: span.endTime,
        duration: span.duration,
        riskLevel: TOOL_RISK_LEVELS[span.attributes?.['tool.name']]?.level || 'medium',
        data: span.attributes,
        error: span.status?.message,
        canRevert: TOOL_RISK_LEVELS[span.attributes?.['tool.name']]?.level === 'high',
      })) as WorkflowStep[];

    const isRunning = !trace.endTime;
    const hasFailed = trace.status === 'error';
    
    return {
      id: trace.traceId,
      workflowName: trace.rootSpan?.name || 'Unknown Workflow',
      status: isRunning ? 'running' : hasFailed ? 'failed' : 'completed',
      startedAt: trace.startTime,
      completedAt: trace.endTime,
      currentStep: steps.filter(s => s.status === 'completed').length,
      totalSteps: steps.length,
      steps,
      error: hasFailed ? trace.rootSpan?.status?.message : undefined,
      canRollback: hasFailed && steps.some(s => s.canRevert),
      rollbackPoint: steps.findIndex(s => s.status === 'failed'),
      metadata: {
        source: trace.attributes?.['workflow.source'],
        trigger: trace.attributes?.['workflow.trigger'],
        dataProcessed: trace.attributes?.['workflow.data_count'],
        criticalData: trace.attributes?.['workflow.critical'],
      },
    };
  };

  // Update system metrics
  const updateSystemMetrics = (workflows: WorkflowExecution[]) => {
    const total = workflows.length;
    const successful = workflows.filter(w => w.status === 'completed').length;
    const durations = workflows
      .filter(w => w.completedAt)
      .map(w => new Date(w.completedAt!).getTime() - new Date(w.startedAt).getTime());
    
    setSystemMetrics({
      totalExecutions: total,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgDuration: durations.length > 0 ? 
        durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      activeAgents: activeWorkflows.length,
      dataProcessed: workflows.reduce((sum, w) => 
        sum + (w.metadata?.dataProcessed || 0), 0),
      criticalFailures: workflows.filter(w => 
        w.status === 'failed' && w.metadata?.criticalData).length,
    });
  };

  // Check for risk alerts
  const checkRiskAlerts = (workflows: WorkflowExecution[]) => {
    const alerts: any[] = [];
    
    workflows.forEach(workflow => {
      // Check for high-risk operations on critical data
      if (workflow.metadata?.criticalData) {
        const highRiskSteps = workflow.steps.filter(s => s.riskLevel === 'high');
        if (highRiskSteps.length > 0) {
          alerts.push({
            id: `${workflow.id}-critical`,
            type: 'critical',
            message: `High-risk operations on critical data in ${workflow.workflowName}`,
            workflow: workflow.id,
            timestamp: new Date().toISOString(),
          });
        }
      }
      
      // Check for failed steps that need attention
      const failedSteps = workflow.steps.filter(s => s.status === 'failed');
      if (failedSteps.length > 0) {
        alerts.push({
          id: `${workflow.id}-failed`,
          type: 'error',
          message: `${failedSteps.length} failed steps in ${workflow.workflowName}`,
          workflow: workflow.id,
          timestamp: new Date().toISOString(),
        });
      }
    });
    
    setRiskAlerts(alerts);
  };

  // Handle workflow pause
  const handlePauseWorkflow = async (workflowId: string) => {
    // In production, this would call an API to pause the workflow
    console.log('Pausing workflow:', workflowId);
    setActiveWorkflows(prev => 
      prev.map(w => w.id === workflowId ? { ...w, status: 'paused' } : w)
    );
    
    addNotification({
      type: 'info',
      message: `Workflow ${workflowId} has been paused`,
      timestamp: new Date().toISOString(),
    });
  };

  // Handle workflow resume
  const handleResumeWorkflow = async (workflowId: string) => {
    // In production, this would call an API to resume the workflow
    console.log('Resuming workflow:', workflowId);
    setActiveWorkflows(prev => 
      prev.map(w => w.id === workflowId ? { ...w, status: 'running' } : w)
    );
    
    addNotification({
      type: 'info',
      message: `Workflow ${workflowId} has been resumed`,
      timestamp: new Date().toISOString(),
    });
  };

  // Handle rollback
  const handleRollback = async (workflow: WorkflowExecution) => {
    if (!confirm(`Rollback workflow "${workflow.workflowName}" to last safe state?`)) {
      return;
    }

    // Find the last successful step before failure
    const rollbackToStep = workflow.rollbackPoint !== undefined ? 
      workflow.rollbackPoint - 1 : 
      workflow.steps.findLastIndex(s => s.status === 'completed' && s.riskLevel === 'low');
    
    if (rollbackToStep < 0) {
      alert('No safe rollback point found');
      return;
    }

    // In production, this would trigger actual rollback
    console.log('Rolling back to step:', rollbackToStep);
    
    // Mark steps as reverted
    const updatedWorkflow = {
      ...workflow,
      status: 'rolled_back' as const,
      steps: workflow.steps.map((step, index) => ({
        ...step,
        status: index > rollbackToStep ? 'skipped' as const : step.status,
      })),
    };
    
    setCompletedWorkflows(prev => 
      prev.map(w => w.id === workflow.id ? updatedWorkflow : w)
    );
    
    addNotification({
      type: 'warning',
      message: `Workflow ${workflow.workflowName} rolled back to step ${rollbackToStep + 1}`,
      timestamp: new Date().toISOString(),
    });
  };

  // Add notification
  const addNotification = (notification: any) => {
    setNotifications(prev => [notification, ...prev].slice(0, 50));
  };

  // Auto-refresh
  useEffect(() => {
    fetchWorkflowExecutions();
    
    if (autoRefresh) {
      const interval = setInterval(fetchWorkflowExecutions, 5000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  // Initialize notification rules
  useEffect(() => {
    setNotificationRules([
      {
        id: '1',
        name: 'Critical Data Failure',
        enabled: true,
        conditions: { type: 'error', pattern: 'critical' },
        actions: ['email', 'slack', 'pause_workflow'],
      },
      {
        id: '2',
        name: 'High Risk Threshold',
        enabled: true,
        conditions: { type: 'risk_threshold', threshold: 5 },
        actions: ['slack'],
      },
      {
        id: '3',
        name: 'Performance Degradation',
        enabled: false,
        conditions: { type: 'performance', threshold: 10000 },
        actions: ['email'],
      },
    ]);
  }, []);

  const getRiskBadge = (level: 'high' | 'medium' | 'low') => {
    const colors = {
      high: 'destructive',
      medium: 'warning',
      low: 'secondary',
    };
    return <Badge variant={colors[level] as any}>{level.toUpperCase()} RISK</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running': return <Activity className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'paused': return <Pause className="w-4 h-4 text-yellow-500" />;
      case 'rolled_back': return <RotateCcw className="w-4 h-4 text-orange-500" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-3xl font-bold">Agent Observability Dashboard</h1>
            <p className="text-gray-500 mt-1">
              Real-time monitoring, risk assessment, and rollback controls for MCP workflows
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={autoRefresh ? "default" : "outline"}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
              Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
            </Button>
            <Button onClick={fetchWorkflowExecutions} variant="outline">
              Refresh Now
            </Button>
          </div>
        </div>

        {/* Critical Alerts */}
        {riskAlerts.filter(a => a.type === 'critical').length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Critical Risk Alert</AlertTitle>
            <AlertDescription>
              {riskAlerts.filter(a => a.type === 'critical').length} high-risk operations detected on critical data.
              Immediate attention required.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* System Metrics */}
      <div className="grid grid-cols-6 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeWorkflows.length}</div>
            <p className="text-xs text-gray-500">Currently executing</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {systemMetrics.successRate.toFixed(1)}%
            </div>
            <Progress value={systemMetrics.successRate} className="mt-1 h-1" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(systemMetrics.avgDuration / 1000).toFixed(1)}s
            </div>
            <p className="text-xs text-gray-500">Per workflow</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Data Processed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemMetrics.dataProcessed}</div>
            <p className="text-xs text-gray-500">Total records</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Critical Failures</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {systemMetrics.criticalFailures}
            </div>
            <p className="text-xs text-gray-500">Require rollback</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Risk Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">
              {riskAlerts.length}
            </div>
            <p className="text-xs text-gray-500">Active alerts</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="workflows" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="workflows">Active Workflows</TabsTrigger>
          <TabsTrigger value="history">Execution History</TabsTrigger>
          <TabsTrigger value="risk">Risk Analysis</TabsTrigger>
          <TabsTrigger value="rollback">Rollback Console</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry Data</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        {/* Active Workflows Tab */}
        <TabsContent value="workflows">
          <Card>
            <CardHeader>
              <CardTitle>Active Workflow Executions</CardTitle>
            </CardHeader>
            <CardContent>
              {activeWorkflows.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No active workflows at the moment
                </div>
              ) : (
                <div className="space-y-4">
                  {activeWorkflows.map(workflow => (
                    <div key={workflow.id} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="font-semibold flex items-center gap-2">
                            {getStatusIcon(workflow.status)}
                            {workflow.workflowName}
                          </h3>
                          <p className="text-sm text-gray-500">
                            Started: {new Date(workflow.startedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {workflow.status === 'running' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePauseWorkflow(workflow.id)}
                            >
                              <Pause className="w-4 h-4 mr-1" />
                              Pause
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResumeWorkflow(workflow.id)}
                            >
                              <Play className="w-4 h-4 mr-1" />
                              Resume
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedWorkflow(workflow)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Details
                          </Button>
                        </div>
                      </div>
                      
                      {/* Step Progress */}
                      <div className="mb-3">
                        <div className="flex justify-between text-sm mb-1">
                          <span>Progress: Step {workflow.currentStep} of {workflow.totalSteps}</span>
                          <span>{Math.round((workflow.currentStep! / workflow.totalSteps) * 100)}%</span>
                        </div>
                        <Progress 
                          value={(workflow.currentStep! / workflow.totalSteps) * 100} 
                          className="h-2"
                        />
                      </div>
                      
                      {/* Current Step Details */}
                      {workflow.currentStep !== undefined && workflow.steps[workflow.currentStep - 1] && (
                        <div className="bg-gray-50 rounded p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              Current: {workflow.steps[workflow.currentStep - 1].name}
                            </span>
                            {getRiskBadge(workflow.steps[workflow.currentStep - 1].riskLevel)}
                          </div>
                          {workflow.steps[workflow.currentStep - 1].affectedData && (
                            <div className="text-xs text-gray-600">
                              Affecting: {workflow.steps[workflow.currentStep - 1].affectedData?.entity} 
                              ({workflow.steps[workflow.currentStep - 1].affectedData?.count} records)
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Execution History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Execution History</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="space-y-3">
                  {completedWorkflows.map(workflow => (
                    <div key={workflow.id} className="border rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold flex items-center gap-2">
                            {getStatusIcon(workflow.status)}
                            {workflow.workflowName}
                          </h3>
                          <div className="text-sm text-gray-500 space-y-1 mt-1">
                            <div>Started: {new Date(workflow.startedAt).toLocaleString()}</div>
                            {workflow.completedAt && (
                              <div>Completed: {new Date(workflow.completedAt).toLocaleString()}</div>
                            )}
                            {workflow.error && (
                              <div className="text-red-600">Error: {workflow.error}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedWorkflow(workflow)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                          {workflow.canRollback && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRollback(workflow)}
                            >
                              <RotateCcw className="w-4 h-4 mr-1" />
                              Rollback
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Risk Analysis Tab */}
        <TabsContent value="risk">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Risk Distribution by Tool Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(TOOL_RISK_LEVELS).map(([tool, info]) => {
                    const Icon = info.icon;
                    return (
                      <div key={tool} className="flex items-center justify-between p-3 border rounded">
                        <div className="flex items-center gap-3">
                          <Icon className="w-5 h-5 text-gray-600" />
                          <div>
                            <div className="font-medium">{tool}</div>
                            <div className="text-xs text-gray-500">{info.label}</div>
                          </div>
                        </div>
                        {getRiskBadge(info.level)}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active Risk Alerts</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {riskAlerts.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No active risk alerts
                      </div>
                    ) : (
                      riskAlerts.map(alert => (
                        <Alert key={alert.id} variant={alert.type === 'critical' ? 'destructive' : 'default'}>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>{alert.type.toUpperCase()}</AlertTitle>
                          <AlertDescription>
                            {alert.message}
                            <div className="text-xs text-gray-500 mt-1">
                              {new Date(alert.timestamp).toLocaleString()}
                            </div>
                          </AlertDescription>
                        </Alert>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Rollback Console Tab */}
        <TabsContent value="rollback">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-orange-500" />
                Rollback Management Console
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {completedWorkflows.filter(w => w.canRollback).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No workflows require rollback at this time
                  </div>
                ) : (
                  completedWorkflows
                    .filter(w => w.canRollback)
                    .map(workflow => (
                      <div key={workflow.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="font-semibold text-lg">{workflow.workflowName}</h3>
                            <p className="text-sm text-gray-500">
                              Failed at: {workflow.completedAt ? 
                                new Date(workflow.completedAt).toLocaleString() : 'Unknown'}
                            </p>
                            {workflow.error && (
                              <Alert variant="destructive" className="mt-2">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>{workflow.error}</AlertDescription>
                              </Alert>
                            )}
                          </div>
                          <Badge variant="destructive">FAILED</Badge>
                        </div>
                        
                        {/* Step Timeline */}
                        <div className="space-y-2 mb-4">
                          <h4 className="font-medium text-sm">Execution Timeline:</h4>
                          <div className="pl-4 space-y-1">
                            {workflow.steps.map((step, index) => (
                              <div key={step.id} className="flex items-center gap-2 text-sm">
                                {getStatusIcon(step.status)}
                                <span className={step.status === 'failed' ? 'text-red-600 font-medium' : ''}>
                                  Step {index + 1}: {step.name}
                                </span>
                                {step.canRevert && (
                                  <Badge variant="outline" className="text-xs">Revertible</Badge>
                                )}
                                {index === workflow.rollbackPoint && (
                                  <Badge variant="destructive" className="text-xs">Failed Here</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        
                        {/* Rollback Options */}
                        <div className="bg-orange-50 p-3 rounded mb-3">
                          <h4 className="font-medium text-sm mb-2">Rollback Options:</h4>
                          <ul className="text-sm space-y-1 text-gray-700">
                            <li>• Rollback to step {(workflow.rollbackPoint || 0)} (last successful state)</li>
                            <li>• Revert all high-risk operations performed</li>
                            <li>• Restore data to pre-execution state</li>
                          </ul>
                        </div>
                        
                        <Button
                          variant="destructive"
                          className="w-full"
                          onClick={() => handleRollback(workflow)}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Execute Rollback to Safe State
                        </Button>
                      </div>
                    ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Telemetry Data Tab */}
        <TabsContent value="telemetry">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-500" />
                Raw Telemetry Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="space-y-4">
                  {activeWorkflows.concat(completedWorkflows).slice(0, 10).map(workflow => (
                    <div key={workflow.id} className="border rounded-lg p-4 font-mono text-xs">
                      <div className="mb-2">
                        <span className="font-bold">Trace ID:</span> {workflow.id}
                      </div>
                      <div className="mb-2">
                        <span className="font-bold">Workflow:</span> {workflow.workflowName}
                      </div>
                      <div className="mb-2">
                        <span className="font-bold">Status:</span> {workflow.status}
                      </div>
                      <div className="mb-2">
                        <span className="font-bold">Steps:</span>
                        <pre className="mt-1 p-2 bg-gray-100 rounded overflow-x-auto">
                          {JSON.stringify(workflow.steps.map(s => ({
                            name: s.name,
                            tool: s.toolName,
                            status: s.status,
                            risk: s.riskLevel,
                            duration: s.duration,
                          })), null, 2)}
                        </pre>
                      </div>
                      {workflow.metadata && (
                        <div>
                          <span className="font-bold">Metadata:</span>
                          <pre className="mt-1 p-2 bg-gray-100 rounded overflow-x-auto">
                            {JSON.stringify(workflow.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Notification Rules
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {notificationRules.map(rule => (
                    <div key={rule.id} className="border rounded-lg p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-medium">{rule.name}</h4>
                          <p className="text-xs text-gray-500">
                            Condition: {rule.conditions.type}
                            {rule.conditions.threshold && ` > ${rule.conditions.threshold}`}
                          </p>
                        </div>
                        <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                          {rule.enabled ? 'ENABLED' : 'DISABLED'}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        {rule.actions.map(action => (
                          <Badge key={action} variant="outline" className="text-xs">
                            {action}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Notifications</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {notifications.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map((notif, index) => (
                        <div key={index} className="border-l-4 border-blue-500 pl-3 py-2">
                          <div className="text-sm font-medium">{notif.message}</div>
                          <div className="text-xs text-gray-500">
                            {new Date(notif.timestamp).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Workflow Details Modal */}
      {selectedWorkflow && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-[800px] max-h-[80vh] overflow-auto">
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle>Workflow Details: {selectedWorkflow.workflowName}</CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedWorkflow(null)}
                >
                  ✕
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Status</label>
                    <div className="flex items-center gap-2 mt-1">
                      {getStatusIcon(selectedWorkflow.status)}
                      <span className="font-medium">{selectedWorkflow.status.toUpperCase()}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Duration</label>
                    <div className="mt-1">
                      {selectedWorkflow.completedAt ? 
                        `${((new Date(selectedWorkflow.completedAt).getTime() - 
                          new Date(selectedWorkflow.startedAt).getTime()) / 1000).toFixed(1)}s` :
                        'In progress'}
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-medium mb-2">Execution Steps</h3>
                  <div className="space-y-2">
                    {selectedWorkflow.steps.map((step, index) => (
                      <div key={step.id} className="border rounded p-3">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(step.status)}
                            <span className="font-medium">
                              Step {index + 1}: {step.name}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {getRiskBadge(step.riskLevel)}
                            {step.canRevert && (
                              <Badge variant="outline">Revertible</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          Tool: {step.toolName}
                          {step.duration && ` • Duration: ${step.duration}ms`}
                        </div>
                        {step.error && (
                          <Alert variant="destructive" className="mt-2">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{step.error}</AlertDescription>
                          </Alert>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}