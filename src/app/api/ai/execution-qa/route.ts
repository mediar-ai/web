import { NextResponse } from 'next/server';
import { createVertex } from '@ai-sdk/google-vertex';
import { streamText } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import * as queryTools from '@/lib/execution-query-tools';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages, executionId } = body;

    // Use existing environment variables
    const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_VERTEX_PROJECT || process.env.GOOGLE_PROJECT_ID || 'mediar-394022';
    const location = process.env.VERTEX_AI_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';

    // Handle base64 credentials
    let credentialsJson: string | undefined;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      try {
        credentialsJson = Buffer.from(
          process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
          'base64'
        ).toString('utf-8');
      } catch (error) {
        console.error('Failed to decode base64 credentials:', error);
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // Fallback to JSON if available
      credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    }

    if (!project) {
      return NextResponse.json(
        { error: 'Google Cloud project not configured' },
        { status: 500 }
      );
    }

    // Initialize Vertex AI client with proper credentials
    const vertex = createVertex({
      project,
      location,
      googleAuthOptions: credentialsJson ? {
        credentials: JSON.parse(credentialsJson),
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      } : undefined
    });

    // Fetch execution data from database
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (error || !execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // Extract execution data from the results field
    const executionData = execution.results ? queryTools.extractExecutionData(execution.results) : null;

    // Get basic summary
    const stepCount = executionData?.results?.length || 0;
    const summary = executionData ? queryTools.getExecutionSummary(executionData) : 'No detailed execution data available';

    // Build context with tool usage instructions
    const context = `You are an AI assistant analyzing workflow execution #${execution.id}.

EXECUTION OVERVIEW:
- Status: ${execution.status}
- Duration: ${execution.execution_duration_seconds || 0} seconds
- Workflow: ${execution.workflow_id}
- Total Steps: ${stepCount}
${execution.error_message ? `- Error: ${execution.error_message}` : ''}

${summary}

IMPORTANT: You have access to tools to query the complete execution data:

1. searchLogs - Search for patterns in all execution logs
2. getStepDetails - Get complete details for a specific step
3. listSteps - List all steps with their status
4. getErrors - Get all error details
5. searchInResults - Search in step outputs/results
6. getTimeline - Get execution timeline
7. getPerformanceMetrics - Analyze performance

When answering questions:
- Use listSteps() first to understand the workflow structure
- Use searchLogs() to find specific information
- Use getStepDetails() to drill into specific steps
- Use getErrors() when asked about failures
- Always query the actual data rather than guessing

Be specific and detailed in your answers. If you need more information, use the tools to get it.`;

    // Define tools for the AI
    const tools = {
      searchLogs: {
        description: 'Search for patterns in all execution logs',
        inputSchema: z.object({
          pattern: z.string().describe('The pattern to search for'),
          limit: z.number().optional().default(50).describe('Maximum number of results')
        }),
        execute: async ({ pattern, limit }: { pattern: string; limit: number }) => {
          if (!executionData) return { error: 'No execution data available' };
          const results = queryTools.searchLogs(executionData, pattern, limit);
          return {
            found: results.length,
            matches: results
          };
        }
      },

      getStepDetails: {
        description: 'Get complete details for a specific step by index or name',
        inputSchema: z.object({
          stepId: z.string().describe('Step index (0,1,2...) or step name')
        }),
        execute: async ({ stepId }: { stepId: string }) => {
          if (!executionData) return { error: 'No execution data available' };
          const step = queryTools.getStepDetails(executionData, stepId);
          if (!step) return { error: `Step '${stepId}' not found` };
          return step;
        }
      },

      listSteps: {
        description: 'List all workflow steps with their status and basic info',
        inputSchema: z.object({}),
        execute: async () => {
          if (!executionData) return { error: 'No execution data available' };
          const steps = queryTools.listSteps(executionData);
          return {
            totalSteps: steps.length,
            steps: steps
          };
        }
      },

      getErrors: {
        description: 'Get all errors from the execution',
        inputSchema: z.object({
          limit: z.number().optional().default(20).describe('Maximum number of errors to return')
        }),
        execute: async ({ limit }: { limit: number }) => {
          if (!executionData) return { error: 'No execution data available' };
          const errors = queryTools.getErrors(executionData, limit);
          return {
            errorCount: errors.length,
            errors: errors
          };
        }
      },

      searchInResults: {
        description: 'Search for patterns in step outputs/results',
        inputSchema: z.object({
          pattern: z.string().describe('The pattern to search for in results'),
          limit: z.number().optional().default(20).describe('Maximum number of results')
        }),
        execute: async ({ pattern, limit }: { pattern: string; limit: number }) => {
          if (!executionData) return { error: 'No execution data available' };
          const results = queryTools.searchInResults(executionData, pattern, limit);
          return {
            found: results.length,
            matches: results
          };
        }
      },

      getTimeline: {
        description: 'Get the execution timeline showing when each step ran',
        inputSchema: z.object({}),
        execute: async () => {
          if (!executionData) return { error: 'No execution data available' };
          const timeline = queryTools.getTimeline(executionData);
          return {
            steps: timeline.length,
            timeline: timeline
          };
        }
      },

      getPerformanceMetrics: {
        description: 'Get performance metrics and timing analysis',
        inputSchema: z.object({}),
        execute: async () => {
          if (!executionData) return { error: 'No execution data available' };
          const metrics = queryTools.getPerformanceMetrics(executionData);
          if (!metrics) return { error: 'No performance data available' };
          return metrics;
        }
      },

      getLogsByTimeRange: {
        description: 'Get logs within a specific time range',
        inputSchema: z.object({
          startTime: z.string().describe('Start time (ISO format or relative like "2 minutes ago")'),
          endTime: z.string().describe('End time (ISO format or relative like "now")')
        }),
        execute: async ({ startTime, endTime }: { startTime: string; endTime: string }) => {
          if (!executionData) return { error: 'No execution data available' };
          const logs = queryTools.getLogsByTimeRange(executionData, startTime, endTime);
          return {
            logCount: logs.length,
            logs: logs
          };
        }
      },

      extractSection: {
        description: 'Extract a specific section from the execution data using dot notation path',
        inputSchema: z.object({
          path: z.string().describe('Dot notation path (e.g., "results.0.logs" or "status")')
        }),
        execute: async ({ path }: { path: string }) => {
          if (!executionData) return { error: 'No execution data available' };
          const section = queryTools.extractSection(executionData, path);
          if (section === null) return { error: `Path '${path}' not found` };
          return { path, data: section };
        }
      }
    };

    // Stream the response using Vercel AI SDK with tools
    const result = await streamText({
      model: vertex('gemini-2.5-pro'),
      messages: [
        { role: 'system', content: context },
        ...messages
      ],
      tools: tools,
      toolChoice: 'auto', // Let the model decide when to use tools
      temperature: 0.7,
      maxRetries: 3,
      onChunk: async ({ chunk }) => {
        // Log when tools are being called
        if (chunk.type === 'tool-call') {
          console.log(`[AI Tool Call] ${chunk.toolName}`);
        }
      }
    });

    // Return the stream
    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Error in execution Q&A:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}