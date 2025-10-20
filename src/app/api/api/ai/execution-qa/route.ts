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

    console.log('[Q&A API] Loading context for execution:', executionId);

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

    // Fetch execution data and Terminator docs in parallel
    console.log('[Q&A API] ⏳ Fetching execution data and Terminator documentation...');
    const fetchStartTime = Date.now();

    const [executionResult, terminatorDocsResult] = await Promise.all([
      supabase
        .from('workflow_executions')
        .select('*')
        .eq('id', executionId)
        .single(),
      fetch('https://raw.githubusercontent.com/mediar-ai/terminator/main/terminator-mcp-agent/src/prompt.rs')
        .then(res => res.ok ? res.text() : null)
        .catch(() => null)
    ]);

    const fetchDuration = Date.now() - fetchStartTime;
    const { data: execution, error } = executionResult;
    const terminatorDocs = terminatorDocsResult;

    console.log(`[Q&A API] ✓ Fetched execution data in ${fetchDuration}ms`);
    console.log(`[Q&A API] ${terminatorDocs ? '✓' : '✗'} Terminator documentation ${terminatorDocs ? 'loaded' : 'failed to load'}`);

    if (error || !execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // Extract execution data from the results field
    const executionData = execution.results ? queryTools.extractExecutionData(execution.results) : null;

    // Get basic summary
    const stepCount = executionData?.results?.length || 0;
    const summary = executionData ? queryTools.getExecutionSummary(executionData) : 'No detailed execution data available';

    console.log(`[Q&A API] 📊 Parsed execution data: ${stepCount} steps, ${execution.status} status`);
    if (execution.execution_logs) {
      console.log(`[Q&A API] 📋 Orchestrator logs: ${execution.execution_logs.length} entries`);
    }
    if (execution.screenshots) {
      console.log(`[Q&A API] 📸 Screenshots: ${execution.screenshots.length} available`);
    }

    // Build context with tool usage instructions
    const context = `You are an AI assistant analyzing workflow execution #${execution.id}.

EXECUTION OVERVIEW:
- Status: ${execution.status}
- Duration: ${execution.execution_duration_seconds || 0} seconds
- Workflow: ${execution.workflow_id}
- Total Steps: ${stepCount}
${execution.error_message ? `- Error: ${execution.error_message}` : ''}

${summary}

You have access to tools to query the complete execution data:

1. searchLogs - Search for patterns in all execution logs
2. getStepDetails - Get complete details for a specific step
3. listSteps - List all steps with their status
4. getErrors - Get all error details
5. searchInResults - Search in step outputs/results
6. getTimeline - Get execution timeline
7. getPerformanceMetrics - Analyze performance
8. searchTerminatorDocs - Search Terminator desktop automation documentation for tool usage and best practices

${terminatorDocs ? 'TERMINATOR DOCUMENTATION: Available - use searchTerminatorDocs to query desktop automation patterns, error handling, browser scripts, validation, and workflow best practices.' : ''}

When answering questions:
- Use tools to query the actual execution data rather than guessing
- If the user asks about how Terminator tools work or workflow patterns, use searchTerminatorDocs
- After using tools, provide a clear natural language response explaining what you found
- Be specific and detailed in your answers based on the data

Answer the user's question helpfully and thoroughly.`;

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
      },

      searchTerminatorDocs: {
        description: 'Search Terminator desktop automation documentation for tool usage, patterns, best practices, and troubleshooting',
        inputSchema: z.object({
          pattern: z.string().describe('Search pattern or topic (e.g., "click_element", "browser script", "validation", "error handling")'),
          limit: z.number().optional().default(5).describe('Maximum number of matching sections to return')
        }),
        execute: async ({ pattern, limit }: { pattern: string; limit: number }) => {
          if (!terminatorDocs) return { error: 'Terminator documentation not available' };

          const searchPattern = pattern.toLowerCase();
          const lines = terminatorDocs.split('\n');
          const matches: { section: string; content: string; lineNumber: number }[] = [];

          let currentSection = 'Introduction';
          let sectionContent: string[] = [];
          let sectionStartLine = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Detect section headers (markdown ## or ###)
            if (line.startsWith('##')) {
              // Save previous section if it matches
              if (sectionContent.join('\n').toLowerCase().includes(searchPattern)) {
                matches.push({
                  section: currentSection,
                  content: sectionContent.join('\n').substring(0, 500), // Limit content length
                  lineNumber: sectionStartLine
                });
                if (matches.length >= limit) break;
              }

              // Start new section
              currentSection = line.replace(/^#+\s*/, '');
              sectionContent = [line];
              sectionStartLine = i + 1;
            } else {
              sectionContent.push(line);
            }
          }

          // Check last section
          if (matches.length < limit && sectionContent.join('\n').toLowerCase().includes(searchPattern)) {
            matches.push({
              section: currentSection,
              content: sectionContent.join('\n').substring(0, 500),
              lineNumber: sectionStartLine
            });
          }

          return {
            found: matches.length,
            query: pattern,
            matches: matches
          };
        }
      }
    };

    // Provide comprehensive execution data in the context
    const stepsData = executionData ? queryTools.listSteps(executionData) : [];
    const errorsData = executionData ? queryTools.getErrors(executionData) : [];

    // Parse formatted output if available
    let formattedOutput = null;
    if (execution.formatted_output) {
      try {
        formattedOutput = typeof execution.formatted_output === 'string'
          ? JSON.parse(execution.formatted_output)
          : execution.formatted_output;
      } catch (e) {
        formattedOutput = execution.formatted_output;
      }
    }

    const enrichedContext = context + `\n\n=== EXECUTION DATA ===\n` +
      `Steps (${stepsData.length} total):\n${JSON.stringify(stepsData, null, 2)}\n\n` +
      (errorsData.length > 0 ? `Errors:\n${JSON.stringify(errorsData, null, 2)}\n\n` : '') +
      (formattedOutput ? `Formatted Output:\n${JSON.stringify(formattedOutput, null, 2)}\n\n` : '') +
      (execution.error_analysis ? `AI Error Analysis:\n${execution.error_analysis}\n\n` : '') +
      (execution.execution_params ? `Execution Parameters:\n${JSON.stringify(execution.execution_params, null, 2)}\n\n` : '') +
      (execution.screenshots && execution.screenshots.length > 0 ? `Screenshots: ${execution.screenshots.length} monitor screenshots available\n\n` : '') +
      (execution.execution_logs && execution.execution_logs.length > 0 ?
        `Orchestrator Server Logs (${execution.execution_logs.length} entries):\n${JSON.stringify(execution.execution_logs, null, 2)}\n\n` : '') +
      `Answer the user's question based on this data. Be specific and helpful.`;

    const result = await streamText({
      model: vertex('gemini-2.5-pro'),
      messages: [
        { role: 'system', content: enrichedContext },
        ...messages
      ],
      temperature: 0.7,
      maxRetries: 3,
    });

    // Return the stream
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('Error in execution Q&A:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}