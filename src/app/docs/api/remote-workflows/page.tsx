'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ui/code-block';
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

// Types for validation rules
interface ValidationRule {
  type?: string;
  required?: boolean;
  description?: string;
  options?: string[] | Array<{value: string; label: string}>;
  conditional?: boolean;
  branches?: string[];
  regex?: string;
  validation_message?: string;
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
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('overview');
  
  // New state for dynamic API responses
  const [dynamicResponses, setDynamicResponses] = useState<Record<string, string>>({});
  const [loadingResponses, setLoadingResponses] = useState(false);
  
  // Copy-to-clipboard state
  const [copiedStates, setCopiedStates] = useState<Record<string, string>>({});
  
  // Copy to clipboard utility function
  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [key]: 'Copied!' }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [key]: '' }));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopiedStates(prev => ({ ...prev, [key]: 'Failed' }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [key]: '' }));
      }, 2000);
    }
  };
  
  // Generate dynamic request examples
  const generateRequestExamples = (endpoint: EndpointDefinition) => {
    const baseUrl = 'https://app.mediar.ai';
    let fullUrl = `${baseUrl}${endpoint.path}`;

    // Add query parameters for GET requests
    if (endpoint.method === 'GET' && endpoint.queryParams) {
      const params = new URLSearchParams();
      endpoint.queryParams.forEach(param => {
        if (param.name === 'status') params.append(param.name, 'active');
        else if (param.name === 'limit') params.append(param.name, '50');
        else if (param.name === 'workflow_id') params.append(param.name, '1');
      });
      const queryString = params.toString();
      if (queryString) fullUrl += `?${queryString}`;
    }

    // Replace path parameters with real values
    if (fullUrl.includes('[workflowId]')) {
      const workflowId = Object.keys(workflowSchemas).length > 0 ? Object.keys(workflowSchemas)[0] : '1';
      fullUrl = fullUrl.replace('[workflowId]', workflowId);
    }
    if (fullUrl.includes('[executionId]')) {
      fullUrl = fullUrl.replace('[executionId]', '3856');
    }
    
    // Generate curl command
    const generateCurl = () => {
      let curl = `curl -X ${endpoint.method} "${fullUrl}"`;
      
      if (endpoint.method !== 'GET') {
        curl += ` \\\n  -H "Content-Type: application/json"`;
      }
      
      if (endpoint.requestBody) {
        // The requestBody should already have parameters wrapped, so use it directly
        curl += ` \\\n  -d '${endpoint.requestBody}'`;
      }
      
      return curl;
    };
    
    // Generate JavaScript fetch example
    const generateJavaScript = () => {
      let js = `const response = await fetch('${fullUrl}'`;
      
      if (endpoint.method !== 'GET' || endpoint.requestBody) {
        js += `, {\n  method: '${endpoint.method}'`;
        if (endpoint.method !== 'GET') {
          js += `,\n  headers: {\n    'Content-Type': 'application/json'\n  }`;
        }
        if (endpoint.requestBody) {
          // Parse and re-stringify to ensure valid JSON - requestBody should already be properly formatted
          try {
            const parsedBody = JSON.parse(endpoint.requestBody);
            js += `,\n  body: JSON.stringify(${JSON.stringify(parsedBody, null, 4)})`;
          } catch {
            js += `,\n  body: JSON.stringify(${endpoint.requestBody})`;
          }
        }
        js += `\n}`;
      }
      
      js += `);\nconst data = await response.json();\nconsole.log(data);`;
      return js;
    };
    
    // Generate complete Postman collection
    const generatePostman = () => {
      const urlParts = new URL(fullUrl);
      const postmanRequestItem = {
        name: endpoint.title,
        request: {
          method: endpoint.method,
          header: endpoint.method !== 'GET' ? [
            {
              key: "Content-Type",
              value: "application/json"
            }
          ] : [],
          url: {
            raw: fullUrl,
            protocol: urlParts.protocol.replace(':', ''),
            host: [urlParts.hostname],
            port: urlParts.port || (urlParts.protocol === 'https:' ? '443' : '80'),
            path: urlParts.pathname.split('/').filter(p => p),
            query: urlParts.search ? urlParts.search.substring(1).split('&').map(param => {
              const [key, value] = param.split('=');
              return { key, value };
            }) : []
          },
          body: endpoint.requestBody ? {
            mode: "raw",
            raw: endpoint.requestBody,
            options: {
              raw: {
                language: "json"
              }
            }
          } : undefined
        },
        response: []
      };

      // Create complete Postman collection structure
      const postmanCollection = {
        info: {
          name: "Remote Workflows API Collection",
          description: `Collection for ${endpoint.title} - Generated from Mediar API documentation`,
          schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        item: [postmanRequestItem]
      };
      
      return JSON.stringify(postmanCollection, null, 2);
    };
    
    return {
      curl: generateCurl(),
      javascript: generateJavaScript(),
      postman: generatePostman()
    };
  };

  // Generate complete collection with all endpoints
  const generateCompleteCollection = () => {
    const baseUrl = 'https://app.mediar.ai';
    const allRequestItems = [];

    // Process all static endpoints (excluding execute endpoints since we add them dynamically)
    endpoints.filter(endpoint => !endpoint.path.includes('/execute')).forEach(endpoint => {
      let fullUrl = `${baseUrl}${endpoint.path}`;

      // Add query parameters for GET requests
      if (endpoint.method === 'GET' && endpoint.queryParams) {
        const params = new URLSearchParams();
        endpoint.queryParams.forEach(param => {
          if (param.name === 'status') params.append(param.name, 'active');
          else if (param.name === 'limit') params.append(param.name, '50');
          else if (param.name === 'workflow_id') params.append(param.name, '1');
        });
        const queryString = params.toString();
        if (queryString) fullUrl += `?${queryString}`;
      }

      // Replace path parameters with real values
      if (fullUrl.includes('[workflowId]')) {
        const workflowId = Object.keys(workflowSchemas).length > 0 ? Object.keys(workflowSchemas)[0] : '1';
        fullUrl = fullUrl.replace('[workflowId]', workflowId);
      }
      if (fullUrl.includes('[executionId]')) {
        fullUrl = fullUrl.replace('[executionId]', '3856');
      }

      const urlParts = new URL(fullUrl);
      const postmanRequestItem = {
        name: endpoint.title,
        request: {
          method: endpoint.method,
          header: endpoint.method !== 'GET' ? [
            {
              key: "Content-Type",
              value: "application/json"
            }
          ] : [],
          url: {
            raw: fullUrl,
            protocol: urlParts.protocol.replace(':', ''),
            host: [urlParts.hostname],
            port: urlParts.port || (urlParts.protocol === 'https:' ? '443' : '80'),
            path: urlParts.pathname.split('/').filter(p => p),
            query: urlParts.search ? urlParts.search.substring(1).split('&').map(param => {
              const [key, value] = param.split('=');
              return { key, value };
            }) : []
          },
          body: endpoint.requestBody ? {
            mode: "raw",
            raw: endpoint.requestBody,
            options: {
              raw: {
                language: "json"
              }
            }
          } : undefined
        },
        response: []
      };

      allRequestItems.push(postmanRequestItem);
    });

    // Add dynamic execute workflow endpoint if available
    if (Object.keys(workflowSchemas).length > 0) {
      const workflowId = Object.keys(workflowSchemas)[0];
      const schema = workflowSchemas[parseInt(workflowId)];
      
      if (schema && schema.name) {
        const executeUrl = `${baseUrl}/api/remote-workflows/${workflowId}/execute`;
        const executeUrlParts = new URL(executeUrl);
        
        // Generate sample request body from schema - wrap parameters under "parameters" key
        let sampleBody = '';
        if (schema.sample_request) {
          // Wrap the sample_request under "parameters" key to match execute endpoint expectation
          const wrappedRequest = {
            parameters: schema.sample_request
          };
          sampleBody = JSON.stringify(wrappedRequest, null, 2);
        } else if (schema.input_parameters) {
          const sample: Record<string, unknown> = {};
          Object.entries(schema.input_parameters).forEach(([key, param]) => {
            if (param && typeof param === 'object' && 'default' in param) {
              sample[key] = (param as { default: unknown }).default;
            }
          });
          // Wrap the sample under "parameters" key
          const wrappedRequest = {
            parameters: sample
          };
          sampleBody = JSON.stringify(wrappedRequest, null, 2);
        }

        const executeRequestItem = {
          name: `Execute Workflow: ${schema.name}`,
          request: {
            method: "POST",
            header: [
              {
                key: "Content-Type",
                value: "application/json"
              }
            ],
            url: {
              raw: executeUrl,
              protocol: executeUrlParts.protocol.replace(':', ''),
              host: [executeUrlParts.hostname],
              port: executeUrlParts.port || "443",
              path: executeUrlParts.pathname.split('/').filter(p => p),
              query: []
            },
            body: sampleBody ? {
              mode: "raw",
              raw: sampleBody,
              options: {
                raw: {
                  language: "json"
                }
              }
            } : undefined
          },
          response: []
        };

        allRequestItems.push(executeRequestItem);
      }
    }

    // Create complete collection structure
    const completeCollection = {
      info: {
        name: "Remote Workflows API - Complete Collection",
        description: "Complete API collection with all Remote Workflows endpoints - Generated from Mediar API documentation",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      item: allRequestItems
    };
    
    return JSON.stringify(completeCollection, null, 2);
  };

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

  // Fetch real API responses for documentation examples
  useEffect(() => {
    const fetchDynamicResponses = async () => {
      try {
        setLoadingResponses(true);
        console.log('🔄 Fetching real API responses for documentation...');
        
        const responses: Record<string, string> = {};

        // Fetch execution details from a recent execution
        try {
          const executionsResponse = await fetch('/api/remote-workflows/executions?limit=1');
          const executionsData = await executionsResponse.json();
          
          if (executionsData.success && executionsData.executions.length > 0) {
            const latestExecution = executionsData.executions[0];
            const detailsResponse = await fetch(`/api/remote-workflows/executions/${latestExecution.execution_id}`);
            const detailsData = await detailsResponse.json();
            
            if (detailsData.success) {
              responses['get-execution-details'] = JSON.stringify(detailsData, null, 2);
              console.log('✅ Fetched real execution details response');
            }
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch execution details:', error);
        }

        // Fetch list executions response
        try {
          const listResponse = await fetch('/api/remote-workflows/executions?limit=2');
          const listData = await listResponse.json();
          
          if (listData.success) {
            responses['list-executions'] = JSON.stringify(listData, null, 2);
            console.log('✅ Fetched real executions list response');
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch executions list:', error);
        }

        // Fetch live execution status
        try {
          const liveResponse = await fetch('/api/remote-workflows/executions/live?limit=10');
          const liveData = await liveResponse.json();
          
          if (liveData.success) {
            responses['live-execution-status'] = JSON.stringify(liveData, null, 2);
            console.log('✅ Fetched real live execution status response');
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch live executions:', error);
        }

        // Fetch workflow list response
        try {
          const workflowsResponse = await fetch('/api/remote-workflows/list?limit=2');
          const workflowsData = await workflowsResponse.json();
          
          if (workflowsData.success) {
            responses['list-workflows'] = JSON.stringify(workflowsData, null, 2);
            console.log('✅ Fetched real workflows list response');
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch workflows list:', error);
        }

        // Fetch workflow details (use first available workflow)
        if (Object.keys(workflowSchemas).length > 0) {
          const firstWorkflowId = Object.keys(workflowSchemas)[0];
          try {
            const workflowResponse = await fetch(`/api/remote-workflows/${firstWorkflowId}`);
            const workflowData = await workflowResponse.json();
            
            if (workflowData.success) {
              responses['get-workflow-details'] = JSON.stringify(workflowData, null, 2);
              console.log('✅ Fetched real workflow details response');
            }
          } catch (error) {
            console.warn('⚠️ Could not fetch workflow details:', error);
          }
        }

        console.log(`✅ Successfully loaded ${Object.keys(responses).length} dynamic API responses`);
        setDynamicResponses(responses);
      } catch (error) {
        console.error('❌ Failed to fetch dynamic responses:', error);
      } finally {
        setLoadingResponses(false);
      }
    };

    // Only fetch responses after schemas are loaded (so we have workflow IDs)
    if (!loadingSchemas && Object.keys(workflowSchemas).length > 0) {
      fetchDynamicResponses();
    }
  }, [loadingSchemas, workflowSchemas]);

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
      requestBody: JSON.stringify({ parameters: schema.sample_request }, null, 2),
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
        { name: 'include_results', type: 'boolean', optional: true, description: 'Controls output detail level and response speed. FALSE (default): ⚡ Fast concise response (~50ms) with formatted_output only - optimized for real-time dashboards and user displays. TRUE: 🐌 Slower detailed response (~200ms+) including execution_params and full results - only use when debugging or needing complete execution data. For performance-critical apps, always use FALSE.' }
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
    "request_parameters": {
      "original_request": {
        "customer_info": {
          "state": "California",
          "height": "5'10\\"",
          "weight": "180",
          "zip_code": "90210",
          "date_of_birth": "01/15/1985"
        },
        "insurance_preferences": {
          "gender": "Male",
          "nicotine": "Never",
          "face_value": "$100,000"
        }
      },
      "api_parameter_names": {
        "expected_parameter_names": [
          "applicant_dob",
          "product_types", 
          "applicant_state",
          "applicant_gender",
          "applicant_height",
          "applicant_weight",
          "registration_key",
          "applicant_zip_code",
          "registration_email",
          "policy_coverage_type",
          "open_enrollment_status",
          "applicant_tobacco_usage",
          "quote_type",
          "quote_value"
        ],
        "actual_parameter_names": [
          "customer_info",
          "insurance_preferences"
        ],
        "parameter_count_match": false,
        "schema_endpoint": "/api/remote-workflows/1/schema",
        "docs_endpoint": "/docs/api/remote-workflows"
      },
      "parameter_count": 2,
      "note": "Use 'original_request' to see exactly what was sent. Check API docs for current parameter schema."
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
        { name: 'limit', type: 'number', optional: true, description: 'Maximum number of executions to return (default: 50). Example: ?limit=10 for dashboard widgets.' }
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
      GET: 'bg-white text-black border border-black',
      POST: 'bg-black text-white border border-black',
      PUT: 'bg-white text-black border border-black',
      DELETE: 'bg-white text-black border border-black font-bold'
    };
    return colors[method as keyof typeof colors] || 'bg-white text-black border border-black';
  };

  // Component to display parameter validation rules
  const ParameterValidationTable = ({ validationRules }: { validationRules: Record<string, ValidationRule> }) => {
    if (!validationRules || Object.keys(validationRules).length === 0) {
      return (
        <div className="text-sm text-gray-600 italic">
          No validation rules available for this workflow.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full border border-black text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-black px-3 py-2 text-left font-medium">Parameter</th>
              <th className="border border-black px-3 py-2 text-left font-medium">Type</th>
              <th className="border border-black px-3 py-2 text-center font-medium">Required</th>
              <th className="border border-black px-3 py-2 text-left font-medium">Validation</th>
              <th className="border border-black px-3 py-2 text-left font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(validationRules).map(([param, rule]) => (
              <tr key={param} className="hover:bg-gray-50">
                <td className="border border-black px-3 py-2">
                  <code className="bg-gray-100 px-1 py-0.5 rounded text-xs border border-black">{param}</code>
                </td>
                <td className="border border-black px-3 py-2">
                  <Badge variant="outline" className="text-xs border-black">
                    {rule.type || 'string'}
                  </Badge>
                  {rule.conditional && (
                    <Badge variant="secondary" className="text-xs ml-1 border-black">
                      Conditional
                    </Badge>
                  )}
                </td>
                <td className="border border-black px-3 py-2 text-center">
                  {rule.required ? (
                    <span className="text-black font-medium">true</span>
                  ) : (
                    <span className="text-gray-600">false</span>
                  )}
                </td>
                <td className="border border-black px-3 py-2">
                  <div className="space-y-1">
                    {rule.regex && (
                      <div>
                        <div className="text-xs text-gray-600">Pattern:</div>
                        <code className="bg-gray-100 px-1 py-0.5 rounded text-xs break-all border border-black">
                          {rule.regex}
                        </code>
                      </div>
                    )}
                    {rule.options && (
                      <div>
                        <div className="text-xs text-gray-600">Options:</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(Array.isArray(rule.options) ? rule.options : []).map((option, idx) => {
                            const optionValue = typeof option === 'string' ? option : option.value;
                            return (
                              <Badge key={idx} variant="outline" className="text-xs border-black">
                                {optionValue}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {rule.branches && (
                      <div>
                        <div className="text-xs text-gray-600">Controls:</div>
                        <div className="text-xs text-gray-800">
                          {rule.branches.join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                </td>
                <td className="border border-black px-3 py-2">
                  <div className="text-xs text-gray-700">
                    {rule.description}
                    {rule.validation_message && (
                      <div className="text-black mt-1 italic">
                        {rule.validation_message}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Render different sections based on selectedEndpoint
  const renderContent = () => {
    if (selectedEndpoint === 'overview') {
      return (
        <div className="max-w-4xl">
          <h1 className="text-3xl font-bold mb-2">Remote Workflows API Documentation</h1>
          <span className="text-sm text-gray-500 mb-4 block">Jul 15, 2025</span>
          <p className="text-muted-foreground mb-8">Complete API reference for remote workflow management and execution</p>
          
          {/* Dynamic Schema Status - only show when there are issues */}
          {loadingSchemas && (
            <div className="mb-4 p-3 bg-gray-50 border border-black rounded-lg">
              <div className="flex items-center gap-3">
                <div className="animate-spin">
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full"></div>
                </div>
                <p className="text-gray-700 text-sm">Loading real workflow schemas to generate accurate documentation...</p>
              </div>
              <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div className="bg-black h-full rounded-full animate-pulse" style={{width: '40%'}}></div>
              </div>
            </div>
          )}
          
          {schemaError && (
            <div className="mb-4 p-3 bg-gray-100 border border-black rounded-lg">
              <p className="text-gray-800 text-sm">⚠️ Could not load dynamic schemas: {schemaError}. Showing static examples.</p>
            </div>
          )}

          {/* Dynamic Response Status - only show when there are issues */}
          {loadingResponses && (
            <div className="mb-4 p-3 bg-gray-50 border border-black rounded-lg">
              <div className="flex items-center gap-3">
                <div className="animate-spin">
                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full"></div>
                </div>
                <p className="text-gray-700 text-sm">Loading real API responses to generate live documentation examples...</p>
              </div>
              <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div className="bg-black h-full rounded-full animate-pulse" style={{width: '60%'}}></div>
              </div>
            </div>
          )}
          
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
          
          {/* Mermaid Diagram */}
          <div className="mb-12 p-6 bg-gray-50 rounded-lg border border-black">
            <h2 className="text-xl font-semibold mb-4">API Structure</h2>
            <pre className="mermaid">
{mermaidDiagram}
            </pre>
          </div>

          {/* Complete Postman Collection Button */}
          <div className="mt-8 p-4 bg-gray-50 border border-black rounded-lg">
            <h3 className="text-lg font-semibold mb-3">Download Complete Postman Collection</h3>
            <p className="text-sm text-gray-700 mb-3">
              Postman collection containing all available endpoints.
              To import press Import button in Postman and paste from clipboard, then press Enter.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => copyToClipboard(generateCompleteCollection(), 'complete-postman-collection')}
                className="px-4 py-2 bg-black text-white border border-black rounded hover:bg-gray-800 transition-colors text-sm font-medium"
              >
                {copiedStates['complete-postman-collection'] || '📋 Copy Complete Postman Collection of Example Requests'}
              </button>
              <button
                onClick={() => window.open('https://www.postman.com/matt-3648038/mediar-deployed-workflows-workspace/overview', '_blank')}
                className="px-4 py-2 bg-white text-black border border-black rounded hover:bg-black hover:text-white transition-colors text-sm font-medium"
              >
                🚀 Open Postman Workspace
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Find the selected endpoint
    const endpoint = endpoints.find(ep => ep.id === selectedEndpoint);
    if (!endpoint) return null;

    // Use dynamic response if available, otherwise use static example
    const response = dynamicResponses[endpoint.id] || endpoint.response;

    return (
      <div className="max-w-4xl">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <Badge className={getMethodBadge(endpoint.method)}>
              {endpoint.method}
            </Badge>
            <code className="text-lg font-mono">{endpoint.path}</code>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{endpoint.title}</h1>
          <p className="text-gray-700 mt-2">{endpoint.description}</p>
        </div>

        {/* Query Parameters */}
        {endpoint.queryParams && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-3">Query Parameters</h3>
            <div className="space-y-3">
              {endpoint.queryParams.map((param) => (
                <div key={param.name} className="border border-black rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono border border-black">{param.name}</code>
                    <span className="text-xs text-gray-500">({param.type}{param.optional && ', optional'})</span>
                  </div>
                  <p className="text-sm text-gray-600">{param.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Parameter Validation Section - only for execute endpoints */}
        {endpoint.id.startsWith('execute-workflow-') && endpoint.workflowInfo && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-3">Parameter Validation</h3>
            {(() => {
              const workflowId = endpoint.id.replace('execute-workflow-', '');
              const workflowSchema = workflowSchemas[parseInt(workflowId)];
              if (workflowSchema && workflowSchema.validation_rules) {
                return <ParameterValidationTable validationRules={workflowSchema.validation_rules as Record<string, ValidationRule>} />;
              }
              return (
                <div className="flex items-center gap-3 p-4 bg-gray-50 border border-black rounded-lg">
                  <div className="animate-spin">
                    <div className="w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full"></div>
                  </div>
                  <span className="text-sm text-gray-600 italic">Loading validation rules...</span>
                </div>
              );
            })()}
          </div>
        )}
        
        {/* Request Body */}
        {endpoint.requestBody && (
          <div className="mb-8">
            <CodeBlock
              language="json"
              title="Request Body"
              size="sm"
            >
              {endpoint.requestBody}
            </CodeBlock>
          </div>
        )}
        
        {/* Request Examples - Copy to Clipboard */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-3">Request Examples</h3>
          {(() => {
            const examples = generateRequestExamples(endpoint);
            return (
              <div className="space-y-4">
                {/* curl Example */}
                <div>
                  <CodeBlock
                    language="curl"
                    title="curl"
                    size="sm"
                  >
                    {examples.curl}
                  </CodeBlock>
                </div>
                
                {/* JavaScript Example */}
                <div>
                  <CodeBlock
                    language="javascript"
                    title="JavaScript"
                    size="sm"
                  >
                    {examples.javascript}
                  </CodeBlock>
                </div>
                
                {/* Postman Example */}
                <div>
                  <CodeBlock
                    language="json"
                    title="Postman Collection"
                    size="sm"
                  >
                    {examples.postman}
                  </CodeBlock>
                </div>
              </div>
            );
          })()}
        </div>
        
        {/* Response */}
        {endpoint.response && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-3">Response</h3>
            
            {/* Show indicator only when using static data */}
            {!dynamicResponses[endpoint.id] && (
              <div className="mb-2 px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs text-gray-600">
                📝 STATIC: Example response (live data not available)
              </div>
            )}
            
            <CodeBlock
              language="json"
              size="sm"
            >
              {response}
            </CodeBlock>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-black flex-shrink-0 fixed left-0 top-0 h-full overflow-y-auto">
        <div className="p-6 border-b border-black">
          <h2 className="text-lg font-semibold text-gray-900">API Reference</h2>
          <p className="text-sm text-gray-600 mt-1">Remote Workflows API</p>
        </div>
        
        <nav className="p-4">
          {/* Overview */}
          <div className="mb-6">
            <button
              onClick={() => setSelectedEndpoint('overview')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-black ${
                selectedEndpoint === 'overview'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-black hover:bg-gray-50'
              }`}
            >
              Overview
            </button>
          </div>

          {/* Endpoints */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Endpoints</h3>
            <div className="space-y-1">
              {endpoints.map((endpoint) => (
                <button
                  key={endpoint.id}
                  onClick={() => setSelectedEndpoint(endpoint.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-colors border border-black ${
                    selectedEndpoint === endpoint.id
                      ? 'bg-black text-white border-black'
                      : 'bg-white text-black border-black hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className={`${getMethodBadge(endpoint.method)} text-xs`}>
                      {endpoint.method}
                    </Badge>
                    <span className="text-sm font-medium truncate">{endpoint.title}</span>
                  </div>
                  <code className="text-xs text-gray-500 font-mono block truncate">
                    {endpoint.path}
                  </code>
                </button>
              ))}
            </div>
          </div>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto ml-80">
        <div className="p-8">
          {renderContent()}
        </div>
      </div>
    </div>
  );
} 