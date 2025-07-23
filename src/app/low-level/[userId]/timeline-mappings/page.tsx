/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlayCircle, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface RawEventAnnotation {
  user_id: string;
  raw_event_id: number;
  analysis_id: number;
  confidence_score: number;
  is_workflow_related: boolean;
  model_used: string;
  unrelated_reason: string | null;
  workflow_template_id: number | null;
  workflow_type_id: number | null;
  workflow_instance_id: number | null;
  workflow_step_id: number | null;
  workflow_substep_id: number | null;
  inputs: string | null;
  outputs: string | null;
  business_logics: string | null;
  created_at: string;
  // Joined event data
  event_payload?: any;
  event_created_at?: string;
}

interface AnalysisStatus {
  ready_for_analysis: boolean;
  total_events: number;
  total_workflows: number;
  mapped_events: number;
  unmapped_events: number;
}

export default function TimelineMappingsPage() {
  const params = useParams();
  const userId = params.userId as string;

  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [rawEventAnnotations, setRawEventAnnotations] = useState<RawEventAnnotation[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  // Fetch raw event annotations from the new table
  const fetchRawEventAnnotations = useCallback(async () => {
    setIsFetching(true);
    try {
      const response = await fetch(`/api/timeline-event-mappings?user_id=${userId}&raw_events=true&include_unrelated=true`);
      if (!response.ok) throw new Error('Failed to fetch raw event annotations');
      const data = await response.json();
      setRawEventAnnotations(data.annotations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch annotations');
    } finally {
      setIsFetching(false);
    }
  }, [userId]);

  // Calculate analysis status from existing annotations
  const calculateAnalysisStatus = useCallback(async () => {
    try {
      // Get total events count
      const eventsResponse = await fetch(`/api/users/${userId}/data?limit=1`);
      if (!eventsResponse.ok) throw new Error('Failed to fetch events count');
      const eventsData = await eventsResponse.json();
      
             // Get workflows count
       const workflowsResponse = await fetch(`/api/workflows?userId=${userId}`);
             const workflowsData = workflowsResponse.ok ? await workflowsResponse.json() : { data: [] };
       
       const mappedEvents = rawEventAnnotations.filter(a => a.is_workflow_related).length;
       const totalEvents = eventsData.pagination?.total || 0;
       
       setAnalysisStatus({
         ready_for_analysis: true,
         total_events: totalEvents,
         total_workflows: workflowsData.data?.length || 0,
        mapped_events: mappedEvents,
        unmapped_events: Math.max(0, totalEvents - rawEventAnnotations.length)
      });
    } catch (err) {
      console.error('Error calculating analysis status:', err);
    }
  }, [userId, rawEventAnnotations]);

  // Run raw timeline analysis using the restored endpoint
  const runAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);
    setProgress('Starting analysis...');

    try {
      const response = await fetch('/api/analyze-raw-timeline-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          model: 'gemini-2.5-pro'
        })
      });

      if (!response.ok) throw new Error('Analysis failed');

      // Stream the response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.status) {
                  setProgress(data.status);
                }
                if (data.data?.annotations) {
                  // Add new annotations to the list as they come in
                  setRawEventAnnotations(prev => [...prev, ...data.data.annotations]);
                }
                if (data.error) {
                  setError(data.error);
                  break;
                }
                               } catch {
                   // Ignore parse errors for incomplete chunks
                 }
            }
          }
        }
      }

      // Refresh the full data
      await fetchRawEventAnnotations();
      setProgress('Analysis completed!');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => setProgress(''), 3000);
    }
  }, [userId, fetchRawEventAnnotations]);

  const getEventStatusBadge = (annotation: RawEventAnnotation) => {
    if (annotation.is_workflow_related) {
      return <Badge variant="default" className="bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3 mr-1" />
        Mapped to Workflow
      </Badge>;
    } else if (annotation.unrelated_reason) {
      return <Badge variant="secondary" className="bg-gray-100 text-gray-800">
        <XCircle className="w-3 h-3 mr-1" />
        Unrelated
      </Badge>;
    } else {
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-800">
        <AlertCircle className="w-3 h-3 mr-1" />
        Unmapped
      </Badge>;
    }
  };

  const getEventType = (annotation: RawEventAnnotation) => {
    try {
      return annotation.event_payload?.payload?.type || 'Unknown';
    } catch {
      return 'Unknown';
    }
  };

  // Fetch data on page load
  useEffect(() => {
    fetchRawEventAnnotations();
  }, [fetchRawEventAnnotations]);

  useEffect(() => {
    calculateAnalysisStatus();
  }, [calculateAnalysisStatus]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Raw Event Timeline Mappings</h1>
          <p className="text-muted-foreground">Analyze and map individual raw events to workflow components</p>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-red-800">
              <XCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {progress && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-blue-800">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{progress}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analysis Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>Analysis Status</CardTitle>
          <CardDescription>Current state of raw event timeline analysis</CardDescription>
        </CardHeader>
        <CardContent>
          {analysisStatus ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{analysisStatus.total_events}</div>
                <div className="text-sm text-muted-foreground">Total Events</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{analysisStatus.mapped_events}</div>
                <div className="text-sm text-muted-foreground">Mapped</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{analysisStatus.unmapped_events}</div>
                <div className="text-sm text-muted-foreground">Unmapped</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{analysisStatus.total_workflows}</div>
                <div className="text-sm text-muted-foreground">Workflows</div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <div className="text-muted-foreground">Loading analysis status...</div>
            </div>
          )}

          <Button 
            onClick={runAnalysis}
            disabled={!analysisStatus?.ready_for_analysis || isAnalyzing}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Raw Events...
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 mr-2" />
                Run Raw Event Analysis
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Raw Event Annotations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Raw Event Mappings ({rawEventAnnotations.length})
            <Button 
              variant="outline" 
              size="sm"
              onClick={fetchRawEventAnnotations}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
            </Button>
          </CardTitle>
          <CardDescription>Individual raw events with workflow component mappings</CardDescription>
        </CardHeader>
        <CardContent>
          {isFetching ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <div className="text-muted-foreground">Loading raw event mappings...</div>
            </div>
          ) : rawEventAnnotations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No raw event mappings found. Run analysis to generate mappings.
            </div>
          ) : (
            <div className="space-y-3">
              {rawEventAnnotations.slice(0, 50).map((annotation) => (
                <div key={`${annotation.raw_event_id}-${annotation.analysis_id}`} className="border rounded-lg p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <Badge variant="outline">
                          Event #{annotation.raw_event_id}
                        </Badge>
                        <Badge variant="outline">
                          {getEventType(annotation)}
                        </Badge>
                        {getEventStatusBadge(annotation)}
                        <Badge variant="secondary">
                          {Math.round(annotation.confidence_score * 100)}% confidence
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {annotation.event_created_at 
                          ? new Date(annotation.event_created_at).toLocaleString()
                          : new Date(annotation.created_at).toLocaleString()
                        }
                      </div>
                    </div>
                  </div>

                  {/* Workflow Component Mapping */}
                  {annotation.is_workflow_related && (
                    <div className="ml-4 space-y-2">
                      <div className="bg-green-50 p-3 rounded border-l-4 border-green-400">
                        <div className="font-medium text-green-900">
                          Workflow Component Mapping
                        </div>
                        <div className="text-sm text-green-700 space-y-1">
                          {annotation.workflow_template_id && (
                            <div>Template ID: {annotation.workflow_template_id}</div>
                          )}
                          {annotation.workflow_type_id && (
                            <div>Type ID: {annotation.workflow_type_id}</div>
                          )}
                          {annotation.workflow_instance_id && (
                            <div>Instance ID: {annotation.workflow_instance_id}</div>
                          )}
                          {annotation.workflow_step_id && (
                            <div>Step ID: {annotation.workflow_step_id}</div>
                          )}
                          {annotation.workflow_substep_id && (
                            <div>Substep ID: {annotation.workflow_substep_id}</div>
                          )}
                        </div>
                        {annotation.inputs && (
                          <div className="text-sm text-green-600 mt-2">
                            <strong>Inputs:</strong> {annotation.inputs}
                          </div>
                        )}
                        {annotation.outputs && (
                          <div className="text-sm text-green-600">
                            <strong>Outputs:</strong> {annotation.outputs}
                          </div>
                        )}
                        {annotation.business_logics && (
                          <div className="text-sm text-green-600">
                            <strong>Business Logic:</strong> {annotation.business_logics}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Unrelated Reason */}
                  {annotation.unrelated_reason && (
                    <div className="ml-4">
                      <div className="bg-gray-50 p-3 rounded border-l-4 border-gray-400">
                        <div className="text-sm text-gray-700">
                          <strong>Unrelated:</strong> {annotation.unrelated_reason}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {rawEventAnnotations.length > 50 && (
                <div className="text-center py-4 text-muted-foreground">
                  Showing first 50 of {rawEventAnnotations.length} raw event mappings
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
