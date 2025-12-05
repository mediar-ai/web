/**
 * Server-side dev execution log tools for AI
 * These tools allow AI to access and query recent workflow execution logs from the desktop app
 */

import { Type } from '@/app/api/ai/types/vertex';

// Alias for backward compatibility
const SchemaType = Type;
import { getRedisClient } from '@/lib/redis-client';
import * as devQueryTools from '@/lib/dev-execution-query-tools';

export const serverSideDevLogTools = {
  getLatestExecutionLogs: {
    name: 'getLatestExecutionLogs',
    description: 'Get the most recent workflow execution logs from the desktop app for debugging. Use when user mentions they just ran a workflow and it failed or want to check what happened.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        workflow_id: {
          type: SchemaType.NUMBER,
          description: 'The workflow ID (automatically provided from request context - you do not need to specify this)'
        }
      },
      required: []
    }
  },

  searchDevLogs: {
    name: 'searchDevLogs',
    description: 'Search for patterns in the latest execution logs. Use this to find specific errors, warnings, or debug messages.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        workflow_id: {
          type: SchemaType.NUMBER,
          description: 'The workflow ID (automatically provided from request context - you do not need to specify this)'
        },
        pattern: {
          type: SchemaType.STRING,
          description: 'Text pattern to search for in logs (e.g., "error", "timeout", "element not found")'
        },
        limit: {
          type: SchemaType.NUMBER,
          description: 'Maximum number of results to return (default: 50)'
        }
      },
      required: ['pattern']
    }
  },

  getDevStepDetails: {
    name: 'getDevStepDetails',
    description: 'Get full details for a specific step from the latest execution, including all logs, timing, and results.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        workflow_id: {
          type: SchemaType.NUMBER,
          description: 'The workflow ID (automatically provided from request context - you do not need to specify this)'
        },
        stepId: {
          type: SchemaType.STRING,
          description: 'Step index number (0, 1, 2, etc.) or step name'
        }
      },
      required: ['stepId']
    }
  },

  listDevSteps: {
    name: 'listDevSteps',
    description: 'List all steps from the latest execution with their status. Use this to get an overview of what ran.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        workflow_id: {
          type: SchemaType.NUMBER,
          description: 'The workflow ID (automatically provided from request context - you do not need to specify this)'
        }
      },
      required: []
    }
  },

  getDevErrors: {
    name: 'getDevErrors',
    description: 'Get all errors from the latest execution. Use this first when debugging a failed workflow.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        workflow_id: {
          type: SchemaType.NUMBER,
          description: 'The workflow ID (automatically provided from request context - you do not need to specify this)'
        },
        limit: {
          type: SchemaType.NUMBER,
          description: 'Maximum number of errors to return (default: 20)'
        }
      },
      required: []
    }
  },

  getDevTimeline: {
    name: 'getDevTimeline',
    description: 'Get the execution timeline showing when each step ran. Useful for identifying timing issues.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        workflow_id: {
          type: SchemaType.NUMBER,
          description: 'The workflow ID (automatically provided from request context - you do not need to specify this)'
        }
      },
      required: []
    }
  },

  getDevPerformanceMetrics: {
    name: 'getDevPerformanceMetrics',
    description: 'Get performance metrics and timing statistics for the latest execution.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        workflow_id: {
          type: SchemaType.NUMBER,
          description: 'The workflow ID (automatically provided from request context - you do not need to specify this)'
        }
      },
      required: []
    }
  }
};

/**
 * Check if a tool name is a dev log tool
 */
export function isDevLogTool(toolName: string): boolean {
  return toolName in serverSideDevLogTools;
}

/**
 * Get tool declarations for Vertex AI
 * Full declarations with descriptions and schemas for native function calling
 */
