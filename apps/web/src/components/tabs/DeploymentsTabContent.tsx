'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { UnifiedWorkflowDialog } from '@/components/deployments/UnifiedWorkflowDialog';
import { CreateWorkflowDialog } from '@/components/deployments/CreateWorkflowDialogImproved';

// Types for our workflow deployment system
interface WorkflowRun {
  id: string;
  status: 'success' | 'failure' | 'running' | 'queued';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  eventsProcessed: number;
  errorMessage?: string;
  metrics: {
    accuracy: number;
    confidence: number;
    tokensUsed: number;
  };
}

interface WorkflowDeployment {
  id: string;
  name: string;
  description: string;
  stage: 'idle' | 'human-in-loop' | 'autonomous';
  status: 'draft' | 'pending' | 'deployed' | 'paused' | 'failed' | 'inactive';
  version: string;
  lastDeployed: Date;
  nextRun?: Date;
  triggers: string[];
  steps: string[];
  inputs: string[];
  outputs: string[];
  businessLogic: string[];
  runs: WorkflowRun[];
  metrics: {
    totalRuns: number;
    successRate: number;
    avgDuration: number;
    totalEventsProcessed: number;
  };
  infrastructure: {
    modalAppId: string;
    instances: number;
    memory: string;
    cpu: string;
    region: string;
  };
}

