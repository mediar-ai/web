'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy, Download, ExternalLink, Play, Code, BarChart3, Database, Search, Users, Calendar, Zap } from 'lucide-react';

interface CachedResponse {
  endpointPath: string;
  httpMethod: string;
  statusCode: number;
  responseBody: Record<string, unknown>;
  requestParams: Record<string, unknown>;
  executionTimeMs: number;
  timestamp: string;
}

export default function WorkflowRecorderAPIDocsPage() {
  const [cachedResponses, setCachedResponses] = useState<CachedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedStates, setCopiedStates] = useState<{[key: string]: boolean}>({});

  useEffect(() => {
    fetchCachedResponses();
  }, []);

  const fetchCachedResponses = async () => {
    try {
      console.log('🔄 Fetching cached API responses for workflow recorder documentation...');
      const response = await fetch('/api/response-cache?endpoint_pattern=workflow-recorder');
      if (response.ok) {
        const data = await response.json();
        setCachedResponses(data.responses || []);
        console.log(`✅ Loaded ${data.responses?.length || 0} cached responses`);
      }
    } catch (error) {
      console.error('Failed to fetch cached responses:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [key]: false }));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const downloadPostmanCollection = () => {
    const endpoints = [
      {
        name: "List Events",
        method: "GET",
        url: "{{baseUrl}}/api/workflow-recorder",
        description: "Query workflow recorder events with filtering and pagination"
      },
      {
        name: "Get Event Details",
        method: "GET", 
        url: "{{baseUrl}}/api/workflow-recorder/{{eventId}}",
        description: "Get detailed information about a specific event including UI analysis"
      },
      {
        name: "List Sessions",
        method: "GET",
        url: "{{baseUrl}}/api/workflow-recorder/sessions", 
        description: "Query workflow recorder sessions with aggregated metrics"
      },
      {
        name: "Get Analytics",
        method: "GET",
        url: "{{baseUrl}}/api/workflow-recorder/analytics",
        description: "Get aggregated analytics and insights from workflow recorder data"
      }
    ];

    const collection = {
      info: {
        name: "Workflow Recorder API",
        description: `Collection for Workflow Recorder API - Generated from Mediar API documentation`,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      variable: [
        {
          key: "baseUrl",
          value: window.location.origin,
          type: "string"
        }
      ],
      item: endpoints.map(endpoint => ({
        name: endpoint.name,
        request: {
          method: endpoint.method,
          header: [
            {
              key: "Content-Type",
              value: "application/json"
            }
          ],
          url: {
            raw: endpoint.url,
            host: ["{{baseUrl}}"],
            path: endpoint.url.replace("{{baseUrl}}/", "").split("/")
          },
          description: endpoint.description
        }
      }))
    };

    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow-recorder-api.postman_collection.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getCachedExample = (endpointPath: string, method: string = 'GET') => {
    return cachedResponses.find(r => 
      r.endpointPath === endpointPath && 
      r.httpMethod === method
    );
  };

  const formatJsonWithSyntaxHighlighting = (json: Record<string, unknown>) => {
    const jsonString = JSON.stringify(json, null, 2);
    return (
      <pre className="text-sm overflow-x-auto bg-gray-50 p-4 rounded-lg border">
        <code>{jsonString}</code>
      </pre>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header Section */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Database className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold mb-2">Workflow Recorder API Documentation</h1>
        </div>
        <p className="text-lg text-gray-600 max-w-3xl mx-auto">
          Query and analyze low-level workflow recorder data including UI trees, user interactions, and session analytics. 
          Perfect for building workflow automation tools and understanding user behavior patterns.
        </p>
        
        <div className="flex items-center justify-center gap-4 mt-6">
          <Badge variant="secondary" className="text-sm px-3 py-1">
            <Zap className="w-4 h-4 mr-1" />
            Low-Level Data Access
          </Badge>
          <Badge variant="secondary" className="text-sm px-3 py-1">
            <BarChart3 className="w-4 h-4 mr-1" />
            Analytics Ready
          </Badge>
          <Badge variant="secondary" className="text-sm px-3 py-1">
            <Search className="w-4 h-4 mr-1" />
            Advanced Filtering
          </Badge>
        </div>

        {loading && (
          <p className="text-gray-700 text-sm">Loading real API responses to generate live documentation examples...</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-4 justify-center">
        <Button onClick={downloadPostmanCollection} variant="outline" className="flex items-center gap-2">
          <Download className="w-4 h-4" />
          Download Postman Collection
        </Button>
        <Button asChild variant="outline" className="flex items-center gap-2">
          <a href="/api/workflow-recorder" target="_blank">
            <ExternalLink className="w-4 h-4" />
            Try API Live
          </a>
        </Button>
      </div>

      {/* API Overview Diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            API Structure
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 p-6 rounded-lg border-2 border-dashed border-gray-300">
            <div className="font-mono text-sm space-y-2">
              <div className="text-blue-600 font-bold">/api/workflow-recorder</div>
              <div className="ml-4 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">GET</Badge>
                  <span>List and filter events with pagination</span>
                </div>
              </div>
              
              <div className="text-blue-600 font-bold">/api/workflow-recorder/[eventId]</div>
              <div className="ml-4 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">GET</Badge>
                  <span>Get detailed event info with UI analysis</span>
                </div>
              </div>
              
              <div className="text-blue-600 font-bold">/api/workflow-recorder/sessions</div>
              <div className="ml-4 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">GET</Badge>
                  <span>Query sessions with aggregated metrics</span>
                </div>
              </div>
              
              <div className="text-blue-600 font-bold">/api/workflow-recorder/analytics</div>
              <div className="ml-4 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">GET</Badge>
                  <span>Get analytics and insights across time ranges</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main API Documentation */}
      <Tabs defaultValue="events" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="events" className="flex items-center gap-2">
            <Database className="w-4 h-4" />
            Events
          </TabsTrigger>
          <TabsTrigger value="event-details" className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            Event Details
          </TabsTrigger>
          <TabsTrigger value="sessions" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        {/* Events Tab */}
        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                List Events
              </CardTitle>
              <p className="text-gray-600">
                Query workflow recorder events with advanced filtering and pagination. 
                Access low-level UI tree data, user interactions, and application context.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Endpoint Info */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-blue-600">GET</Badge>
                  <code className="text-sm font-mono">/api/workflow-recorder</code>
                </div>
                <p className="text-sm text-blue-700">
                  Returns paginated list of workflow recorder events with metadata and filtering options.
                </p>
              </div>

              {/* Query Parameters */}
              <div>
                <h4 className="font-semibold mb-3">Query Parameters</h4>
                <div className="space-y-3">
                  {[
                    { name: 'page', type: 'integer', default: '1', description: 'Page number for pagination' },
                    { name: 'limit', type: 'integer', default: '50', description: 'Number of events per page (max 100)' },
                    { name: 'user_id', type: 'string', description: 'Filter by user ID' },
                    { name: 'session_id', type: 'string', description: 'Filter by session ID' },
                    { name: 'start_date', type: 'string', description: 'Filter events after this date (ISO 8601)' },
                    { name: 'end_date', type: 'string', description: 'Filter events before this date (ISO 8601)' },
                    { name: 'event_type', type: 'string', description: 'Filter by event type (ui_tree, interaction, etc.)' },
                    { name: 'application', type: 'string', description: 'Filter by application name (partial match)' }
                  ].map((param) => (
                    <div key={param.name} className="bg-gray-50 p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-sm font-mono text-blue-600">{param.name}</code>
                        <Badge variant="outline" className="text-xs">{param.type}</Badge>
                        {param.default && <Badge variant="secondary" className="text-xs">default: {param.default}</Badge>}
                      </div>
                      <p className="text-sm text-gray-600">{param.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Example Request */}
              <div>
                <h4 className="font-semibold mb-3">Example Request</h4>
                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span>curl</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(`curl -X GET "${window.location.origin}/api/workflow-recorder?user_id=22f84efc-3049-2fb8-22f8-4efc30492fb8&limit=10&event_type=ui_tree" \\
  -H "Accept: application/json"`, 'events-curl')}
                      className="text-gray-400 hover:text-white"
                    >
                      {copiedStates['events-curl'] ? '✓' : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div>
                    {`curl -X GET "${window.location.origin}/api/workflow-recorder?user_id=22f84efc-3049-2fb8-22f8-4efc30492fb8&limit=10&event_type=ui_tree" \\
  -H "Accept: application/json"`}
                  </div>
                </div>
              </div>

              {/* Example Response */}
              <div>
                <h4 className="font-semibold mb-3">Example Response</h4>
                {(() => {
                  const cachedExample = getCachedExample('/api/workflow-recorder');
                  if (cachedExample) {
                    return (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="bg-green-600">200 OK</Badge>
                          <span className="text-sm text-gray-600">
                            Response time: {cachedExample.executionTimeMs}ms
                          </span>
                        </div>
                        {formatJsonWithSyntaxHighlighting(cachedExample.responseBody)}
                      </div>
                    );
                  }
                  return (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <p className="text-gray-600 text-sm">
                        Live example will appear here once the API has been called.
                        <Button
                          variant="link"
                          asChild
                          className="p-0 ml-2 text-blue-600"
                        >
                          <a href="/api/workflow-recorder?limit=2" target="_blank">
                            Try it now →
                          </a>
                        </Button>
                      </p>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Event Details Tab */}
        <TabsContent value="event-details">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Get Event Details
              </CardTitle>
              <p className="text-gray-600">
                Get comprehensive details about a specific event including UI tree analysis, 
                interactive elements, and workflow development hints.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Endpoint Info */}
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-green-600">GET</Badge>
                  <code className="text-sm font-mono">/api/workflow-recorder/[eventId]</code>
                </div>
                <p className="text-sm text-green-700">
                  Returns detailed analysis of a specific event with UI element extraction and selector hints.
                </p>
              </div>

              {/* Path Parameters */}
              <div>
                <h4 className="font-semibold mb-3">Path Parameters</h4>
                <div className="bg-gray-50 p-3 rounded border">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono text-blue-600">eventId</code>
                    <Badge variant="outline" className="text-xs">string</Badge>
                    <Badge variant="destructive" className="text-xs">required</Badge>
                  </div>
                  <p className="text-sm text-gray-600">The unique identifier of the event to retrieve</p>
                </div>
              </div>

              {/* Query Parameters */}
              <div>
                <h4 className="font-semibold mb-3">Query Parameters</h4>
                <div className="bg-gray-50 p-3 rounded border">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono text-blue-600">include_raw</code>
                    <Badge variant="outline" className="text-xs">boolean</Badge>
                    <Badge variant="secondary" className="text-xs">default: false</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Include raw event data and complete UI tree in response</p>
                </div>
              </div>

              {/* Example Request */}
              <div>
                <h4 className="font-semibold mb-3">Example Request</h4>
                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span>curl</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(`curl -X GET "${window.location.origin}/api/workflow-recorder/52490?include_raw=true" \\
  -H "Accept: application/json"`, 'event-details-curl')}
                      className="text-gray-400 hover:text-white"
                    >
                      {copiedStates['event-details-curl'] ? '✓' : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div>
                    {`curl -X GET "${window.location.origin}/api/workflow-recorder/52490?include_raw=true" \\
  -H "Accept: application/json"`}
                  </div>
                </div>
              </div>

              {/* Use Cases */}
              <div>
                <h4 className="font-semibold mb-3">Common Use Cases</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      title: "Workflow Development",
                      description: "Extract UI selectors and element hints for building automation workflows",
                      icon: <Code className="w-5 h-5 text-blue-600" />
                    },
                    {
                      title: "UI Analysis",
                      description: "Analyze application UI complexity and interactive element patterns",
                      icon: <Search className="w-5 h-5 text-green-600" />
                    },
                    {
                      title: "Debugging Sessions",
                      description: "Investigate specific user interactions and UI states during recordings",
                      icon: <Play className="w-5 h-5 text-purple-600" />
                    },
                    {
                      title: "Context Discovery",
                      description: "Find related events and understand user workflow patterns",
                      icon: <Database className="w-5 h-5 text-orange-600" />
                    }
                  ].map((useCase, index) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg border">
                      <div className="flex items-center gap-3 mb-2">
                        {useCase.icon}
                        <h5 className="font-medium">{useCase.title}</h5>
                      </div>
                      <p className="text-sm text-gray-600">{useCase.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sessions Tab */}
        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Query Sessions
              </CardTitle>
              <p className="text-gray-600">
                Analyze workflow recorder sessions with aggregated metrics including duration, 
                event counts, and application usage patterns.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Endpoint Info */}
              <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-purple-600">GET</Badge>
                  <code className="text-sm font-mono">/api/workflow-recorder/sessions</code>
                </div>
                <p className="text-sm text-purple-700">
                  Returns aggregated session data with metrics for analyzing user workflow patterns.
                </p>
              </div>

              {/* Key Features */}
              <div>
                <h4 className="font-semibold mb-3">Session Analytics Features</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    {
                      title: "Duration Analysis",
                      description: "Track session length and user engagement time",
                      icon: <Calendar className="w-5 h-5 text-blue-600" />
                    },
                    {
                      title: "Event Aggregation", 
                      description: "Count and categorize events per session",
                      icon: <BarChart3 className="w-5 h-5 text-green-600" />
                    },
                    {
                      title: "Application Usage",
                      description: "Track which applications were used in each session",
                      icon: <Database className="w-5 h-5 text-purple-600" />
                    }
                  ].map((feature, index) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg border text-center">
                      <div className="flex justify-center mb-2">
                        {feature.icon}
                      </div>
                      <h5 className="font-medium mb-1">{feature.title}</h5>
                      <p className="text-sm text-gray-600">{feature.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Example Response Structure */}
              <div>
                <h4 className="font-semibold mb-3">Response Structure</h4>
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <pre className="text-sm text-gray-700">
{`{
  "success": true,
  "sessions": [
    {
      "session_id": "4e14c17c-56a1-4113-86f5-7eff024be975",
      "user_id": "22f84efc-3049-2fb8-22f8-4efc30492fb8",
      "start_time": "2025-06-25T10:56:43.616Z",
      "end_time": "2025-06-25T11:15:22.143Z",
      "duration_minutes": 18.6,
      "event_count": 47,
      "applications": ["Chrome", "VS Code", "Terminal"],
      "event_types": ["ui_tree", "interaction", "navigation"],
      "client_info": { ... },
      "endpoints": {
        "events": "/api/workflow-recorder?session_id=...",
        "timeline": "/api/workflow-recorder?session_id=...&start_date=...&end_date=..."
      }
    }
  ],
  "summary": {
    "total_sessions": 15,
    "avg_events_per_session": 32.4,
    "avg_session_duration_minutes": 14.2,
    "unique_applications": ["Chrome", "VS Code", "Terminal", "Slack"],
    "unique_users": ["user1", "user2"]
  }
}`}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Analytics & Insights
              </CardTitle>
              <p className="text-gray-600">
                Get comprehensive analytics across time ranges including user activity patterns, 
                UI complexity metrics, and workflow insights.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Endpoint Info */}
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-orange-600">GET</Badge>
                  <code className="text-sm font-mono">/api/workflow-recorder/analytics</code>
                </div>
                <p className="text-sm text-orange-700">
                  Returns aggregated analytics and insights across configurable time ranges.
                </p>
              </div>

              {/* Analytics Categories */}
              <div>
                <h4 className="font-semibold mb-3">Analytics Categories</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      title: "Activity Overview",
                      metrics: ["Total events", "Unique sessions", "Unique users", "Date range coverage"],
                      color: "blue"
                    },
                    {
                      title: "UI Complexity",
                      metrics: ["Avg elements per UI tree", "Interactive element ratio", "Max UI complexity", "UI tree count"],
                      color: "green"
                    },
                    {
                      title: "Session Patterns",
                      metrics: ["Avg events per session", "Session duration analysis", "Duration distribution", "Activity peaks"],
                      color: "purple"
                    },
                    {
                      title: "Usage Insights",
                      metrics: ["Most active users", "Popular applications", "Peak activity times", "Trend analysis"],
                      color: "orange"
                    }
                  ].map((category) => (
                    <div key={category.title} className="bg-gray-50 p-4 rounded-lg border">
                      <h5 className={`font-medium mb-3 text-${category.color}-600`}>{category.title}</h5>
                      <ul className="space-y-1">
                        {category.metrics.map((metric, index) => (
                          <li key={index} className="text-sm text-gray-600 flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full bg-${category.color}-400`}></div>
                            {metric}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Time Range Options */}
              <div>
                <h4 className="font-semibold mb-3">Time Range Options</h4>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: '1d', label: 'Last 24 hours' },
                    { value: '7d', label: 'Last 7 days' },
                    { value: '30d', label: 'Last 30 days' },
                    { value: '90d', label: 'Last 90 days' }
                  ].map((range) => (
                    <Badge key={range.value} variant="outline" className="text-sm px-3 py-1">
                      {range.label} (time_range={range.value})
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Example Request */}
              <div>
                <h4 className="font-semibold mb-3">Example Request</h4>
                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span>curl</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(`curl -X GET "${window.location.origin}/api/workflow-recorder/analytics?time_range=7d&application=Chrome" \\
  -H "Accept: application/json"`, 'analytics-curl')}
                      className="text-gray-400 hover:text-white"
                    >
                      {copiedStates['analytics-curl'] ? '✓' : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <div>
                    {`curl -X GET "${window.location.origin}/api/workflow-recorder/analytics?time_range=7d&application=Chrome" \\
  -H "Accept: application/json"`}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <h3 className="text-lg font-semibold">Ready to Start Querying?</h3>
            <p className="text-gray-600 max-w-2xl mx-auto">
              The Workflow Recorder API provides comprehensive access to low-level user interaction data. 
              Use these endpoints to build powerful workflow automation tools, analyze user behavior, and 
              extract insights from recorded sessions.
            </p>
            <div className="flex justify-center gap-4">
              <Button asChild>
                <a href="/api/workflow-recorder" target="_blank">
                  <Play className="w-4 h-4 mr-2" />
                  Try API Now
                </a>
              </Button>
              <Button variant="outline" onClick={downloadPostmanCollection}>
                <Download className="w-4 h-4 mr-2" />
                Get Postman Collection
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}