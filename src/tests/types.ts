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
}

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

export interface AIRequestBody {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  mcpTools?: MCPToolsCollection;
}

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
