import * as queryTools from '@/lib/execution-query-tools';
import {
  loadTerminatorDocs,
  searchTerminatorDocs as searchDocs,
} from '@/lib/terminator-docs-service';
import { auth } from '@clerk/nextjs/server';
import type { FunctionDeclaration, Content } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Interface for workflow context
interface WorkflowContext {
  workflow: any | null; // The JSON workflow object from JSONB column
  workflowError: string | null;
  version: string;
  workflowId: number;
  jsFiles: Record<string, string>;
  jsFilesError: string | null;
}

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Simple in-memory cache for execution context (avoids re-fetching workflow + JS files)
const contextCache = new Map<
  string,
  {
    execution: any;
    workflowContext: WorkflowContext;
    terminatorDocs: string | null;
    timestamp: number;
  }
>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Helper function to determine if an error is retryable
function isRetryableError(error: any): boolean {
  // Check for HTTP status codes that are retryable
  const errorMessage = error?.message || String(error);
  const errorString = errorMessage.toLowerCase();

  // Retryable: 503 Service Unavailable, 429 Too Many Requests, 500 Internal Server Error
  // Also retry on timeout/network errors
  const retryablePatterns = [
    '503',
    'service unavailable',
    '429',
    'too many requests',
    'rate limit',
    '500',
    'internal server error',
    'timeout',
    'econnreset',
    'enotfound',
    'unavailable',
    'visibility check was unavailable', // Specific Google error
  ];

  return retryablePatterns.some(pattern => errorString.includes(pattern));
}

