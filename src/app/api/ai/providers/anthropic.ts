/**
 * Anthropic Claude AI Provider
 * Handles all Claude-specific logic including tool conversion and multi-turn conversations
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProviderRequest,
  AIProviderResponse,
  AnthropicMessage,
  AnthropicTool,
  VertexMessage
} from './types';
import {
  processToolResult,
  formatErrorMessage,
  calculateElapsedMs,
  cleanSchema,
  logToolCalls
} from './utils';

/**
 * Convert AI SDK tools to Anthropic tool format
 * Handles the jsonSchema unwrapping issue we fixed in frontend
 */
function convertToAnthropicTools(tools: any[]): AnthropicTool[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  console.log('[ANTHROPIC] Converting', tools.length, 'tools to Anthropic format');

  return tools.map(tool => {
    // Handle tools with toJSON() method (AI SDK tools)
    if (tool && typeof tool.toJSON === 'function') {
      const toolJson = tool.toJSON();
      let schema = toolJson.parameters || { type: 'object', properties: {} };

      // CRITICAL FIX: If the schema has a nested jsonSchema property, unwrap it
      // This happens when tools are created with inputSchema parameter
      if (schema && schema.jsonSchema) {
        console.log(`[ANTHROPIC] Unwrapping jsonSchema for tool: ${toolJson.name}`);
        schema = schema.jsonSchema;
      }

      // Ensure the schema always has a type field
      if (!schema.type) {
        console.log(`[ANTHROPIC] Adding missing type field for tool: ${toolJson.name}`);
        schema = { type: 'object', properties: schema.properties || {}, ...schema };
      }

      return {
        name: toolJson.name,
        description: toolJson.description || `Execute ${toolJson.name}`,
        input_schema: schema,
      };
    }

    // Handle tools with direct properties
    if (tool && tool.name) {
      // Get the schema from various possible locations
      let schema = tool.inputSchema || tool.parameters || tool.input_schema || { type: 'object', properties: {} };

      // CRITICAL FIX: If the schema has a nested jsonSchema property, unwrap it
      if (schema && schema.jsonSchema) {
        console.log(`[ANTHROPIC] Unwrapping jsonSchema for tool: ${tool.name}`);
        schema = schema.jsonSchema;
      }

      // Ensure the schema always has a type field
      if (!schema.type) {
        console.log(`[ANTHROPIC] Adding missing type field for tool: ${tool.name}`);
        schema = { type: 'object', properties: schema.properties || {}, ...schema };
      }

      // Clean the schema to remove any Zod-specific properties
      const cleanedSchema = cleanSchema(schema);

      return {
        name: tool.name,
        description: tool.description || `Execute ${tool.name}`,
        input_schema: cleanedSchema,
      };
    }

    console.warn('[ANTHROPIC] Could not convert tool:', tool);
    return null;
  }).filter(Boolean) as AnthropicTool[];
}

/**
 * Convert Vertex format history to Anthropic format
 */
export function vertexToAnthropicHistory(vertexHistory: VertexMessage[]): AnthropicMessage[] {
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of vertexHistory) {
    if (msg.role === 'user') {
      // Convert user messages
      const textParts = msg.parts.filter(p => p.text).map(p => p.text).join('');

      // Check for function responses (tool results)
      const functionResponses = msg.parts.filter(p => p.functionResponse);

      if (functionResponses.length > 0) {
        // This is a tool result message
        const toolResults = functionResponses.map(fr => ({
          type: 'tool_result' as const,
          tool_use_id: fr.functionResponse.id || fr.functionResponse.name, // Use ID if available, fallback to name
          content: JSON.stringify(fr.functionResponse.response),
        }));

        anthropicMessages.push({
          role: 'user',
          content: toolResults,
        });
      } else if (textParts) {
        // Regular user message
        anthropicMessages.push({
          role: 'user',
          content: textParts,
        });
      }
    } else if (msg.role === 'model') {
      // Convert assistant messages
      const content: any[] = [];

      // Add text content
      const textParts = msg.parts.filter(p => p.text).map(p => p.text).join('');
      if (textParts) {
        content.push({
          type: 'text',
          text: textParts,
        });
      }

      // Add function calls (tool uses)
      const functionCalls = msg.parts.filter(p => p.functionCall);
      for (const fc of functionCalls) {
        content.push({
          type: 'tool_use',
          // Use existing ID if available, otherwise generate one
          id: fc.functionCall.id || `call_${Date.now()}_${Math.random().toString(36).substring(2)}`,
          name: fc.functionCall.name,
          input: fc.functionCall.args || {},
        });
      }

      if (content.length > 0) {
        anthropicMessages.push({
          role: 'assistant',
          content,
        });
      }
    }
  }

  return anthropicMessages;
}

/**
 * Convert Anthropic response back to Vertex format for Redis storage
 */
export function anthropicToVertexMessage(
  text: string,
  toolCalls: Array<{ name: string; args: any; id?: string }>,
  role: 'user' | 'model' = 'model'
): VertexMessage {
  const parts: any[] = [];

  if (text) {
    parts.push({ text });
  }

  for (const toolCall of toolCalls) {
    parts.push({
      functionCall: {
        name: toolCall.name,
        args: toolCall.args,
        // Store the tool ID in the functionCall for future reference
        id: toolCall.id,
      }
    });
  }

  return { role, parts };
}

/**
 * Handle Anthropic chat with multi-turn support
 */