// Hardcoded example workflows based on what we've observed
const mockWorkflows: WorkflowDeployment[] = [
  {
    id: 'wf-insurance-quote',
    name: 'Insurance Quote Processing',
    description: 'Automates insurance benefit amount updates and premium calculations across multiple insurance providers',
    stage: 'human-in-loop',
    status: 'deployed',
    version: 'v2.1.3',
    lastDeployed: new Date('2025-01-27T15:30:00Z'),
    nextRun: new Date(Date.now() + 3600000), // 1 hour from now
    triggers: ['Benefit Amount Field Change', 'Premium Calculation Request', 'Quote Form Submission'],
    steps: [
      'Detect benefit amount field interaction',
      'Extract new benefit value from UI',
      'Trigger premium recalculation',
      'Verify all plan premiums updated',
      'Generate quote summary'
    ],
    inputs: ['Benefit Amount', 'Plan Selection', 'Customer Demographics'],
    outputs: ['Updated Premium Costs', 'Quote Summary', 'Plan Comparisons'],
    businessLogic: [
      'Premium calculations must complete within 3 seconds',
      'All rider premiums update proportionally',
      'Validation against underwriting rules',
      'Compliance with state insurance regulations'
    ],
    runs: [
      {
        id: 'run-001',
        status: 'success',
        startTime: new Date('2025-01-27T14:20:00Z'),
        endTime: new Date('2025-01-27T14:20:15Z'),
        duration: 15000,
        eventsProcessed: 8,
        metrics: { accuracy: 0.98, confidence: 0.94, tokensUsed: 2340 }
      },
      {
        id: 'run-002',
        status: 'success',
        startTime: new Date('2025-01-27T13:45:00Z'),
        endTime: new Date('2025-01-27T13:45:12Z'),
        duration: 12000,
        eventsProcessed: 6,
        metrics: { accuracy: 0.96, confidence: 0.91, tokensUsed: 1890 }
      },
      {
        id: 'run-003',
        status: 'failure',
        startTime: new Date('2025-01-27T12:30:00Z'),
        endTime: new Date('2025-01-27T12:30:08Z'),
        duration: 8000,
        eventsProcessed: 3,
        errorMessage: 'Premium calculation API timeout - external service unavailable',
        metrics: { accuracy: 0.0, confidence: 0.0, tokensUsed: 890 }
      }
    ],
    metrics: {
      totalRuns: 127,
      successRate: 0.94,
      avgDuration: 13500,
      totalEventsProcessed: 856
    },
    infrastructure: {
      modalAppId: 'ap-ins-quote-proc-v2',
      instances: 3,
      memory: '2GB',
      cpu: '1 vCPU',
      region: 'us-west-1'
    }
  },
  {
    id: 'wf-agent-desktop',
    name: 'Agent Desktop Navigation',
    description: 'Manages agent workspace transitions and call handling workflows in contact center applications',
    stage: 'autonomous',
    status: 'deployed',
    version: 'v1.8.2',
    lastDeployed: new Date('2025-01-27T10:15:00Z'),
    nextRun: new Date(Date.now() + 1800000), // 30 minutes from now
    triggers: ['Tab Switch to Agent Desktop', 'Call Status Change', 'Error Notification'],
    steps: [
      'Monitor browser tab activity',
      'Detect Agent Desktop Plus activation',
      'Capture call status notifications',
      'Log disconnected caller events',
      'Update agent availability status'
    ],
    inputs: ['Browser Tab Events', 'Call Notifications', 'Agent Status'],
    outputs: ['Agent Activity Log', 'Call Metrics', 'Error Reports'],
    businessLogic: [
      'Immediate response to caller disconnections',
      'Maintain agent status accuracy',
      'Track call handling performance',
      'Escalate repeated connection issues'
    ],
    runs: [
      {
        id: 'run-004',
        status: 'success',
        startTime: new Date('2025-01-27T14:45:00Z'),
        endTime: new Date('2025-01-27T14:45:03Z'),
        duration: 3000,
        eventsProcessed: 4,
        metrics: { accuracy: 0.99, confidence: 0.97, tokensUsed: 1200 }
      },
      {
        id: 'run-005',
        status: 'running',
        startTime: new Date('2025-01-27T15:00:00Z'),
        eventsProcessed: 2,
        metrics: { accuracy: 0.0, confidence: 0.0, tokensUsed: 0 }
      }
    ],
    metrics: {
      totalRuns: 89,
      successRate: 0.97,
      avgDuration: 4200,
      totalEventsProcessed: 334
    },
    infrastructure: {
      modalAppId: 'ap-agent-desktop-nav',
      instances: 2,
      memory: '1GB',
      cpu: '0.5 vCPU',
      region: 'us-east-1'
    }
  },
  {
    id: 'wf-mediar-setup',
    name: 'Mediar Setup Wizard',
    description: 'Handles installation completion and setup wizard re-launch scenarios for the Mediar application',
    stage: 'idle',
    status: 'paused',
    version: 'v0.9.1',
    lastDeployed: new Date('2025-01-26T16:20:00Z'),
    triggers: ['Setup Wizard Completion', 'Maintenance Mode Entry', 'Installation Finish'],
    steps: [
      'Monitor setup wizard completion',
      'Detect finish button clicks',
      'Handle unexpected re-launches',
      'Manage maintenance mode transitions',
      'Validate installation state'
    ],
    inputs: ['Setup Events', 'Installation Status', 'User Interactions'],
    outputs: ['Setup Completion Status', 'Error Diagnostics', 'User Guidance'],
    businessLogic: [
      'Prevent infinite setup loops',
      'Graceful maintenance mode handling',
      'User experience optimization',
      'Installation state validation'
    ],
    runs: [
      {
        id: 'run-006',
        status: 'success',
        startTime: new Date('2025-01-27T09:30:00Z'),
        endTime: new Date('2025-01-27T09:30:18Z'),
        duration: 18000,
        eventsProcessed: 12,
        metrics: { accuracy: 0.92, confidence: 0.88, tokensUsed: 2100 }
      }
    ],
    metrics: {
      totalRuns: 23,
      successRate: 0.87,
      avgDuration: 16800,
      totalEventsProcessed: 198
    },
    infrastructure: {
      modalAppId: 'ap-mediar-setup-wiz',
      instances: 1,
      memory: '512MB',
      cpu: '0.25 vCPU',
      region: 'us-west-2'
    }
  }
];

const getStageColor = (stage: string) => {
  switch (stage) {
    case 'idle': return 'bg-white text-black border-gray-400';
    case 'human-in-loop': return 'bg-gray-100 text-black border-gray-400';
    case 'autonomous': return 'bg-black text-white border-black';
    default: return 'bg-white text-black border-gray-400';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'active': return 'bg-black text-white';
    case 'paused': return 'bg-gray-100 text-black';
    case 'error': return 'bg-gray-300 text-black';
    case 'deploying': return 'bg-gray-200 text-black';
    default: return 'bg-white text-black';
  }
};

const getRunStatusText = (status: string) => {
  switch (status) {
    case 'success': return '✓';
    case 'failure': return '✗';
    case 'running': return '●';
    case 'queued': return '○';
    default: return '○';
  }
};

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

