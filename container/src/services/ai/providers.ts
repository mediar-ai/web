/**
 * AI Provider implementations for the container service
 * Supports Gemini (Vertex AI) and Anthropic Claude
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../../lib/logger.js';

// Allowed models
export const VERTEX_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-pro-preview',
] as const;
export const ANTHROPIC_MODELS = ['claude-sonnet-4-5-20250929'] as const;
export const ALLOWED_MODELS = [...VERTEX_MODELS, ...ANTHROPIC_MODELS] as const;

export type VertexModel = (typeof VERTEX_MODELS)[number];
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export function isAnthropicModel(model: string): model is AnthropicModel {
  return (ANTHROPIC_MODELS as readonly string[]).includes(model);
}

export function isVertexModel(model: string): model is VertexModel {
  return (VERTEX_MODELS as readonly string[]).includes(model);
}

export function validateModel(model: string): model is AllowedModel {
  return (ALLOWED_MODELS as readonly string[]).includes(model);
}

// Tool interface
export interface Tool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

// Message types
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  toolResults?: Array<{ id: string; name: string; result: unknown }>;
}

// Streaming callback
export type StreamCallback = (event: StreamEvent) => void;

export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'thinking'; content: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: 'done'; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; message: string };

// Provider request
export interface ProviderRequest {
  model: AllowedModel;
  messages: Message[];
  tools?: Tool[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  onStream: StreamCallback;
}

/**
 * Get Vertex AI model name mapping
 */
function getVertexModelName(model: VertexModel): string {
  const mapping: Record<VertexModel, string> = {
    'gemini-2.5-flash': 'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
  };
  return mapping[model] || model;
}

/**
 * Convert tools to Gemini format
 */
function toGeminiFunctionDeclarations(tools: Tool[]) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description || tool.name,
    parameters: tool.parameters || { type: 'object', properties: {} },
  }));
}

/**
 * Convert messages to Gemini content format
 */
function toGeminiContents(
  messages: Message[]
): Array<{ role: 'user' | 'model'; parts: any[] }> {
  return messages.map(msg => ({
    role: (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: msg.toolResults
      ? msg.toolResults.map(tr => ({
          functionResponse: {
            name: tr.name,
            response:
              typeof tr.result === 'object' && tr.result !== null
                ? (tr.result as Record<string, unknown>)
                : { result: tr.result },
          },
        }))
      : msg.toolCalls
        ? msg.toolCalls.map(tc => ({
            functionCall: { name: tc.name, args: tc.args },
          }))
        : [{ text: msg.content }],
  }));
}

/**
 * Handle Gemini/Vertex AI chat
 */
export async function handleGeminiChat(
  request: ProviderRequest
): Promise<void> {
  const { model, messages, tools, system, temperature, maxTokens, onStream } =
    request;

  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    onStream({ type: 'error', message: 'GOOGLE_AI_API_KEY not configured' });
    return;
  }

  const genAI = new GoogleGenAI({ apiKey });
  const mappedModel = getVertexModelName(model as VertexModel);

  const config: any = {
    temperature: temperature ?? 0.7,
    maxOutputTokens: maxTokens ?? 8192,
  };

  if (system) {
    config.systemInstruction = system;
  }

  if (tools && tools.length > 0) {
    config.tools = [
      { functionDeclarations: toGeminiFunctionDeclarations(tools) },
    ];
  }

  try {
    const response = await genAI.models.generateContent({
      model: mappedModel,
      contents: toGeminiContents(messages),
      config,
    });

    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    for (const part of parts) {
      if (part.text && !(part as any).thought) {
        onStream({ type: 'token', content: part.text });
      } else if ((part as any).thought) {
        onStream({ type: 'thinking', content: (part as any).thought });
      } else if (part.functionCall && part.functionCall.name) {
        onStream({
          type: 'tool_call',
          id: `gemini_${Date.now()}_${part.functionCall.name}`,
          name: part.functionCall.name,
          args: (part.functionCall.args as Record<string, unknown>) || {},
        });
      }
    }

    const usage = response?.usageMetadata;
    onStream({
      type: 'done',
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount || 0,
            completionTokens: usage.candidatesTokenCount || 0,
          }
        : undefined,
    });
  } catch (error) {
    logger.error({ error }, 'Gemini API error');
    onStream({
      type: 'error',
      message: error instanceof Error ? error.message : 'Gemini API error',
    });
  }
}

/**
 * Convert tools to Anthropic format
 */
function toAnthropicTools(tools: Tool[]) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description || tool.name,
    input_schema: tool.parameters || { type: 'object', properties: {} },
  }));
}

/**
 * Convert messages to Anthropic format
 */
function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map(msg => {
    if (msg.toolResults && msg.toolResults.length > 0) {
      return {
        role: 'user' as const,
        content: msg.toolResults.map(tr => ({
          type: 'tool_result' as const,
          tool_use_id: tr.id,
          content:
            typeof tr.result === 'string'
              ? tr.result
              : JSON.stringify(tr.result),
        })),
      };
    }

    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const content: Array<
        | { type: 'text'; text: string }
        | {
            type: 'tool_use';
            id: string;
            name: string;
            input: Record<string, unknown>;
          }
      > = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.args,
        });
      }
      return { role: 'assistant' as const, content: content as any };
    }

    return {
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    };
  });
}

/**
 * Handle Anthropic Claude chat
 */
export async function handleAnthropicChat(
  request: ProviderRequest
): Promise<void> {
  const { model, messages, tools, system, temperature, maxTokens, onStream } =
    request;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onStream({ type: 'error', message: 'ANTHROPIC_API_KEY not configured' });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const stream = await client.messages.stream({
      model: model || 'claude-sonnet-4-5-20250929',
      max_tokens: maxTokens || 8192,
      temperature: temperature ?? 0.7,
      system,
      messages: toAnthropicMessages(messages),
      tools:
        tools && tools.length > 0
          ? (toAnthropicTools(tools) as any)
          : undefined,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as any;
        if (delta.type === 'text_delta') {
          onStream({ type: 'token', content: delta.text });
        } else if (delta.type === 'input_json_delta') {
          // Tool input streaming - accumulate
        }
      } else if (event.type === 'content_block_start') {
        const block = event.content_block as any;
        if (block.type === 'tool_use') {
          // Will emit full tool call on content_block_stop
        }
      } else if (event.type === 'content_block_stop') {
        // Check for completed tool use blocks
      }
    }

    const finalMessage = await stream.finalMessage();

    // Extract tool calls from final message
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        onStream({
          type: 'tool_call',
          id: block.id,
          name: block.name,
          args: block.input as Record<string, unknown>,
        });
      }
    }

    onStream({
      type: 'done',
      usage: {
        promptTokens: finalMessage.usage.input_tokens,
        completionTokens: finalMessage.usage.output_tokens,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Anthropic API error');
    onStream({
      type: 'error',
      message: error instanceof Error ? error.message : 'Anthropic API error',
    });
  }
}

/**
 * Route to the appropriate provider
 */
export async function handleChat(request: ProviderRequest): Promise<void> {
  if (isAnthropicModel(request.model)) {
    return handleAnthropicChat(request);
  }
  return handleGeminiChat(request);
}
