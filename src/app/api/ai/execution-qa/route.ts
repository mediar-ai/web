import { NextResponse } from 'next/server';
import { createVertex } from '@ai-sdk/google-vertex';
import { streamText } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import * as queryTools from '@/lib/execution-query-tools';

// Interface for workflow context
interface WorkflowContext {
  yaml: string | null;
  yamlError: string | null;
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

    // First fetch execution data to get workflow_id and version
    console.log('[Q&A API] ⏳ Fetching execution data...');
    const fetchStartTime = Date.now();

    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (error || !execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    console.log(`[Q&A API] ✓ Execution loaded - workflow_id: ${execution.workflow_id}, version: ${execution.version_number}`);

    // Now fetch YAML and Terminator docs in parallel
    console.log('[Q&A API] ⏳ Fetching workflow YAML and Terminator documentation...');

    const [workflowYamlResult, terminatorDocsResult] = await Promise.all([
      // Fetch workflow for the specific version (can be YAML or JSONB)
      supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, automation_sequence, version_number, preferred_format')
        .eq('workflow_id', execution.workflow_id)
        .eq('version_number', execution.version_number)
        .single(),
      // Fetch Terminator documentation
      fetch('https://raw.githubusercontent.com/mediar-ai/terminator/main/terminator-mcp-agent/src/prompt.rs')
        .then(res => res.ok ? res.text() : null)
        .catch(() => null)
    ]);

    const fetchDuration = Date.now() - fetchStartTime;
    const terminatorDocs = terminatorDocsResult;

    // Handle workflow YAML loading with error handling
    let workflowYaml: string | null = null;
    let yamlLoadError: string | null = null;

    if (workflowYamlResult.error) {
      console.error(`[Q&A API] Failed to fetch workflow for version ${execution.version_number}:`, workflowYamlResult.error);
      yamlLoadError = `Failed to load workflow: ${workflowYamlResult.error.message}`;

      // FALLBACK: Try to get the current version
      console.log('[Q&A API] Attempting to fetch current version as fallback...');
      const { data: currentWorkflow } = await supabase
        .from('deployed_workflows')
        .select('current_version_id')
        .eq('id', execution.workflow_id)
        .single();

      if (currentWorkflow?.current_version_id) {
        const { data: fallbackVersion } = await supabase
          .from('deployed_workflow_versions')
          .select('automation_sequence_yaml, automation_sequence, version_number, preferred_format')
          .eq('id', currentWorkflow.current_version_id)
          .single();

        if (fallbackVersion) {
          // Check which format to use
          if (fallbackVersion.preferred_format === 'jsonb' && fallbackVersion.automation_sequence) {
            // Convert JSON to YAML-like string representation
            workflowYaml = JSON.stringify(fallbackVersion.automation_sequence, null, 2);
            yamlLoadError = `Version ${execution.version_number} not found, using current version ${fallbackVersion.version_number} (JSONB format)`;
          } else if (fallbackVersion.automation_sequence_yaml) {
            workflowYaml = fallbackVersion.automation_sequence_yaml;
            yamlLoadError = `Version ${execution.version_number} not found, using current version ${fallbackVersion.version_number} (YAML format)`;
          }
          console.warn(`[Q&A API] ${yamlLoadError}`);
        }
      }
    } else if (workflowYamlResult.data) {
      // Check which format to use based on preferred_format
      const versionData = workflowYamlResult.data;

      if (versionData.preferred_format === 'jsonb' && versionData.automation_sequence) {
        // Handle JSONB format
        workflowYaml = JSON.stringify(versionData.automation_sequence, null, 2);
        console.log(`[Q&A API] ✓ Loaded workflow from JSONB v${execution.version_number} (${workflowYaml.length} chars)`);
      } else if (versionData.automation_sequence_yaml) {
        // Handle YAML format
        workflowYaml = versionData.automation_sequence_yaml;
        console.log(`[Q&A API] ✓ Loaded workflow from YAML v${execution.version_number} (${workflowYaml!.length} chars)`);
      } else {
        yamlLoadError = 'No workflow content found in either YAML or JSONB format';
        console.warn(`[Q&A API] ${yamlLoadError} for version ${execution.version_number}`);
      }
    }

    // Load JS files for the workflow
    const workflowJsFiles: Record<string, string> = {};
    let jsFilesError: string | null = null;

    try {
      console.log('[Q&A API] ⏳ Loading workflow JavaScript files...');

      // Fetch JS files metadata from database
      const { data: files, error: filesError } = await supabase
        .from('workflow_files')
        .select('file_path, storage_path, file_size')
        .eq('workflow_id', execution.workflow_id)
        .eq('version_number', execution.version_number);

      if (filesError) {
        jsFilesError = `Failed to fetch file metadata: ${filesError.message}`;
        console.error(`[Q&A API] ${jsFilesError}`);
      } else if (files && files.length > 0) {
        console.log(`[Q&A API] Found ${files.length} JS files to load`);

        // Generate signed URLs for each file
        const signedUrls: Record<string, string> = {};
        for (const file of files) {
          const { data } = await supabase.storage
            .from('workflow-files')
            .createSignedUrl(file.storage_path, 3600); // 1 hour expiry

          if (data?.signedUrl) {
            signedUrls[file.file_path] = data.signedUrl;
          } else {
            console.warn(`[Q&A API] Failed to get signed URL for ${file.file_path}`);
          }
        }

        // Download file contents in parallel
        const downloadPromises = Object.entries(signedUrls).map(async ([filePath, url]) => {
          try {
            const response = await fetch(url);
            if (response.ok) {
              const content = await response.text();
              workflowJsFiles[filePath] = content;
              console.log(`[Q&A API] ✓ Loaded ${filePath} (${content.length} chars)`);
              return { filePath, success: true };
            } else {
              console.error(`[Q&A API] Failed to download ${filePath}: HTTP ${response.status}`);
              return { filePath, success: false };
            }
          } catch (err) {
            console.error(`[Q&A API] Error downloading ${filePath}:`, err);
            return { filePath, success: false };
          }
        });

        const results = await Promise.all(downloadPromises);
        const failedFiles = results.filter(r => !r.success);

        if (failedFiles.length > 0) {
          jsFilesError = `Failed to download ${failedFiles.length} files: ${failedFiles.map(f => f.filePath).join(', ')}`;
        }

        console.log(`[Q&A API] ✓ Loaded ${Object.keys(workflowJsFiles).length}/${files.length} JS files`);
      } else {
        console.log(`[Q&A API] No JS files found for version ${execution.version_number}`);
      }
    } catch (err) {
      jsFilesError = err instanceof Error ? err.message : 'Unknown error loading JS files';
      console.error('[Q&A API] Error loading workflow JS files:', err);
      // Continue without JS files - don't fail the entire request
    }

    // Create workflow context with JS files
    const workflowContext: WorkflowContext = {
      yaml: workflowYaml,
      yamlError: yamlLoadError,
      version: execution.version_number || 'unknown',
      workflowId: execution.workflow_id,
      jsFiles: workflowJsFiles,
      jsFilesError: jsFilesError
    };

    const totalFetchDuration = Date.now() - fetchStartTime;
    console.log(`[Q&A API] ✓ All data fetched in ${totalFetchDuration}ms`);
    console.log(`[Q&A API] ${workflowYaml ? '✓' : '✗'} Workflow YAML ${workflowYaml ? `loaded (${workflowYaml.length} chars)` : `not loaded: ${yamlLoadError}`}`);
    console.log(`[Q&A API] ${Object.keys(workflowJsFiles).length > 0 ? '✓' : '✗'} JS Files ${Object.keys(workflowJsFiles).length > 0 ? `loaded (${Object.keys(workflowJsFiles).length} files)` : `not loaded: ${jsFilesError || 'No files'}`}`);
    console.log(`[Q&A API] ${terminatorDocs ? '✓' : '✗'} Terminator documentation ${terminatorDocs ? 'loaded' : 'failed to load'}`);

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
- Workflow ID: ${execution.workflow_id}
- Version: ${execution.version_number || 'unknown'}
- Total Steps: ${stepCount}
${execution.error_message ? `- Error: ${execution.error_message}` : ''}

WORKFLOW DEFINITION:
${workflowContext.yaml ?
  `✓ YAML loaded successfully (${workflowContext.yaml.length} chars, v${workflowContext.version})` :
  `✗ YAML not available: ${workflowContext.yamlError || 'Unknown error'}`}
${Object.keys(workflowContext.jsFiles).length > 0 ?
  `✓ JavaScript files loaded (${Object.keys(workflowContext.jsFiles).length} files): ${Object.keys(workflowContext.jsFiles).join(', ')}` :
  `✗ JavaScript files not available: ${workflowContext.jsFilesError || 'No files found'}`}

${summary}

You have access to tools to query the complete execution data:

EXECUTION ANALYSIS:
1. searchLogs - Search for patterns in all execution logs
2. getStepDetails - Get complete details for a specific step
3. listSteps - List all steps with their status
4. getErrors - Get all error details
5. searchInResults - Search in step outputs/results
6. getTimeline - Get execution timeline
7. getPerformanceMetrics - Analyze performance

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

${terminatorDocs ? 'TERMINATOR DOCUMENTATION: Available - use searchTerminatorDocs to query desktop automation patterns, error handling, browser scripts, validation, and workflow best practices.' : ''}

DEBUGGING APPROACH:
When analyzing failures, use this systematic approach:
1. Check what failed: Use getErrors() and getStepDetails() to understand the error
2. Check what it was supposed to do: Use getWorkflowStepDefinition() to see the step's YAML configuration
3. If the step uses a script: Use getStepWithJsFile() or getJsFile() to examine the JavaScript code
4. Check what actually happened: Use searchLogs() to find relevant log entries
5. Search for patterns: Use searchJsFiles() to find similar code patterns or error handling
6. Cross-reference with documentation: Use searchTerminatorDocs() for tool-specific guidance

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
      },