export default function DeploymentsTabContent() {
  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<string>>(new Set());
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDeployment | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [templateYaml, setTemplateYaml] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');

  const filteredWorkflows = useMemo(() => {
    return mockWorkflows.filter(workflow => {
      const stageMatch = filterStage === 'all' || workflow.stage === filterStage;
      const statusMatch = filterStatus === 'all' || workflow.status === filterStatus;
      return stageMatch && statusMatch;
    });
  }, [filterStage, filterStatus]);

  const toggleWorkflowExpansion = (workflowId: string) => {
    const newExpanded = new Set(expandedWorkflows);
    if (newExpanded.has(workflowId)) {
      newExpanded.delete(workflowId);
    } else {
      newExpanded.add(workflowId);
    }
    setExpandedWorkflows(newExpanded);
  };

  const moveWorkflowStage = (workflowId: string, newStage: 'idle' | 'human-in-loop' | 'autonomous') => {
    // In a real app, this would make an API call
    console.log(`Moving workflow ${workflowId} to stage: ${newStage}`);
  };

  const openWorkflowDialog = (workflow: WorkflowDeployment) => {
    setSelectedWorkflow(workflow);
    setDialogOpen(true);
  };

  const totalMetrics = useMemo(() => {
    return filteredWorkflows.reduce((acc, workflow) => ({
      totalRuns: acc.totalRuns + workflow.metrics.totalRuns,
      totalEvents: acc.totalEvents + workflow.metrics.totalEventsProcessed,
      avgSuccessRate: acc.avgSuccessRate + workflow.metrics.successRate
    }), { totalRuns: 0, totalEvents: 0, avgSuccessRate: 0 });
  }, [filteredWorkflows]);

  return (
    <div className="space-y-6">
      {/* Header with Overview Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Deployed Workflows</p>
                <p className="text-2xl font-bold">{filteredWorkflows.filter(w => w.status === 'deployed').length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Runs</p>
                <p className="text-2xl font-bold">{totalMetrics.totalRuns.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
                <p className="text-2xl font-bold">{((totalMetrics.avgSuccessRate / filteredWorkflows.length) * 100).toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="flex gap-2">
          <Button
            variant={filterStage === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStage('all')}
          >
            All Stages
          </Button>
          <Button
            variant={filterStage === 'idle' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStage('idle')}
          >
            Idle
          </Button>
          <Button
            variant={filterStage === 'human-in-loop' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStage('human-in-loop')}
          >
            Human-in-Loop
          </Button>
          <Button
            variant={filterStage === 'autonomous' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStage('autonomous')}
          >
            Autonomous
          </Button>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant={filterStatus === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStatus('all')}
          >
            All Status
          </Button>
          <Button
            variant={filterStatus === 'deployed' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStatus('deployed')}
          >
            Deployed
          </Button>
          <Button
            variant={filterStatus === 'paused' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterStatus('paused')}
          >
            Paused
          </Button>
        </div>
      </div>

      {/* Workflow Cards */}
      <div className="space-y-4">
        {filteredWorkflows.map((workflow) => (
          <Card key={workflow.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Collapsible>
                    <CollapsibleTrigger
                      onClick={() => toggleWorkflowExpansion(workflow.id)}
                      className="flex items-center gap-2 hover:bg-muted rounded p-1"
                    >
                      {expandedWorkflows.has(workflow.id) ? 
                        <ChevronDown className="h-4 w-4" /> : 
                        <ChevronRight className="h-4 w-4" />
                      }
                    </CollapsibleTrigger>
                  </Collapsible>
                  
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{workflow.name}</h3>
                      <Badge variant="outline" className={getStageColor(workflow.stage)}>
                        {workflow.stage === 'human-in-loop' ? 'Human-in-Loop' : 
                         workflow.stage === 'autonomous' ? 'Autonomous' : 'Idle'}
                      </Badge>
                      <Badge className={getStatusColor(workflow.status)}>
                        {workflow.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{workflow.description}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="text-right text-sm">
                    <p className="font-medium">{workflow.metrics.successRate * 100}% success</p>
                    <p className="text-muted-foreground">{workflow.metrics.totalRuns} runs</p>
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        ⋮
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => moveWorkflowStage(workflow.id, 'idle')}>
                        Move to Idle
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => moveWorkflowStage(workflow.id, 'human-in-loop')}>
                        Move to Human-in-Loop
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => moveWorkflowStage(workflow.id, 'autonomous')}>
                        Move to Autonomous
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openWorkflowDialog(workflow)}>
                        Settings & Details
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardHeader>
            
            <Collapsible open={expandedWorkflows.has(workflow.id)}>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="grid w-full grid-cols-5">
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="runs">Recent Runs</TabsTrigger>
                      <TabsTrigger value="metrics">Metrics</TabsTrigger>
                      <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
                      <TabsTrigger value="configuration">Configuration</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="overview" className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">
                              Triggers
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <ul className="text-sm space-y-1">
                              {workflow.triggers.map((trigger, idx) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <span className="text-xs">•</span>
                                  {trigger}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                        
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">
                              Steps
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <ol className="text-sm space-y-1">
                              {workflow.steps.map((step, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="bg-gray-100 text-gray-800 text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    {idx + 1}
                                  </span>
                                  {step}
                                </li>
                              ))}
                            </ol>
                          </CardContent>
                        </Card>
                        
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Business Logic</CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <ul className="text-sm space-y-1">
                              {workflow.businessLogic.map((logic, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="text-xs mt-1">✓</span>
                                  {logic}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="runs" className="space-y-4">
                      <div className="space-y-3">
                        {workflow.runs.map((run) => (
                          <Card key={run.id}>
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                                              <div className="flex items-center gap-3">
                                <span className="font-mono text-lg">{getRunStatusText(run.status)}</span>
                                  <div>
                                    <p className="font-medium">Run {run.id}</p>
                                    <p className="text-sm text-muted-foreground">
                                      {run.startTime.toLocaleString()}
                                      {run.duration && ` • ${formatDuration(run.duration)}`}
                                    </p>
                                  </div>
                                </div>
                                
                                <div className="text-right">
                                  <p className="text-sm font-medium">{run.eventsProcessed} events</p>
                                  <p className="text-sm text-muted-foreground">
                                    {run.metrics.tokensUsed} tokens
                                  </p>
                                </div>
                              </div>
                              
                              {run.errorMessage && (
                                <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-md">
                                  <div className="flex items-start gap-2">
                                    <span className="text-black mt-0.5">✗</span>
                                    <div>
                                      <p className="text-sm font-medium text-black">Error</p>
                                      <p className="text-sm text-gray-700">{run.errorMessage}</p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                              {run.status === 'success' && (
                                <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <p className="text-muted-foreground">Accuracy</p>
                                    <p className="font-medium">{(run.metrics.accuracy * 100).toFixed(1)}%</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Confidence</p>
                                    <p className="font-medium">{(run.metrics.confidence * 100).toFixed(1)}%</p>
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="metrics" className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card>
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold text-green-600">{(workflow.metrics.successRate * 100).toFixed(1)}%</p>
                            <p className="text-sm text-muted-foreground">Success Rate</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold">{formatDuration(workflow.metrics.avgDuration)}</p>
                            <p className="text-sm text-muted-foreground">Avg Duration</p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="p-4 text-center">
                            <p className="text-2xl font-bold">{workflow.metrics.totalEventsProcessed.toLocaleString()}</p>
                            <p className="text-sm text-muted-foreground">Events Processed</p>
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="infrastructure" className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">
                              Modal Configuration
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">App ID</span>
                              <span className="text-sm font-mono">{workflow.infrastructure.modalAppId}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Region</span>
                              <span className="text-sm">{workflow.infrastructure.region}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Instances</span>
                              <span className="text-sm">{workflow.infrastructure.instances}</span>
                            </div>
                          </CardContent>
                        </Card>
                        
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">
                              Resources
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Memory</span>
                              <span className="text-sm">{workflow.infrastructure.memory}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">CPU</span>
                              <span className="text-sm">{workflow.infrastructure.cpu}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Version</span>
                              <span className="text-sm font-mono">{workflow.version}</span>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="configuration" className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Inputs</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ul className="text-sm space-y-1">
                              {workflow.inputs.map((input, idx) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                  {input}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                        
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Outputs</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ul className="text-sm space-y-1">
                              {workflow.outputs.map((output, idx) => (
                                <li key={idx} className="flex items-center gap-2">
                                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                  {output}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      </div>
                      
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm">
                            Schedule
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Last Deployed</span>
                              <span>{workflow.lastDeployed.toLocaleString()}</span>
                            </div>
                            {workflow.nextRun && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Next Run</span>
                                <span>{workflow.nextRun.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
      </div>

      {/* Unified Workflow Dialog */}
      <UnifiedWorkflowDialog
        workflow={selectedWorkflow as any}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSettingsUpdated={() => {
          // Refresh data if needed
          console.log('Settings updated');
        }}
      />

      {/* Create Workflow Dialog with Template */}
      <CreateWorkflowDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        initialYaml={templateYaml}
        initialName={templateName}
        onWorkflowCreated={() => {
          setCreateDialogOpen(false);
          // Optionally refresh the workflow list
        }}
      />
    </div>
  );
} 