import {
  MCPToolsCollection,
  OpenAIStreamChunk,
  OpenAITool,
  StreamChunk,
  TestConfig,
  TestResult,
} from './types';

export const DEFAULT_TEST_CONFIG: TestConfig = {
  apiBaseUrl: 'http://localhost:3000/api',
  apiPassword: 'your-secret-password-here',
  timeout: 30000, // 30 seconds
};

// Convert MCP tools to OpenAI format
export function convertMCPToolsToOpenAI(
  mcpTools: MCPToolsCollection
): OpenAITool[] {
  const openAITools: OpenAITool[] = [];

  for (const [toolName, mcpTool] of Object.entries(mcpTools)) {
    openAITools.push({
      type: 'function',
      function: {
        name: toolName,
        description: mcpTool.description,
        parameters: {
          type: mcpTool.inputSchema.jsonSchema.type,
          properties: mcpTool.inputSchema.jsonSchema.properties,
          required: mcpTool.inputSchema.jsonSchema.required || [],
        },
      },
    });
  }

  return openAITools;
}

// Parse OpenAI streaming response format
export function parseOpenAIStreamingResponse(
  body: string
): OpenAIStreamChunk[] {
  const chunks: OpenAIStreamChunk[] = [];
  const lines = body.split('\n');

  for (const line of lines) {
    if (line.trim() && line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as OpenAIStreamChunk;
        chunks.push(parsed);
      } catch (e) {
        TestLogger.debug('Failed to parse OpenAI stream chunk', {
          line,
          error: e,
        });
      }
    }
  }

  return chunks;
}

// Convert OpenAI chunks to legacy format for compatibility
export function convertOpenAIChunksToLegacy(
  openAIChunks: OpenAIStreamChunk[]
): StreamChunk[] {
  const legacyChunks: StreamChunk[] = [];

  for (const chunk of openAIChunks) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    // Handle role assignment (start)
    if (choice.delta.role === 'assistant') {
      legacyChunks.push({ type: 'start' });
    }

    // Handle text content
    if (choice.delta.content) {
      legacyChunks.push({
        type: 'textDelta',
        textDelta: choice.delta.content,
      });
    }

    // Handle tool calls
    if (choice.delta.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        legacyChunks.push({
          type: 'toolCall',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          args: JSON.parse(toolCall.function.arguments),
        });
      }
    }

    // Handle finish
    if (choice.finish_reason) {
      legacyChunks.push({
        type: 'finish',
        finishReason: choice.finish_reason,
        usage: chunk.usage
          ? { totalTokens: chunk.usage.total_tokens }
          : undefined,
      });
    }

    // Handle errors
    if (chunk.error) {
      legacyChunks.push({
        type: 'error',
        error: chunk.error.message,
      });
    }
  }

  return legacyChunks;
}

// Mock function execution for testing
export async function executeMockTool(
  toolName: string,
  args: any = {}
): Promise<any> {
  console.log(`🔧 Executing mock tool: ${toolName} with args:`, args);

  // Mock implementations for testing
  switch (toolName) {
    case 'take_screenshot':
      return `Screenshot captured of ${args?.selector || 'desktop'} (mock image data)`;

    case 'get_current_time':
      return new Date().toISOString();

    case 'calculate':
      const expr = args?.expression || '0';
      try {
        // Simple math expression evaluation (mock)
        const result = eval(expr.replace(/[^0-9+\-*/.() ]/g, ''));
        return `The result of ${expr} is ${result}`;
      } catch {
        return `Unable to calculate: ${expr}`;
      }

    case 'get_weather':
      const location = args?.location || 'Unknown';
      return `Weather in ${location}: 72°F, partly cloudy with light winds`;

    case 'get_applications':
      return {
        applications: [
          { name: 'Cursor', pid: 1234, focused: false },
          { name: 'Chrome', pid: 5678, focused: true },
          { name: 'Terminal', pid: 9012, focused: false },
          { name: 'Slack', pid: 3456, focused: false },
        ],
      };

    case 'open_application':
      const appName = args?.app_name || 'Unknown App';
      return `Opened application: ${appName} (PID: ${Math.floor(Math.random() * 10000)})`;

    case 'get_window_tree':
      const title = args?.title;
      return {
        window: title || 'Active Window',
        focused: true,
        tree: {
          role: 'Window',
          name: title ? `${title} - Main Window` : 'Main Window',
          children: [
            {
              role: 'Group',
              name: 'Content Panel',
              children: [
                {
                  role: 'Edit',
                  name: 'Text Input',
                  placeholder:
                    title === 'Cursor' ? 'Ask Cursor...' : 'Type here...',
                },
                { role: 'Button', name: 'Submit', enabled: true },
                { role: 'Button', name: 'Clear', enabled: true },
              ],
            },
          ],
        },
      };

    case 'get_focused_window_tree':
      return {
        window: 'Focused Window',
        focused: true,
        tree: {
          role: 'Window',
          name: 'Cursor - Main Window',
          children: [
            {
              role: 'Group',
              name: 'Chat Panel',
              children: [
                {
                  role: 'Edit',
                  name: 'Message Input',
                  placeholder: 'Ask Cursor...',
                },
                { role: 'Button', name: 'Send Message', enabled: true },
              ],
            },
          ],
        },
      };

    case 'click_element':
      const clickSelector = args?.selector || 'unknown';
      return `Clicked element "${clickSelector}" successfully (simulated)`;

    case 'type_into_element':
      const typeSelector = args?.selector || 'unknown';
      const textToType = args?.text_to_type || '';
      const clearBefore = args?.clear_before_typing !== false;
      return `${clearBefore ? 'Cleared and t' : 'T'}yped "${textToType}" into element "${typeSelector}" (simulated)`;

    case 'validate_element':
      const validateSelector = args?.selector || 'unknown';
      return {
        exists: true,
        visible: true,
        enabled: true,
        selector: validateSelector,
        element: {
          role: 'Button',
          name: 'Mock Element',
          bounds: { x: 100, y: 200, width: 120, height: 40 },
        },
      };

    case 'wait_for_element':
      const waitSelector = args?.selector || 'unknown';
      const condition = args?.condition || 'visible';
      const timeout = args?.timeout_ms || 5000;
      return `Element "${waitSelector}" is now ${condition} (waited ${Math.min(timeout, 1000)}ms)`;

    case 'file_operations':
      const operation = args?.operation || 'read';
      const path = args?.path || '/unknown';
      return `File operation "${operation}" completed on "${path}" (simulated)`;

    default:
      return `Function ${toolName} executed successfully (mock response)`;
  }
}

