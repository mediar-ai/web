// Test types and interfaces

export interface TestConfig {
  apiBaseUrl: string;
  apiPassword: string;
  timeout: number;
}

export interface TestResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  duration?: number;
  details?: any; // Added missing details property
}

// OpenAI-compatible tool format
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

// Legacy MCP tool format (for backwards compatibility)
export interface MCPTool {
  description: string;
  inputSchema: {
    jsonSchema: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export interface MCPToolsCollection {
  [toolName: string]: MCPTool;
}

// OpenAI-compatible request format
export interface AIRequestBody {
  messages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool'; // ✅ Added 'tool' role
    content: string | null;
    tool_calls?: Array<{
      // ✅ For assistant messages with tool calls
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string; // ✅ For tool messages - references the tool call
  }>;
  model?: string;
  max_tokens?: number; // OpenAI format
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[]; // OpenAI format
  tool_choice?: string | object;
  // Legacy support
  maxOutputTokens?: number;
  mcpTools?: MCPToolsCollection;
  // Internal continuation fields
  _toolResults?: any[];
  toolResults?: any[]; // Added for compatibility
}

// OpenAI streaming response chunk format
export interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: 'stop' | 'tool_calls' | 'error' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

// Legacy stream chunk format (for backwards compatibility)
export interface StreamChunk {
  type: 'start' | 'toolCall' | 'toolResult' | 'textDelta' | 'finish' | 'error';
  toolName?: string;
  toolCallId?: string;
  args?: any;
  result?: string;
  textDelta?: string;
  finishReason?: string;
  usage?: {
    totalTokens: number;
  };
  error?: string;
}

export interface TestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  results: TestResult[];
}