// Helper function to retry Vertex AI sendMessage with exponential backoff
async function sendMessageWithRetry(
  chat: any,
  message: any,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    messageType?: string;
  } = {}
): Promise<any> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    messageType = 'message',
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Calculate exponential backoff delay: baseDelay * 2^(attempt-1)
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(
          `[Q&A-RETRY] Attempt ${attempt + 1}/${maxRetries + 1} - waiting ${delayMs}ms before retry...`
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      console.log(
        `[Q&A-HTTP] Sending ${messageType} to Vertex AI (attempt ${attempt + 1}/${maxRetries + 1})`
      );
      const response = await chat.sendMessage({ message });

      if (attempt > 0) {
        console.log(`[Q&A-RETRY] ✅ Success after ${attempt} retries`);
      }

      return response;
    } catch (error: any) {
      lastError = error;

      const isRetryable = isRetryableError(error);
      const errorDetails = {
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        errorType: error?.constructor?.name || 'Unknown',
        errorMessage: error?.message || String(error),
        isRetryable,
      };

      console.error(`[Q&A-HTTP] API error:`, errorDetails);

      // If it's not retryable or we've exhausted retries, throw immediately
      if (!isRetryable) {
        console.error(
          `[Q&A-HTTP] Non-retryable error detected, failing immediately`
        );
        throw error;
      }

      if (attempt >= maxRetries) {
        console.error(`[Q&A-HTTP] Max retries (${maxRetries + 1}) exhausted`);
        throw new Error(
          `Vertex AI request failed after ${maxRetries + 1} attempts: ${error?.message || String(error)}`
        );
      }

      console.log(`[Q&A-HTTP] Retryable error detected, will retry...`);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

export async function POST(request: Request) {
  try {
    // Get authenticated user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { messages, executionId, contextData, model = 'gemini-2.5-pro' } = body;

    // Check if context was provided by the frontend
    if (contextData) {
      console.log(
        '[Q&A API] Using pre-loaded context for execution:',
        executionId
      );
      console.log(
        `[Q&A API] Context has ${contextData.metadata?.jsFileCount || 0} JS files, ${contextData.metadata?.workflowSteps || 0} steps`
      );
    } else {
      console.log('[Q&A API] Loading context for execution:', executionId);
    }
    let execution: any;
    let workflowContext: WorkflowContext;
    let terminatorDocs: string | null = null;

    // Check cache first (avoids re-fetching workflow + 33 JS files on every message)
    const cached = contextCache.get(executionId);
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      // Use cached context
      execution = cached.execution;
      workflowContext = cached.workflowContext;
      terminatorDocs = cached.terminatorDocs;
      console.log(
        '[Q&A API] ✓ Using cached context (skipped GitHub API calls)'
      );
    } else {
      // Cache miss or expired - load fresh context
      if (cached) {
        console.log('[Q&A API] Cache expired, reloading context');
        contextCache.delete(executionId);
      }
      // Fetch execution data to get workflow_id and version
      console.log('[Q&A API] ⏳ Fetching execution data...');
      const fetchStartTime = Date.now();

      const { data: executionData, error } = await supabase
        .from('workflow_executions')
        .select('*')
        .eq('id', executionId)
        .single();

      if (error || !executionData) {
        return NextResponse.json(
          { error: 'Execution not found' },
          { status: 404 }
        );
      }

      execution = executionData;
      console.log(
        `[Q&A API] ✓ Execution loaded - workflow_id: ${execution.workflow_id}, version: ${execution.version_number}`
      );

      // Now fetch workflow, GitHub folder, and Terminator docs in parallel
      console.log('[Q&A API] ⏳ Fetching workflow data and documentation...');

      const [workflowResult, workflowInfoResult, terminatorDocsResult] =
        await Promise.all([
          // Fetch workflow from JSONB column
          supabase
            .from('deployed_workflow_versions')
            .select('automation_sequence, version_number')
            .eq('workflow_id', execution.workflow_id)
            .eq('version_number', execution.version_number)
            .single(),
          // Fetch GitHub folder for the workflow
          supabase
            .from('deployed_workflows')
            .select('github_folder')
            .eq('id', execution.workflow_id)
            .single(),
          // Load Terminator documentation using shared service
          loadTerminatorDocs(),
        ]);

      const fetchDuration = Date.now() - fetchStartTime;
      console.log(`[Q&A API] Data fetch completed in ${fetchDuration}ms`);
      terminatorDocs = terminatorDocsResult;

      // Handle workflow loading with error handling
      let workflowData: any | null = null;
      let workflowLoadError: string | null = null;

      if (workflowResult.error) {
        console.error(
          `[Q&A API] Failed to fetch workflow for version ${execution.version_number}:`,
          workflowResult.error
        );
        workflowLoadError = `Failed to load workflow: ${workflowResult.error.message}`;

        // FALLBACK: Try to get the current version
        console.log(
          '[Q&A API] Attempting to fetch current version as fallback...'
        );
        const { data: currentWorkflow } = await supabase
          .from('deployed_workflows')
          .select('current_version_id')
          .eq('id', execution.workflow_id)
          .single();

        if (currentWorkflow?.current_version_id) {
          const { data: fallbackVersion } = await supabase
            .from('deployed_workflow_versions')
            .select('automation_sequence, version_number')
            .eq('id', currentWorkflow.current_version_id)
            .single();

          if (fallbackVersion?.automation_sequence) {
            workflowData = fallbackVersion.automation_sequence;
            workflowLoadError = `Version ${execution.version_number} not found, using current version ${fallbackVersion.version_number}`;
            console.warn(`[Q&A API] ${workflowLoadError}`);
          }
        }
      } else if (workflowResult.data?.automation_sequence) {
        // Load workflow from JSONB
        workflowData = workflowResult.data.automation_sequence;
        console.log(
          `[Q&A API] ✓ Loaded workflow v${execution.version_number} (${workflowData.steps?.length || 0} steps)`
        );
      } else {
        workflowLoadError = 'No workflow content found in database';
        console.warn(
          `[Q&A API] ${workflowLoadError} for version ${execution.version_number}`
        );
      }

      // Load JS files from GitHub (single source of truth)
      const workflowJsFiles: Record<string, string> = {};
      let jsFilesError: string | null = null;

      try {
        console.log(
          '[Q&A API] ⏳ Loading workflow JavaScript files from GitHub...'
        );

        const githubFolder = workflowInfoResult.data?.github_folder;

        if (!githubFolder) {
          jsFilesError = 'No GitHub folder configured for this workflow';
          console.warn(`[Q&A API] ${jsFilesError}`);
        } else {
          // Extract script file references from workflow
          const scriptFiles = new Set<string>();

          if (workflowData && workflowData.steps) {
            for (const step of workflowData.steps) {
              if (step.arguments) {
                if (step.arguments.script_file) {
                  scriptFiles.add(step.arguments.script_file);
                }
                if (step.arguments.scriptFile) {
                  scriptFiles.add(step.arguments.scriptFile);
                }
              }
            }
          }

          console.log(
            `[Q&A API] Found ${scriptFiles.size} JS files referenced in workflow`
          );

          // Fetch files from GitHub
          const githubToken = process.env.GITHUB_TOKEN;
          if (!githubToken) {
            jsFilesError = 'GitHub token not configured';
            console.error(`[Q&A API] ${jsFilesError}`);
          } else {
            // Fetch each file from GitHub
            const filePromises = Array.from(scriptFiles).map(async fileName => {
              try {
                const url = `https://api.github.com/repos/mediar-ai/workflows/contents/${githubFolder}/${fileName}`;
                const response = await fetch(url, {
                  headers: {
                    Authorization: `Bearer ${githubToken}`,
                    Accept: 'application/vnd.github.v3+json',
                  },
                });

                if (response.ok) {
                  const data = await response.json();
                  // Decode base64 content
                  const content = Buffer.from(data.content, 'base64').toString(
                    'utf-8'
                  );
                  workflowJsFiles[fileName] = content;
                  console.log(
                    `[Q&A API] ✓ Loaded ${fileName} from GitHub (${content.length} chars)`
                  );
                  return { fileName, success: true };
                } else if (response.status === 404) {
                  console.warn(
                    `[Q&A API] File not found in GitHub: ${fileName}`
                  );
                  return { fileName, success: false, error: 'Not found' };
                } else {
                  console.error(
                    `[Q&A API] Failed to fetch ${fileName} from GitHub: ${response.status}`
                  );
                  return {
                    fileName,
                    success: false,
                    error: `HTTP ${response.status}`,
                  };
                }
              } catch (err) {
                console.error(
                  `[Q&A API] Error fetching ${fileName} from GitHub:`,
                  err
                );
                return {
                  fileName,
                  success: false,
                  error: err instanceof Error ? err.message : 'Unknown error',
                };
              }
            });

            const results = await Promise.all(filePromises);
            const failedFiles = results.filter(r => !r.success);

            if (failedFiles.length > 0) {
              jsFilesError = `Failed to load ${failedFiles.length} files from GitHub: ${failedFiles.map(f => `${f.fileName} (${f.error})`).join(', ')}`;
              console.warn(`[Q&A API] ${jsFilesError}`);
            }

            console.log(
              `[Q&A API] ✓ Loaded ${Object.keys(workflowJsFiles).length}/${scriptFiles.size} JS files from GitHub`
            );
          }
        }
      } catch (err) {
        jsFilesError =
          err instanceof Error ? err.message : 'Unknown error loading JS files';
        console.error(
          '[Q&A API] Error loading workflow JS files from GitHub:',
          err
        );
        // Continue without JS files - don't fail the entire request
      }

      // Create workflow context with JS files
      workflowContext = {
        workflow: workflowData,
        workflowError: workflowLoadError,
        version: execution.version_number || 'unknown',
        workflowId: execution.workflow_id,
        jsFiles: workflowJsFiles,
        jsFilesError: jsFilesError,
      };

      const totalFetchDuration = Date.now() - fetchStartTime;
      console.log(`[Q&A API] ✓ All data fetched in ${totalFetchDuration}ms`);
      console.log(
        `[Q&A API] ${workflowData ? '✓' : '✗'} Workflow ${workflowData ? `loaded (${workflowData.steps?.length || 0} steps)` : `not loaded: ${workflowLoadError}`}`
      );
      console.log(
        `[Q&A API] ${Object.keys(workflowJsFiles).length > 0 ? '✓' : '✗'} JS Files ${Object.keys(workflowJsFiles).length > 0 ? `loaded (${Object.keys(workflowJsFiles).length} files)` : `not loaded: ${jsFilesError || 'No files'}`}`
      );
      console.log(
        `[Q&A API] ${terminatorDocs ? '✓' : '✗'} Terminator documentation ${terminatorDocs ? 'loaded' : 'failed to load'}`
      );

      // Store in cache for subsequent messages
      contextCache.set(executionId, {
        execution,
        workflowContext,
        terminatorDocs,
        timestamp: Date.now(),
      });
      console.log(`[Q&A API] ✓ Cached context for execution ${executionId}`);
    }

    // Extract execution data from the results field
    const executionData = execution.results
      ? queryTools.extractExecutionData(execution.results)
      : null;

    // Get basic summary
    const stepCount = executionData?.results?.length || 0;
    const summary = executionData
      ? queryTools.getExecutionSummary(executionData)
      : 'No detailed execution data available';

    console.log(
      `[Q&A API] 📊 Parsed execution data: ${stepCount} steps, ${execution.status} status`
    );
    if (execution.execution_logs) {
      console.log(
        `[Q&A API] 📋 Orchestrator logs: ${execution.execution_logs.length} entries`
      );
    }
    if (execution.screenshots) {
      console.log(
        `[Q&A API] 📸 Screenshots: ${execution.screenshots.length} available`
      );
    }

    // Build context with tool usage instructions
    const hasExecutionData = !!executionData;
    const context = `You are an AI assistant analyzing workflow execution #${execution.id}.

EXECUTION OVERVIEW:
- Status: ${execution.status}
- Duration: ${execution.execution_duration_seconds || 0} seconds
- Workflow ID: ${execution.workflow_id}
- Version: ${execution.version_number || 'unknown'}
- Total Steps Executed: ${stepCount}
${execution.error_message ? `- Error: ${execution.error_message}` : ''}
${
  !hasExecutionData
    ? `\n⚠️ IMPORTANT: This execution has NO runtime data (results field is empty).
This typically means the execution failed before it could start running steps, due to:
- Connectivity issues reaching the executor
- Executor service unavailable
- Invalid execution parameters
- Workflow loading failures`
    : ''
}

WORKFLOW DEFINITION:
${
  workflowContext.workflow
    ? `✓ Workflow loaded successfully (${workflowContext.workflow.steps?.length || 0} steps, v${workflowContext.version})`
    : `✗ Workflow not available: ${workflowContext.workflowError || 'Unknown error'}`
}
${
  Object.keys(workflowContext.jsFiles).length > 0
    ? `✓ JavaScript files loaded (${Object.keys(workflowContext.jsFiles).length} files): ${Object.keys(workflowContext.jsFiles).join(', ')}`
    : `✗ JavaScript files not available: ${workflowContext.jsFilesError || 'No files found'}`
}

${summary}

You have access to tools to query the execution data:

${
  hasExecutionData
    ? `EXECUTION ANALYSIS (Runtime Data Available):
1. searchLogs - Search for patterns in all execution logs
2. getStepDetails - Get complete details for a specific step
3. listSteps - List all steps with their status
4. getErrors - Get all error details
5. searchInResults - Search in step outputs/results
6. getTimeline - Get execution timeline
7. getPerformanceMetrics - Analyze performance`
    : `EXECUTION ANALYSIS (No Runtime Data):
⚠️ Tools 1-7 are UNAVAILABLE (searchLogs, getStepDetails, listSteps, getErrors, etc.)
Use getExecutionFailureReason() to understand why the execution failed before starting.
Check execution.error_message, execution.execution_logs, and execution_params for clues.`
}

WORKFLOW DEFINITION:
8. getWorkflowYaml - Get the complete YAML definition
9. searchWorkflowYaml - Search for patterns in the YAML
10. getWorkflowStepDefinition - Get YAML for a specific step
11. listWorkflowSteps - List all workflow steps with IDs, names, and descriptions

JAVASCRIPT FILES:
12. listJsFiles - List all JavaScript files in the workflow
13. getJsFile - Get the complete content of a specific JS file
14. searchJsFiles - Search for patterns across all JS files
15. getStepWithJsFile - Get step definition along with its JS file content

DOCUMENTATION:
16. searchTerminatorDocs - Search Terminator desktop automation documentation

PRE-EXECUTION FAILURE ANALYSIS:
17. getExecutionFailureReason - Get detailed information about why execution failed before starting

${terminatorDocs ? 'TERMINATOR DOCUMENTATION: Available - use searchTerminatorDocs to query desktop automation patterns, error handling, browser scripts, validation, and workflow best practices.' : ''}

DEBUGGING APPROACH:
${
  hasExecutionData
    ? `When analyzing failures, use this systematic approach:
1. Check what failed: Use getErrors() and getStepDetails() to understand the error
2. Check what it was supposed to do: Use getWorkflowStepDefinition() to see the step's YAML configuration
3. If the step uses a script: Use getStepWithJsFile() or getJsFile() to examine the JavaScript code
4. Check what actually happened: Use searchLogs() to find relevant log entries
5. Search for patterns: Use searchJsFiles() to find similar code patterns or error handling
6. Cross-reference with documentation: Use searchTerminatorDocs() for tool-specific guidance`
    : `When analyzing pre-execution failures:
1. Use getExecutionFailureReason() to get a summary of what went wrong
2. Check execution.error_message for the specific error
3. Review execution.execution_logs (orchestrator server logs) for connection/startup issues
4. Check execution_params to see if invalid parameters were sent
5. Use getWorkflowYaml() to see what SHOULD have run
6. If the workflow definition is missing, that may be the root cause`
}

IMPORTANT: When users ask about workflow steps, YAML content, or workflow structure, ALWAYS use the appropriate tools:
- If asked for workflow steps: Use listWorkflowSteps()
- If asked for the YAML: Use getWorkflowYaml()
- If asked about a specific step: Use getWorkflowStepDefinition()
- If asked about JS files: Use listJsFiles() and getJsFile()

Answer the user's question helpfully and thoroughly by using the available tools.`;

    // Define tools for the AI
    const tools = {
      searchLogs: {
        description: 'Search for patterns in all execution logs',
        inputSchema: z.object({
          pattern: z.string().describe('The pattern to search for'),
          limit: z
            .number()
            .optional()
            .default(50)
            .describe('Maximum number of results'),
        }),
        execute: async ({
          pattern,
          limit,
        }: {
          pattern: string;
          limit: number;
        }) => {
          if (!executionData) {
            return {
              error: 'No execution data available',
              reason:
                'This execution failed before any steps could run. No logs were generated.',
              suggestion:
                'Use getExecutionFailureReason() to understand why the execution failed before starting. Check execution.execution_logs for orchestrator server logs instead.',
            };
          }
          const results = queryTools.searchLogs(executionData, pattern, limit);
          return {
            found: results.length,
            matches: results,
          };
        },
      },

      getStepDetails: {
        description:
          'Get complete details for a specific step by index or name',
        inputSchema: z.object({
          stepId: z.string().describe('Step index (0,1,2...) or step name'),
        }),
        execute: async ({ stepId }: { stepId: string }) => {
          if (!executionData) return { error: 'No execution data available' };
          const step = queryTools.getStepDetails(executionData, stepId);
          if (!step) return { error: `Step '${stepId}' not found` };
          return step;
        },
      },

      listSteps: {
        description: 'List all workflow steps with their status and basic info',
        inputSchema: z.object({}),
        execute: async () => {
          if (!executionData) return { error: 'No execution data available' };
          const steps = queryTools.listSteps(executionData);
          return {
            totalSteps: steps.length,
            steps: steps,
          };
        },
      },

      getErrors: {
        description: 'Get all errors from the execution',
        inputSchema: z.object({
          limit: z
            .number()
            .optional()
            .default(20)
            .describe('Maximum number of errors to return'),
        }),
        execute: async ({ limit }: { limit: number }) => {
          if (!executionData) {
            return {
              error: 'No execution data available',
              reason:
                'This execution failed before any steps could run. No step errors were generated.',
              suggestion:
                'Use getExecutionFailureReason() instead. Check execution.error_message for the pre-execution failure reason.',
            };
          }
          const errors = queryTools.getErrors(executionData, limit);
          return {
            errorCount: errors.length,
            errors: errors,
          };
        },
      },

      searchInResults: {
        description: 'Search for patterns in step outputs/results',
        inputSchema: z.object({
          pattern: z.string().describe('The pattern to search for in results'),
          limit: z
            .number()
            .optional()
            .default(20)
            .describe('Maximum number of results'),
        }),
        execute: async ({
          pattern,
          limit,
        }: {
          pattern: string;
          limit: number;
        }) => {
          if (!executionData) return { error: 'No execution data available' };
          const results = queryTools.searchInResults(
            executionData,
            pattern,
            limit
          );
          return {
            found: results.length,
            matches: results,
          };
        },
      },

      getTimeline: {
        description: 'Get the execution timeline showing when each step ran',
        inputSchema: z.object({}),
        execute: async () => {
          if (!executionData) return { error: 'No execution data available' };
          const timeline = queryTools.getTimeline(executionData);
          return {
            steps: timeline.length,
            timeline: timeline,
          };
        },
      },

      getPerformanceMetrics: {
        description: 'Get performance metrics and timing analysis',
        inputSchema: z.object({}),
        execute: async () => {
          if (!executionData) return { error: 'No execution data available' };
          const metrics = queryTools.getPerformanceMetrics(executionData);
          if (!metrics) return { error: 'No performance data available' };
          return metrics;
        },
      },

      getLogsByTimeRange: {
        description: 'Get logs within a specific time range',
        inputSchema: z.object({
          startTime: z
            .string()
            .describe(
              'Start time (ISO format or relative like "2 minutes ago")'
            ),
          endTime: z
            .string()
            .describe('End time (ISO format or relative like "now")'),
        }),
        execute: async ({
          startTime,
          endTime,
        }: {
          startTime: string;
          endTime: string;
        }) => {
          if (!executionData) return { error: 'No execution data available' };
          const logs = queryTools.getLogsByTimeRange(
            executionData,
            startTime,
            endTime
          );
          return {
            logCount: logs.length,
            logs: logs,
          };
        },
      },

      extractSection: {
        description:
          'Extract a specific section from the execution data using dot notation path',
        inputSchema: z.object({
          path: z
            .string()
            .describe('Dot notation path (e.g., "results.0.logs" or "status")'),
        }),
        execute: async ({ path }: { path: string }) => {
          if (!executionData) return { error: 'No execution data available' };
          const section = queryTools.extractSection(executionData, path);
          if (section === null) return { error: `Path '${path}' not found` };
          return { path, data: section };
        },
      },

      searchTerminatorDocs: {
        description:
          'Search Terminator desktop automation documentation for tool usage, patterns, best practices, and troubleshooting',
        inputSchema: z.object({
          pattern: z
            .string()
            .describe(
              'Search pattern or topic (e.g., "click_element", "browser script", "validation", "error handling")'
            ),
          limit: z
            .number()
            .optional()
            .default(5)
            .describe('Maximum number of matching sections to return'),
        }),
        execute: async ({
          pattern,
          limit,
        }: {
          pattern: string;
          limit: number;
        }) => {
          if (!terminatorDocs)
            return { error: 'Terminator documentation not available' };

          // Use shared search function
          const matches = searchDocs(terminatorDocs, pattern, limit);

          return {
            found: matches.length,
            query: pattern,
            matches: matches,
          };
        },
      },

      getWorkflowYaml: {
        description:
          'Get the complete workflow definition that was used for this execution',
        inputSchema: z.object({}),
        execute: async () => {
          if (!workflowContext.workflow) {
            return {
              error: workflowContext.workflowError || 'Workflow not available',
              version: workflowContext.version,
              workflowId: workflowContext.workflowId,
            };
          }

          return {
            version: workflowContext.version,
            workflowId: workflowContext.workflowId,
            workflow: workflowContext.workflow,
            stepCount: workflowContext.workflow.steps?.length || 0,
            hasVariables: !!workflowContext.workflow.variables,
            hasSelectors: !!workflowContext.workflow.selectors,
          };
        },
      },

      searchWorkflowYaml: {
        description:
          'Search for specific patterns or keywords in the workflow definition',
        inputSchema: z.object({
          pattern: z
            .string()
            .describe('Pattern to search for (case-insensitive)'),
          searchIn: z
            .enum(['steps', 'variables', 'selectors', 'all'])
            .optional()
            .default('all')
            .describe('Where to search'),
        }),
        execute: async ({
          pattern,
          searchIn,
        }: {
          pattern: string;
          searchIn: string;
        }) => {
          if (!workflowContext.workflow) {
            return { error: 'Workflow not available' };
          }

          const matches: Array<any> = [];
          const searchPattern = pattern.toLowerCase();

          // Search in steps
          if (searchIn === 'all' || searchIn === 'steps') {
            workflowContext.workflow.steps?.forEach(
              (step: any, idx: number) => {
                const stepStr = JSON.stringify(step).toLowerCase();
                if (stepStr.includes(searchPattern)) {
                  matches.push({
                    type: 'step',
                    index: idx,
                    id: step.id,
                    name: step.name,
                    tool: step.tool_name || step.tool,
                    match: step,
                  });
                }
              }
            );
          }

          // Search in variables
          if (searchIn === 'all' || searchIn === 'variables') {
            const vars = workflowContext.workflow.variables || {};
            Object.entries(vars).forEach(([key, value]) => {
              const varStr = JSON.stringify({ key, value }).toLowerCase();
              if (varStr.includes(searchPattern)) {
                matches.push({
                  type: 'variable',
                  key,
                  value,
                });
              }
            });
          }

          // Search in selectors
          if (searchIn === 'all' || searchIn === 'selectors') {
            const selectors = workflowContext.workflow.selectors || {};
            Object.entries(selectors).forEach(([key, value]) => {
              const selStr = JSON.stringify({ key, value }).toLowerCase();
              if (selStr.includes(searchPattern)) {
                matches.push({
                  type: 'selector',
                  key,
                  value,
                });
              }
            });
          }

          return {
            pattern,
            searchIn,
            found: matches.length,
            matches: matches.slice(0, 20), // Limit to 20 matches
          };
        },
      },

      getWorkflowStepDefinition: {
        description: 'Get the definition for a specific step in the workflow',
        inputSchema: z.object({
          stepIdentifier: z
            .string()
            .describe('Step index (0-based), step ID, or step name'),
        }),
        execute: async ({ stepIdentifier }: { stepIdentifier: string }) => {
          if (!workflowContext.workflow?.steps) {
            return { error: 'Workflow steps not available' };
          }

          const steps = workflowContext.workflow.steps;
          let targetStep: any = null;
          let stepIndex = -1;

          // Check if it's a number (index)
          if (/^\d+$/.test(stepIdentifier)) {
            stepIndex = parseInt(stepIdentifier);
            if (stepIndex >= 0 && stepIndex < steps.length) {
              targetStep = steps[stepIndex];
            }
          } else {
            // Search by ID or name
            steps.forEach((step: any, idx: number) => {
              if (
                step.id === stepIdentifier ||
                step.name
                  ?.toLowerCase()
                  .includes(stepIdentifier.toLowerCase()) ||
                step.tool_name
                  ?.toLowerCase()
                  .includes(stepIdentifier.toLowerCase())
              ) {
                targetStep = step;
                stepIndex = idx;
              }
            });
          }

          if (!targetStep) {
            return {
              error: `Step '${stepIdentifier}' not found`,
              availableSteps: steps.map((s: any, idx: number) => ({
                index: idx,
                id: s.id,
                name: s.name,
                tool: s.tool_name || s.tool,
              })),
            };
          }

          return {
            stepIndex,
            step: targetStep,
            id: targetStep.id,
            name: targetStep.name,
            tool: targetStep.tool_name || targetStep.tool,
            scriptFile: targetStep.arguments?.script_file,
            delay: targetStep.delay,
            fallbackId: targetStep.fallback_id,
          };
        },
      },

      listWorkflowSteps: {
        description: 'List all workflow steps with their IDs, names, and tools',
        inputSchema: z.object({
          includeDetails: z
            .boolean()
            .optional()
            .default(false)
            .describe('Include full step details'),
        }),
        execute: async ({ includeDetails }: { includeDetails: boolean }) => {
          console.log('[Q&A API Tool] listWorkflowSteps called');
          console.log(
            '[Q&A API Tool] workflowContext.workflow exists:',
            !!workflowContext.workflow
          );
          console.log(
            '[Q&A API Tool] workflowContext.workflow?.steps exists:',
            !!workflowContext.workflow?.steps
          );
          if (workflowContext.workflow?.steps) {
            console.log(
              '[Q&A API Tool] Steps count:',
              workflowContext.workflow.steps.length
            );
          }

          if (!workflowContext.workflow?.steps) {
            console.log(
              '[Q&A API Tool] Returning error: Workflow steps not available'
            );
            return { error: 'Workflow steps not available' };
          }

          const steps = workflowContext.workflow.steps.map(
            (step: any, index: number) => {
              const summary = {
                index,
                id: step.id,
                name: step.name,
                tool: step.tool_name || step.tool,
                scriptFile: step.arguments?.script_file,
                fallbackId: step.fallback_id,
                delay: step.delay,
              };

              if (includeDetails) {
                return {
                  ...summary,
                  arguments: step.arguments,
                  jumps: step.jumps,
                  fullStep: step,
                };
              }

              return summary;
            }
          );

          return {
            totalSteps: steps.length,
            steps,
          };
        },
      },

      listJsFiles: {
        description: 'List all JavaScript files available for this workflow',
        inputSchema: z.object({}),
        execute: async () => {
          const files = Object.keys(workflowContext.jsFiles);

          if (files.length === 0) {
            return {
              error:
                workflowContext.jsFilesError || 'No JavaScript files available',
              files: [],
            };
          }

          // Get file info
          const fileInfo = files.map(fileName => ({
            name: fileName,
            size: workflowContext.jsFiles[fileName].length,
            lines: workflowContext.jsFiles[fileName].split('\n').length,
          }));

          return {
            count: files.length,
            files: fileInfo,
            totalSize: fileInfo.reduce((sum, f) => sum + f.size, 0),
          };
        },
      },

      getJsFile: {
        description: 'Get the complete content of a specific JavaScript file',
        inputSchema: z.object({
          fileName: z
            .string()
            .describe('File name (e.g., "read_json_file.js")'),
        }),
        execute: async ({ fileName }: { fileName: string }) => {
          if (!(fileName in workflowContext.jsFiles)) {
            // Try to find a partial match
            const availableFiles = Object.keys(workflowContext.jsFiles);
            const partialMatch = availableFiles.find(f =>
              f.toLowerCase().includes(fileName.toLowerCase())
            );

            if (partialMatch) {
              fileName = partialMatch;
            } else {
              return {
                error: `File '${fileName}' not found`,
                availableFiles:
                  availableFiles.length > 0
                    ? availableFiles
                    : 'No files available',
              };
            }
          }

          const content = workflowContext.jsFiles[fileName];
          return {
            fileName,
            content,
            size: content.length,
            lines: content.split('\n').length,
            firstLines: content.split('\n').slice(0, 10).join('\n'),
            lastLines: content.split('\n').slice(-10).join('\n'),
          };
        },
      },

      searchJsFiles: {
        description: 'Search for patterns across all JavaScript files',
        inputSchema: z.object({
          pattern: z
            .string()
            .describe('Pattern to search for (case-insensitive)'),
          includeContext: z
            .boolean()
            .optional()
            .default(true)
            .describe('Include surrounding lines'),
          contextLines: z
            .number()
            .optional()
            .default(2)
            .describe('Number of context lines'),
          limit: z
            .number()
            .optional()
            .default(20)
            .describe('Maximum matches to return'),
        }),
        execute: async ({
          pattern,
          includeContext,
          contextLines,
          limit,
        }: {
          pattern: string;
          includeContext: boolean;
          contextLines: number;
          limit: number;
        }) => {
          const matches: Array<{
            file: string;
            lineNumber: number;
            line: string;
            context?: string;
          }> = [];

          for (const [fileName, content] of Object.entries(
            workflowContext.jsFiles
          )) {
            const lines = content.split('\n');

            lines.forEach((line, idx) => {
              if (line.toLowerCase().includes(pattern.toLowerCase())) {
                const match: any = {
                  file: fileName,
                  lineNumber: idx + 1,
                  line: line.trim(),
                };

                if (includeContext) {
                  const start = Math.max(0, idx - contextLines);
                  const end = Math.min(lines.length - 1, idx + contextLines);
                  match.context = lines
                    .slice(start, end + 1)
                    .map((l, i) => `${start + i + 1}: ${l}`)
                    .join('\n');
                }

                matches.push(match);

                if (matches.length >= limit) {
                  return {
                    pattern,
                    found: matches.length,
                    limitReached: true,
                    matches,
                  };
                }
              }
            });
          }

          return {
            pattern,
            found: matches.length,
            matches,
          };
        },
      },

      getStepWithJsFile: {
        description:
          'Get workflow step definition along with its JavaScript file content',
        inputSchema: z.object({
          stepIdentifier: z
            .string()
            .describe('Step index (0-based) or step ID/name'),
        }),
        execute: async ({ stepIdentifier }: { stepIdentifier: string }) => {
          // Check if workflow is available
          if (!workflowContext.workflow) {
            return { error: 'Workflow not available' };
          }

          // Get steps array from JSON workflow
          const steps = workflowContext.workflow.steps || [];
          if (!Array.isArray(steps)) {
            return { error: 'No steps found in workflow' };
          }

          // Find the requested step
          let targetStep: any = null;
          let targetIndex = -1;

          if (/^\d+$/.test(stepIdentifier)) {
            // Numeric identifier - treat as index
            targetIndex = parseInt(stepIdentifier);
            targetStep = steps[targetIndex];
          } else {
            // Search by id or name
            steps.forEach((step, idx) => {
              if (
                step.id?.toLowerCase() === stepIdentifier.toLowerCase() ||
                step.name?.toLowerCase().includes(stepIdentifier.toLowerCase())
              ) {
                targetStep = step;
                targetIndex = idx;
              }
            });
          }

          if (!targetStep) {
            return {
              error: `Step '${stepIdentifier}' not found`,
              availableSteps: steps.map((s, idx) => ({
                index: idx,
                id: s.id,
                name: s.name || s.id,
              })),
            };
          }

          // Build result with step details from JSON
          const result: any = {
            stepIndex: targetIndex,
            stepId: targetStep.id,
            stepName: targetStep.name || targetStep.id,
            tool: targetStep.tool,
            stepDefinition: targetStep,
          };

          // Check for script file reference in the JSON step
          const scriptFile = targetStep.script_file || targetStep.scriptFile;
          if (scriptFile) {
            result.scriptFile = scriptFile;

            if (scriptFile in workflowContext.jsFiles) {
              const jsContent = workflowContext.jsFiles[scriptFile];
              result.jsFileContent = jsContent;
              result.jsFileSize = jsContent.length;
              result.jsFileLines = jsContent.split('\n').length;
            } else {
              result.jsFileError = `Script file '${scriptFile}' not found in loaded files`;
              result.availableFiles = Object.keys(workflowContext.jsFiles);
            }
          } else {
            result.scriptFile = null;
            result.note = 'This step does not use a JavaScript file';
          }

          return result;
        },
      },

      getExecutionFailureReason: {
        description:
          'Get detailed information about why the execution failed before starting (use when no runtime data is available)',
        inputSchema: z.object({}),
        execute: async () => {
          return {
            status: execution.status,
            errorMessage:
              execution.error_message || 'No error message provided',
            hasRuntimeData: !!executionData,
            duration: execution.execution_duration_seconds || 0,
            executionParams: execution.execution_params || null,
            orchestratorLogsCount: execution.execution_logs?.length || 0,
            orchestratorLogs: execution.execution_logs || [],
            screenshotsCount: execution.screenshots?.length || 0,
            workflowAvailable: !!workflowContext.workflow,
            workflowError: workflowContext.workflowError,
            analysis: !executionData
              ? 'This execution failed before any steps could run. This is a pre-execution failure - the workflow never started. Check error_message and orchestrator logs for connectivity/startup issues.'
              : `Execution ran and completed ${stepCount} steps. This is NOT a pre-execution failure.`,
          };
        },
      },
    };

    // Provide comprehensive execution data in the context
    const stepsData = executionData ? queryTools.listSteps(executionData) : [];
    const errorsData = executionData ? queryTools.getErrors(executionData) : [];

    // Parse formatted output if available
    let formattedOutput = null;
    if (execution.formatted_output) {
      try {
        formattedOutput =
          typeof execution.formatted_output === 'string'
            ? JSON.parse(execution.formatted_output)
            : execution.formatted_output;
      } catch (e) {
        formattedOutput = execution.formatted_output;
      }
    }

    const enrichedContext =
      context +
      `\n\n=== EXECUTION DATA ===\n` +
      (executionData
        ? `Steps (${stepsData.length} total):\n${JSON.stringify(stepsData, null, 2)}\n\n`
        : `⚠️ NO RUNTIME DATA: The execution did not produce any step results.\n` +
          `This means the workflow never started running. Check error_message and execution_logs below.\n\n`) +
      (errorsData.length > 0
        ? `Errors:\n${JSON.stringify(errorsData, null, 2)}\n\n`
        : '') +
      (formattedOutput
        ? `Formatted Output:\n${JSON.stringify(formattedOutput, null, 2)}\n\n`
        : '') +
      (execution.error_analysis
        ? `AI Error Analysis:\n${execution.error_analysis}\n\n`
        : '') +
      (execution.execution_params
        ? `Execution Parameters:\n${JSON.stringify(execution.execution_params, null, 2)}\n\n`
        : '') +
      (execution.screenshots && execution.screenshots.length > 0
        ? `Screenshots: ${execution.screenshots.length} monitor screenshots available\n\n`
        : '') +
      (execution.execution_logs && execution.execution_logs.length > 0
        ? `Orchestrator Server Logs (${execution.execution_logs.length} entries):\n${JSON.stringify(execution.execution_logs, null, 2)}\n\n`
        : '') +
      `Answer the user's question based on this data. Be specific and helpful.\n\n` +
      `IMPORTANT: When you use tools, ALWAYS provide a text response after getting the tool results to explain or summarize them for the user. Never end without a final text response.`;

    // Helper: Convert Zod schema to Vertex FunctionDeclaration parameters
    function zodToVertexSchema(schema: z.ZodObject<any>): any {
      const shape = schema.shape;
      const properties: any = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        const zodType = value as z.ZodTypeAny;

        // Extract description
        const description = (zodType as any)._def?.description || '';

        // Determine type
        let type = 'string';
        let items = undefined;
        let enumValues = undefined;

        if (zodType instanceof z.ZodString) {
          type = 'string';
          const enumDef = (zodType as any)._def?.checks?.find(
            (c: any) => c.kind === 'enum'
          );
          if (enumDef) {
            enumValues = enumDef.values;
          }
        } else if (zodType instanceof z.ZodNumber) {
          type = 'number';
        } else if (zodType instanceof z.ZodBoolean) {
          type = 'boolean';
        } else if (zodType instanceof z.ZodArray) {
          type = 'array';
          items = { type: 'string' }; // Simplified
        } else if (zodType instanceof z.ZodEnum) {
          type = 'string';
          enumValues = (zodType as any)._def.values;
        }

        properties[key] = {
          type,
          description,
          ...(items && { items }),
          ...(enumValues && { enum: enumValues }),
        };

        // Check if required (not optional)
        if (
          !(zodType instanceof z.ZodOptional) &&
          !(zodType instanceof z.ZodDefault)
        ) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required,
      };
    }

    // Convert tools to Vertex FunctionDeclarations
    const functionDeclarations: FunctionDeclaration[] = Object.entries(
      tools
    ).map(([name, tool]) => ({
      name,
      description: tool.description,
      parameters: zodToVertexSchema(tool.inputSchema as z.ZodObject<any>),
    }));

    console.log(
      `[Q&A API] Converted ${functionDeclarations.length} tools to FunctionDeclarations`
    );

    // Initialize Vertex AI
    const project =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_VERTEX_PROJECT ||
      process.env.GOOGLE_PROJECT_ID ||
      'mediar-394022';
    const location =
      process.env.VERTEX_AI_LOCATION ||
      process.env.GOOGLE_VERTEX_LOCATION ||
      'us-central1';

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
      credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    }

    const credentials = credentialsJson
      ? JSON.parse(credentialsJson)
      : undefined;

    const genAI = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: credentials
        ? {
            credentials: {
              client_email: credentials.client_email,
              private_key: credentials.private_key,
            },
          }
        : undefined,
    });

    // Convert message history to new SDK format
    const history: Content[] = messages.slice(0, -1).map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const userMessage = messages[messages.length - 1].content;

    console.log(
      `[Q&A API] Starting conversation with ${history.length} previous messages using ${model}`
    );

    // Create chat session using new SDK
    const chat = genAI.chats.create({
      model: model,
      history,
      config: {
        systemInstruction: enrichedContext,
        temperature: 0.7,
        maxOutputTokens: 8192,
        tools: functionDeclarations.length > 0
          ? [{ functionDeclarations }]
          : undefined,
      },
    });

    // Multi-turn conversation loop
    let finalText = '';
    let turnCount = 0;
    const maxTurns = 10; // Prevent infinite loops

    while (turnCount < maxTurns) {
      turnCount++;
      console.log(`[Q&A API] Turn ${turnCount}: Sending message to model`);

      const response = await sendMessageWithRetry(chat, userMessage, {
        maxRetries: 3,
        baseDelayMs: 1000,
        messageType: 'user message',
      });
      const candidates = response.candidates;

      if (!candidates || candidates.length === 0) {
        throw new Error('No candidate in response');
      }

      const candidate = candidates[0];
      const parts = candidate.content?.parts || [];

      // Extract text parts
      const textParts = parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text);

      // Extract function calls
      const functionCalls = parts
        .filter((p: any) => p.functionCall)
        .map((p: any) => p.functionCall);

      console.log(
        `[Q&A API] Turn ${turnCount}: Received ${textParts.length} text parts, ${functionCalls.length} function calls`
      );

      if (functionCalls.length > 0) {
        // Execute tools
        console.log(
          `[Q&A API] Executing ${functionCalls.length} tool(s): ${functionCalls.map((fc: any) => fc.name).join(', ')}`
        );

        const functionResponses = await Promise.all(
          functionCalls.map(async (fc: any) => {
            const toolName = fc.name as string;
            const toolArgs = fc.args || {};

            console.log(`[Q&A API] Executing tool: ${toolName}`);

            if (!tools[toolName as keyof typeof tools]) {
              console.error(`[Q&A API] Tool not found: ${toolName}`);
              return {
                name: toolName,
                response: { error: `Tool ${toolName} not found` },
              };
            }

            try {
              const result =
                await tools[toolName as keyof typeof tools].execute(toolArgs);
              console.log(`[Q&A API] Tool ${toolName} executed successfully`);
              return {
                name: toolName,
                response: result,
              };
            } catch (error) {
              console.error(
                `[Q&A API] Tool ${toolName} execution failed:`,
                error
              );
              return {
                name: toolName,
                response: {
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Tool execution failed',
                },
              };
            }
          })
        );

        // Send function responses back to model
        // Vertex AI expects an array of parts, each with functionResponse (singular)
        const functionResponseParts = functionResponses.map(fr => ({
          functionResponse: {
            name: fr.name,
            response: fr.response,
          },
        }));

        console.log(
          `[Q&A API] Sending ${functionResponses.length} tool result(s) back to model`
        );

        // Continue the conversation with tool results
        const nextResponse = await sendMessageWithRetry(
          chat,
          functionResponseParts,
          {
            maxRetries: 3,
            baseDelayMs: 1000,
            messageType: 'tool results',
          }
        );
        const nextCandidates = nextResponse.candidates;

        if (nextCandidates && nextCandidates.length > 0) {
          const nextCandidate = nextCandidates[0];
          const nextParts = nextCandidate.content?.parts || [];
          const nextTextParts = nextParts
            .filter((p: any) => p.text)
            .map((p: any) => p.text);

          if (nextTextParts.length > 0) {
            finalText = nextTextParts.join('');
            console.log(
              `[Q&A API] Got final text response after tool execution (${finalText.length} chars)`
            );
            break;
          }
        }

        turnCount++;
        continue;
      }

      // No function calls, we have the final response
      if (textParts.length > 0) {
        finalText = textParts.join('');
        console.log(
          `[Q&A API] Got direct text response (${finalText.length} chars)`
        );
        break;
      }

      // No text and no function calls - unexpected
      console.warn(
        '[Q&A API] No text or function calls in response, ending conversation'
      );
      break;
    }

    if (turnCount >= maxTurns) {
      console.warn('[Q&A API] Reached maximum turn count');
    }

    console.log(`[Q&A API] Conversation completed in ${turnCount} turns`);

    // Save conversation
    try {
      const updatedMessages = [
        ...messages,
        {
          id: Date.now().toString(),
          role: 'assistant' as const,
          content: finalText,
        },
      ];

      const saveResponse = await supabase
        .from('execution_qa_conversations')
        .upsert(
          {
            execution_id: parseInt(executionId),
            user_id: userId,
            messages: updatedMessages,
          },
          {
            onConflict: 'execution_id,user_id',
          }
        )
        .select('id')
        .single();

      if (saveResponse.error) {
        console.error(
          '[Q&A API] Failed to save conversation:',
          saveResponse.error
        );
      } else {
        console.log('[Q&A API] Conversation saved successfully');
      }
    } catch (saveError) {
      console.error('[Q&A API] Error saving conversation:', saveError);
    }

    // Return response
    return NextResponse.json({
      text: finalText,
      turns: turnCount,
    });
  } catch (error) {
    console.error('Error in execution Q&A:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
