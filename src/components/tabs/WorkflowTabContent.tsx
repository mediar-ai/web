'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Loader2, Play, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

interface WorkflowContext {
  user_job_role?: string;
  project_name?: string;
  user_goal_from_recordings?: string;
  overall_project_goal?: string;
  overall_project_description?: string;
}

interface WorkflowStep {
  title: string;
  description: string;
  step_name?: string;
  substeps?: {
    substep_name: string;
    inputs: string[];
    outputs: string[];
    business_logic: string[];
  }[];
}

interface WorkflowType {
  name: string;
  description: string;
  type_name?: string;
  type_description?: string;
}

interface WorkflowInstance {
  name: string;
  description: string;
  instance_name?: string;
  instance_data?: Record<string, unknown>;
}

interface SynthesizedWorkflow {
  id: number;
  title: string;
  description: string;
  steps: WorkflowStep[];
  workflow_types: WorkflowType[];
  workflow_instances: WorkflowInstance[];
}

interface WorkflowTabContentProps {
  userId: string | null;
  eventsCount: number;
  activityItemsCount: number;
}

type AnalysisPhase = 'idle' | 'identifying' | 'synthesizing' | 'complete';

export default function WorkflowTabContent({
  userId,
  eventsCount,
  activityItemsCount,
}: WorkflowTabContentProps) {
  const [phase, setPhase] = useState<AnalysisPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [workflowNames, setWorkflowNames] = useState<string[]>([]);
  const [workflowContext, setWorkflowContext] = useState<WorkflowContext | null>(null);
  const [synthesizedWorkflows, setSynthesizedWorkflows] = useState<SynthesizedWorkflow[]>([]);
  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<number>>(new Set());
  const [model, setModel] = useState('gemini-3-pro-preview');

  const toggleWorkflowExpanded = (id: number) => {
    setExpandedWorkflows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const startAnalysis = useCallback(async () => {
    if (!userId) {
      setError('User ID not available. Please sign in.');
      return;
    }

    const sessionId = localStorage.getItem('app_session_id');
    if (!sessionId) {
      setError('No active session. Please start a recording first.');
      return;
    }

    if (eventsCount === 0) {
      setError('No events to analyze. Record some activity first.');
      return;
    }

    setPhase('identifying');
    setError(null);
    setProgress(0);
    setStatus('Starting workflow identification...');
    setWorkflowNames([]);
    setWorkflowContext(null);
    setSynthesizedWorkflows([]);

    let identifiedNames: string[] = [];
    let identifiedContext: WorkflowContext | null = null;

    try {
      // PHASE 1: Identify workflows
      const response = await fetch('/api/web-workflow-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sessionId,
          model,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start analysis');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                throw new Error(data.details || data.error);
              }

              if (data.status) setStatus(data.status);
              if (data.progress) setProgress(Math.min(data.progress, 50)); // Cap at 50% for phase 1

              if (data.data?.workflowNames) {
                identifiedNames = data.data.workflowNames;
                setWorkflowNames(identifiedNames);
              }
              if (data.data?.workflowContext) {
                identifiedContext = data.data.workflowContext;
                setWorkflowContext(identifiedContext);
              }
            } catch (e) {
              if (e instanceof Error && e.message) throw e;
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }

      // PHASE 2: Synthesize detailed workflows
      if (identifiedNames.length > 0) {
        setPhase('synthesizing');
        setStatus('Synthesizing detailed workflows...');
        setProgress(55);

        const synthesisResponse = await fetch('/api/web-synthesize-workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            context: {
              userId,
              sessionId,
              workflows: identifiedNames.map(name => ({ name })),
              workflowContext: identifiedContext,
            },
            startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
            endDate: new Date().toISOString(),
          }),
        });

        if (!synthesisResponse.ok) {
          const errorData = await synthesisResponse.json();
          throw new Error(errorData.message || errorData.error || 'Failed to synthesize workflows');
        }

        setProgress(85);
        setStatus('Processing synthesis results...');

        const synthesisResult = await synthesisResponse.json();

        if (synthesisResult.workflows && Array.isArray(synthesisResult.workflows)) {
          setSynthesizedWorkflows(synthesisResult.workflows);
          // Expand all workflows by default
          setExpandedWorkflows(new Set(synthesisResult.workflows.map((w: SynthesizedWorkflow) => w.id)));
        }

        setProgress(100);
        setStatus('Analysis complete!');
        setPhase('complete');
      } else {
        setError('No workflows identified. Try recording more activity.');
        setPhase('idle');
      }
    } catch (err) {
      console.error('Workflow analysis error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPhase('idle');
    }
  }, [userId, eventsCount, model]);

  const isAnalyzing = phase === 'identifying' || phase === 'synthesizing';

  return (
    <div className="space-y-4 p-4">
      <Card className="border-2 border-black">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-sm uppercase text-gray-600">Workflow Synthesis</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="font-mono text-xs text-gray-600 uppercase mb-1 block">Model</label>
              <Select value={model} onValueChange={setModel} disabled={isAnalyzing}>
                <SelectTrigger className="border-2 border-black font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-3-pro-preview">Gemini 3 Pro Preview</SelectItem>
                  <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                  <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (Fast)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-5">
              <Button
                onClick={startAnalysis}
                disabled={isAnalyzing || eventsCount === 0}
                className="bg-black text-white hover:bg-gray-800 font-mono"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {phase === 'identifying' ? 'Identifying...' : 'Synthesizing...'}
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    ANALYZE WORKFLOWS
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="text-sm font-mono text-gray-600">
            {eventsCount} events, {activityItemsCount} activities available
          </div>

          {isAnalyzing && (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 h-2 rounded">
                <div
                  className="bg-black h-2 rounded transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm font-mono text-gray-600">{status}</p>
            </div>
          )}

          {error && (
            <div className="border-2 border-black bg-gray-100 p-3">
              <p className="text-sm font-mono text-black">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Synthesized Workflows */}
      {synthesizedWorkflows.length > 0 && (
        <Card className="border-2 border-black">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="font-mono text-sm uppercase text-gray-600">
              Synthesized Workflows ({synthesizedWorkflows.length})
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={startAnalysis}
              disabled={isAnalyzing}
              className="hover:bg-gray-100 h-7"
            >
              <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            </Button>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {synthesizedWorkflows.map((workflow) => (
              <div key={workflow.id} className="border-2 border-black">
                <button
                  onClick={() => toggleWorkflowExpanded(workflow.id)}
                  className="w-full p-3 flex items-center justify-between hover:bg-gray-50 text-left"
                >
                  <div>
                    <h3 className="font-mono font-bold">{workflow.title}</h3>
                    <p className="font-mono text-sm text-gray-600 mt-1">{workflow.description}</p>
                  </div>
                  {expandedWorkflows.has(workflow.id) ? (
                    <ChevronDown className="h-5 w-5 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-5 w-5 flex-shrink-0" />
                  )}
                </button>

                {expandedWorkflows.has(workflow.id) && (
                  <div className="border-t-2 border-black p-4 space-y-4">
                    {/* Steps */}
                    {workflow.steps && workflow.steps.length > 0 && (
                      <div>
                        <h4 className="font-mono text-xs uppercase text-gray-600 mb-2">
                          Steps ({workflow.steps.length})
                        </h4>
                        <ol className="space-y-2">
                          {workflow.steps.map((step, stepIndex) => (
                            <li key={stepIndex} className="bg-gray-50 p-3 border border-gray-200">
                              <div className="font-mono text-sm font-bold">
                                {stepIndex + 1}. {step.title || step.step_name}
                              </div>
                              <p className="font-mono text-xs text-gray-600 mt-1">
                                {step.description}
                              </p>
                              {step.substeps && step.substeps.length > 0 && (
                                <div className="mt-2 pl-4 border-l-2 border-gray-300">
                                  {step.substeps.map((substep, subIndex) => (
                                    <div key={subIndex} className="text-xs font-mono mt-1">
                                      <span className="text-gray-500">{subIndex + 1}.</span>{' '}
                                      {substep.substep_name}
                                      {substep.inputs?.length > 0 && (
                                        <span className="text-gray-400 ml-2">
                                          [in: {substep.inputs.join(', ')}]
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Workflow Types */}
                    {workflow.workflow_types && workflow.workflow_types.length > 0 && (
                      <div>
                        <h4 className="font-mono text-xs uppercase text-gray-600 mb-2">
                          Workflow Types
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {workflow.workflow_types.map((type, typeIndex) => (
                            <span
                              key={typeIndex}
                              className="px-2 py-1 bg-gray-100 border border-gray-300 font-mono text-xs"
                              title={type.description || type.type_description}
                            >
                              {type.name || type.type_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Workflow Instances */}
                    {workflow.workflow_instances && workflow.workflow_instances.length > 0 && (
                      <div>
                        <h4 className="font-mono text-xs uppercase text-gray-600 mb-2">
                          Instances
                        </h4>
                        <div className="space-y-1">
                          {workflow.workflow_instances.map((instance, instIndex) => (
                            <div key={instIndex} className="font-mono text-xs">
                              <span className="font-bold">{instance.name || instance.instance_name}:</span>{' '}
                              <span className="text-gray-600">{instance.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Identified Workflows (shown only if no synthesized workflows yet) */}
      {workflowNames.length > 0 && synthesizedWorkflows.length === 0 && (
        <Card className="border-2 border-black">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm uppercase text-gray-600">
              Identified Workflows ({workflowNames.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <ul className="space-y-2">
              {workflowNames.map((name, index) => (
                <li
                  key={index}
                  className="border-2 border-black p-3 font-mono text-sm hover:bg-gray-50"
                >
                  {index + 1}. {name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* User Context */}
      {workflowContext && (
        <Card className="border-2 border-black">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm uppercase text-gray-600">User Context</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {workflowContext.user_job_role && (
              <div>
                <label className="font-mono text-xs text-gray-600 uppercase">Job Role</label>
                <p className="font-mono text-sm">{workflowContext.user_job_role}</p>
              </div>
            )}
            {workflowContext.project_name && (
              <div>
                <label className="font-mono text-xs text-gray-600 uppercase">Project</label>
                <p className="font-mono text-sm">{workflowContext.project_name}</p>
              </div>
            )}
            {workflowContext.user_goal_from_recordings && (
              <div>
                <label className="font-mono text-xs text-gray-600 uppercase">Goal from Recordings</label>
                <p className="font-mono text-sm">{workflowContext.user_goal_from_recordings}</p>
              </div>
            )}
            {workflowContext.overall_project_goal && (
              <div>
                <label className="font-mono text-xs text-gray-600 uppercase">Overall Goal</label>
                <p className="font-mono text-sm">{workflowContext.overall_project_goal}</p>
              </div>
            )}
            {workflowContext.overall_project_description && (
              <div>
                <label className="font-mono text-xs text-gray-600 uppercase">Description</label>
                <p className="font-mono text-sm">{workflowContext.overall_project_description}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {phase === 'idle' && workflowNames.length === 0 && !error && (
        <div className="text-center py-8 text-gray-500 font-mono">
          <p>Click &quot;ANALYZE WORKFLOWS&quot; to identify and synthesize workflows from your recorded session.</p>
          <p className="text-xs mt-2">Requires at least 1 event to analyze.</p>
        </div>
      )}
    </div>
  );
}
