/**
 * Common types for AI providers (Vertex AI and Anthropic)
 * Defines unified interfaces both providers must implement
 */

// Common request format for all AI providers
export interface AIProviderRequest {
  model: string;
  input?: string;
  history: any[]; // Provider-specific format (Vertex or Anthropic)
  system?: string;
  tools?: any[]; // Provider-specific tool format
  toolResults?: Array<{ id?: string; name: string; result: any }>; // id is optional (Vertex doesn't use it)
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  sessionId?: string;
}

// Common response format from all AI providers
export interface AIProviderResponse {
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>; // id is required for proper matching
  finishReason: 'stop' | 'tool_calls';
  metrics: {
    elapsedMs: number;
    tokens?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
  };
}

// Vertex AI message format (currently used in Redis)
export interface VertexMessage {
  role: 'user' | 'model';
  parts: Array<{
    text?: string;
    functionCall?: any;
    functionResponse?: any;
  }>;
}

// Anthropic message format
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
    tool_use_id?: string;
    content?: string | any;
    is_error?: boolean;
  }>;
}

// Tool format for Anthropic
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

// Session data stored in Redis
export interface SessionData {
  history: any[]; // Provider-specific format
  provider?: 'vertex' | 'anthropic'; // Track which provider format
  system?: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}