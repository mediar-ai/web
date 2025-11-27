'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

interface WorkflowContext {
  user_job_role?: string;
  project_name?: string;
  user_goal_from_recordings?: string;
  overall_project_goal?: string;
  overall_project_description?: string;
}

interface WorkflowTabContentProps {
  userId: string | null;
  eventsCount: number;
  activityItemsCount: number;
}

export default function WorkflowTabContent({
  userId,
  eventsCount,
  activityItemsCount,
}: WorkflowTabContentProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [workflowNames, setWorkflowNames] = useState<string[]>([]);
  const [workflowContext, setWorkflowContext] = useState<WorkflowContext | null>(null);
  const [model, setModel] = useState('gemini-3-pro-preview');

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

    setIsAnalyzing(true);
    setError(null);
    setProgress(0);
    setStatus('Starting analysis...');
    setWorkflowNames([]);
    setWorkflowContext(null);

    try {
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
              if (data.progress) setProgress(data.progress);

              if (data.data?.workflowNames) {
                setWorkflowNames(data.data.workflowNames);
              }
              if (data.data?.workflowContext) {
                setWorkflowContext(data.data.workflowContext);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (err) {
      console.error('Workflow analysis error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsAnalyzing(false);
    }
  }, [userId, eventsCount, model]);

  return (
    <div className="space-y-4 p-4">
      <Card className="border-2 border-black">
        <CardHeader className="bg-black text-white py-3">
          <CardTitle className="font-mono text-sm">WORKFLOW SYNTHESIS</CardTitle>
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
                    Analyzing...
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

      {workflowNames.length > 0 && (
        <Card className="border-2 border-black">
          <CardHeader className="bg-black text-white py-3 flex flex-row items-center justify-between">
            <CardTitle className="font-mono text-sm">IDENTIFIED WORKFLOWS ({workflowNames.length})</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={startAnalysis}
              disabled={isAnalyzing}
              className="text-white hover:bg-gray-800 h-7"
            >
              <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            </Button>
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

      {workflowContext && (
        <Card className="border-2 border-black">
          <CardHeader className="bg-black text-white py-3">
            <CardTitle className="font-mono text-sm">USER CONTEXT</CardTitle>
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

      {!isAnalyzing && workflowNames.length === 0 && !error && (
        <div className="text-center py-8 text-gray-500 font-mono">
          <p>Click &quot;ANALYZE WORKFLOWS&quot; to identify workflows from your recorded session.</p>
          <p className="text-xs mt-2">Requires at least 1 event to analyze.</p>
        </div>
      )}
    </div>
  );
}
