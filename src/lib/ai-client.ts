import { AIGenerateRequest, AIGenerateResponse, AIErrorResponse, AIHealthResponse, AIStreamChunk } from '@/types/ai';

export class AIClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || '/api/ai';
  }

  private getHeaders(): HeadersInit {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Generate text using the AI API
   */
  async generateText(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error: AIErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to generate text');
    }

    return response.json();
  }

  /**
   * Generate text with streaming response
   */
  async *generateTextStream(request: AIGenerateRequest): AsyncGenerator<AIStreamChunk, void, unknown> {
    const streamRequest = { ...request, stream: true };
    
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(streamRequest),
    });

    if (!response.ok) {
      const error: AIErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to generate text stream');
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch {
              // Skip invalid JSON lines
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get API health status and available models
   */
  async getHealth(): Promise<AIHealthResponse> {
    const response = await fetch(this.baseUrl, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error: AIErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to get health status');
    }

    return response.json();
  }

  /**
   * Simple text generation helper
   */
  async ask(prompt: string, options?: Partial<AIGenerateRequest>): Promise<string> {
    const response = await this.generateText({
      prompt,
      ...options,
    });
    
    return response.text;
  }

  /**
   * Chat-style conversation helper
   */
  async chat(message: string, systemPrompt?: string, options?: Partial<AIGenerateRequest>): Promise<string> {
    const response = await this.generateText({
      prompt: message,
      systemPrompt,
      ...options,
    });
    
    return response.text;
  }
}

// Default client instance (you'll need to set the API key)
export let aiClient: AIClient | null = null;

export function initializeAIClient(apiKey: string, baseUrl?: string): AIClient {
  aiClient = new AIClient(apiKey, baseUrl);
  return aiClient;
}

export function getAIClient(): AIClient {
  if (!aiClient) {
    throw new Error('AI client not initialized. Call initializeAIClient() first.');
  }
  return aiClient;
}