      getWorkflowYaml: {
        description: 'Get the complete workflow YAML definition that was used for this execution',
        inputSchema: z.object({}),
        execute: async () => {
          if (!workflowContext.yaml) {
            return {
              error: workflowContext.yamlError || 'Workflow YAML not available',
              version: workflowContext.version,
              workflowId: workflowContext.workflowId
            };
          }

          // Parse to count steps
          const stepCount = (workflowContext.yaml.match(/^\s*-?\s*tool:/gm) || []).length;

          return {
            version: workflowContext.version,
            workflowId: workflowContext.workflowId,
            yaml: workflowContext.yaml,
            length: workflowContext.yaml.length,
            estimatedSteps: stepCount
          };
        }
      },

      searchWorkflowYaml: {
        description: 'Search for specific patterns or keywords in the workflow YAML',
        inputSchema: z.object({
          pattern: z.string().describe('Pattern to search for (case-insensitive)'),
          includeContext: z.boolean().optional().default(true).describe('Include surrounding lines'),
          contextLines: z.number().optional().default(3).describe('Number of context lines before/after match')
        }),
        execute: async ({ pattern, includeContext, contextLines }: { pattern: string; includeContext: boolean; contextLines: number }) => {
          if (!workflowContext.yaml) {
            return { error: 'Workflow YAML not available' };
          }

          const lines = workflowContext.yaml.split('\n');
          const matches: Array<{
            lineNumber: number;
            line: string;
            context?: string;
          }> = [];

          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(pattern.toLowerCase())) {
              const match: any = {
                lineNumber: idx + 1,
                line: line
              };

              if (includeContext) {
                const start = Math.max(0, idx - contextLines);
                const end = Math.min(lines.length - 1, idx + contextLines);
                match.context = lines.slice(start, end + 1)
                  .map((l, i) => `${start + i + 1}: ${l}`)
                  .join('\n');
              }

              matches.push(match);
            }
          });

          return {
            pattern,
            found: matches.length,
            matches: matches.slice(0, 20) // Limit to 20 matches
          };
        }
      },

      getWorkflowStepDefinition: {
        description: 'Get the YAML definition for a specific step in the workflow',
        inputSchema: z.object({
          stepIdentifier: z.string().describe('Step index (0-based) or step name/tool name')
        }),
        execute: async ({ stepIdentifier }: { stepIdentifier: string }) => {
          if (!workflowContext.yaml) {
            return { error: 'Workflow YAML not available' };
          }

          const lines = workflowContext.yaml.split('\n');
          const stepStarts: Array<{index: number; line: number; tool: string}> = [];

          // Find all step starts
          lines.forEach((line, idx) => {
            const toolMatch = line.match(/^\s*-?\s*tool:\s*(.+)/);
            if (toolMatch) {
              stepStarts.push({
                index: stepStarts.length,
                line: idx,
                tool: toolMatch[1].trim()
              });
            }
          });

          // Find the requested step
          let targetStep: typeof stepStarts[0] | undefined;

          // Check if it's a number (index)
          if (/^\d+$/.test(stepIdentifier)) {
            const index = parseInt(stepIdentifier);
            targetStep = stepStarts[index];
          } else {
            // Search by tool name
            targetStep = stepStarts.find(s =>
              s.tool.toLowerCase().includes(stepIdentifier.toLowerCase())
            );
          }

          if (!targetStep) {
            return {
              error: `Step '${stepIdentifier}' not found`,
              availableSteps: stepStarts.map(s => ({
                index: s.index,
                tool: s.tool
              }))
            };
          }

          // Extract step definition
          const startLine = targetStep.line;
          const nextStep = stepStarts.find(s => s.line > startLine);
          const endLine = nextStep ? nextStep.line : lines.length;

          const stepYaml = lines.slice(startLine, endLine).join('\n');

          // Extract key information
          const scriptFileMatch = stepYaml.match(/script_file:\s*["']?([^"'\n]+)["']?/);
          const descriptionMatch = stepYaml.match(/description:\s*["']?([^"'\n]+)["']?/);

          return {
            stepIndex: targetStep.index,
            tool: targetStep.tool,
            yaml: stepYaml,
            scriptFile: scriptFileMatch ? scriptFileMatch[1] : null,
            description: descriptionMatch ? descriptionMatch[1] : null,
            lineNumber: startLine + 1,
            lineRange: `${startLine + 1}-${endLine}`
          };
        }
      },

      listWorkflowSteps: {
        description: 'List all workflow steps with their IDs, names, and tools',
        inputSchema: z.object({
          includeJumps: z.boolean().optional().default(false).describe('Include jump conditions for each step')
        }),
        execute: async ({ includeJumps }: { includeJumps: boolean }) => {
          if (!workflowContext.yaml) {
            return { error: 'Workflow YAML not available' };
          }

          const lines = workflowContext.yaml.split('\n');
          const steps: Array<{
            index: number;
            id?: string;
            name?: string;
            tool?: string;
            scriptFile?: string;
            fallbackId?: string;
            jumps?: Array<{ condition: string; target: string; reason?: string }>;
            lineNumber: number;
          }> = [];

          let currentStep: any = null;
          let inJumpsSection = false;
          let currentJumps: Array<{ condition: string; target: string; reason?: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check for step start (- tool: or - name:)
            if (line.match(/^\s*-\s+(tool:|name:|tool_name:)/)) {
              // Save previous step if exists
              if (currentStep) {
                if (currentJumps.length > 0) {
                  currentStep.jumps = currentJumps;
                }
                steps.push(currentStep);
              }

              // Start new step
              currentStep = {
                index: steps.length,
                lineNumber: i + 1
              };
              currentJumps = [];
              inJumpsSection = false;

              // Check if this line has tool
              const toolMatch = line.match(/tool(?:_name)?:\s*(.+)/);
              if (toolMatch) {
                currentStep.tool = toolMatch[1].trim();
              }

              // Check if this line has name
              const nameMatch = line.match(/name:\s*(.+)/);
              if (nameMatch) {
                currentStep.name = nameMatch[1].trim();
              }
            }
            // Parse step properties (when we're in a step)
            else if (currentStep && !line.match(/^\s*-\s+/) && line.includes(':')) {
              // Extract id
              if (trimmedLine.startsWith('id:')) {
                const idMatch = line.match(/id:\s*(.+)/);
                if (idMatch) {
                  currentStep.id = idMatch[1].trim();
                }
              }
              // Extract name (if not already found)
              else if (trimmedLine.startsWith('name:') && !currentStep.name) {
                const nameMatch = line.match(/name:\s*(.+)/);
                if (nameMatch) {
                  currentStep.name = nameMatch[1].trim();
                }
              }
              // Extract tool (if not already found)
              else if ((trimmedLine.startsWith('tool:') || trimmedLine.startsWith('tool_name:')) && !currentStep.tool) {
                const toolMatch = line.match(/tool(?:_name)?:\s*(.+)/);
                if (toolMatch) {
                  currentStep.tool = toolMatch[1].trim();
                }
              }
              // Extract script_file
              else if (trimmedLine.startsWith('script_file:')) {
                const scriptMatch = line.match(/script_file:\s*["']?([^"'\n]+)["']?/);
                if (scriptMatch) {
                  currentStep.scriptFile = scriptMatch[1].trim();
                }
              }
              // Extract fallback_id
              else if (trimmedLine.startsWith('fallback_id:')) {
                const fallbackMatch = line.match(/fallback_id:\s*(.+)/);
                if (fallbackMatch) {
                  currentStep.fallbackId = fallbackMatch[1].trim();
                }
              }
              // Start of jumps section
              else if (trimmedLine === 'jumps:') {
                inJumpsSection = true;
              }
              // Parse jump conditions (if includeJumps is true)
              else if (includeJumps && inJumpsSection && trimmedLine.startsWith('- if:')) {
                const jumpCondition = { condition: '', target: '', reason: '' };

                // Get condition
                const condMatch = line.match(/if:\s*["']?(.+?)["']?\s*$/);
                if (condMatch) {
                  jumpCondition.condition = condMatch[1].trim();
                }

                // Look for to_id and reason in next lines
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                  const nextLine = lines[j].trim();
                  if (nextLine.startsWith('to_id:')) {
                    const toMatch = nextLine.match(/to_id:\s*(.+)/);
                    if (toMatch) {
                      jumpCondition.target = toMatch[1].trim();
                    }
                  } else if (nextLine.startsWith('reason:')) {
                    const reasonMatch = nextLine.match(/reason:\s*["']?(.+?)["']?\s*$/);
                    if (reasonMatch) {
                      jumpCondition.reason = reasonMatch[1].trim();
                    }
                  } else if (nextLine.startsWith('- ') || !nextLine.startsWith(' ')) {
                    break;
                  }
                }

                if (jumpCondition.condition && jumpCondition.target) {
                  currentJumps.push(jumpCondition);
                }
              }
            }
            // Check if we've left the jumps section
            else if (inJumpsSection && !trimmedLine.startsWith('-') && !trimmedLine.startsWith('to_id:') && !trimmedLine.startsWith('reason:') && trimmedLine !== '') {
              inJumpsSection = false;
            }
          }

          // Don't forget the last step
          if (currentStep) {
            if (currentJumps.length > 0) {
              currentStep.jumps = currentJumps;
            }
            steps.push(currentStep);
          }

          // Generate summary
          const summary = {
            totalSteps: steps.length,
            stepsWithIds: steps.filter(s => s.id).length,
            stepsWithNames: steps.filter(s => s.name).length,
            stepsWithScripts: steps.filter(s => s.scriptFile).length,
            stepsWithJumps: steps.filter(s => s.jumps && s.jumps.length > 0).length
          };

          return {
            summary,
            steps: steps.map(s => ({
              index: s.index,
              id: s.id || '(no id)',
              name: s.name || '(no name)',
              tool: s.tool || '(no tool)',
              scriptFile: s.scriptFile,
              fallbackId: s.fallbackId,
              jumps: includeJumps ? s.jumps : undefined,
              lineNumber: s.lineNumber
            }))
          };
        }
      },

      listJsFiles: {
        description: 'List all JavaScript files available for this workflow',
        inputSchema: z.object({}),
        execute: async () => {
          const files = Object.keys(workflowContext.jsFiles);

          if (files.length === 0) {
            return {
              error: workflowContext.jsFilesError || 'No JavaScript files available',
              files: []
            };
          }

          // Get file info
          const fileInfo = files.map(fileName => ({
            name: fileName,
            size: workflowContext.jsFiles[fileName].length,
            lines: workflowContext.jsFiles[fileName].split('\n').length
          }));

          return {
            count: files.length,
            files: fileInfo,
            totalSize: fileInfo.reduce((sum, f) => sum + f.size, 0)
          };
        }
      },

      getJsFile: {
        description: 'Get the complete content of a specific JavaScript file',
        inputSchema: z.object({
          fileName: z.string().describe('File name (e.g., "read_json_file.js")')
        }),
        execute: async ({ fileName }: { fileName: string }) => {
          if (!(fileName in workflowContext.jsFiles)) {
            // Try to find a partial match
            const availableFiles = Object.keys(workflowContext.jsFiles);
            const partialMatch = availableFiles.find(f => f.toLowerCase().includes(fileName.toLowerCase()));

            if (partialMatch) {
              fileName = partialMatch;
            } else {
              return {
                error: `File '${fileName}' not found`,
                availableFiles: availableFiles.length > 0 ? availableFiles : 'No files available'
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
            lastLines: content.split('\n').slice(-10).join('\n')
          };
        }
      },

      searchJsFiles: {
        description: 'Search for patterns across all JavaScript files',
        inputSchema: z.object({
          pattern: z.string().describe('Pattern to search for (case-insensitive)'),
          includeContext: z.boolean().optional().default(true).describe('Include surrounding lines'),
          contextLines: z.number().optional().default(2).describe('Number of context lines'),
          limit: z.number().optional().default(20).describe('Maximum matches to return')
        }),
        execute: async ({ pattern, includeContext, contextLines, limit }: {
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

          for (const [fileName, content] of Object.entries(workflowContext.jsFiles)) {
            const lines = content.split('\n');

            lines.forEach((line, idx) => {
              if (line.toLowerCase().includes(pattern.toLowerCase())) {
                const match: any = {
                  file: fileName,
                  lineNumber: idx + 1,
                  line: line.trim()
                };

                if (includeContext) {
                  const start = Math.max(0, idx - contextLines);
                  const end = Math.min(lines.length - 1, idx + contextLines);
                  match.context = lines.slice(start, end + 1)
                    .map((l, i) => `${start + i + 1}: ${l}`)
                    .join('\n');
                }

                matches.push(match);

                if (matches.length >= limit) {
                  return {
                    pattern,
                    found: matches.length,
                    limitReached: true,
                    matches
                  };
                }
              }
            });
          }

          return {
            pattern,
            found: matches.length,
            matches
          };
        }
      },

      getStepWithJsFile: {
        description: 'Get workflow step definition along with its JavaScript file content',
        inputSchema: z.object({
          stepIdentifier: z.string().describe('Step index (0-based) or step ID/name')
        }),
        execute: async ({ stepIdentifier }: { stepIdentifier: string }) => {
          // First, get the step definition
          if (!workflowContext.yaml) {
            return { error: 'Workflow YAML not available' };
          }

          const lines = workflowContext.yaml.split('\n');
          const stepStarts: Array<{index: number; line: number; tool: string; id?: string; name?: string}> = [];

          // Find all step starts and extract their properties
          let currentStepInfo: any = null;
          lines.forEach((line, idx) => {
            const toolMatch = line.match(/^\s*-?\s*tool:\s*(.+)/);
            if (toolMatch) {
              if (currentStepInfo) {
                stepStarts.push(currentStepInfo);
              }
              currentStepInfo = {
                index: stepStarts.length,
                line: idx,
                tool: toolMatch[1].trim()
              };
            } else if (currentStepInfo) {
              // Extract id and name for current step
              if (line.match(/^\s*id:\s*(.+)/)) {
                const idMatch = line.match(/id:\s*(.+)/);
                if (idMatch) currentStepInfo.id = idMatch[1].trim();
              } else if (line.match(/^\s*name:\s*(.+)/)) {
                const nameMatch = line.match(/name:\s*(.+)/);
                if (nameMatch) currentStepInfo.name = nameMatch[1].trim();
              }
            }
          });
          if (currentStepInfo) {
            stepStarts.push(currentStepInfo);
          }

          // Find the requested step
          let targetStep: typeof stepStarts[0] | undefined;
          if (/^\d+$/.test(stepIdentifier)) {
            const index = parseInt(stepIdentifier);
            targetStep = stepStarts[index];
          } else {
            // Search by id or name
            targetStep = stepStarts.find(s =>
              s.id?.toLowerCase() === stepIdentifier.toLowerCase() ||
              s.name?.toLowerCase().includes(stepIdentifier.toLowerCase())
            );
          }

          if (!targetStep) {
            return {
              error: `Step '${stepIdentifier}' not found`,
              availableSteps: stepStarts.map(s => ({
                index: s.index,
                id: s.id,
                name: s.name
              }))
            };
          }

          // Extract step YAML
          const startLine = targetStep.line;
          const nextStep = stepStarts.find(s => s.line > startLine);
          const endLine = nextStep ? nextStep.line : lines.length;
          const stepYaml = lines.slice(startLine, endLine).join('\n');

          // Extract script file reference
          const scriptFileMatch = stepYaml.match(/script_file:\s*["']?([^"'\n]+)["']?/);

          const result: any = {
            stepIndex: targetStep.index,
            stepId: targetStep.id,
            stepName: targetStep.name,
            tool: targetStep.tool,
            yaml: stepYaml,
            lineRange: `${startLine + 1}-${endLine}`
          };

          // If step has a script file, include its content
          if (scriptFileMatch) {
            const scriptFile = scriptFileMatch[1].trim();
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
      tools,  // Add the tools we defined so AI can execute them
      maxSteps: 5,  // Allow up to 5 tool calls in sequence
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