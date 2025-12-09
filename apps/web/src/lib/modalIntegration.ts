/**
 * Modal Integration Functions
 * Handles communication with Modal serverless functions for workflow execution
 */

interface ModalExecutionResult {
  success: boolean;
  execution_id: number;
  results?: Record<string, unknown>;
  error?: string;
  execution_logs?: string[];
  screenshots?: Array<{
    name: string;
    step: number;
    data: string;
    timestamp: string;
  }>;
  execution_duration_seconds?: number;
}

interface QueueStatus {
  queued_count: number;
  running_count: number;
  timestamp: string;
  error?: string;
}

/**
 * Trigger workflow execution on Modal
 */
export async function triggerModalExecution(
  executionId: number,
  workflowDefinition: Record<string, unknown>,
  executionParams: Record<string, unknown>
): Promise<{ success: boolean; modalCallId?: string; error?: string }> {
  try {
    const modalApiUrl = process.env.MODAL_API_URL || 'https://api.modal.com';
    const modalToken = process.env.MODAL_TOKEN;
    
    if (!modalToken) {
      throw new Error('Modal API token not configured');
    }

    // Call Modal function
    const response = await fetch(`${modalApiUrl}/v1/apps/workflow-executor/functions/execute_workflow/invoke`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${modalToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        execution_id: executionId,
        workflow_definition: workflowDefinition,
        execution_params: executionParams
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Modal API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      modalCallId: result.call_id || `modal_${executionId}_${Date.now()}`
    };

  } catch (error) {
    console.error('Modal execution trigger failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get Modal execution queue status
 */
export async function getModalQueueStatus(): Promise<QueueStatus> {
  try {
    const modalApiUrl = process.env.MODAL_API_URL || 'https://api.modal.com';
    const modalToken = process.env.MODAL_TOKEN;
    
    if (!modalToken) {
      throw new Error('Modal API token not configured');
    }

    const response = await fetch(`${modalApiUrl}/v1/apps/workflow-executor/functions/get_workflow_queue_status/invoke`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${modalToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`Modal API error: ${response.status}`);
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error('Modal queue status check failed:', error);
    return {
      queued_count: 0,
      running_count: 0,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Cancel Modal execution (if running)
 */
export async function cancelModalExecution(modalCallId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const modalToken = process.env.MODAL_TOKEN;
    
    if (!modalToken) {
      throw new Error('Modal API token not configured');
    }

    // Note: This is a placeholder - Modal doesn't have direct cancellation API
    // In production, you'd implement this through Modal's function cancellation
    console.log(`Attempting to cancel Modal execution: ${modalCallId}`);
    
    return { success: true };

  } catch (error) {
    console.error('Modal execution cancellation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Mock Modal execution for development/testing
 */

export async function mockModalExecution(
  executionId: number,
  _workflowDefinition: Record<string, unknown>,
  _executionParams: Record<string, unknown>
): Promise<ModalExecutionResult> {

  // Simulate execution delay
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const mockResults = {
    insurance_quotes: [
      {
        provider: "SafeGuard Insurance",
        monthly_premium: 245.67,
        coverage: "Comprehensive",
        deductible: 500
      },
      {
        provider: "Shield Protection",
        monthly_premium: 289.12,
        coverage: "Full Coverage",
        deductible: 250
      }
    ],
    comparison_summary: {
      cheapest_option: "SafeGuard Insurance",
      most_coverage: "Shield Protection",
      total_quotes_found: 2
    }
  };

  const mockLogs = [
    `[${new Date().toISOString()}] INFO: Starting workflow execution ${executionId}`,
    `[${new Date().toISOString()}] INFO: WebDriver initialized successfully`,
    `[${new Date().toISOString()}] INFO: Navigated to insurance website`,
    `[${new Date().toISOString()}] INFO: Filled personal information form`,
    `[${new Date().toISOString()}] INFO: Selected coverage options`,
    `[${new Date().toISOString()}] INFO: Extracted 2 insurance quotes`,
    `[${new Date().toISOString()}] INFO: Workflow execution completed successfully`
  ];

  return {
    success: true,
    execution_id: executionId,
    results: mockResults,
    execution_logs: mockLogs,
    screenshots: [
      {
        name: "initial_page",
        step: 1,
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", // 1x1 transparent PNG
        timestamp: new Date().toISOString()
      }
    ],
    execution_duration_seconds: 45
  };
}
