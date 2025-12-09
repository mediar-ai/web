'use client';

import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ui/code-block';
import { Menu, X } from 'lucide-react';
import mermaid from 'mermaid';
import { useEffect, useRef, useState } from 'react';

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
  
  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
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
  
  // Generate intelligent sample values for different parameter types
  const generateSampleValue = (type: string, name: string): string => {
    if (type === 'boolean') {
      // Use context-aware boolean values
      if (name.includes('detailed') || name.includes('full')) return 'true';
      if (name.includes('include') || name.includes('results')) return 'false';
      return 'true';
    }
    
    if (type === 'number') {
      if (name.includes('limit')) return '10';
      if (name.includes('offset')) return '0';
      if (name.includes('workflow_id')) return '1';
      if (name.includes('execution_id')) return '44';
      return '1';
    }
    
    if (type === 'string') {
      if (name.includes('status')) return 'active';
      if (name.includes('category')) return 'insurance';
      if (name.includes('method')) return 'POST';
      return 'example';
    }
    
    return 'value';
  };

  // Generate dynamic URL examples for endpoint parameters
  const generateUrlExamples = (endpoint: EndpointDefinition) => {
    const baseUrl = 'https://app.mediar.ai';
    let basePath = endpoint.path;
    
    // Replace path parameters with real values
    if (basePath.includes('[workflowId]')) {
      const workflowId = Object.keys(workflowSchemas).length > 0 ? Object.keys(workflowSchemas)[0] : '1';
      basePath = basePath.replace('[workflowId]', workflowId);
    }
    if (basePath.includes('[executionId]')) {
      basePath = basePath.replace('[executionId]', '3856');
    }
    
    const fullBasePath = `${baseUrl}${basePath}`;
    
    if (!endpoint.queryParams || endpoint.queryParams.length === 0) {
      return [];
    }

    const examples = [];
    
    // 1. Default behavior (no parameters)
    examples.push({
      label: 'Default',
      url: fullBasePath,
      description: 'No parameters (uses defaults)'
    });

    // 2. Single parameter examples for each parameter
    endpoint.queryParams.forEach(param => {
      const sampleValue = generateSampleValue(param.type, param.name);
      examples.push({
        label: `Single parameter: ${param.name}`,
        url: `${fullBasePath}?${param.name}=${sampleValue}`,
        description: `Using ${param.name}=${sampleValue}`
      });
    });

    // 3. Common combinations
    if (endpoint.queryParams.length >= 2) {
      // For list endpoints, show limit + status/workflow_id
      const hasLimit = endpoint.queryParams.find(p => p.name === 'limit');
      const hasStatus = endpoint.queryParams.find(p => p.name === 'status');
      const hasWorkflowId = endpoint.queryParams.find(p => p.name === 'workflow_id');
      
      if (hasLimit && hasStatus) {
        examples.push({
          label: 'Multiple parameters',
          url: `${fullBasePath}?limit=5&status=active`,
          description: 'Limit results to 5 active items'
        });
      }
      
      if (hasLimit && hasWorkflowId) {
        examples.push({
          label: 'Filter + limit',
          url: `${fullBasePath}?workflow_id=1&limit=10`,
          description: 'Get 10 executions for workflow 1'
        });
      }

      // For performance-critical endpoints, show performance optimization
      const hasIncludeResults = endpoint.queryParams.find(p => p.name === 'include_results');
      if (hasIncludeResults) {
        examples.push({
          label: '[PERF] Performance optimized',
          url: `${fullBasePath}?include_results=false&limit=20`,
          description: 'Fast response for dashboards (exclude heavy data)'
        });
      }

      const hasFullDetailed = endpoint.queryParams.find(p => p.name === 'full_detailed_response');
      if (hasFullDetailed) {
        examples.push({
          label: '🔍 Debugging mode',
          url: `${fullBasePath}?full_detailed_response=true`,
          description: 'Detailed response with raw data and logs'
        });
      }
    }

    return examples;
  };
  
  // Generate dynamic request examples
  const generateRequestExamples = (endpoint: EndpointDefinition) => {
    const baseUrl = 'https://app.mediar.ai';
    let fullUrl = `${baseUrl}${endpoint.path}`;

    // Add query parameters for ALL requests (not just GET)
    if (endpoint.queryParams) {
      const params = new URLSearchParams();
      endpoint.queryParams.forEach(param => {
        const sampleValue = generateSampleValue(param.type, param.name);
        // Only add a few key parameters to avoid overly long URLs in examples
        if (['status', 'limit', 'workflow_id', 'full_detailed_response'].includes(param.name)) {
          params.append(param.name, sampleValue);
        }
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
    const allRequestItems: Array<{
      name: string;
      request: {
        method: string;
        header: Array<{ key: string; value: string }>;
        url: {
          raw: string;
          protocol: string;
          host: string[];
          port: string;
          path: string[];
          query: Array<{ key: string; value: string }>;
        };
        body?: {
          mode: string;
          raw: string;
          options: { raw: { language: string } };
        };
      };
      response: unknown[];
    }> = [];

    // Process ALL endpoints dynamically (including execute and execute-sync endpoints)
    endpoints.forEach(endpoint => {
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
              console.warn(`[WARN] Failed to fetch schema for workflow ${workflow.id}:`, schemaData.error);
              return null;
            }
          } catch (error) {
            console.warn(`[WARN] Error fetching schema for workflow ${workflow.id}:`, error);
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

        console.log(`[SUCCESS] Successfully loaded ${Object.keys(schemas).length} workflow schemas`);
        setWorkflowSchemas(schemas);
        setSchemaError(null);
      } catch (error) {
        console.error('[ERROR] Failed to fetch workflow schemas:', error);
        setSchemaError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoadingSchemas(false);
      }
    };

    fetchWorkflowSchemas();
  }, []);

  // Fetch cached API responses for documentation examples
  useEffect(() => {
    const fetchCachedResponses = async () => {
      try {
        setLoadingResponses(true);
        console.log('🔄 Fetching cached API responses for documentation...');
        console.log('[SUCCESS] Filtering for successful responses only (status 200) for documentation examples');
        
        const responses: Record<string, string> = {};

                 // Helper function to get latest successful cached response
         const getCachedResponse = async (endpoint: string, method: string) => {
           try {
             const encodedEndpoint = encodeURIComponent(endpoint);
             const cacheResponse = await fetch(`/api/response-cache?endpoint=${encodedEndpoint}&method=${method}&latest=true&success_only=true`);
             const cacheData = await cacheResponse.json();
             
             if (cacheData.success && cacheData.responses.length > 0) {
               // Since we filtered for success_only, we can take the first response
               const latestSuccessResponse = cacheData.responses[0];
               return latestSuccessResponse.response_body;
             }
             return null;
           } catch (error) {
             console.warn(`[WARN] Could not fetch cached response for ${endpoint}:`, error);
             return null;
           }
         };

        // Fetch cached execution details response
        const executionDetailsResponse = await getCachedResponse('/api/remote-workflows/executions/[executionId]', 'GET');
        if (executionDetailsResponse) {
          responses['get-execution-details'] = JSON.stringify(executionDetailsResponse, null, 2);
          console.log('[SUCCESS] Fetched cached execution details response');
        }

        // Fetch cached list executions response
        const listExecutionsResponse = await getCachedResponse('/api/remote-workflows/executions', 'GET');
        if (listExecutionsResponse) {
          responses['list-executions'] = JSON.stringify(listExecutionsResponse, null, 2);
          console.log('[SUCCESS] Fetched cached list executions response');
        }

        // Fetch cached list workflows response
        const listWorkflowsResponse = await getCachedResponse('/api/remote-workflows/list', 'GET');
        if (listWorkflowsResponse) {
          responses['list-workflows'] = JSON.stringify(listWorkflowsResponse, null, 2);
          console.log('[SUCCESS] Fetched cached list workflows response');
        }

        // Fetch cached get workflow details response and apply to all workflow detail endpoints
        const getWorkflowDetailsResponse = await getCachedResponse('/api/remote-workflows/[workflowId]', 'GET');
        if (getWorkflowDetailsResponse) {
          const detailsResponseString = JSON.stringify(getWorkflowDetailsResponse, null, 2);
          
          // Apply the cached response to all get workflow details endpoints (for each workflow schema)
          Object.keys(workflowSchemas).forEach(workflowId => {
            responses[`get-workflow-details-${workflowId}`] = detailsResponseString;
          });
          
          console.log(`[SUCCESS] Fetched cached get workflow details response and applied to ${Object.keys(workflowSchemas).length} workflow(s)`);
        }

        // Fetch cached execute response and apply to all workflow execute endpoints
        const executeResponse = await getCachedResponse('/api/remote-workflows/[workflowId]/execute', 'POST');
        if (executeResponse) {
          const executeResponseString = JSON.stringify(executeResponse, null, 2);
          
          // Apply the cached response to all execute endpoints (for each workflow schema)
          Object.keys(workflowSchemas).forEach(workflowId => {
            responses[`execute-workflow-${workflowId}`] = executeResponseString;
          });
          
          console.log(`[SUCCESS] Fetched cached execute response and applied to ${Object.keys(workflowSchemas).length} workflow(s)`);
        }

        // Fetch cached execute-sync response and apply to all workflow execute-sync endpoints
        const executeSyncResponse = await getCachedResponse('/api/remote-workflows/[workflowId]/execute-sync', 'POST');
        if (executeSyncResponse) {
          const executeSyncResponseString = JSON.stringify(executeSyncResponse, null, 2);
          
          // Apply the cached response to all execute-sync endpoints (for each workflow schema)
          Object.keys(workflowSchemas).forEach(workflowId => {
            responses[`execute-sync-workflow-${workflowId}`] = executeSyncResponseString;
          });
          
          console.log(`[SUCCESS] Fetched cached execute-sync response and applied to ${Object.keys(workflowSchemas).length} workflow(s)`);
        }

        // Fetch cached live execution status response
        const liveExecutionStatusResponse = await getCachedResponse('/api/remote-workflows/executions/live', 'GET');
        if (liveExecutionStatusResponse) {
          responses['live-execution-status'] = JSON.stringify(liveExecutionStatusResponse, null, 2);
          console.log('[SUCCESS] Fetched cached live execution status response');
        }

        // If no cached responses available, fall back to live API calls for critical endpoints
        if (Object.keys(responses).length === 0) {
          console.log('🔄 No cached responses found, falling back to live API calls...');
          
          // Fallback: Fetch live execution details
          try {
            const executionsResponse = await fetch('/api/remote-workflows/executions?limit=1');
            const executionsData = await executionsResponse.json();
            
            if (executionsData.success && executionsData.executions.length > 0) {
              const latestExecution = executionsData.executions[0];
              const detailsResponse = await fetch(`/api/remote-workflows/executions/${latestExecution.execution_id}`);
              const detailsData = await detailsResponse.json();
              
              if (detailsData.success) {
                responses['get-execution-details'] = JSON.stringify(detailsData, null, 2);
                console.log('[SUCCESS] Fetched live execution details response (fallback)');
              }
            }
          } catch (error) {
            console.warn('[WARN] Could not fetch live execution details:', error);
          }

          // Fallback: Fetch live list executions
          try {
            const listResponse = await fetch('/api/remote-workflows/executions?limit=2');
            const listData = await listResponse.json();
            
            if (listData.success) {
              responses['list-executions'] = JSON.stringify(listData, null, 2);
              console.log('[SUCCESS] Fetched live executions list response (fallback)');
            }
          } catch (error) {
            console.warn('[WARN] Could not fetch executions list:', error);
          }
        }

        console.log(`[SUCCESS] Successfully loaded ${Object.keys(responses).length} API responses (${Object.keys(responses).length > 0 ? 'cached + fallback' : 'fallback only'})`);
        setDynamicResponses(responses);
      } catch (error) {
        console.error('[ERROR] Failed to fetch dynamic responses:', error);
      } finally {
        setLoadingResponses(false);
      }
    };

    // Only fetch responses after schemas are loaded (so we have workflow IDs)
    if (!loadingSchemas && Object.keys(workflowSchemas).length > 0) {
      fetchCachedResponses();
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

  // Helper function to generate dynamic execute-sync workflow endpoints from real schemas
  const generateExecuteSyncWorkflowEndpoints = (schemas: Record<number, WorkflowSchema>) => {
    if (Object.keys(schemas).length === 0) {
      // Return static example if no schemas loaded yet
      return [{
        id: 'execute-sync-workflow-loading',
        method: 'POST',
        path: '/api/remote-workflows/[workflowId]/execute-sync',
        title: 'Execute Workflow Synchronously (Loading...)',
        description: 'Loading real workflow schemas...',
        requestBody: `{
  "loading": "Fetching real workflow parameters..."
}`,
        response: `{
  "success": true,
  "execution_id": 44,
  "status": "completed",
  "message": "Workflow execution completed synchronously"
}`
      }];
    }

    // Generate sync endpoints for each workflow with real schemas
    return Object.values(schemas).map(schema => ({
      id: `execute-sync-workflow-${schema.id}`,
      method: 'POST',
      path: `/api/remote-workflows/${schema.id}/execute-sync`,
      title: `Execute Workflow Synchronously: ${schema.name}`,
      description: `Executes "${schema.name}" workflow synchronously and returns results immediately. Waits up to 5 minutes for completion. Perfect for applications that need immediate results without polling. ${schema.metadata.has_conditional_logic ? 'This workflow has conditional logic - some parameters may be required only for specific branches.' : ''}`,
      queryParams: [
        { name: 'full_detailed_response', type: 'boolean', optional: true, description: 'When true, includes raw data and execution logs. When false (default), returns basic response without raw data or execution logs.' }
      ],
      requestBody: JSON.stringify({ parameters: schema.sample_request }, null, 2),
      response: `{
  "success": true,
  "execution": {
    "execution_id": 44,
    "workflow_id": ${schema.id},
    "workflow_name": "${schema.name}",
    "status": "completed",
    "is_successful": true,
    "created_at": "2025-01-01T20:12:35.657Z",
    "started_at": "2025-01-01T20:12:36.000Z",
    "completed_at": "2025-01-01T20:14:28.000Z",
    "execution_duration_seconds": 112,
    "runtime_seconds": 112,
    "progress_percentage": 100,
    "total_steps": 15,
    "modal_call_id": "modal_sync_1751407955657_j9p0qn5ks",
    "execution_params": {
      "state": "California",
      "gender": "Male",
      "age": 35
    },
    "request_parameters": {
      "original_request": {
        "state": "California",
        "gender": "Male", 
        "age": 35
      },
      "parameter_count": 3,
      "note": "Parameters as sent in the original request"
    },
    "results": {
      "quotes": [
        {
          "company": "Best Plan Pro",
          "monthly_premium": "$45.67",
          "coverage_amount": "$500,000"
        }
      ],
      "execution_summary": {
        "workflow_completed": true
      },
      "performance_metrics": {
        "successful_steps": 15,
        "failed_steps": 0,
        "total_steps": 15
      }
    },
    "formatted_output": "[SUCCESS] Successfully found 1 insurance quote:\\n\\n[MONEY] Best Plan Pro: $45.67/month for $500,000 coverage",
    "summary": {
      "execution_successful": true,
      "workflow_completed": true,
      "steps_completed": 15,
      "steps_failed": 0,
      "quotes_found": 1,
      "error_stage": null
    }
  },
  "response_metadata": {
    "execution_mode": "synchronous",
    "detail_level": "basic",
    "note": "Synchronous execution completed. Returns basic response without raw data or execution logs."
  },
  "timestamp": "2025-01-01T20:14:28.000Z"
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
        
        WF --> Execute["/execute<br/>POST: Execute workflow (async)"]
        WF --> ExecuteSync["/execute-sync<br/>POST: Execute workflow (sync)"]
        
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
    style ExecuteSync fill:#e6f3ff,stroke:#000
    style Live fill:#f9f9f9,stroke:#000
    style ExecDetail fill:#f9f9f9,stroke:#000
    style Status fill:#ddd,stroke:#666
    style Results fill:#ddd,stroke:#666
`;

  // Helper function to generate dynamic get workflow details endpoints from real schemas
  const generateGetWorkflowDetailsEndpoints = (schemas: Record<number, WorkflowSchema>) => {
    if (Object.keys(schemas).length === 0) {
      // Return static example if no schemas loaded yet
      return [{
        id: 'get-workflow-details-loading',
        method: 'GET',
        path: '/api/remote-workflows/[workflowId]',
        title: 'Get Workflow Details (Loading...)',
        description: 'Loading real workflow schemas...',
        response: `{
  "success": true,
  "workflow": {
    "id": 1,
    "name": "Loading...",
    "status": "loading"
  }
}`
      }];
    }

    // Generate details endpoints for each workflow with real schemas
    return Object.values(schemas).map(schema => ({
      id: `get-workflow-details-${schema.id}`,
      method: 'GET',
      path: `/api/remote-workflows/${schema.id}`,
      title: `Get Workflow Details: ${schema.name}`,
      description: `Retrieves comprehensive details about the "${schema.name}" workflow including automation sequence, validation checks, and execution information.`,
      response: `{
  "success": true,
  "workflow": {
    "id": ${schema.id},
    "name": "${schema.name}",
    "description": "${schema.description}",
    "status": "deployed",
    "trigger_info": {
      "endpoint": "/api/remote-workflows/${schema.id}/execute",
      "method": "POST",
      "required_headers": ["Content-Type: application/json"],
      "is_executable": true
    },
    "automation_sequence": [...],
    "input_parameters": ${JSON.stringify(schema.sample_request, null, 6)},
    "usage_examples": {
      "curl_example": "curl -X POST https://app.mediar.ai/api/remote-workflows/${schema.id}/execute...",
      "javascript_example": "fetch('/api/remote-workflows/${schema.id}/execute'...)"
    }
  }
}`,
      workflowInfo: {
        parameterCount: schema.metadata.parameter_count,
        hasConditionalLogic: schema.metadata.has_conditional_logic,
        estimatedDuration: schema.estimated_duration_seconds
      }
    }));
  };

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
    // Dynamic get workflow details endpoints - will be populated from real schemas
    ...generateGetWorkflowDetailsEndpoints(workflowSchemas),
    // Dynamic execute workflow endpoint - will be populated from real schemas
    ...generateExecuteWorkflowEndpoints(workflowSchemas),
    // Dynamic execute-sync workflow endpoint - will be populated from real schemas
    ...generateExecuteSyncWorkflowEndpoints(workflowSchemas),
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
        { name: 'include_results', type: 'boolean', optional: true, description: 'Controls output detail level and response speed. FALSE (default): [PERF] Fast concise response (~50ms) with formatted_output only - optimized for real-time dashboards and user displays. TRUE: [SLOW] Slower detailed response (~200ms+) including execution_params and full results - only use when debugging or needing complete execution data. For performance-critical apps, always use FALSE.' }
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
      queryParams: [
        { name: 'full_detailed_response', type: 'boolean', optional: true, description: 'When true, includes raw data, execution logs, and schema analysis. When false (default), returns basic response only.' }
      ],
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
    "formatted_output": "[ERROR] Workflow execution failed!\\n\\n[STATS] Error Summary...",
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
              <p className="text-gray-800 text-sm">[WARN] Could not load dynamic schemas: {schemaError}. Showing static examples.</p>
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

        {/* URL Examples */}
        {endpoint.queryParams && endpoint.queryParams.length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-3">🔗 URL Examples</h3>
            <div className="bg-gray-50 border border-black rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-3">Copy these URLs to use in your applications:</p>
              <div className="space-y-2">
                {generateUrlExamples(endpoint).map((example, index) => (
                  <div key={index} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700 min-w-fit">{example.label}:</span>
                      <code className="bg-white px-2 py-1 rounded text-xs font-mono border border-gray-300 flex-1 break-all">
                        {example.url}
                      </code>
                    </div>
                    <p className="text-xs text-gray-500 ml-2">{example.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Parameter Validation Section - for both execute and execute-sync endpoints */}
        {(endpoint.id.startsWith('execute-workflow-') || endpoint.id.startsWith('execute-sync-workflow-')) && endpoint.workflowInfo && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-3">Parameter Validation</h3>
            {(() => {
              const workflowId = endpoint.id.replace('execute-workflow-', '').replace('execute-sync-workflow-', '');
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
    <div className="flex min-h-screen bg-gray-50 relative">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white border border-black rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 z-30 bg-black bg-opacity-50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        w-80 bg-white border-r border-black flex-shrink-0 h-full overflow-y-auto z-40
        lg:fixed lg:left-0 lg:top-0
        ${sidebarOpen 
          ? 'fixed left-0 top-0 translate-x-0' 
          : 'fixed left-0 top-0 -translate-x-full lg:translate-x-0'
        }
        transition-transform duration-300 ease-in-out
      `}>
        <div className="p-6 border-b border-black">
          <h2 className="text-lg font-semibold text-gray-900">API Reference</h2>
          <p className="text-sm text-gray-600 mt-1">Remote Workflows API</p>
        </div>
        
        <nav className="p-4">
          {/* Overview */}
          <div className="mb-6">
            <button
              onClick={() => {
                setSelectedEndpoint('overview');
                setSidebarOpen(false); // Close mobile sidebar after selection
              }}
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
                  onClick={() => {
                    setSelectedEndpoint(endpoint.id);
                    setSidebarOpen(false); // Close mobile sidebar after selection
                  }}
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
      <div className="flex-1 overflow-auto lg:ml-80">
        <div className="p-8 pt-16 lg:pt-8">
          {renderContent()}
        </div>
      </div>
    </div>
  );
} 