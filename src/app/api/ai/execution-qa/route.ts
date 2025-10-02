import { NextResponse } from 'next/server';
import { createVertex } from '@ai-sdk/google-vertex';
import { streamText } from 'ai';
import { createClient } from '@supabase/supabase-js';

// Initialize Vertex AI client
const vertex = createVertex({
  project: process.env.GOOGLE_VERTEX_PROJECT || process.env.GOOGLE_PROJECT_ID || '',
  location: process.env.GOOGLE_VERTEX_LOCATION || 'us-central1',
});

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages, executionId } = body;

    // Fetch execution data from database
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (error || !execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // Helper function to truncate long strings
    const truncate = (obj: any, maxLength: number = 1000): string => {
      const str = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
      if (!str) return '';
      return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
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

    // Build context for the AI
    const context = `You are analyzing a workflow execution. Here's the execution data:

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

Context: ${JSON.stringify(execution.context, null, 2)}

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

Note: This is a smart sample of the execution logs. Focus on error patterns, the workflow flow, and final results. If user asks about specific details not shown, explain that you're seeing a summary and key events.

Please answer questions about this workflow execution in a helpful and detailed manner. Focus on:
- What the workflow accomplished or attempted to do
- Any errors or issues that occurred
- Performance metrics and timing
- The state of the execution
- Any relevant technical details

Use markdown formatting for better readability.`;

    // Stream the response using Vercel AI SDK
    const result = await streamText({
      model: vertex('gemini-2.5-pro'),
      messages: [
        { role: 'system', content: context },
        ...messages
      ],
      temperature: 0.7,
      maxRetries: 3,
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