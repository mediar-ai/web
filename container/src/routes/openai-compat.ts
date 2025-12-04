/**
 * OpenAI-compatible API endpoint
 * /v1/chat/completions
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validateToken } from '../services/auth/validate.js';
import {
  handleChat,
  validateModel,
  AllowedModel,
  Message,
  Tool,
  StreamEvent,
} from '../services/ai/providers.js';
import { logger } from '../lib/logger.js';

// OpenAI-compatible request schema
const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().nullable(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_calls: z.array(z.object({
      id: z.string(),
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        arguments: z.string(),
      }),
    })).optional(),
  })),
  tools: z.array(z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.any()).optional(),
    }),
  })).optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
});

type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export async function openaiCompatRoutes(fastify: FastifyInstance): Promise<void> {
  // List models
  fastify.get('/v1/models', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { message: 'Unauthorized', type: 'invalid_request_error' } });
    }

    const user = await validateToken(authHeader.substring(7));
    if (!user) {
      return reply.status(401).send({ error: { message: 'Invalid token', type: 'invalid_request_error' } });
    }

    return {
      object: 'list',
      data: [
        { id: 'gemini-2.5-flash', object: 'model', created: Date.now(), owned_by: 'mediar' },
        { id: 'gemini-2.5-pro', object: 'model', created: Date.now(), owned_by: 'mediar' },
        { id: 'gemini-3-pro-preview', object: 'model', created: Date.now(), owned_by: 'mediar' },
        { id: 'claude-sonnet-4-5-20250929', object: 'model', created: Date.now(), owned_by: 'mediar' },
      ],
    };
  });

  // Chat completions
  fastify.post('/v1/chat/completions', async (request: FastifyRequest, reply: FastifyReply) => {
    // Auth
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { message: 'Unauthorized', type: 'invalid_request_error' } });
    }

    const user = await validateToken(authHeader.substring(7));
    if (!user) {
      return reply.status(401).send({ error: { message: 'Invalid token', type: 'invalid_request_error' } });
    }

    // Parse request
    const parsed = ChatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { message: 'Invalid request', type: 'invalid_request_error', details: parsed.error },
      });
    }

    const body = parsed.data;

    // Validate model
    if (!validateModel(body.model)) {
      return reply.status(400).send({
        error: { message: `Invalid model: ${body.model}`, type: 'invalid_request_error' },
      });
    }

    // Convert messages
    let systemPrompt: string | undefined;
    const messages: Message[] = [];

    for (const msg of body.messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content || '';
      } else if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content || '' });
      } else if (msg.role === 'assistant') {
        const toolCalls = msg.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        }));
        messages.push({
          role: 'assistant',
          content: msg.content || '',
          toolCalls,
        });
      } else if (msg.role === 'tool') {
        // Find the last assistant message and add tool result
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistant && msg.tool_call_id) {
          messages.push({
            role: 'user',
            content: '',
            toolResults: [{
              id: msg.tool_call_id,
              name: msg.name || 'unknown',
              result: msg.content,
            }],
          });
        }
      }
    }

    // Convert tools
    const tools: Tool[] = body.tools?.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })) || [];

    // Handle streaming
    if (body.stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const id = `chatcmpl-${Date.now()}`;
      let finishReason: string | null = null;
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

      const onStream = (event: StreamEvent) => {
        if (event.type === 'token') {
          const chunk = {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{
              index: 0,
              delta: { content: event.content },
              finish_reason: null,
            }],
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } else if (event.type === 'tool_call') {
          toolCalls.push({ id: event.id, name: event.name, args: event.args });
          const chunk = {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: toolCalls.length - 1,
                  id: event.id,
                  type: 'function',
                  function: { name: event.name, arguments: JSON.stringify(event.args) },
                }],
              },
              finish_reason: null,
            }],
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } else if (event.type === 'done') {
          finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
          const chunk = {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: finishReason,
            }],
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
        } else if (event.type === 'error') {
          const errorChunk = {
            error: { message: event.message, type: 'server_error' },
          };
          reply.raw.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
          reply.raw.end();
        }
      };

      try {
        await handleChat({
          model: body.model as AllowedModel,
          messages,
          tools,
          system: systemPrompt,
          temperature: body.temperature,
          maxTokens: body.max_tokens,
          onStream,
        });
      } catch (error) {
        logger.error({ error }, 'Stream error');
        reply.raw.write(`data: ${JSON.stringify({ error: { message: 'Stream error' } })}\n\n`);
        reply.raw.end();
      }

      return;
    }

    // Non-streaming
    let content = '';
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    let usage = { promptTokens: 0, completionTokens: 0 };

    const onStream = (event: StreamEvent) => {
      if (event.type === 'token') {
        content += event.content;
      } else if (event.type === 'tool_call') {
        toolCalls.push({ id: event.id, name: event.name, args: event.args });
      } else if (event.type === 'done' && event.usage) {
        usage = event.usage;
      }
    };

    try {
      await handleChat({
        model: body.model as AllowedModel,
        messages,
        tools,
        system: systemPrompt,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        onStream,
      });
    } catch (error) {
      logger.error({ error }, 'Chat error');
      return reply.status(500).send({
        error: { message: 'Chat failed', type: 'server_error' },
      });
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.length > 0 ? toolCalls.map((tc, i) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })) : undefined,
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.promptTokens + usage.completionTokens,
      },
    };
  });
}