export function getDevLogToolDeclarations() {
  return Object.entries(serverSideDevLogTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

/**
 * Execute a dev log tool
 */
export async function executeDevLogTool(
  toolName: string,
  args: any,
  userContext: { userId: string; orgId: string | null; email?: string | null }
): Promise<any> {
  console.log(`[DEV LOG TOOL] Executing ${toolName} for user ${userContext.userId}`);

  const { workflow_id } = args;

  if (!workflow_id) {
    return {
      error: 'Missing workflow_id parameter',
      message: 'workflow_id is required to access execution logs'
    };
  }

  const redis = await getRedisClient();

  try {
    // 1. Get latest execution ID for this workflow
    const latestKey = `dev-execution:${userContext.userId}:${workflow_id}:latest`;
    const latestExecutionId = await redis.get(latestKey);

    if (!latestExecutionId) {
      return {
        error: 'No recent execution logs found',
        message: `No dev execution logs found for workflow ${workflow_id}. The user needs to run the workflow in the desktop app first. Logs are stored for 30 days after execution.`,
        workflow_id
      };
    }

    // 2. Load execution data
    const executionKey = `dev-execution:${userContext.userId}:${workflow_id}:${latestExecutionId}`;
    const executionData = await redis.get(executionKey);

    if (!executionData) {
      return {
        error: 'Execution logs expired',
        message: 'The execution logs have expired (TTL: 30 days). Please run the workflow again to generate new logs.',
        execution_id: latestExecutionId
      };
    }

    const execution = JSON.parse(executionData);

    console.log(`[DEV LOG TOOL] Loaded execution ${latestExecutionId}, status: ${execution.status}, steps: ${Object.keys(execution.workflowExecutionLogs).length}`);

    // 3. Execute the appropriate tool
    switch (toolName) {
      case 'getLatestExecutionLogs':
        return {
          execution_id: execution.execution_id,
          workflow_id: execution.workflow_id,
          workflow_name: execution.workflow_name,
          status: execution.status,
          duration_seconds: execution.duration_seconds,
          started_at: execution.started_at,
          completed_at: execution.completed_at,
          error_message: execution.error_message,
          step_count: Object.keys(execution.workflowExecutionLogs).length,
          summary: devQueryTools.getExecutionSummary(execution.workflowExecutionLogs)
        };

      case 'searchDevLogs':
        const searchResults = devQueryTools.searchLogs(
          execution.workflowExecutionLogs,
          args.pattern,
          args.limit || 50
        );
        return {
          found: searchResults.length,
          pattern: args.pattern,
          execution_id: execution.execution_id,
          matches: searchResults
        };

      case 'getDevStepDetails':
        const stepDetails = devQueryTools.getStepDetails(
          execution.workflowExecutionLogs,
          args.stepId
        );
        if (!stepDetails) {
          return {
            error: `Step '${args.stepId}' not found`,
            message: `No step matching '${args.stepId}' found in execution. Use listDevSteps to see all available steps.`
          };
        }
        return {
          execution_id: execution.execution_id,
          step: stepDetails
        };

      case 'listDevSteps':
        const steps = devQueryTools.listSteps(execution.workflowExecutionLogs);
        return {
          execution_id: execution.execution_id,
          total_steps: steps.length,
          steps
        };

      case 'getDevErrors':
        const errors = devQueryTools.getErrors(
          execution.workflowExecutionLogs,
          args.limit || 20
        );
        return {
          execution_id: execution.execution_id,
          error_count: errors.length,
          errors
        };

      case 'getDevTimeline':
        const timeline = devQueryTools.getTimeline(execution.workflowExecutionLogs);
        return {
          execution_id: execution.execution_id,
          total_steps: timeline.length,
          timeline
        };

      case 'getDevPerformanceMetrics':
        const metrics = devQueryTools.getPerformanceMetrics(execution.workflowExecutionLogs);
        if (!metrics) {
          return {
            error: 'No performance data available',
            message: 'Could not calculate performance metrics for this execution'
          };
        }
        return {
          execution_id: execution.execution_id,
          metrics
        };

      default:
        return {
          error: `Unknown tool: ${toolName}`,
          message: `Tool '${toolName}' is not recognized as a dev log tool`
        };
    }

  } catch (error) {
    console.error(`[DEV LOG TOOL] Error executing ${toolName}:`, error);
    return {
      error: 'Tool execution failed',
      message: error instanceof Error ? error.message : String(error),
      tool: toolName
    };
  }
}
