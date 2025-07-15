'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import mermaid from 'mermaid';

// Types for dynamic schema data
interface WorkflowSchema {
  id: number;
  name: string;
  description: string;
  estimated_duration_seconds?: number;
  input_parameters: Record<string, unknown>;
  sample_request: Record<string, unknown>;
  validation_rules: Record<string, unknown>;
  expected_outputs: Record<string, unknown>;
  api_info: {
    execute_endpoint: string;
    method: string;
    content_type: string;
    example_curl: string;
    example_javascript: string;
  };
  metadata: {
    parameter_count: number;
    has_conditional_logic: boolean;
  };
}

// Endpoint type for consistency
interface EndpointDefinition {
  id: string;
  method: string;
  path: string;
  title: string;
  description: string;
  queryParams?: Array<{
    name: string;
    type: string;
    optional: boolean;
    description: string;
  }>;
  requestBody?: string;
  response: string;
  workflowInfo?: {
    parameterCount: number;
    hasConditionalLogic: boolean;
    estimatedDuration?: number;
  };
}

export default function RemoteWorkflowsAPIDocsPage() {
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [workflowSchemas, setWorkflowSchemas] = useState<Record<number, WorkflowSchema>>({});
  const [loadingSchemas, setLoadingSchemas] = useState(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  
  useEffect(() => {
    mermaid.initialize({ 
      startOnLoad: true,
      theme: 'neutral',
      themeVariables: {
        primaryColor: '#fff',
        primaryTextColor: '#000',
        primaryBorderColor: '#000',
        lineColor: '#000',
        background: '#fff'
      }
    });
    
    if (mermaidRef.current) {
      mermaid.contentLoaded();
    }
  }, []);

  // Fetch workflow schemas dynamically
  useEffect(() => {
    const fetchWorkflowSchemas = async () => {
      try {
        setLoadingSchemas(true);
        console.log('🔄 Fetching workflow list for dynamic documentation...');
        
        // First, get the list of available workflows
        const listResponse = await fetch('/api/remote-workflows/list?limit=10');
        const listData = await listResponse.json();
        
        if (!listData.success || !listData.workflows) {
          throw new Error('Failed to fetch workflow list');
        }

        console.log(`📋 Found ${listData.workflows.length} workflows, fetching schemas...`);
        
        // Fetch schema for each workflow
        const schemaPromises = listData.workflows.map(async (workflow: { id: number }) => {
          try {
            const schemaResponse = await fetch(`/api/remote-workflows/${workflow.id}/schema`);
            const schemaData = await schemaResponse.json();
            
            if (schemaData.success) {
              return {
                id: workflow.id,
                schema: {
                  ...schemaData.workflow,
                  ...schemaData.schema,
                  api_info: schemaData.api_info,
                  metadata: schemaData.metadata
                }
              };
            } else {
              console.warn(`⚠️ Failed to fetch schema for workflow ${workflow.id}:`, schemaData.error);
              return null;
            }
          } catch (error) {
            console.warn(`⚠️ Error fetching schema for workflow ${workflow.id}:`, error);
            return null;
          }
        });

        const schemaResults = await Promise.all(schemaPromises);
        const schemas: Record<number, WorkflowSchema> = {};
        
        schemaResults.forEach(result => {
          if (result) {
            schemas[result.id] = result.schema;
          }
        });

        console.log(`✅ Successfully loaded ${Object.keys(schemas).length} workflow schemas`);
        setWorkflowSchemas(schemas);
        setSchemaError(null);
      } catch (error) {
        console.error('❌ Failed to fetch workflow schemas:', error);
        setSchemaError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoadingSchemas(false);
      }
    };

    fetchWorkflowSchemas();
  }, []);

  // Helper function to generate dynamic execute workflow endpoints from real schemas
  const generateExecuteWorkflowEndpoints = (schemas: Record<number, WorkflowSchema>) => {
    if (Object.keys(schemas).length === 0) {
      // Return static example if no schemas loaded yet
      return [{
        id: 'execute-workflow-loading',
        method: 'POST',
        path: '/api/remote-workflows/[workflowId]/execute',
        title: 'Execute Workflow (Loading...)',
        description: 'Loading real workflow schemas...',
        requestBody: `{
  "loading": "Fetching real workflow parameters..."
}`,
        response: `{
  "success": true,
  "execution_id": 44,
  "status": "queued",
  "message": "Workflow execution started successfully"
}`
      }];
    }

    // Generate endpoints for each workflow with real schemas
    return Object.values(schemas).map(schema => ({
      id: `execute-workflow-${schema.id}`,
      method: 'POST',
      path: `/api/remote-workflows/${schema.id}/execute`,
      title: `Execute Workflow: ${schema.name}`,
      description: `Triggers execution of "${schema.name}" workflow with the following parameters. ${schema.metadata.has_conditional_logic ? 'This workflow has conditional logic - some parameters may be required only for specific branches.' : ''}`,
      requestBody: JSON.stringify(schema.sample_request, null, 2),
      response: `{
  "success": true,
  "execution_id": 44,
  "workflow_id": ${schema.id},
  "workflow_name": "${schema.name}",
  "status": "queued",
  "modal_call_id": "modal_1751407955657_j9p0qn5ks",
  "created_at": "2025-01-01T20:12:35.657Z",
  "execution_mode": "async",
  "client_id": "web-1751407955657",
  "message": "Workflow execution queued successfully. Modal will process it within 10 seconds. Use execution ID 44 to monitor progress.",
  "endpoints": {
    "status": "/api/remote-workflows/executions/44",
    "results": "/api/remote-workflows/executions/44"
  }
}`,
      workflowInfo: {
        parameterCount: schema.metadata.parameter_count,
        hasConditionalLogic: schema.metadata.has_conditional_logic,
        estimatedDuration: schema.estimated_duration_seconds
      }
    }));
  };

  const mermaidDiagram = `
graph TB
    subgraph "Remote Workflows API"
        Root["/api/remote-workflows"]
        
        Root --> List["/list<br/>GET: List all workflows"]
        Root --> WF["/[workflowId]<br/>GET: Workflow details"]
        Root --> Exec["/executions<br/>GET: List executions"]
        
        WF --> Execute["/execute<br/>POST: Execute workflow"]
        
        Exec --> Live["/live<br/>GET: Live execution status"]
        Exec --> ExecDetail["/[executionId]<br/>GET: Execution details"]
        
        ExecDetail --> Status["/status<br/>GET: Redirects to /[executionId]"]
        ExecDetail --> Results["/results<br/>GET: Redirects to /[executionId]"]
    end
    
    style Root fill:#000,stroke:#000,color:#fff
    style List fill:#f9f9f9,stroke:#000
    style WF fill:#f9f9f9,stroke:#000
    style Exec fill:#f9f9f9,stroke:#000
    style Execute fill:#f9f9f9,stroke:#000
    style Live fill:#f9f9f9,stroke:#000
    style ExecDetail fill:#f9f9f9,stroke:#000
    style Status fill:#ddd,stroke:#666
    style Results fill:#ddd,stroke:#666
`;

  const endpoints: EndpointDefinition[] = [
    {
      id: 'list-workflows',
      method: 'GET',
      path: '/api/remote-workflows/list',
      title: 'List Workflows',
      description: 'Lists all available workflows with basic information and performance metrics.',
      queryParams: [
        { name: 'category', type: 'string', optional: true, description: 'Filter by workflow category' },
        { name: 'status', type: 'string', optional: true, description: 'Filter by status (default: "active")' },
        { name: 'limit', type: 'number', optional: true, description: 'Number of results per page (default: 50)' },
        { name: 'offset', type: 'number', optional: true, description: 'Pagination offset (default: 0)' }
      ],
      response: `{
  "success": true,
  "workflows": [
    {
      "id": 1,
      "name": "Best Plan Pro Insurance Quote",
      "description": "Automated life insurance quote generation",
      "version": "1.0.0",
      "status": "active",
      "category": "insurance",
      "tags": ["insurance", "quotes", "automation"],
      "difficulty_level": "medium",
      "estimated_duration_seconds": 90,
      "performance_metrics": {
        "successful_runs": 4,
        "failed_runs": 27,
        "total_executions": 31,
        "success_rate": 13
      },
      "is_executable": true,
      "deployment_status": "deployed",
      "endpoints": {
        "details": "/api/remote-workflows/1",
        "execute": "/api/remote-workflows/1/execute"
      }
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}`
    },
    {
      id: 'get-workflow-details',
      method: 'GET',
      path: '/api/remote-workflows/[workflowId]',
      title: 'Get Workflow Details',
      description: 'Retrieves comprehensive details about a specific workflow including automation sequence, validation checks, and recent executions.',
      response: `{
  "success": true,
  "workflow": {
    "id": 1,
    "name": "Best Plan Pro Insurance Quote",
    "description": "Automated life insurance quote generation",
    "version": "1.0.0",
    "status": "active",
    "trigger_info": {
      "endpoint": "/api/remote-workflows/1/execute",
      "method": "POST",
      "required_headers": ["Content-Type: application/json"],
      "modal_function": "execute_workflow",
      "deployment_status": "deployed",
      "is_executable": true
    },
    "automation_sequence": [
      {
        "action": "navigate",
        "url": "https://bestplanpro.com",
        "description": "Navigate to Best Plan Pro website"
      }
    ],
    "validation_checks": [
      {
        "name": "age_validation",
        "description": "Verify age is within acceptable range (18-75)",
        "type": "input_validation"
      }
    ],
    "error_handling": [
      {
        "error_type": "element_not_found",
        "action": "retry",
        "retry_count": 3
      }
    ],
    "input_parameters": {
      "state": {
        "type": "string",
        "required": true,
        "description": "State name"
      }
    },
    "performance_metrics": {
      "successful_runs": 4,
      "failed_runs": 27,
      "total_executions": 31,
      "success_rate": 13
    },
    "recent_executions": [],
    "usage_examples": {
      "curl_example": "curl -X POST...",
      "javascript_example": "fetch('/api/remote-workflows/1/execute'..."
    }
  }
}`
    },
    // Dynamic execute workflow endpoint - will be populated from real schemas
    ...generateExecuteWorkflowEndpoints(workflowSchemas),
    {
      id: 'list-executions',
      method: 'GET',
      path: '/api/remote-workflows/executions',
      title: 'List Executions',
      description: 'Lists workflow executions with filtering and pagination support.',
      queryParams: [
        { name: 'workflow_id', type: 'number', optional: true, description: 'Filter by workflow ID' },
        { name: 'status', type: 'string', optional: true, description: 'Filter by execution status' },
        { name: 'limit', type: 'number', optional: true, description: 'Results per page (default: 20)' },
        { name: 'offset', type: 'number', optional: true, description: 'Pagination offset (default: 0)' },
        { name: 'include_results', type: 'boolean', optional: true, description: 'Include full results (default: false)' }
      ],
      response: `{
  "success": true,
  "executions": [
    {
      "execution_id": 44,
      "workflow_id": 1,
      "workflow_name": "Best Plan Pro Insurance Quote",
      "workflow_category": "insurance",
      "status": "running",
      "progress_percentage": 50,
      "current_step": 8,
      "total_steps": 15,
      "started_at": "2025-01-01T20:12:35.657Z",
      "runtime_seconds": 45,
      "is_running": true,
      "is_successful": false,
      "has_error": false,
      "modal_call_id": "modal_1751407955657_j9p0qn5ks"
    }
  ],
  "summary": {
    "total_executions": 44,
    "by_status": {
      "running": 2,
      "failed": 40,
      "completed": 2
    }
  },
  "pagination": {
    "total": 44,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}`
    },
    {
      id: 'get-execution-details',
      method: 'GET',
      path: '/api/remote-workflows/executions/[executionId]',
      title: 'Get Execution Details',
      description: 'Retrieves complete details about a specific execution including logs, results, and formatted output.',
      response: `{
  "success": true,
  "execution": {
    "execution_id": 44,
    "workflow_id": 1,
    "workflow_name": "Best Plan Pro Insurance Quote",
    "status": "failed",
    "is_successful": false,
    "has_failed": true,
    "started_at": "2025-01-01T20:12:35.657Z",
    "completed_at": "2025-01-01T20:12:37.238Z",
    "execution_duration_seconds": 2,
    "error_message": "MCP Execution Failed",
    "execution_params": {
      "customer_info": {...}
    },
    "results": {
      "error_details": "MCP endpoint test failed",
      "execution_summary": {
        "workflow_completed": false
      }
    },
    "formatted_output": "❌ Workflow execution failed!\\n\\n📊 Error Summary...",
    "raw_data": {
      "raw_logs": "Starting workflow execution...",
      "raw_mcp_response": {...},
      "execution_logs": []
    },
    "summary": {
      "execution_successful": false,
      "workflow_completed": false,
      "steps_completed": 0,
      "error_stage": "mcp_connection"
    }
  }
}`
    },
    {
      id: 'live-execution-status',
      method: 'GET',
      path: '/api/remote-workflows/executions/live',
      title: 'Live Execution Status',
      description: 'Retrieves real-time status of running executions with optimized performance metrics for monitoring dashboards.',
      queryParams: [
        { name: 'status', type: 'string', optional: true, description: 'Filter by status ("active" for running/queued)' },
        { name: 'workflow_id', type: 'number', optional: true, description: 'Filter by workflow ID' },
        { name: 'limit', type: 'number', optional: true, description: 'Max results (default: 50)' }
      ],
      response: `{
  "success": true,
  "data": {
    "executions": [
      {
        // Basic identification
        "id": 44,
        "workflow_id": 1,
        "workflow_name": "Best Plan Pro Insurance Quote",
        "workflow_description": "Automated life insurance quote generation",
        
        // Status and progress
        "status": "running",
        "progress_percentage": 75,
        "current_step_index": 12,
        "total_steps": 15,
        "current_step_description": "Extracting quote results",
        
        // Timing information
        "step_start_time": "2025-01-01T20:13:00.000Z",
        "estimated_completion_time": "2025-01-01T20:14:30.000Z",
        "started_at": "2025-01-01T20:12:35.657Z",
        "created_at": "2025-01-01T20:12:30.000Z",
        "execution_duration_seconds": 45,
        "runtime_seconds": 45,
        
        // Performance metrics (calculated in real-time)
        "estimated_seconds_remaining": 22,
        "steps_per_minute": 8.5,
        
        // System identifiers
        "modal_call_id": "modal_1751407955657_j9p0qn5ks",
        "client_id": "web-1751407955657",
        "status_priority": 1
      }
    ],
    "summary": {
      "total_active": 2,
      "total_running": 2,
      "total_queued": 0,
      "average_progress": 75,
      "timestamp": "2025-01-01T20:13:15.000Z"
    }
  }
}`
    }
  ];

  const getMethodBadge = (method: string) => {
    const colors = {
      GET: 'bg-black text-white',
      POST: 'bg-gray-700 text-white',
      PUT: 'bg-gray-600 text-white',
      DELETE: 'bg-red-600 text-white'
    };
    return colors[method as keyof typeof colors] || 'bg-gray-500 text-white';
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <Card className="p-8 border-black">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">Remote Workflows API Documentation</h1>
          <span className="text-sm text-gray-500">Jul 1, 2025</span>
        </div>
        <p className="text-muted-foreground mb-4">Complete API reference for remote workflow management and execution</p>
        
        {/* Dynamic Schema Status - only show when there are issues */}
        {loadingSchemas && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-700 text-sm">🔄 Loading real workflow schemas to generate accurate documentation...</p>
          </div>
        )}
        
        {schemaError && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-700 text-sm">⚠️ Could not load dynamic schemas: {schemaError}. Showing static examples.</p>
          </div>
        )}
        
        {/* Mermaid Diagram */}
        <div className="mb-12 p-6 bg-gray-50 rounded-lg border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">API Structure</h2>
          <pre className="mermaid">
{mermaidDiagram}
          </pre>
        </div>
        
        {/* Overview Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Overview</h2>
          <p className="text-gray-700 mb-4">
            The Remote Workflows API provides endpoints for managing and executing automated workflows. 
            All endpoints are prefixed with <code className="bg-gray-100 px-2 py-1 rounded text-sm">/api/remote-workflows</code>.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <h3 className="font-semibold mb-2">Status Codes</h3>
              <ul className="text-sm space-y-1">
                <li><code className="bg-gray-100 px-1">200</code> - Success</li>
                <li><code className="bg-gray-100 px-1">400</code> - Bad Request</li>
                <li><code className="bg-gray-100 px-1">404</code> - Not Found</li>
                <li><code className="bg-gray-100 px-1">500</code> - Server Error</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Rate Limiting</h3>
              <ul className="text-sm space-y-1">
                <li>List endpoints: 100 req/min</li>
                <li>Execute endpoints: 10 req/min per workflow</li>
                <li>Status polling: 120 req/min</li>
              </ul>
            </div>
          </div>
        </div>
        
        {/* API Endpoints with Accordion */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">API Endpoints</h2>
          <Accordion type="single" collapsible className="space-y-2">
            {endpoints.map((endpoint) => (
              <AccordionItem key={endpoint.id} value={endpoint.id} className="border border-gray-200 rounded-lg">
                <AccordionTrigger className="px-6 hover:no-underline hover:bg-gray-50">
                  <div className="flex items-center gap-3 text-left">
                    <Badge className={getMethodBadge(endpoint.method)}>
                      {endpoint.method}
                    </Badge>
                    <code className="text-sm font-mono">{endpoint.path}</code>
                    <span className="text-gray-600 ml-2">{endpoint.title}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-6">
                  <p className="text-gray-700 mb-4">{endpoint.description}</p>
                  
                  {/* Query Parameters */}
                  {endpoint.queryParams && (
                    <div className="mb-6">
                      <h4 className="font-semibold mb-2">Query Parameters:</h4>
                      <div className="space-y-2">
                        {endpoint.queryParams.map((param) => (
                          <div key={param.name} className="flex items-start gap-2 text-sm">
                            <code className="bg-gray-100 px-2 py-1 rounded">{param.name}</code>
                            <span className="text-gray-600">
                              ({param.type}{param.optional && ', optional'}) - {param.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Request Body */}
                  {endpoint.requestBody && (
                    <div className="mb-6">
                      <h4 className="font-semibold mb-2">Request Body:</h4>
                      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                        <code className="text-sm">{endpoint.requestBody}</code>
                      </pre>
                    </div>
                  )}
                  
                  {/* Response */}
                  <div>
                    <h4 className="font-semibold mb-2">Response:</h4>
                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                      <code className="text-sm">{endpoint.response}</code>
                    </pre>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Card>
    </div>
  );
} 