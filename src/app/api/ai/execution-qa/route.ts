import { createVertex } from '@ai-sdk/google-vertex';
import { streamText } from 'ai';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    // Use existing environment variables that are already in Vercel
    const project = process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022';
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

    // Handle base64 credentials (what's actually in Vercel)
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
      return new Response(
        JSON.stringify({
          error: 'GOOGLE_CLOUD_PROJECT environment variable is not configured'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Initialize Vertex AI provider with proper credentials
    const vertex = createVertex({
      project,
      location,
      googleAuthOptions: credentialsJson ? {
        credentials: JSON.parse(credentialsJson),
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      } : undefined
    });

    const { messages, executionId } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!executionId) {
      return new Response(JSON.stringify({ error: 'Execution ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch execution data from Supabase
    const { data: execution, error: dbError } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (dbError || !execution) {
      console.error('Failed to fetch execution:', dbError);
      return new Response(
        JSON.stringify({ error: 'Execution not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Truncate large fields to keep context manageable
    const truncate = (field: any, maxLength: number = 10000) => {
      if (!field) return field;
      const str = typeof field === 'string' ? field : JSON.stringify(field, null, 2);
      return str.length > maxLength ? str.substring(0, maxLength) + '\n... [truncated]' : str;
    };

    // Smart log sampling for better context
    const allLogs = execution.execution_logs || [];
    const errorLogs = allLogs.filter((log: any) =>
      log.level === 'ERROR' || log.message?.toLowerCase().includes('error')
    );
    const warningLogs = allLogs.filter((log: any) =>
      log.level === 'WARN' || log.level === 'WARNING'
    );

    // Create execution summary
    const executionSummary = {
      total_log_entries: allLogs.length,
      error_count: errorLogs.length,
      warning_count: warningLogs.length,
      first_error: errorLogs[0] ? `[${errorLogs[0].level}] ${errorLogs[0].message}` : null,
      last_activity: allLogs.length > 0 ? `[${allLogs[allLogs.length - 1].level || 'INFO'}] ${allLogs[allLogs.length - 1].message}` : null,
    };

    // Smart sampling: first 10, up to 20 errors, last 20
    const smartSample = [
      ...allLogs.slice(0, 10),  // First 10 logs (initialization)
      ...errorLogs.slice(0, 20), // Up to 20 error logs
      ...warningLogs.slice(0, 10), // Up to 10 warning logs
      ...allLogs.slice(-20)      // Last 20 logs (completion)
    ];

    // Remove duplicates while preserving order
    const uniqueLogs = Array.from(new Map(
      smartSample.map((log: any) => [`${log.timestamp}-${log.message}`, log])
    ).values());

    // Build system prompt with execution context
    const systemPrompt = `You are an AI assistant helping users understand workflow execution results.

EXECUTION SUMMARY:
- Execution ID: ${execution.id}
- Workflow ID: ${execution.workflow_id}
- Status: ${execution.status}
- Duration: ${execution.execution_duration_seconds} seconds
- Total Logs: ${executionSummary.total_log_entries}
- Errors: ${executionSummary.error_count}
- Warnings: ${executionSummary.warning_count}
${executionSummary.first_error ? `- First Error: ${truncate(executionSummary.first_error, 500)}` : ''}
${execution.error_message ? `- Final Error: ${truncate(execution.error_message, 2000)}` : ''}

FORMATTED OUTPUT:
${truncate(execution.formatted_output, 15000)}

RESULTS STRUCTURE:
${execution.results ? Object.keys(execution.results).join(', ') : 'No structured results'}

RESULTS DATA:
${truncate(execution.results, 15000)}

${uniqueLogs.length > 0 ? `
LOG SAMPLES (${uniqueLogs.length} key entries from ${executionSummary.total_log_entries} total):
${uniqueLogs.map((log: any) => `[${log.timestamp}] [${log.level || 'INFO'}] ${truncate(log.message, 500)}`).join('\n')}
` : 'No execution logs available'}

Note: This is a smart sample of the execution logs. Focus on error patterns, the workflow flow, and final results. If user asks about specific details not shown, explain that you're seeing a summary and key events.`;

    // Stream the response using Vercel AI SDK
    const result = await streamText({
      model: vertex('gemini-2.5-pro'),
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Error in execution Q&A:', error);

    // Check if it's an authentication error
    if (error instanceof Error && error.message.includes('credentials')) {
      return new Response(
        JSON.stringify({
          error: 'Vertex AI authentication not configured. Please set up GOOGLE_APPLICATION_CREDENTIALS.'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Failed to process AI request',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}