export async function handleAnthropicChat(params: AIProviderRequest): Promise<AIProviderResponse> {
  const startTime = Date.now();
  const {
    model,
    input,
    history = [],
    system,
    tools = [],
    toolResults,
    generationConfig = {}
  } = params;

  // Initialize Anthropic client with server-side API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set');
  }

  const client = new Anthropic({
    apiKey,
    // NO dangerouslyAllowBrowser flag - we're on the server!
  });

  // Convert tools to Anthropic format
  const anthropicTools = convertToAnthropicTools(tools);

  // Convert history from Vertex format to Anthropic format
  // Assuming history is in Vertex format from Redis
  let anthropicHistory: AnthropicMessage[];

  // Check if history is already in Anthropic format (if provider tag exists)
  if (history.length > 0 && 'content' in history[0]) {
    // Already in Anthropic format
    anthropicHistory = history as AnthropicMessage[];
  } else {
    // Convert from Vertex format
    anthropicHistory = vertexToAnthropicHistory(history as VertexMessage[]);
  }

  // Add tool results if continuing from tool calls
  if (toolResults && toolResults.length > 0) {
    console.log(`[ANTHROPIC] 🔧 Processing ${toolResults.length} tool result(s)`);

    // Build a map of tool names to IDs from the last assistant message
    const toolCallIdMap = new Map<string, string>();

    // Find the last assistant message with tool calls
    for (let i = anthropicHistory.length - 1; i >= 0; i--) {
      const msg = anthropicHistory[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const toolUseBlocks = msg.content.filter(
          (block: any) => block.type === 'tool_use'
        );

        for (const toolUse of toolUseBlocks) {
          toolCallIdMap.set(toolUse.name, toolUse.id);
        }

        if (toolUseBlocks.length > 0) {
          break; // Found the assistant message with tool calls, stop searching
        }
      }
    }

    const toolResultContent = toolResults.map(tr => {
      // Try to get the ID from: 1) provided ID, 2) map lookup by name
      const toolUseId = tr.id || toolCallIdMap.get(tr.name);

      if (!toolUseId) {
        console.warn(`[ANTHROPIC] ⚠️ No tool_use_id found for tool: ${tr.name}. This will cause an API error!`);
        console.warn(`[ANTHROPIC] Available IDs in map:`, Array.from(toolCallIdMap.entries()));
      } else {
        console.log(`[ANTHROPIC] ✅ Mapped tool ${tr.name} to ID: ${toolUseId}`);
      }

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseId || tr.name, // Last resort fallback to name (will likely error)
        content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
      };
    });

    anthropicHistory.push({
      role: 'user',
      content: toolResultContent,
    });
  } else if (input) {
    // Add new user message
    anthropicHistory.push({
      role: 'user',
      content: input,
    });
  }

  console.log(`[ANTHROPIC] Starting chat with ${anthropicHistory.length} messages`);

  // Multi-turn conversation loop
  let continueConversation = true;
  let turnCount = 0;
  const MAX_TURNS = 10;
  let aggregatedText = '';
  const aggregatedToolCalls: Array<{ name: string; args: any; id: string }> = [];
  let usageMetadata: any = null;

  while (continueConversation && turnCount < MAX_TURNS) {
    turnCount++;
    console.log(`[ANTHROPIC] Turn ${turnCount}: Creating message...`);

    try {
      // Create message with Anthropic SDK
      const message = await client.messages.create({
        model: model || 'claude-sonnet-4-5-20250929',
        max_tokens: generationConfig.maxOutputTokens || 8192,
        temperature: generationConfig.temperature || 0.7,
        system,
        messages: anthropicHistory as Anthropic.MessageParam[],
        tools: anthropicTools.length > 0 ? anthropicTools as any : undefined,
      });

      // Extract text content
      const textContent = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      if (textContent) {
        aggregatedText += (aggregatedText ? '\n' : '') + textContent;
      }

      // Extract tool calls
      const toolUseBlocks = message.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');

      // Check if we need to continue with tool execution
      if (message.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
        console.log(`[ANTHROPIC] Model requested ${toolUseBlocks.length} tool(s)`);

        for (const toolUse of toolUseBlocks) {
          aggregatedToolCalls.push({
            name: toolUse.name,
            args: toolUse.input as Record<string, any>,
            id: toolUse.id,  // CRITICAL: Include the tool_use_id for multi-turn support
          });
        }

        // For server-side, we don't execute tools here
        // We return the tool calls and let the frontend handle them
        // Then the frontend will call us back with tool results
        continueConversation = false; // Stop here, wait for tool results
      } else {
        // Conversation complete
        continueConversation = false;
      }

      // Capture usage metadata
      if (message.usage) {
        usageMetadata = {
          promptTokenCount: message.usage.input_tokens,
          candidatesTokenCount: message.usage.output_tokens,
          totalTokenCount: (message.usage.input_tokens || 0) + (message.usage.output_tokens || 0),
        };
      }

    } catch (error) {
      console.error('[ANTHROPIC] API error:', error);
      throw new Error(formatErrorMessage(error, 'Anthropic API call failed'));
    }
  }

  if (turnCount >= MAX_TURNS) {
    console.warn('[ANTHROPIC] Reached maximum turn limit');
  }

  // Log tool calls if any
  logToolCalls(aggregatedToolCalls, 'ANTHROPIC');

  return {
    text: aggregatedText,
    toolCalls: aggregatedToolCalls,
    finishReason: aggregatedToolCalls.length > 0 ? 'tool_calls' : 'stop',
    metrics: {
      elapsedMs: calculateElapsedMs(startTime),
      ...(usageMetadata && { tokens: usageMetadata }),
    },
  };
}