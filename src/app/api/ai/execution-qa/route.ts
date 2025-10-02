import { createVertex } from '@ai-sdk/google-vertex';
import { streamText } from 'ai';
import { NextRequest } from 'next/server';

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

    const { messages, executionContext } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build system prompt with execution context
    const systemPrompt = `You are an AI assistant helping users understand workflow execution results.

Context about this execution:
- Execution ID: ${executionContext.execution_id}
- Workflow: ${executionContext.workflow_name}
- Status: ${executionContext.status}
- Duration: ${executionContext.duration}
${executionContext.error_message ? `- Error: ${executionContext.error_message}` : ''}

Formatted Output:
${JSON.stringify(executionContext.formatted_output, null, 2)}

Results:
${JSON.stringify(executionContext.results, null, 2)}

${executionContext.execution_logs?.length > 0 ? `
Recent Logs:
${executionContext.execution_logs.slice(-20).map((log: any) => `[${log.level}] ${log.message}`).join('\n')}
` : ''}

Answer questions about this execution, explain the results, help debug issues, and provide insights based on the data above.`;

    // Stream the response using Vercel AI SDK
    const result = await streamText({
      model: vertex('gemini-1.5-flash'),
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