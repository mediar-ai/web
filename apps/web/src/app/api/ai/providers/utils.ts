/**
 * Shared utilities for AI providers
 * Contains common logic used by both Vertex and Anthropic providers
 */

/**
 * Format error message consistently across providers
 */
export function formatErrorMessage(error: unknown, context?: string): string {
  const baseMessage = error instanceof Error ? error.message : String(error);
  return context ? `${context}: ${baseMessage}` : baseMessage;
}

/**
 * Calculate elapsed time in milliseconds
 */
export function calculateElapsedMs(startTime: number): number {
  return Date.now() - startTime;
}

/**
 * Clean JSON schema for tool parameters
 * Removes Zod-specific fields and ensures valid JSON schema
 */
export function cleanSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }

  const src = schema as Record<string, unknown>;
  const dst: Record<string, unknown> = {
    // Convert Vertex AI uppercase types (OBJECT, STRING, etc.) to lowercase for Anthropic compatibility
    type: typeof src.type === 'string' ? (src.type as string).toLowerCase() : 'object',
  };

  if (src.properties && typeof src.properties === 'object') {
    const cleanedProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      cleanedProps[k] = cleanSchema(v);
    }
    dst.properties = cleanedProps;
  }

  if (Array.isArray(src.required)) dst.required = src.required;
  if (typeof src.description === 'string') dst.description = src.description;
  if (Array.isArray(src.enum)) dst.enum = src.enum;
  if (typeof src.format === 'string') dst.format = src.format;
  if (src.type === 'array' && src.items) dst.items = cleanSchema(src.items);

  return dst;
}

/**
 * Log tool calls in a consistent format
 */
export function logToolCalls(toolCalls: Array<{ name: string; args?: any }>, provider: string): void {
  if (toolCalls.length > 0) {
    const toolNames = toolCalls.map(tc => tc.name).join(', ');
    console.log(`[${provider}] 🛠️ Model requested ${toolCalls.length} tool call(s): [${toolNames}]`);

    // Log each tool call with args
    toolCalls.forEach((tc, index) => {
      console.log(`[${provider}] Tool ${index + 1}: ${tc.name}`,
        tc.args ? JSON.stringify(tc.args, null, 2) : '(no args)');
    });
  }
}

/**
 * Validate model name against allowed models
 */
export const ALLOWED_MODELS = {
  vertex: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  anthropic: ['claude-sonnet-4-5-20250929']
} as const;

export function getProviderForModel(model: string): 'vertex' | 'anthropic' | null {
  if ((ALLOWED_MODELS.vertex as readonly string[]).includes(model)) return 'vertex';
  if ((ALLOWED_MODELS.anthropic as readonly string[]).includes(model)) return 'anthropic';
  return null;
}

export function isModelAllowed(model: string): boolean {
  return getProviderForModel(model) !== null;
}

/**
 * Check tool results for large payloads and image data
 * Logs warnings for results that might cause token limit issues
 */
export function analyzeToolResults(
  toolResults: Array<{ name: string; result: any; id?: string }>,
  providerName: string = 'AI'
): void {
  toolResults.forEach((tr, idx) => {
    const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
    const sizeKB = resultStr.length / 1024;

    console.log(`[${providerName}] Tool result ${idx + 1} (${tr.name}): ${sizeKB.toFixed(1)}KB`);

    // Warn if very large (>100KB)
    if (sizeKB > 100) {
      console.warn(`[${providerName}] ⚠️ Large tool result detected: ${tr.name} is ${sizeKB.toFixed(1)}KB`);

      // Check if it contains base64 image data
      if (resultStr.includes('data:image') || resultStr.includes('iVBORw0KGgo')) {
        console.warn(`[${providerName}] ⚠️ Tool result contains image data (likely screenshot)`);
      }
    }
  });
}

/**
 * Estimate token count for a message history
 * Uses rough approximation: 3 characters ≈ 1 token (conservative estimate)
 */
export function estimateTokens(content: any): number {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  return Math.round(contentStr.length / 3);
}

/**
 * Check if approaching token limit and log warnings
 * Returns true if within safe limits, false if approaching/exceeding limit
 */
export function checkTokenLimit(
  history: any,
  providerName: string = 'AI',
  maxTokens: number = 200000,
  warningThreshold: number = 150000
): boolean {
  const historyStr = JSON.stringify(history);
  const historySizeMB = historyStr.length / 1024 / 1024;
  const estimatedTokens = estimateTokens(historyStr);

  console.log(
    `[${providerName}] Message history size: ${historySizeMB.toFixed(2)}MB (~${estimatedTokens.toLocaleString()} tokens)`
  );

  if (estimatedTokens > warningThreshold) {
    console.warn(
      `[${providerName}] ⚠️ Approaching token limit! Estimated: ${estimatedTokens.toLocaleString()} tokens (max: ${maxTokens.toLocaleString()})`
    );
  }

  if (estimatedTokens > maxTokens) {
    console.error(
      `[${providerName}] ❌ Token limit exceeded! Estimated: ${estimatedTokens.toLocaleString()} tokens (max: ${maxTokens.toLocaleString()})`
    );
    return false;
  }

  return true;
}

/**
 * Log diagnostic information about provider configuration
 */
export function logProviderDiagnostics(
  providerName: string,
  config: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    toolCount?: number;
    historyLength?: number;
  }
): void {
  console.log(`[${providerName}] Configuration:`, {
    model: config.model || 'default',
    maxTokens: config.maxTokens || 'default',
    temperature: config.temperature || 'default',
    tools: config.toolCount || 0,
    historyMessages: config.historyLength || 0,
  });
}