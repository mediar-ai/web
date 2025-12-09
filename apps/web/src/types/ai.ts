export interface AIGenerateRequest {
  prompt: string;
  model?: string;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AIGenerateResponse {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  model: string;
}

export interface AIErrorResponse {
  error: string;
  details?: string;
}

export interface AIHealthResponse {
  status: string;
  message: string;
  availableModels: string[];
  endpoints: {
    generate: {
      method: string;
      description: string;
      parameters: Record<string, string>;
    };
  };
  authentication: {
    method: string;
    note: string;
  };
}

export interface AIStreamChunk {
  text: string;
}