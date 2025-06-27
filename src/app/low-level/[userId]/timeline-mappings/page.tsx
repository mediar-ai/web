'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlayCircle, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import {
  EnhancedTimelineEvent,
  TimelineEventAnalysisResponse,
  FetchTimelineEventMappingsResponse
} from '@/lib/timelineMappingTypes';

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
  const [mappedEvents, setMappedEvents] = useState<EnhancedTimelineEvent[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalysisStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/analyze-timeline-events?user_id=${userId}`);
      if (!response.ok) throw new Error('Failed to fetch analysis status');
      const data = await response.json();
      setAnalysisStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    }
  }, [userId]);

  const fetchMappedEvents = useCallback(async () => {
    setIsFetching(true);
    try {
      const response = await fetch(`/api/timeline-event-mappings?user_id=${userId}&include_unrelated=true`);
      if (!response.ok) throw new Error('Failed to fetch mapped events');
      const data: FetchTimelineEventMappingsResponse = await response.json();
      setMappedEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      setIsFetching(false);
    }
  }, [userId]);

  const runAnalysis = useCallback(async () => {
    if (!analysisStatus || !analysisStatus.ready_for_analysis) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      // First, get unmapped events and workflows
      const statusResponse = await fetch(`/api/analyze-timeline-events?user_id=${userId}`);
      if (!statusResponse.ok) throw new Error('Failed to fetch analysis data');
      const statusData = await statusResponse.json();

      // Run the analysis
      const analysisResponse = await fetch('/api/analyze-timeline-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          events: statusData.events,
          existing_workflows: statusData.workflows,
          model: 'gemini-pro'
        })
      });

      if (!analysisResponse.ok) throw new Error('Analysis failed');
      const analysisResult: TimelineEventAnalysisResponse = await analysisResponse.json();

      // Save the analysis results
      const saveResponse = await fetch('/api/timeline-event-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          analysis_result: analysisResult
        })
      });

      if (!saveResponse.ok) throw new Error('Failed to save analysis results');

      // Refresh data
      await fetchAnalysisStatus();
      await fetchMappedEvents();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  }, [analysisStatus, userId, fetchAnalysisStatus, fetchMappedEvents]);

  const getEventStatusBadge = (event: EnhancedTimelineEvent) => {
    if (event.is_workflow_related) {
      return <Badge variant="default" className="bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3 mr-1" />
        Mapped ({event.total_mappings})
      </Badge>;
    } else if (event.unrelated_info) {
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

  // Fetch analysis status on page load
  useEffect(() => {
    fetchAnalysisStatus();
    fetchMappedEvents();
  }, [fetchAnalysisStatus, fetchMappedEvents, userId]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Timeline Event Workflow Mappings</h1>
          <p className="text-muted-foreground">Analyze and map timeline events to confirmed workflows</p>
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

      {/* Analysis Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>Analysis Status</CardTitle>
          <CardDescription>Current state of timeline event analysis</CardDescription>
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
            disabled={!analysisStatus?.ready_for_analysis || isAnalyzing || analysisStatus?.unmapped_events === 0}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Timeline Events...
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 mr-2" />
                Run Analysis ({analysisStatus?.unmapped_events || 0} unmapped events)
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Mapped Events */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Timeline Events
            <Button 
              variant="outline" 
              size="sm"
              onClick={fetchMappedEvents}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refresh'}
            </Button>
          </CardTitle>
          <CardDescription>Timeline events with workflow mapping status</CardDescription>
        </CardHeader>
        <CardContent>
          {isFetching ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <div className="text-muted-foreground">Loading events...</div>
            </div>
          ) : mappedEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No timeline events found
            </div>
          ) : (
            <div className="space-y-3">
              {mappedEvents.slice(0, 20).map((event) => (
                <div key={event.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <Badge variant="outline">{event.event_type}</Badge>
                        {getEventStatusBadge(event)}
                        {event.confidence_score && (
                          <Badge variant="secondary">
                            {Math.round(event.confidence_score * 100)}% confidence
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Workflow Mappings */}
                  {event.workflow_mappings.length > 0 && (
                    <div className="ml-4 space-y-2">
                      {event.workflow_mappings.map((mapping, idx) => (
                        <div key={idx} className="bg-green-50 p-3 rounded border-l-4 border-green-400">
                          <div className="font-medium text-green-900">
                            {mapping.workflow_template?.title} → {mapping.workflow_step}
                          </div>
                          <div className="text-sm text-green-700">
                            Type: {mapping.workflow_type?.type_name} | 
                            Instance: {mapping.workflow_instance?.instance_name}
                          </div>
                          {mapping.workflow_substep && (
                            <div className="text-sm text-green-600">
                              Substep: {mapping.workflow_substep}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unrelated Info */}
                  {event.unrelated_info && (
                    <div className="ml-4">
                      <div className="bg-gray-50 p-3 rounded border-l-4 border-gray-400">
                        <div className="text-sm text-gray-700">
                          <strong>Unrelated:</strong> {event.unrelated_info.unrelated_reason}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {mappedEvents.length > 20 && (
                <div className="text-center py-4 text-muted-foreground">
                  Showing first 20 of {mappedEvents.length} events
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
