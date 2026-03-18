import { NextRequest, NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';
import { GoogleGenAI } from '@google/genai';
import { trackLLMUsageAsync } from '@/lib/llm-tracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for analysis

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const isAdmin = await isMediarAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const { userId } = await params;

  try {
    const body = await request.json();
    const { prompt, userMessages, chatHistory = [] } = body as {
      prompt: string;
      userMessages: Array<{ role: string; content: string | unknown }>;
      chatHistory?: ChatMessage[];
    };

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Initialize Gemini with global endpoint (required for Gemini 3)
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      return NextResponse.json(
        { error: 'Server configuration error: missing Google credentials' },
        { status: 500 }
      );
    }

    const credentialsJson = Buffer.from(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
      'base64'
    ).toString('utf-8');
    const credentials = JSON.parse(credentialsJson);

    const genAI = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      location: process.env.VERTEX_AI_LOCATION || 'us-central1',
      googleAuthOptions: { credentials },
    });

    const modelName = 'gemini-2.5-pro';

    // Format user messages for context
    const formattedMessages = userMessages
      .map((msg, idx) => {
        const role = msg.role?.toUpperCase() || 'UNKNOWN';
        let content = '';

        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .map((part: any) => {
              if (part.type === 'text') return part.text;
              if (part.type === 'tool_use') return `[Tool: ${part.name}]`;
              if (part.type === 'tool_result') return '[Tool Result]';
              return '';
            })
            .filter(Boolean)
            .join('\n');
        } else if (msg.content) {
          content = JSON.stringify(msg.content);
        }

        // Truncate very long messages
        if (content.length > 2000) {
          content = content.slice(0, 2000) + '... [truncated]';
        }

        return `[${idx + 1}] ${role}: ${content}`;
      })
      .join('\n\n---\n\n');

    // Build the full prompt with context
    const systemContext = `You are an AI assistant analyzing user chat conversations from a workflow automation platform called Mediar.
The user is asking about conversations from user ID: ${userId}.

Here are the user's chat messages to analyze:

=== USER MESSAGES START ===
${formattedMessages}
=== USER MESSAGES END ===

`;

    // Build conversation history for multi-turn
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    // Add chat history if exists
    for (const msg of chatHistory) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }

    // Add current user message
    const currentMessage = chatHistory.length === 0
      ? systemContext + prompt
      : prompt;

    contents.push({
      role: 'user',
      parts: [{ text: currentMessage }],
    });

    console.log(`[User Messages Analysis] Calling ${modelName} for user ${userId}...`);

    const result = await genAI.models.generateContent({
      model: modelName,
      contents,
      config: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    });

    // Track LLM usage
    trackLLMUsageAsync({
      model: modelName,
      inputTokens: result.usageMetadata?.promptTokenCount || 0,
      outputTokens: result.usageMetadata?.candidatesTokenCount || 0,
      source: 'user_message_analysis',
    });

    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

    console.log(`[User Messages Analysis] Response generated (${responseText.length} chars)`);

    return NextResponse.json({
      text: responseText,
      model: modelName,
      usage: {
        inputTokens: result.usageMetadata?.promptTokenCount || 0,
        outputTokens: result.usageMetadata?.candidatesTokenCount || 0,
      },
    });
  } catch (error) {
    console.error('[User Messages Analysis] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
