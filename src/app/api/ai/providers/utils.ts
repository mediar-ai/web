/**
 * Shared utilities for AI providers
 * Contains common logic used by both Vertex and Anthropic providers
 */

/**
 * Process unified tool result format {success, data?, error?}
 * This eliminates duplicated logic across providers
 */
export function processToolResult(result: any): {
  isError: boolean;
  content: any;
} {
  let isError = false;
  let content = result;

  if (result && typeof result === 'object' && 'success' in result) {
    // Unified format from workflow tools
    isError = !result.success;
    content = result.success ? result.data : { error: result.error };
  }

  return { isError, content };
}

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
    type: (src.type as string) || 'object',
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
  anthropic: [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest'
  ]
} as const;

export function getProviderForModel(model: string): 'vertex' | 'anthropic' | null {
  if ((ALLOWED_MODELS.vertex as readonly string[]).includes(model)) return 'vertex';
  if ((ALLOWED_MODELS.anthropic as readonly string[]).includes(model)) return 'anthropic';

  // Check by prefix as fallback
  if (model.startsWith('gemini-')) return 'vertex';
  if (model.startsWith('claude-')) return 'anthropic';

  return null;
}

export function isModelAllowed(model: string): boolean {
  return getProviderForModel(model) !== null;
}