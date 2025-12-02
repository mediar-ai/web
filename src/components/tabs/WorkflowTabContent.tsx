'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Loader2, Play, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DateRange } from 'react-day-picker';

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
  created_at?: string;
}

interface WorkflowTabContentProps {
  userId: string | null;
  eventsCount: number;
  activityItemsCount: number;
}

type AnalysisPhase = 'idle' | 'identifying' | 'synthesizing' | 'saving' | 'complete';

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

  // Date range state - default to last 24 hours
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(Date.now() - 24 * 60 * 60 * 1000),
    to: new Date(),
  });

  // Filtered counts for selected period
  const [filteredCounts, setFilteredCounts] = useState<{ events: number; activities: number } | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Saved workflows state
  const [savedWorkflows, setSavedWorkflows] = useState<SynthesizedWorkflow[]>([]);
  const [loadingSavedWorkflows, setLoadingSavedWorkflows] = useState(false);
  const [savedWorkflowsCollapsed, setSavedWorkflowsCollapsed] = useState(false);
  const [expandedSavedWorkflows, setExpandedSavedWorkflows] = useState<Set<number>>(new Set());
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<number | null>(null);

  // Fetch saved workflows on mount
  const fetchSavedWorkflows = useCallback(async () => {
    if (!userId) return;

    setLoadingSavedWorkflows(true);
    try {
      const response = await fetch(`/api/workflows?userId=${userId}&status=saved`);
      if (response.ok) {
        const result = await response.json();
        // Transform to match SynthesizedWorkflow interface
        const workflows = (result.data || []).map((w: {
          id: number;
          title: string;
          description?: string;
          detailed_workflow_data?: {
            steps?: WorkflowStep[];
            workflow_types?: WorkflowType[];
            workflow_instances?: WorkflowInstance[];
          };
          steps?: string[];
          created_at?: string;
        }) => ({
          id: w.id,
          title: w.title || 'Untitled Workflow',
          description: w.description || '',
          steps: w.detailed_workflow_data?.steps || [],
          workflow_types: w.detailed_workflow_data?.workflow_types || [],
          workflow_instances: w.detailed_workflow_data?.workflow_instances || [],
          created_at: w.created_at,
        }));
        setSavedWorkflows(workflows);
      }
    } catch (err) {
      console.error('Error fetching saved workflows:', err);
    } finally {
      setLoadingSavedWorkflows(false);
    }
  }, [userId]);

  // Delete a saved workflow
  const deleteWorkflow = useCallback(async (workflowId: number) => {
    if (!confirm('Are you sure you want to delete this workflow?')) return;

    setDeletingWorkflowId(workflowId);
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setSavedWorkflows(prev => prev.filter(w => w.id !== workflowId));
      } else {
        const errorData = await response.json();
        console.error('Delete failed:', errorData);
        alert('Failed to delete workflow');
      }
    } catch (err) {
      console.error('Error deleting workflow:', err);
      alert('Failed to delete workflow');
    } finally {
      setDeletingWorkflowId(null);
    }
  }, []);

  const toggleSavedWorkflowExpanded = (id: number) => {
    setExpandedSavedWorkflows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Fetch saved workflows on mount and when userId changes
  useEffect(() => {
    fetchSavedWorkflows();
  }, [fetchSavedWorkflows]);

  // Fetch counts when date range changes
  const fetchFilteredCounts = useCallback(async () => {
    if (!userId || !dateRange?.from || !dateRange?.to) {
      setFilteredCounts(null);
      return;
    }

    setLoadingCounts(true);
    try {
      const response = await fetch('/api/web-activity-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          startDate: dateRange.from.toISOString(),
          endDate: dateRange.to.toISOString(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setFilteredCounts({ events: data.eventsCount || 0, activities: data.activitiesCount || 0 });
      } else {
        setFilteredCounts(null);
      }
    } catch (err) {
      console.error('Error fetching counts:', err);
      setFilteredCounts(null);
    } finally {
      setLoadingCounts(false);
    }
  }, [userId, dateRange]);

  // Fetch counts when date range or userId changes
  useEffect(() => {
    fetchFilteredCounts();
  }, [fetchFilteredCounts]);

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

    if (!dateRange?.from || !dateRange?.to) {
      setError('Please select a date range.');
      return;
    }

    const effectiveCount = filteredCounts?.events ?? eventsCount;
    if (effectiveCount === 0) {
      setError('No events in selected period. Try a different date range.');
      return;
    }

    setPhase('identifying');
    setError(null);
    setProgress(0);
    setStatus('Starting workflow identification...');
    setWorkflowNames([]);
    setWorkflowContext(null);
    setSynthesizedWorkflows([]);
    setSaveSuccess(false);

    let identifiedNames: string[] = [];
    let identifiedContext: WorkflowContext | null = null;

    const startDate = dateRange.from.toISOString();
    const endDate = dateRange.to.toISOString();

    try {
      // PHASE 1: Identify workflows
      const response = await fetch('/api/web-workflow-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          model,
          startDate,
          endDate,
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
              workflows: identifiedNames.map(name => ({ name })),
              workflowContext: identifiedContext,
            },
            startDate,
            endDate,
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
          // Add temporary IDs for UI purposes
          const workflowsWithIds = synthesisResult.workflows.map((w: SynthesizedWorkflow, index: number) => ({
            ...w,
            id: w.id || index + 1,
          }));
          setSynthesizedWorkflows(workflowsWithIds);
          setExpandedWorkflows(new Set(workflowsWithIds.map((w: SynthesizedWorkflow) => w.id)));
        }

        setProgress(100);
        setStatus('Synthesis complete! Click Save to store workflows.');
        setPhase('complete');
      } else {
        setError('No workflows identified. Try recording more activity or adjusting the date range.');
        setPhase('idle');
      }
    } catch (err) {
      console.error('Workflow analysis error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPhase('idle');
    }
  }, [userId, dateRange, filteredCounts, eventsCount, model]);

  // Save workflows to database
  const saveWorkflows = useCallback(async () => {
    if (!userId || synthesizedWorkflows.length === 0) return;

    setIsSaving(true);
    setError(null);

    try {
      // Transform workflows for the API - include synthesis_status: 'saved'
      const recordsToInsert = synthesizedWorkflows.map(workflow => ({
        title: workflow.title || 'Untitled Workflow',
        detailed_workflow_data: workflow,
        synthesis_status: 'saved',
      }));

      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, workflows: recordsToInsert }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save workflows');
      }

      const result = await response.json();
      console.log('Saved workflows:', result);

      setSaveSuccess(true);
      setStatus(`Saved ${result.data?.length || synthesizedWorkflows.length} workflows to database!`);

      // Refresh saved workflows list
      fetchSavedWorkflows();
    } catch (err) {
      console.error('Save error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save workflows');
    } finally {
      setIsSaving(false);
    }
  }, [userId, synthesizedWorkflows, fetchSavedWorkflows]);

  const isAnalyzing = phase === 'identifying' || phase === 'synthesizing';
  const canAnalyze = (filteredCounts?.events ?? eventsCount) > 0 && dateRange?.from && dateRange?.to;

  return (
    <div className="space-y-4 p-4">
      {/* Saved Workflows Section */}
      {(savedWorkflows.length > 0 || loadingSavedWorkflows) && (
        <Card className="border-2 border-black">
          <CardHeader className="pb-2">
            <button
              onClick={() => setSavedWorkflowsCollapsed(!savedWorkflowsCollapsed)}
              className="w-full flex items-center justify-between hover:bg-gray-50 -m-2 p-2 rounded"
            >
              <CardTitle className="font-mono text-sm uppercase text-gray-600">
                Saved Workflows ({savedWorkflows.length})
              </CardTitle>
              {savedWorkflowsCollapsed ? (
                <ChevronRight className="h-5 w-5 text-gray-600" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-600" />
              )}
            </button>
          </CardHeader>
          {!savedWorkflowsCollapsed && (
            <CardContent className="p-4 space-y-3">
              {loadingSavedWorkflows ? (
                <div className="flex items-center gap-2 text-sm font-mono text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading saved workflows...
                </div>
              ) : savedWorkflows.length === 0 ? (
                <p className="text-sm font-mono text-gray-500">No saved workflows yet.</p>
              ) : (
                savedWorkflows.map((workflow) => (
                  <div key={workflow.id} className="border-2 border-gray-300">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleSavedWorkflowExpanded(workflow.id)}
                        className="flex-1 p-3 flex items-center justify-between hover:bg-gray-50 text-left"
                      >
                        <div>
                          <h3 className="font-mono font-bold text-sm">{workflow.title}</h3>
                          <p className="font-mono text-xs text-gray-600 mt-1">{workflow.description}</p>
                        </div>
                        {expandedSavedWorkflows.has(workflow.id) ? (
                          <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-500" />
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteWorkflow(workflow.id)}
                        disabled={deletingWorkflowId === workflow.id}
                        className="mr-2 hover:bg-red-50 hover:text-red-600"
                      >
                        {deletingWorkflowId === workflow.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {expandedSavedWorkflows.has(workflow.id) && (
                      <div className="border-t border-gray-300 p-4 space-y-4 bg-gray-50">
                        {/* Steps */}
                        {workflow.steps && workflow.steps.length > 0 && (
                          <div>
                            <h4 className="font-mono text-xs uppercase text-gray-600 mb-2">
                              Steps ({workflow.steps.length})
                            </h4>
                            <ol className="space-y-2">
                              {workflow.steps.map((step, stepIndex) => (
                                <li key={stepIndex} className="bg-white p-3 border border-gray-200">
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
                                  className="px-2 py-1 bg-white border border-gray-300 font-mono text-xs"
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
                ))
              )}
            </CardContent>
          )}
        </Card>
      )}

      <Card className="border-2 border-black">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-sm uppercase text-gray-600">Workflow Synthesis</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* Date Range Picker */}
          <div>
            <label className="font-mono text-xs text-gray-600 uppercase mb-1 block">Time Period</label>
            <DateRangePicker
              date={dateRange}
              onDateChange={setDateRange}
              showTime={true}
              placeholder="Select date range"
            />
          </div>

          {/* Filtered counts display */}
          <div className="text-sm font-mono text-gray-600 flex items-center gap-2">
            {loadingCounts ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading counts...
              </span>
            ) : filteredCounts ? (
              <span className="bg-gray-100 px-2 py-1 border border-gray-300">
                Selected period: {filteredCounts.events} events, {filteredCounts.activities} activities
              </span>
            ) : (
              <span>Total: {eventsCount} events, {activityItemsCount} activities</span>
            )}
          </div>

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
                disabled={isAnalyzing || !canAnalyze}
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
            <div className="flex items-center gap-2">
              {/* Save Button */}
              <Button
                onClick={saveWorkflows}
                disabled={isSaving || saveSuccess}
                className={saveSuccess
                  ? "bg-gray-400 text-white font-mono"
                  : "bg-black text-white hover:bg-gray-800 font-mono"
                }
                size="sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : saveSuccess ? (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    SAVE
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={startAnalysis}
                disabled={isAnalyzing}
                className="hover:bg-gray-100 h-7"
              >
                <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {saveSuccess && (
              <div className="border-2 border-black bg-gray-50 p-3 text-sm font-mono">
                {status}
              </div>
            )}
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
          <p>Select a time period and click &quot;ANALYZE WORKFLOWS&quot; to synthesize workflows.</p>
          <p className="text-xs mt-2">Requires at least 1 event in selected period.</p>
        </div>
      )}
    </div>
  );
}
