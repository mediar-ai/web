import type { CachedTool } from './types';

export interface ExecutionResult {
  type: 'success' | 'error' | 'streaming';
  data?: unknown;
  execution_id?: number;
  workflow_id?: number;
  status?: string;
  message?: string;
  error_details?: string;
}

interface APIResponse {
  execution_id?: number;
  id?: number;
  status?: string;
  message?: string;
  error?: string;
  data?: unknown;
  execution_time_ms?: number;
  [key: string]: unknown;
}

export class ExecutionHandler {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Use current origin in production, localhost in development
    this.baseUrl = baseUrl || (
      process.env.NODE_ENV === 'production' 
        ? (process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai') // Use env var or fallback
        : 'http://localhost:3000'
    );
  }

  async executeWorkflowTool(
    toolName: string,
    parameters: Record<string, unknown>,
    cachedTool: CachedTool
  ): Promise<ExecutionResult> {
    console.log(`[FIX] [MCP] Executing tool: ${toolName}`);
    
    try {
      const workflowId = cachedTool.workflow.id;
      const executionMode = parameters.execution_mode || 'async';
      
      // Prepare the execution parameters
      const executionParams = this.prepareExecutionParameters(parameters, cachedTool);
      
      // Call the existing remote-workflows API
      const endpoint = executionMode === 'sync' 
        ? `${this.baseUrl}/api/remote-workflows/${workflowId}/execute-sync`
        : `${this.baseUrl}/api/remote-workflows/${workflowId}/execute`;

      console.log(`[FIX] [MCP] Calling API: ${endpoint}`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parameters: executionParams })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result: APIResponse = await response.json();
      
      // Format the response consistently
      if (executionMode === 'sync') {
        return this.formatSyncResult(result, cachedTool);
      } else {
        return this.formatAsyncResult(result, cachedTool);
      }

    } catch (error) {
      console.error(`[FIX] [MCP] Tool execution error for ${toolName}:`, error);
      
      return {
        type: 'error',
        workflow_id: cachedTool.workflow.id,
        error_details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private prepareExecutionParameters(
    parameters: Record<string, unknown>,
    cachedTool: CachedTool
  ): Record<string, unknown> {
    // Remove MCP-specific parameters
    const { execution_mode, include_cache, full_detailed_response, ...workflowParams } = parameters;
    
    // Suppress unused variable warning for execution_mode since it's used in the calling function
    void execution_mode;
    
    // Use the workflow's default inputs as base
    const defaultInputs = cachedTool.workflow.automation_sequence[0]?.arguments?.inputs || {};
    
    // Merge defaults with provided parameters
    const executionParams = {
      ...defaultInputs,
      ...workflowParams
    };

    // Add cache preference if specified
    if (include_cache !== undefined) {
      executionParams.use_cache = include_cache;
    }

    // Add detailed response preference if specified
    if (full_detailed_response !== undefined) {
      executionParams.include_details = full_detailed_response;
    }

    console.log(`[FIX] [MCP] Execution parameters:`, Object.keys(executionParams));
    
    return executionParams;
  }

  private formatAsyncResult(result: APIResponse, cachedTool: CachedTool): ExecutionResult {
    return {
      type: 'success',
      data: result,
      execution_id: result.execution_id || result.id,
      workflow_id: cachedTool.workflow.id,
      status: result.status || 'started',
      message: result.message || `Workflow ${cachedTool.workflow.name} started successfully. Use the execution ID to monitor progress.`
    };
  }

  private formatSyncResult(result: APIResponse, cachedTool: CachedTool): ExecutionResult {
    // Check if the result indicates an error
    if (result.error || result.status === 'error' || result.status === 'failed') {
      return {
        type: 'error',
        workflow_id: cachedTool.workflow.id,
        error_details: result.error || result.message || 'Workflow execution failed'
      };
    }

    return {
      type: 'success',
      data: result,
      execution_id: result.execution_id || result.id,
      workflow_id: cachedTool.workflow.id,
      status: result.status || 'completed',
      message: this.generateSuccessMessage(result, cachedTool)
    };
  }

  private generateSuccessMessage(result: APIResponse, cachedTool: CachedTool): string {
    let message = `[SUCCESS] ${cachedTool.workflow.name} completed successfully`;
    
    // Add result summary if available
    if (result.data && typeof result.data === 'object') {
      const data = result.data as Record<string, unknown>;
      
      // For quote workflows
      if (data.quotes && Array.isArray(data.quotes)) {
        message += `\n[STATS] Generated ${data.quotes.length} insurance quotes`;
      }
      
      // For general results
      if (data.results && typeof data.results === 'object') {
        const results = data.results as Record<string, unknown>;
        if (results.count || results.length) {
          message += `\n[STATS] Processed ${results.count || results.length} items`;
        }
      }
    }
    
    // Add execution time if available
    if (result.execution_time_ms) {
      message += `\n[TIME] Completed in ${Math.round(result.execution_time_ms / 1000)}s`;
    }

    return message;
  }

  // Get execution status (for monitoring async executions)
  async getExecutionStatus(executionId: number): Promise<ExecutionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/remote-workflows/executions/${executionId}/status`);
      
      if (!response.ok) {
        throw new Error(`Failed to get execution status: ${response.statusText}`);
      }

      const result: APIResponse = await response.json();
      
      return {
        type: 'success',
        data: result,
        execution_id: executionId,
        status: result.status,
        message: `Execution ${executionId} status: ${result.status}`
      };

    } catch (error) {
      return {
        type: 'error',
        execution_id: executionId,
        error_details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Get execution results (for completed async executions)
  async getExecutionResults(executionId: number): Promise<ExecutionResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/remote-workflows/executions/${executionId}/results`);
      
      if (!response.ok) {
        throw new Error(`Failed to get execution results: ${response.statusText}`);
      }

      const result: APIResponse = await response.json();
      
      return {
        type: 'success',
        data: result,
        execution_id: executionId,
        status: 'completed',
        message: `Execution ${executionId} results retrieved successfully`
      };

    } catch (error) {
      return {
        type: 'error',
        execution_id: executionId,
        error_details: error instanceof Error ? error.message : String(error)
      };
    }
  }
} 