// Handle tool execution flow - make initial request, execute tools, then continuation request
// Export the function so it can be used in tests
export async function executeToolWorkflow(
  url: string,
  initialRequest: any,
  options: {
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
  } = {}
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
}> {
  // Step 1: Make initial request
  const initialResponse = await makeHTTPRequest(url, {
    ...options,
    body: JSON.stringify(initialRequest),
  });

  if (!initialResponse.ok) {
    return initialResponse;
  }

  // Step 2: Parse initial response and check for tool calls
  const chunks = parseStreamingResponse(initialResponse.body);
  const analysis = analyzeStreamChunks(chunks);

  console.log(`📊 Initial response analysis:`, {
    toolCalls: analysis.toolCalls.length,
    toolResults: analysis.toolResults.length,
    textDeltas: analysis.textDeltas.length,
    hasFinish: analysis.hasFinish,
  });

  // Step 3: If we have tool calls, execute them and make continuation request
  if (analysis.toolCalls.length > 0) {
    console.log(
      `🛠️ Executing ${analysis.toolCalls.length} tools for continuation...`
    );

    // Execute all tool calls
    const toolResults = [];
    for (const toolCall of analysis.toolCalls) {
      if (!toolCall.toolName) {
        console.warn('⚠️ Tool call missing toolName:', toolCall);
        continue;
      }

      const result = await executeMockTool(toolCall.toolName, toolCall.args);
      toolResults.push({
        toolCallId: toolCall.toolCallId || `call_${Date.now()}`,
        toolName: toolCall.toolName,
        args: toolCall.args, // ✅ Include the original args for proper Gemini pairing
        result: result,
      });
    }

    // Step 4: Make continuation request with tool results (using internal field)
    const continuationRequest = {
      ...initialRequest,
      _toolResults: toolResults,
    };

    console.log(
      `🔄 Making continuation request with ${toolResults.length} tool results...`
    );

    const continuationResponse = await makeHTTPRequest(url, {
      ...options,
      body: JSON.stringify(continuationRequest),
    });

    // Parse continuation response separately
    const continuationChunks = parseStreamingResponse(
      continuationResponse.body
    );
    const continuationAnalysis = analyzeStreamChunks(continuationChunks);

    console.log(`📊 Continuation response analysis:`, {
      toolCalls: continuationAnalysis.toolCalls.length,
      toolResults: continuationAnalysis.toolResults.length,
      textDeltas: continuationAnalysis.textDeltas.length,
      hasFinish: continuationAnalysis.hasFinish,
    });

    // For test purposes, we'll create a synthetic response that combines both
    // with the tool results injected appropriately
    const syntheticToolResults = toolResults.map(tr => ({
      type: 'toolResult' as const,
      toolCallId: tr.toolCallId,
      result: String(tr.result),
    }));

    // Combine: initial chunks + synthetic tool results + continuation chunks
    const allChunks = [
      ...chunks,
      ...syntheticToolResults,
      ...continuationChunks,
    ];

    // Create a combined body that represents the full conversation flow
    const combinedBody = [
      initialResponse.body,
      '', // separator
      syntheticToolResults
        .map(str => `data: ${JSON.stringify(str)}`)
        .join('\n'),
      '', // separator
      continuationResponse.body,
    ].join('\n');

    console.log(`📊 Combined analysis:`, {
      totalChunks: allChunks.length,
      toolCalls: allChunks.filter(c => c.type === 'toolCall').length,
      syntheticToolResults: syntheticToolResults.length,
      continuationTextDeltas: continuationAnalysis.textDeltas.length,
    });

    return {
      ...continuationResponse,
      body: combinedBody, // Combined body for full analysis
    };
  }

  // No tool calls, return initial response
  return initialResponse;
}

