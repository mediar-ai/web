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

    // Only use recent logs to avoid token limits
    const recentLogs = execution.execution_logs?.slice(-50) || [];

    // Build system prompt with execution context
    const systemPrompt = `You are an AI assistant helping users understand workflow execution results.

Context about this execution:
- Execution ID: ${execution.id}
- Workflow ID: ${execution.workflow_id}
- Status: ${execution.status}
- Duration: ${execution.execution_duration_seconds} seconds
${execution.error_message ? `- Error: ${truncate(execution.error_message, 2000)}` : ''}

Formatted Output:
${truncate(execution.formatted_output)}

Results:
${truncate(execution.results)}

${recentLogs.length > 0 ? `
Recent Logs (last ${recentLogs.length} entries):
${recentLogs.map((log: any) => `[${log.level || 'INFO'}] ${log.message}`).join('\n')}
` : ''}

Answer questions about this execution, explain the results, help debug issues, and provide insights based on the data above.`;

    // Stream the response using Vercel AI SDK
    const result = await streamText({
      model: vertex('gemini-2.5-flash'),
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