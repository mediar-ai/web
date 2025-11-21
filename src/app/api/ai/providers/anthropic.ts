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
  formatErrorMessage,
  calculateElapsedMs,
  cleanSchema,
  logToolCalls,
  analyzeToolResults,
  checkTokenLimit,
  logProviderDiagnostics,
  estimateTokens
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
 * CRITICAL: Vertex uses name-based matching, Anthropic uses ID-based matching
 * We need to generate consistent IDs for paired tool calls and results
 */
export function vertexToAnthropicHistory(vertexHistory: VertexMessage[]): AnthropicMessage[] {
  console.log('[ANTHROPIC] Converting Vertex history to Anthropic format');
  
  // PHASE 1: Build a mapping of tool calls to generated IDs
  // This ensures that when we encounter a functionCall and its corresponding functionResponse,
  // they both use the same ID (required by Anthropic)
  
  const toolCallIdMap = new Map<string, string>(); // key: "messageIndex_toolName_callIndex", value: generated ID
  let callCounter = 0; // Global counter for unique IDs
  
  // First pass: identify all tool calls and assign them IDs
  vertexHistory.forEach((msg, msgIndex) => {
    if (msg.role === 'model') {
      const functionCalls = msg.parts.filter(p => p.functionCall);
      functionCalls.forEach((fc, fcIndex) => {
        // If ID already exists, use it; otherwise generate a new one
        const existingId = fc.functionCall.id;
        const generatedId = existingId || `toolu_${callCounter.toString().padStart(6, '0')}_${fc.functionCall.name}`;
        
        // Create a key that can be matched later when we see the response
        // We'll match responses to calls by scanning backwards for the most recent call with the same name
        const mapKey = `${msgIndex}_${fc.functionCall.name}_${fcIndex}`;
        toolCallIdMap.set(mapKey, generatedId);
        
        console.log(`[ANTHROPIC] Mapped tool call at msg ${msgIndex}: ${fc.functionCall.name} → ${generatedId}`);
        callCounter++;
      });
    }
  });
  
  // PHASE 2: Build Anthropic messages, using the ID map for consistency
  const anthropicMessages: AnthropicMessage[] = [];
  
  // Track which tool calls we've seen, to match responses
  const pendingToolCalls: Array<{ name: string; id: string; msgIndex: number }> = [];
  
  for (let msgIndex = 0; msgIndex < vertexHistory.length; msgIndex++) {
    const msg = vertexHistory[msgIndex];
    
    if (msg.role === 'user') {
      // Convert user messages
      const textParts = msg.parts.filter(p => p.text).map(p => p.text).join('');

      // Check for function responses (tool results)
      const functionResponses = msg.parts.filter(p => p.functionResponse);

      if (functionResponses.length > 0) {
        // This is a tool result message
        // Match each response to its corresponding call by name (most recent first)
        const toolResults = functionResponses.map(fr => {
          const toolName = fr.functionResponse.name;
          
          // Find the most recent pending tool call with this name and remove it
          const matchingCallIndex = pendingToolCalls.findIndex(pc => pc.name === toolName);
          let toolUseId: string;
          
          if (matchingCallIndex >= 0) {
            // Found a matching call - use its ID
            toolUseId = pendingToolCalls[matchingCallIndex].id;
            pendingToolCalls.splice(matchingCallIndex, 1); // Remove from pending
            console.log(`[ANTHROPIC] Matched tool result ${toolName} → ${toolUseId}`);
          } else {
            // No matching call found - use the response's own ID or fallback to name
            toolUseId = fr.functionResponse.id || toolName;
            console.warn(`[ANTHROPIC] ⚠️ No matching tool call found for response: ${toolName}, using fallback ID: ${toolUseId}`);
          }
          
          return {
            type: 'tool_result' as const,
            tool_use_id: toolUseId,
            content: JSON.stringify(fr.functionResponse.response),
          };
        });

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
      functionCalls.forEach((fc, fcIndex) => {
        // Get the ID from our map
        const mapKey = `${msgIndex}_${fc.functionCall.name}_${fcIndex}`;
        const toolUseId = toolCallIdMap.get(mapKey) || fc.functionCall.id || `toolu_fallback_${fc.functionCall.name}`;
        
        content.push({
          type: 'tool_use',
          id: toolUseId,
          name: fc.functionCall.name,
          input: fc.functionCall.args || {},
        });
        
        // Add to pending calls so we can match the response later
        pendingToolCalls.push({
          name: fc.functionCall.name,
          id: toolUseId,
          msgIndex
        });
      });

      if (content.length > 0) {
        anthropicMessages.push({
          role: 'assistant',
          content,
        });
      }
    }
  }
  
  // Log any unmatched tool calls (responses never came)
  if (pendingToolCalls.length > 0) {
    console.warn(`[ANTHROPIC] ⚠️ ${pendingToolCalls.length} tool call(s) without matching responses in history:`,
      pendingToolCalls.map(pc => pc.name));
    console.log(`[ANTHROPIC] This is normal when toolResults are being sent in the request body`);
  }

  console.log(`[ANTHROPIC] Converted ${vertexHistory.length} Vertex messages → ${anthropicMessages.length} Anthropic messages`);

  return anthropicMessages;
}

/**
 * Convert Anthropic response back to Vertex format for Redis storage
 */
export function anthropicToVertexMessage(
  text: string,
  toolCalls: Array<{ id: string; name: string; args: any }>,
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

    // Analyze tool results for potential token issues
    analyzeToolResults(toolResults, 'ANTHROPIC');

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
          // Only set in map if both name and id are defined
          if (toolUse.name && toolUse.id) {
            toolCallIdMap.set(toolUse.name, toolUse.id);
          }
        }

        if (toolUseBlocks.length > 0) {
          break; // Found the assistant message with tool calls, stop searching
        }
      }
    }

    const toolResultContent = toolResults.map(tr => {
      // IMPORTANT: As of the desktop app fix, tr.id is ALWAYS provided by the client
      // Fallback to name-based lookup only for backward compatibility with old clients
      const toolUseId = tr.id || toolCallIdMap.get(tr.name);

      if (!toolUseId) {
        console.error(`[ANTHROPIC] ❌ CRITICAL: No tool_use_id found for tool: ${tr.name}!`);
        console.error(`[ANTHROPIC] Provided ID: ${tr.id}, Name: ${tr.name}`);
        console.error(`[ANTHROPIC] Available IDs in map:`, Array.from(toolCallIdMap.entries()));
        console.error(`[ANTHROPIC] This indicates client is not sending tool call IDs properly!`);
        // This will cause Anthropic API to reject with "messages: tool_use must be immediately followed by tool_result"
      } else {
        console.log(`[ANTHROPIC] ✅ Matched tool result ${tr.name} to ID: ${toolUseId}${tr.id ? ' (from client)' : ' (from fallback lookup)'}`);
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

  // Log provider configuration
  logProviderDiagnostics('ANTHROPIC', {
    model: model || 'claude-sonnet-4-5-20250929',
    maxTokens: generationConfig.maxOutputTokens || 8192,
    temperature: generationConfig.temperature || 0.7,
    toolCount: anthropicTools.length,
    historyLength: anthropicHistory.length,
  });

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

    // Check token limits before sending - include ALL request parameters
    const totalRequestContent = {
      messages: anthropicHistory,
      system: system || '',
      tools: anthropicTools,
    };
    checkTokenLimit(totalRequestContent, 'ANTHROPIC', 200000, 150000);

    // Log breakdown for debugging
    const historyTokens = estimateTokens(anthropicHistory);
    const systemTokens = estimateTokens(system || '');
    const toolsTokens = estimateTokens(anthropicTools);
    console.log(`[ANTHROPIC] Token breakdown - History: ~${historyTokens.toLocaleString()}, System: ~${systemTokens.toLocaleString()}, Tools: ~${toolsTokens.toLocaleString()}`);

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