/**
 * Session format converters
 * Handles conversion between Vertex and Anthropic message formats for Redis storage
 */

import type { VertexMessage, AnthropicMessage } from './types';

/**
 * Convert Anthropic history to Vertex format for unified Redis storage
 */
export function anthropicToVertexHistory(anthropicHistory: AnthropicMessage[]): VertexMessage[] {
  const vertexMessages: VertexMessage[] = [];

  for (const msg of anthropicHistory) {
    if (msg.role === 'user') {
      const parts: any[] = [];

      if (typeof msg.content === 'string') {
        // Simple text message
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Complex content with tool results
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push({ text: block.text });
          } else if (block.type === 'tool_result') {
            // Convert tool result to function response
            parts.push({
              functionResponse: {
                name: block.tool_use_id || 'unknown',
                response: typeof block.content === 'string'
                  ? JSON.parse(block.content)
                  : block.content,
              }
            });
          }
        }
      }

      if (parts.length > 0) {
        vertexMessages.push({ role: 'user', parts });
      }
    } else if (msg.role === 'assistant') {
      const parts: any[] = [];

      if (typeof msg.content === 'string') {
        // Simple text response
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Complex content with text and tool calls
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push({ text: block.text });
          } else if (block.type === 'tool_use') {
            // Convert tool use to function call
            parts.push({
              functionCall: {
                name: block.name,
                args: block.input || {},
              }
            });
          }
        }
      }

      if (parts.length > 0) {
        vertexMessages.push({ role: 'model', parts });
      }
    }
  }

  return vertexMessages;
}

/**
 * Create a unified session format that preserves both formats
 * This allows switching between providers without losing context
 */
export interface UnifiedSessionData {
  // Store both formats
  vertexHistory?: VertexMessage[];
  anthropicHistory?: AnthropicMessage[];

  // Metadata
  lastProvider: 'vertex' | 'anthropic';
  model: string;
  system?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert session to unified format
 */
export function toUnifiedFormat(
  history: any[],
  provider: 'vertex' | 'anthropic',
  model: string,
  system?: string
): UnifiedSessionData {
  const now = new Date().toISOString();

  if (provider === 'vertex') {
    return {
      vertexHistory: history as VertexMessage[],
      anthropicHistory: undefined, // Will be converted on demand
      lastProvider: 'vertex',
      model,
      system,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    return {
      vertexHistory: undefined, // Will be converted on demand
      anthropicHistory: history as AnthropicMessage[],
      lastProvider: 'anthropic',
      model,
      system,
      createdAt: now,
      updatedAt: now,
    };
  }
}

/**
 * Get history in the required format from unified session
 */
export function getHistoryForProvider(
  session: UnifiedSessionData,
  targetProvider: 'vertex' | 'anthropic'
): any[] {
  // If we have the format we need, return it
  if (targetProvider === 'vertex' && session.vertexHistory) {
    return session.vertexHistory;
  }
  if (targetProvider === 'anthropic' && session.anthropicHistory) {
    return session.anthropicHistory;
  }

  // Otherwise, convert from the other format
  if (targetProvider === 'vertex' && session.anthropicHistory) {
    // Convert Anthropic to Vertex
    return anthropicToVertexHistory(session.anthropicHistory);
  }
  if (targetProvider === 'anthropic' && session.vertexHistory) {
    // Import the converter from anthropic.ts to avoid circular dependency
    // For now, return empty array - this should be implemented properly
    console.warn('[SESSION] Need to convert Vertex to Anthropic format');
    return [];
  }

  // No history available
  return [];
}