export class TestLogger {
  private static verbose = false;

  private static formatTimestamp(): string {
    return new Date().toISOString().substring(11, 23);
  }

  static setVerbose(enabled: boolean): void {
    this.verbose = enabled;
  }

  static info(message: string, data?: any): void {
    console.log(`[${this.formatTimestamp()}] ℹ️  ${message}`);
    if (data) {
      console.log('   ', JSON.stringify(data, null, 2));
    }
  }

  static success(message: string, data?: any): void {
    console.log(`[${this.formatTimestamp()}] ✅ ${message}`);
    if (data) {
      console.log('   ', JSON.stringify(data, null, 2));
    }
  }

  static error(message: string, error?: any): void {
    console.log(`[${this.formatTimestamp()}] ❌ ${message}`);
    if (error) {
      console.log(
        '   ',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  static warn(message: string, data?: any): void {
    console.log(`[${this.formatTimestamp()}] ⚠️  ${message}`);
    if (data) {
      console.log('   ', JSON.stringify(data, null, 2));
    }
  }

  static debug(message: string, data?: any): void {
    if (this.verbose || process.env.NODE_ENV === 'development') {
      console.log(`[${this.formatTimestamp()}] 🔍 ${message}`);
      if (data) {
        console.log('   ', JSON.stringify(data, null, 2));
      }
    }
  }
}

export async function makeHTTPRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  } = {}
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout || 30000
  );

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      headers,
      body,
      ok: response.ok,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export function parseStreamingResponse(body: string): StreamChunk[] {
  const lines = body.split('\n');

  // Try to parse as OpenAI format first, then fall back to legacy
  const openAIChunks: OpenAIStreamChunk[] = [];
  const legacyChunks: StreamChunk[] = [];
  let isOpenAIFormat = false;

  for (const line of lines) {
    if (line.trim() && line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(data);

        // Check if it's OpenAI format
        if (parsed.object === 'chat.completion.chunk' && parsed.choices) {
          isOpenAIFormat = true;
          openAIChunks.push(parsed as OpenAIStreamChunk);
        } else {
          // Legacy format
          legacyChunks.push(parsed as StreamChunk);
        }
      } catch (e) {
        TestLogger.debug('Failed to parse stream chunk', { line, error: e });
      }
    }
  }

  // If we detected OpenAI format, convert to legacy format for compatibility
  if (isOpenAIFormat) {
    return convertOpenAIChunksToLegacy(openAIChunks);
  }

  return legacyChunks;
}

export function analyzeStreamChunks(chunks: StreamChunk[]): {
  toolCalls: StreamChunk[];
  toolResults: StreamChunk[];
  textDeltas: StreamChunk[];
  errors: StreamChunk[];
  hasFinish: boolean;
} {
  const toolCalls = chunks.filter(c => c.type === 'toolCall');
  const toolResults = chunks.filter(c => c.type === 'toolResult');
  const textDeltas = chunks.filter(c => c.type === 'textDelta');
  const errors = chunks.filter(c => c.type === 'error');
  const hasFinish = chunks.some(c => c.type === 'finish');

  return {
    toolCalls,
    toolResults,
    textDeltas,
    errors,
    hasFinish,
  };
}

export function createTestResult(
  success: boolean,
  message: string,
  data?: any,
  error?: string,
  startTime?: number
): TestResult {
  const result: TestResult = {
    success,
    message,
  };

  if (data !== undefined) {
    result.data = data;
  }

  if (error) {
    result.error = error;
  }

  if (startTime) {
    result.duration = Date.now() - startTime;
  }

  return result;
}

export function printTestSummary(results: TestResult[]): void {
  const totalTests = results.length;
  const passedTests = results.filter(r => r.success).length;
  const failedTests = totalTests - passedTests;
  const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests} ✅`);
  console.log(`Failed: ${failedTests} ❌`);
  console.log(`Success Rate: ${successRate.toFixed(1)}%`);

  if (failedTests > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter(r => !r.success)
      .forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.message}`);
        if (result.error) {
          console.log(`     Error: ${result.error}`);
        }
      });
  }

  console.log('\n' + '='.repeat(60));
}
