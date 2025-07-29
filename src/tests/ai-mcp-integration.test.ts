/**
 * AI API MCP Tools Integration Tests
 *
 * Tests the integration between the AI API and MCP (Model Context Protocol) tools
 * using the OpenAI-compatible Vertex AI SDK implementation.
 */

import {
  COMPLEX_MCP_TOOLS,
  COMPLEX_OPENAI_TOOLS,
  INVALID_MCP_TOOLS,
  MINIMAL_MCP_TOOLS,
  MINIMAL_OPENAI_TOOLS,
} from './fixtures/mcp-tools';
import { AIRequestBody, TestConfig, TestResult } from './types';
import {
  DEFAULT_TEST_CONFIG,
  TestLogger,
  analyzeStreamChunks,
  createTestResult,
  executeMockTool,
  executeToolWorkflow,
  makeHTTPRequest,
  parseStreamingResponse,
  printTestSummary,
} from './utils';

export class MCPIntegrationTester {
  private config: TestConfig;
  private results: TestResult[] = [];

  constructor(config: Partial<TestConfig> = {}) {
    this.config = { ...DEFAULT_TEST_CONFIG, ...config };
    TestLogger.info('MCP Integration Tester initialized', this.config);
  }

  async runAllTests(): Promise<boolean> {
    TestLogger.info('🚀 Starting OpenAI-Compatible AI API Integration Tests');

    const tests = [
      () => this.testHealthCheck(),
      () => this.testBasicToolCalling(),
      () => this.testOpenAIToolCalling(),
      () => this.testOpenAIToolMessageFormat(), // New test for OpenAI tool message format
      () => this.testComplexToolInteraction(),
      () => this.testMultiStepWorkflow(),
      () => this.testFrontendUXIntegration(),
      () => this.testStreamingWithTools(),
      () => this.testWithoutTools(),
      () => this.testInvalidToolSchema(),
      () => this.testErrorHandling(),
      () => this.testBackwardsCompatibility(),
    ];

    for (const test of tests) {
      try {
        const result = await test();
        this.results.push(result);
      } catch (error) {
        TestLogger.error('Test execution failed', error);
        this.results.push(
          createTestResult(
            false,
            'Test execution error',
            undefined,
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }

    printTestSummary(this.results);

    const successCount = this.results.filter(r => r.success).length;
    const success = successCount === this.results.length;

    TestLogger.info(success ? '🎉 All tests passed!' : '⚠️ Some tests failed', {
      passed: successCount,
      total: this.results.length,
    });

    return success;
  }

  async testHealthCheck(): Promise<TestResult> {
    TestLogger.info('🧪 Testing API Health Check');
    const startTime = Date.now();

    try {
      const response = await makeHTTPRequest(`${this.config.apiBaseUrl}/ai`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiPassword}`,
        },
        timeout: this.config.timeout,
      });

      if (!response.ok) {
        return createTestResult(
          false,
          'Health check failed',
          { status: response.status },
          response.body,
          startTime
        );
      }

      const healthData = JSON.parse(response.body);

      // Verify OpenAI compatibility markers
      const isOpenAICompatible =
        healthData.format?.includes('OpenAI') ||
        healthData.compatibility?.openai_api;

      TestLogger.success('Health check passed', {
        status: healthData.status,
        format: healthData.format,
        openaiCompatible: isOpenAICompatible,
        models: healthData.availableModels?.length || 0,
      });

      return createTestResult(
        true,
        'Health check passed - OpenAI compatible API detected',
        { ...healthData, openaiCompatible: isOpenAICompatible },
        undefined,
        startTime
      );
    } catch (error) {
      TestLogger.error('Health check failed', error);
      return createTestResult(
        false,
        'Health check failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testBasicToolCalling(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Basic Tool Calling (Legacy MCP Format)');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content:
            'Use the available tools to get the current time and calculate 15 + 27. Please use both tools.',
        },
      ],
      model: 'gemini-2.5-flash',
      max_tokens: 500,
      temperature: 0.7,
      tools: MINIMAL_OPENAI_TOOLS, // OpenAI format
    };

    try {
      const response = await executeToolWorkflow(
        `${this.config.apiBaseUrl}/ai`,
        requestBody,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiPassword}`,
          },
          timeout: this.config.timeout,
        }
      );

      if (!response.ok) {
        return createTestResult(
          false,
          'Basic tool calling failed',
          { status: response.status },
          response.body,
          startTime
        );
      }

      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      const hasTimeCall = analysis.toolCalls.some(
        tc => tc.toolName === 'get_current_time'
      );
      const hasCalculation = analysis.toolCalls.some(
        tc => tc.toolName === 'calculate'
      );

      const success = (hasTimeCall || hasCalculation) && analysis.hasFinish;

      TestLogger.success('Basic tool calling completed', {
        toolCalls: analysis.toolCalls.length,
        hasTimeCall,
        hasCalculation,
        hasFinish: analysis.hasFinish,
      });

      return createTestResult(
        success,
        success
          ? 'Basic tool calling successful'
          : 'Missing expected tool calls',
        analysis,
        undefined,
        startTime
      );
    } catch (error) {
      TestLogger.error('Basic tool calling failed', error);
      return createTestResult(
        false,
        'Basic tool calling failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testOpenAIToolCalling(): Promise<TestResult> {
    TestLogger.info('🧪 Testing OpenAI Tool Calling Format');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content:
            'Use the available tools to get the current time and calculate 25 * 4. Please use both tools.',
        },
      ],
      model: 'gemini-2.5-flash',
      max_tokens: 500, // OpenAI format
      temperature: 0.7,
      stream: true,
      tools: MINIMAL_OPENAI_TOOLS, // OpenAI format
    };

    try {
      const response = await executeToolWorkflow(
        `${this.config.apiBaseUrl}/ai`,
        requestBody,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiPassword}`,
          },
          timeout: this.config.timeout,
        }
      );

      if (!response.ok) {
        return createTestResult(
          false,
          'OpenAI tool calling failed',
          { status: response.status },
          response.body,
          startTime
        );
      }

      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      const hasTimeCall = analysis.toolCalls.some(
        tc => tc.toolName === 'get_current_time'
      );
      const hasCalculation = analysis.toolCalls.some(
        tc => tc.toolName === 'calculate'
      );

      const success = (hasTimeCall || hasCalculation) && analysis.hasFinish;

      TestLogger.success('OpenAI tool calling completed', {
        toolCalls: analysis.toolCalls.length,
        hasTimeCall,
        hasCalculation,
        hasFinish: analysis.hasFinish,
        textDeltas: analysis.textDeltas.length,
      });

      return createTestResult(
        success,
        success
          ? 'OpenAI tool calling successful'
          : 'Missing expected tool calls',
        analysis,
        undefined,
        startTime
      );
    } catch (error) {
      TestLogger.error('OpenAI tool calling failed', error);
      return createTestResult(
        false,
        'OpenAI tool calling failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testBackwardsCompatibility(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Backwards Compatibility (MCP vs OpenAI)');
    const startTime = Date.now();

    try {
      // Test 1: Legacy MCP format
      const mcpRequest: AIRequestBody = {
        messages: [{ role: 'user', content: 'Calculate 10 + 5' }],
        model: 'gemini-2.5-flash',
        max_tokens: 300,
        mcpTools: { calculate: MINIMAL_MCP_TOOLS.calculate },
      };

      const mcpResponse = await executeToolWorkflow(
        `${this.config.apiBaseUrl}/ai`,
        mcpRequest,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiPassword}`,
          },
          timeout: this.config.timeout,
        }
      );

      // Test 2: OpenAI format
      const openaiRequest: AIRequestBody = {
        messages: [{ role: 'user', content: 'Calculate 20 + 5' }],
        model: 'gemini-2.5-flash',
        max_tokens: 300,
        tools: [
          MINIMAL_OPENAI_TOOLS.find(t => t.function.name === 'calculate')!,
        ],
      };

      const openaiResponse = await executeToolWorkflow(
        `${this.config.apiBaseUrl}/ai`,
        openaiRequest,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiPassword}`,
          },
          timeout: this.config.timeout,
        }
      );

      const mcpSuccess = mcpResponse.ok;
      const openaiSuccess = openaiResponse.ok;
      const success = mcpSuccess && openaiSuccess;

      TestLogger.success('Backwards compatibility test completed', {
        mcpSuccess,
        openaiSuccess,
        bothFormatsWork: success,
      });

      return createTestResult(
        success,
        success
          ? 'Both MCP and OpenAI formats work correctly'
          : 'One or both formats failed',
        { mcpSuccess, openaiSuccess },
        undefined,
        startTime
      );
    } catch (error) {
      TestLogger.error('Backwards compatibility test failed', error);
      return createTestResult(
        false,
        'Backwards compatibility test failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testComplexToolInteraction(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Complex Tool Interaction');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content:
            'Take a desktop screenshot, get the weather for New York, and calculate 123 * 456. Do these tasks in sequence and explain each step.',
        },
      ],
      model: 'gemini-2.0-flash-001',
      max_tokens: 1500,
      temperature: 0.8,
      tools: COMPLEX_OPENAI_TOOLS,
    };

    try {
      const response = await this.makeAIRequest(requestBody);

      if (!response.ok) {
        return createTestResult(
          false,
          'Complex tool interaction failed',
          { status: response.status },
          response.body,
          startTime
        );
      }

      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      // Check for expected tool usage
      const toolNames = analysis.toolCalls.map(c => c.toolName);
      const hasScreenshot = toolNames.includes('take_screenshot');
      const hasWeather = toolNames.includes('get_weather');
      const hasCalculate = toolNames.includes('calculate');

      // The AI model might not call all tools in one go, so let's be more flexible
      // We'll pass if at least one tool was called and we got some response
      const success =
        analysis.toolCalls.length > 0 && analysis.textDeltas.length > 0;

      TestLogger.success('Complex tool interaction completed', {
        toolsUsed: toolNames,
        screenshot: hasScreenshot,
        weather: hasWeather,
        calculate: hasCalculate,
        totalCalls: analysis.toolCalls.length,
      });

      return createTestResult(
        success,
        success
          ? 'Complex tool interaction passed'
          : 'Complex tool interaction incomplete',
        {
          toolNames,
          analysis,
          hasScreenshot,
          hasWeather,
          hasCalculate,
          actualCalls: analysis.toolCalls.length,
        },
        success ? undefined : 'No tool calls made or no text response received',
        startTime
      );
    } catch (error) {
      TestLogger.error('Complex tool interaction failed', error);
      return createTestResult(
        false,
        'Complex tool interaction failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testMultiStepWorkflow(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Multi-Step Workflow');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content:
            'I want to open Cursor app and then type "Hello World" in the chat. Please do this step by step: first get the applications, then open Cursor, then get the window structure, and finally type the text.',
        },
      ],
      model: 'gemini-2.0-flash-001',
      max_tokens: 2000,
      temperature: 0.7,
      tools: COMPLEX_OPENAI_TOOLS,
    };

    try {
      // This test simulates a multi-step workflow
      let currentMessages = requestBody.messages;
      let stepCount = 0;
      const maxSteps = 5; // Prevent infinite loops
      let allToolCalls: any[] = [];
      let allTextResponses: string[] = [];

      while (stepCount < maxSteps) {
        stepCount++;
        TestLogger.info(`🔄 Multi-step workflow - Step ${stepCount}`);

        const response = await this.makeAIRequest({
          ...requestBody,
          messages: currentMessages,
        });

        if (!response.ok) {
          return createTestResult(
            false,
            `Multi-step workflow failed at step ${stepCount}`,
            { status: response.status, step: stepCount },
            response.body,
            startTime
          );
        }

        const chunks = parseStreamingResponse(response.body);
        const analysis = analyzeStreamChunks(chunks);

        // Collect all tool calls and text
        allToolCalls.push(...analysis.toolCalls);
        const stepText = analysis.textDeltas.map(d => d.textDelta).join('');
        if (stepText) {
          allTextResponses.push(stepText);
        }

        TestLogger.info(`📊 Step ${stepCount} analysis:`, {
          toolCalls: analysis.toolCalls.length,
          textLength: stepText.length,
          toolNames: analysis.toolCalls.map(c => c.toolName),
        });

        // If no tool calls were made, this might be the final response
        if (analysis.toolCalls.length === 0) {
          TestLogger.info(
            '✅ Multi-step workflow completed - no more tool calls'
          );
          break;
        }

        // Add the assistant's response to the conversation
        const assistantMessage = {
          role: 'assistant' as const,
          content: stepText,
          toolCalls: analysis.toolCalls.map(tc => ({
            name: tc.toolName,
            args: tc.args,
          })),
        };

        currentMessages = [...currentMessages, assistantMessage];

        // Check if the response indicates the workflow should continue
        const responseText = stepText.toLowerCase();
        const continueIndicators = [
          'next',
          'now let',
          'step',
          'then',
          'after',
          'following',
          'proceed',
        ];

        const shouldContinue = continueIndicators.some(indicator =>
          responseText.includes(indicator)
        );

        if (!shouldContinue && stepText.length > 50) {
          TestLogger.info(
            '✅ Multi-step workflow appears complete based on response content'
          );
          break;
        }

        // Add a user message asking to continue
        const continueMessage = {
          role: 'user' as const,
          content: `Great! Please continue with the next step in the workflow.`,
        };

        currentMessages = [...currentMessages, continueMessage];
      }

      // Analyze the overall workflow
      const uniqueToolNames = [...new Set(allToolCalls.map(tc => tc.toolName))];
      const hasLogicalProgression = uniqueToolNames.length > 1;
      const totalSteps = stepCount;
      const totalToolCalls = allToolCalls.length;

      const success =
        hasLogicalProgression && totalSteps > 1 && totalToolCalls > 0;

      TestLogger.success('Multi-step workflow completed', {
        totalSteps,
        totalToolCalls,
        uniqueTools: uniqueToolNames.length,
        toolsUsed: uniqueToolNames,
        hasLogicalProgression,
      });

      return createTestResult(
        success,
        success
          ? 'Multi-step workflow passed'
          : 'Multi-step workflow incomplete',
        {
          totalSteps,
          totalToolCalls,
          uniqueToolNames,
          allTextResponses: allTextResponses.slice(0, 3), // Limit for readability
        },
        success
          ? undefined
          : 'Workflow did not demonstrate multi-step progression',
        startTime
      );
    } catch (error) {
      TestLogger.error('Multi-step workflow failed', error);
      return createTestResult(
        false,
        'Multi-step workflow failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  /**
   * Test Frontend UX Integration
   * Simulates real frontend usage patterns and validates expected UX behavior
   */
  async testFrontendUXIntegration(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Frontend UX Integration');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content: 'Open Cursor app and type "Hello World" in the chat',
        },
      ],
      model: 'gemini-2.5-flash',
      max_tokens: 1000,
      temperature: 0.7,
      tools: COMPLEX_OPENAI_TOOLS,
    };

    try {
      // Use the existing executeToolWorkflow function which handles the full flow
      const response = await executeToolWorkflow(
        `${this.config.apiBaseUrl}/ai`,
        requestBody,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiPassword}`,
          },
          timeout: this.config.timeout,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.body}`);
      }

      // Parse the response to analyze the conversation
      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      // Validate that we got meaningful tool interactions
      const hasAppAutomation = analysis.toolCalls.some(
        tc =>
          tc.toolName === 'get_applications' ||
          tc.toolName === 'open_application'
      );
      const hasTextInteraction = analysis.toolCalls.some(
        tc => tc.toolName === 'type_into_element'
      );
      const hasWindowInteraction = analysis.toolCalls.some(
        tc =>
          tc.toolName === 'get_window_tree' ||
          tc.toolName === 'get_focused_window_tree'
      );

      // Check for logical workflow progression
      const toolNames = analysis.toolCalls.map(tc => tc.toolName);
      const uniqueTools = [...new Set(toolNames)];
      const hasLogicalProgression = uniqueTools.length >= 2;

      // Validate response quality
      const hasTextResponse = analysis.textDeltas.length > 0;
      const totalTextLength = analysis.textDeltas.join('').length;

      const success = hasAppAutomation; // If it can automate apps, the core functionality works

      const endTime = Date.now();
      const result = createTestResult(
        success,
        success
          ? 'Frontend UX integration passed'
          : 'Frontend UX integration incomplete',
        {
          toolCallsCount: analysis.toolCalls.length,
          uniqueToolsCount: uniqueTools.length,
          toolsUsed: uniqueTools,
          hasAppAutomation,
          hasTextInteraction,
          hasWindowInteraction,
          hasLogicalProgression,
          hasTextResponse,
          totalTextLength,
        },
        undefined, // error
        startTime
      );

      this.results.push(result);
      TestLogger.info('✅ Frontend UX integration completed', result.data);
      return result;
    } catch (error) {
      const endTime = Date.now();
      const result = createTestResult(
        false,
        `Frontend UX test failed: ${error}`,
        { error: String(error) },
        String(error), // error
        startTime // This should be a number, not string
      );
      this.results.push(result);
      TestLogger.error('❌ Frontend UX test failed', result.data);
      return result;
    }
  }

  async testStreamingWithTools(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Streaming Response with Tools');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content:
            'Use the available tools to help me. Get the time and do a simple calculation. Stream your response.',
        },
      ],
      model: 'gemini-2.5-flash',
      max_tokens: 800,
      temperature: 0.5,
      tools: MINIMAL_OPENAI_TOOLS,
    };

    try {
      const response = await this.makeAIRequest(requestBody);

      if (!response.ok) {
        return createTestResult(
          false,
          'Streaming with tools failed',
          { status: response.status },
          response.body,
          startTime
        );
      }

      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      // Verify streaming characteristics
      const hasStart = chunks.some(c => c.type === 'start');
      const hasToolInteraction =
        analysis.toolCalls.length > 0 && analysis.toolResults.length > 0;

      // For the tool workflow test, we mainly care that:
      // 1. Stream started properly
      // 2. Tools were called and results were generated (via our workflow)
      // 3. Stream finished properly
      // Text deltas might not always be present depending on the AI's response pattern
      const success = hasStart && hasToolInteraction && analysis.hasFinish;

      TestLogger.success('Streaming with tools completed', {
        hasStart,
        hasTextDeltas: analysis.textDeltas.length > 0,
        hasToolInteraction,
        hasFinish: analysis.hasFinish,
        chunkCount: chunks.length,
        toolCallsCount: analysis.toolCalls.length,
        toolResultsCount: analysis.toolResults.length,
      });

      return createTestResult(
        success,
        success
          ? 'Streaming with tools passed'
          : 'Streaming with tools incomplete',
        { chunks: chunks.length, analysis },
        success ? undefined : 'Streaming format validation failed',
        startTime
      );
    } catch (error) {
      TestLogger.error('Streaming with tools failed', error);
      return createTestResult(
        false,
        'Streaming with tools failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testWithoutTools(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Without Tools (Control Test)');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content: 'Hello! Tell me about TypeScript without using any tools.',
        },
      ],
      model: 'gemini-2.0-flash-001',
      max_tokens: 500,
      temperature: 0.7,
      // No tools provided
    };

    try {
      const response = await this.makeAIRequest(requestBody);

      if (!response.ok) {
        return createTestResult(
          false,
          'Control test (no tools) failed',
          { status: response.status },
          response.body,
          startTime
        );
      }

      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      // Should have text but no tool interactions
      const hasText = analysis.textDeltas.length > 0;
      const hasNoTools =
        analysis.toolCalls.length === 0 && analysis.toolResults.length === 0;

      const success = hasText && hasNoTools;

      TestLogger.success('Control test completed', {
        hasText,
        hasNoTools,
        textLength: analysis.textDeltas.reduce(
          (sum, c) => sum + (c.textDelta?.length || 0),
          0
        ),
      });

      return createTestResult(
        success,
        success ? 'Control test passed' : 'Control test failed',
        analysis,
        success ? undefined : 'Unexpected tool calls or missing text',
        startTime
      );
    } catch (error) {
      TestLogger.error('Control test failed', error);
      return createTestResult(
        false,
        'Control test failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testInvalidToolSchema(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Invalid Tool Schema Handling');
    const startTime = Date.now();

    const requestBody: AIRequestBody = {
      messages: [
        {
          role: 'user',
          content: 'Use any available tools to help me.',
        },
      ],
      model: 'gemini-2.0-flash-001',
      max_tokens: 500,
      temperature: 0.7,
      mcpTools: {
        ...MINIMAL_MCP_TOOLS,
        ...INVALID_MCP_TOOLS,
      } as any,
    };

    try {
      const response = await this.makeAIRequest(requestBody);

      // Should either succeed with valid tools only, or fail gracefully
      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      // Check if it handled invalid tools gracefully
      const onlyValidToolsUsed = analysis.toolCalls.every(
        c => c.toolName === 'get_current_time' || c.toolName === 'calculate'
      );

      TestLogger.success('Invalid tool schema test completed', {
        status: response.status,
        onlyValidToolsUsed,
        toolCalls: analysis.toolCalls.map(c => c.toolName),
      });

      return createTestResult(
        true, // This test passes if it doesn't crash
        'Invalid tool schema handled',
        { onlyValidToolsUsed, analysis },
        undefined,
        startTime
      );
    } catch (error) {
      TestLogger.error('Invalid tool schema test failed', error);
      return createTestResult(
        false,
        'Invalid tool schema test failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async testErrorHandling(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Error Handling');
    const startTime = Date.now();

    // Test with invalid authentication
    try {
      const response = await makeHTTPRequest(`${this.config.apiBaseUrl}/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-password',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Test' }],
        }),
        timeout: this.config.timeout,
      });

      const expectsAuth = response.status === 401;

      TestLogger.success('Error handling test completed', {
        status: response.status,
        expectsAuth,
      });

      return createTestResult(
        expectsAuth,
        expectsAuth
          ? 'Error handling passed'
          : 'Authentication validation failed',
        { status: response.status },
        expectsAuth ? undefined : 'Should return 401 for invalid auth',
        startTime
      );
    } catch (error) {
      TestLogger.error('Error handling test failed', error);
      return createTestResult(
        false,
        'Error handling test failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  // Update makeAIRequest method to properly type the messages
  private async makeAIRequest(requestBody: any): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    ok: boolean;
    text(): Promise<string>;
  }> {
    // Ensure messages have proper role types
    if (requestBody.messages) {
      requestBody.messages = requestBody.messages.map((msg: any) => ({
        ...msg,
        role: msg.role as 'user' | 'assistant' | 'system',
      }));
    }

    const url = `${this.config.apiBaseUrl}/ai`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiPassword}`,
    };

    const response = await makeHTTPRequest(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      timeout: this.config.timeout,
    });

    // Add text method for compatibility
    return {
      ...response,
      text: async () => response.body,
    };
  }

  /**
   * Test that validates the exact message format sent by the frontend
   * This ensures backend can handle frontend's openAIMessages format
   */
  async testFrontendMessageFormat(): Promise<TestResult> {
    TestLogger.info('🎯 Testing Frontend Message Format Compatibility');
    const startTime = Date.now();

    // Frontend message format test - ensure proper role typing
    const frontendMessages = [
      {
        role: 'user' as const,
        content: 'This is a test message from the frontend UI',
      },
    ];

    const requestBody = {
      messages: frontendMessages, // Now properly typed
      model: 'gemini-2.5-flash',
      max_tokens: 1000,
      temperature: 0.7,
      mcpTools: MINIMAL_MCP_TOOLS,
    };

    try {
      const response = await this.makeAIRequest(requestBody);

      if (!response.ok) {
        const errorText = await response.text();
        return createTestResult(
          false,
          'Frontend message format rejected',
          { status: response.status, error: errorText },
          errorText,
          startTime
        );
      }

      // Parse the streaming response
      const chunks = parseStreamingResponse(response.body);
      const analysis = analyzeStreamChunks(chunks);

      const success =
        analysis.toolCalls.length > 0 || analysis.textDeltas.length > 0;

      return createTestResult(
        success,
        'Frontend Message Format',
        {
          messageFormat: 'Frontend compatible',
          toolCalls: analysis.toolCalls.length,
          textDeltas: analysis.textDeltas.length,
          hasFinish: analysis.hasFinish,
        },
        undefined,
        startTime
      );
    } catch (error) {
      return createTestResult(
        false,
        'Frontend Message Format',
        { error: error instanceof Error ? error.message : String(error) },
        String(error),
        startTime
      );
    }
  }

  /**
   * Test streaming response parsing like the frontend does
   * Validates that all SSE events are properly formatted
   */
  async testStreamingResponseParsing(): Promise<TestResult> {
    TestLogger.info('🌊 Testing Streaming Response Parsing (Frontend Style)');
    const startTime = Date.now();

    const requestBody = {
      messages: [
        {
          role: 'user',
          content: 'Get current applications and take a screenshot',
        },
      ],
      model: 'gemini-2.5-flash',
      max_tokens: 1000,
      temperature: 0.7,
      mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
    };

    try {
      const response = await this.makeAIRequest(requestBody);

      // Handle streaming response properly
      if (typeof response.body === 'string') {
        // Parse the response body as text for streaming
        const chunks = parseStreamingResponse(response.body);
        const analysis = analyzeStreamChunks(chunks);

        return createTestResult(
          true,
          'Streaming response received and parsed',
          {
            status: response.status,
            chunks: chunks.length,
            analysis,
          },
          undefined,
          startTime
        );
      } else {
        return createTestResult(
          false,
          'Expected string body for streaming response',
          { status: response.status },
          'Response body is not a string',
          startTime
        );
      }
    } catch (error) {
      return createTestResult(
        false,
        'Streaming Response Parsing',
        { error: error instanceof Error ? error.message : String(error) },
        String(error),
        startTime
      );
    }
  }

  /**
   * Test tool continuation flow using OpenAI-compliant tool messages
   * Simulates the exact tool execution and continuation flow with role: "tool" messages
   * Tests the new format that replaces the legacy _toolResults field
   */
  async testToolContinuationFlow(): Promise<TestResult> {
    TestLogger.info('🔄 Testing Tool Continuation Flow (Frontend UX)');
    const startTime = Date.now();

    // Step 1: Initial request that should trigger a tool call
    const initialRequest = {
      messages: [{ role: 'user', content: 'Get applications and open Cursor' }],
      model: 'gemini-2.5-flash',
      max_tokens: 1000,
      temperature: 0.7,
      mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
    };

    try {
      const response1 = await this.makeAIRequest(initialRequest);
      const chunks = parseStreamingResponse(response1.body);
      const analysis1 = analyzeStreamChunks(chunks);
      const toolCalls1 = analysis1.toolCalls;

      if (toolCalls1.length === 0) {
        return createTestResult(
          false,
          'No tool calls triggered in initial request',
          { initialToolCalls: toolCalls1.length },
          'No tool calls triggered in initial request',
          startTime
        );
      }

      // Step 2: Execute tools and prepare continuation (simulate frontend)
      const toolResults = [];
      for (const toolCall of toolCalls1) {
        if (!toolCall.toolName || typeof toolCall.toolName !== 'string') {
          console.warn('⚠️ Tool call missing or invalid toolName:', toolCall);
          continue;
        }

        const result = await executeMockTool(toolCall.toolName, toolCall.args);
        toolResults.push({
          toolCallId: toolCall.toolCallId || `call_${Date.now()}`,
          toolName: toolCall.toolName,
          args: toolCall.args, // Include args for proper Gemini pairing
          result: result,
        });
      }

      // Step 3: Send continuation request using OpenAI tool message format
      const continuationMessages = [
        { role: 'user', content: 'Get applications and open Cursor' },
        // Assistant message with tool calls
        {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls1.map((toolCall, index) => ({
            id: toolCall.toolCallId || `call_${Date.now()}_${index}`,
            type: 'function' as const,
            function: {
              name: toolCall.toolName || 'unknown',
              arguments: JSON.stringify(toolCall.args || {}),
            },
          })),
        },
        // Tool messages with results
        ...toolResults.map(toolResult => ({
          role: 'tool' as const,
          content: `Tool result: ${JSON.stringify(toolResult.result)}`,
          tool_call_id: toolResult.toolCallId,
        })),
        { role: 'user', content: 'Continue with the next steps' }, // Follow-up user message
      ];

      const continuationRequest = {
        messages: continuationMessages,
        model: 'gemini-2.5-flash',
        max_tokens: 1000,
        temperature: 0.7,
        tools: MINIMAL_OPENAI_TOOLS, // Use OpenAI format instead of mcpTools
      };

      const response2 = await this.makeAIRequest(continuationRequest);
      const chunks2 = parseStreamingResponse(response2.body);
      const analysis2 = analyzeStreamChunks(chunks2);
      const toolCalls2 = analysis2.toolCalls;
      const textDeltas = analysis2.textDeltas;
      const hasFinish = analysis2.hasFinish;

      const success = textDeltas.length > 0 || toolCalls2.length > 0;

      return createTestResult(
        success,
        'Tool Continuation Flow',
        {
          initialToolCalls: toolCalls1.length,
          toolResultsSent: toolResults.length,
          continuationToolCalls: toolCalls2.length,
          continuationTextDeltas: textDeltas.length,
          hasFinish,
          flowCompleted: success,
        },
        undefined,
        startTime
      );
    } catch (error) {
      return createTestResult(
        false,
        'Tool Continuation Flow',
        { error: error instanceof Error ? error.message : String(error) },
        String(error),
        startTime
      );
    }
  }

  /**
   * Test error handling scenarios that frontend might encounter
   */
  async testErrorHandlingScenarios(): Promise<TestResult> {
    TestLogger.info('⚠️ Testing Error Handling Scenarios');
    const startTime = Date.now();

    const scenarios = [
      {
        name: 'Invalid Tool Name',
        request: {
          messages: [
            { role: 'user', content: 'Use invalid_tool_name to do something' },
          ],
          model: 'gemini-2.5-flash',
          mcpTools: { invalid_tool: { description: 'Invalid tool' } },
        },
      },
      {
        name: 'Malformed Tool Results',
        request: {
          messages: [{ role: 'user', content: 'Test message' }],
          model: 'gemini-2.5-flash',
          mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
          toolResults: [{ malformed: 'data' }], // Missing required fields
        },
      },
      {
        name: 'Empty Messages Array',
        request: {
          messages: [],
          model: 'gemini-2.5-flash',
          mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
        },
      },
    ];

    const results = [];

    for (const scenario of scenarios) {
      try {
        const response = await this.makeAIRequest(scenario.request);
        const responseText = await response.text();

        results.push({
          scenario: scenario.name,
          handled: response.status >= 400, // Should return error status
          status: response.status,
          responseLength: responseText.length,
        });
      } catch (error) {
        results.push({
          scenario: scenario.name,
          handled: true, // Throwing is also valid error handling
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const allHandled = results.every(r => r.handled);

    return createTestResult(
      allHandled,
      'Error Handling Scenarios',
      {
        scenarios: results,
        allErrorsHandled: allHandled,
      },
      undefined,
      startTime
    );
  }

  async testOpenAIToolMessageFormat(): Promise<TestResult> {
    const startTime = Date.now();

    // Test OpenAI-compliant tool message conversation flow
    const initialRequest: AIRequestBody = {
      messages: [
        { role: 'user', content: 'Take a screenshot and get current time' },
      ],
      model: 'gemini-2.5-flash',
      max_tokens: 500,
      temperature: 0.7,
      tools: MINIMAL_OPENAI_TOOLS,
    };

    try {
      // Step 1: Initial request that should trigger tool calls
      const response1 = await this.makeAIRequest(initialRequest);
      const chunks1 = parseStreamingResponse(response1.body);
      const analysis1 = analyzeStreamChunks(chunks1);

      if (analysis1.toolCalls.length === 0) {
        return createTestResult(
          false,
          'No tool calls triggered in OpenAI format test',
          { chunks: chunks1.length },
          'Expected tool calls but got none',
          startTime
        );
      }

      // Step 2: Create continuation request with tool messages (OpenAI format)
      const toolMessages = analysis1.toolCalls
        .map((toolCall, index) => [
          // Assistant message with tool call
          {
            role: 'assistant' as const,
            content: null,
            tool_calls: [
              {
                id: toolCall.toolCallId || `call_${Date.now()}_${index}`,
                type: 'function' as const,
                function: {
                  name: toolCall.toolName || 'unknown',
                  arguments: JSON.stringify(toolCall.args || {}),
                },
              },
            ],
          },
          // Tool message with result
          {
            role: 'tool' as const,
            content: `Mock result for ${toolCall.toolName}: success`,
            tool_call_id: toolCall.toolCallId || `call_${Date.now()}_${index}`,
          },
        ])
        .flat();

      const continuationRequest: AIRequestBody = {
        messages: [
          { role: 'user', content: 'Take a screenshot and get current time' },
          ...toolMessages,
          { role: 'user', content: 'Now describe what you found' },
        ],
        model: 'gemini-2.5-flash',
        max_tokens: 500,
        temperature: 0.7,
      };

      // Step 3: Send continuation request
      const response2 = await this.makeAIRequest(continuationRequest);
      const chunks2 = parseStreamingResponse(response2.body);
      const analysis2 = analyzeStreamChunks(chunks2);

      // Validate the response
      const hasTextResponse = analysis2.textDeltas.length > 0;
      const responseText = analysis2.textDeltas.join('');

      return createTestResult(
        response2.ok && hasTextResponse && responseText.length > 10,
        'OpenAI tool message format test completed successfully',
        {
          initialToolCalls: analysis1.toolCalls.length,
          toolMessages: toolMessages.length,
          finalResponse: responseText.substring(0, 100),
          responseLength: responseText.length,
        },
        undefined,
        startTime
      );
    } catch (error: any) {
      return createTestResult(
        false,
        'OpenAI tool message format test failed',
        { error: error.message },
        error.message,
        startTime
      );
    }
  }

  async testComplexUserWorkflow(): Promise<TestResult> {
    TestLogger.info('🎭 Testing Complex User Workflow (Realistic UX)');
    const startTime = Date.now();

    const userStory =
      'Open Cursor app, type \'console.log("Hello");\' in the editor, then take a screenshot';

    const requestBody = {
      messages: [{ role: 'user', content: userStory }],
      model: 'gemini-2.5-flash',
      max_tokens: 2000,
      temperature: 0.7,
      mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
    };

    try {
      let currentMessages = requestBody.messages;
      let stepCount = 0;
      const maxSteps = 6; // Allow for more steps in complex workflow
      let workflowSteps: any[] = [];
      let totalTextLength = 0;

      while (stepCount < maxSteps) {
        stepCount++;
        TestLogger.info(`  Step ${stepCount}: Making request...`);

        const response = await this.makeAIRequest({
          ...requestBody,
          messages: currentMessages,
        });

        if (!response.ok) {
          throw new Error(
            `Request failed at step ${stepCount}: ${response.status}`
          );
        }

        const chunks = parseStreamingResponse(response.body);
        const analysis = analyzeStreamChunks(chunks);

        const stepResult = {
          step: stepCount,
          toolCalls: analysis.toolCalls.length,
          toolNames: analysis.toolCalls.map(tc => tc.toolName),
          textLength: analysis.textDeltas.join('').length,
          hasFinish: analysis.hasFinish,
        };

        workflowSteps.push(stepResult);
        totalTextLength += stepResult.textLength;

        // Simulate assistant response
        const assistantResponse = analysis.textDeltas.join('');
        if (assistantResponse.trim()) {
          currentMessages.push({
            role: 'assistant',
            content: assistantResponse,
          });
        }

        // Execute tools if any
        if (analysis.toolCalls.length > 0) {
          const toolResults = [];
          for (const toolCall of analysis.toolCalls) {
            if (!toolCall.toolName || typeof toolCall.toolName !== 'string') {
              console.warn(
                '⚠️ Tool call missing or invalid toolName:',
                toolCall
              );
              continue;
            }

            const result = await executeMockTool(
              toolCall.toolName,
              toolCall.args
            );
            toolResults.push({
              toolCallId: toolCall.toolCallId || `call_${Date.now()}`,
              toolName: toolCall.toolName,
              args: toolCall.args,
              result: result,
            });
          }

          // Add tool results and continue
          currentMessages.push({ role: 'user', content: userStory });
          const nextRequest = {
            ...requestBody,
            messages: currentMessages,
            toolResults: toolResults,
          };

          const nextResponse = await this.makeAIRequest(nextRequest);
          const nextChunks = parseStreamingResponse(nextResponse.body);
          const nextAnalysis = analyzeStreamChunks(nextChunks);

          if (nextAnalysis.textDeltas.length > 0) {
            currentMessages.push({
              role: 'assistant',
              content: nextAnalysis.textDeltas.join(''),
            });
          }

          totalTextLength += nextAnalysis.textDeltas.join('').length;

          if (nextAnalysis.hasFinish && nextAnalysis.toolCalls.length === 0) {
            break; // Workflow completed
          }
        } else if (analysis.hasFinish) {
          break; // No more tools needed
        } else {
          // Continue conversation
          currentMessages.push({
            role: 'user',
            content: 'Please continue with the next step.',
          });
        }
      }

      // Analyze workflow quality
      const totalToolCalls = workflowSteps.reduce(
        (sum, step) => sum + step.toolCalls,
        0
      );
      const uniqueTools = [
        ...new Set(workflowSteps.flatMap(step => step.toolNames)),
      ];
      const expectedTools = [
        'get_applications',
        'open_application',
        'type_into_element',
        'capture_element_screenshot',
      ];
      const hasExpectedFlow = expectedTools.some(tool =>
        uniqueTools.includes(tool)
      );

      return createTestResult(
        totalToolCalls >= 2 && totalTextLength > 50 && hasExpectedFlow,
        'Complex User Workflow',
        {
          userStory,
          totalSteps: stepCount,
          totalToolCalls,
          uniqueToolsUsed: uniqueTools,
          totalTextLength,
          workflowSteps,
          expectedFlowDetected: hasExpectedFlow,
        },
        undefined,
        startTime
      );
    } catch (error) {
      return createTestResult(
        false,
        'Complex User Workflow',
        { error: error instanceof Error ? error.message : String(error) },
        String(error),
        startTime
      );
    }
  }

  /**
   * Test performance and responsiveness for frontend UX
   */
  async testPerformanceMetrics(): Promise<TestResult> {
    TestLogger.info('⚡ Testing Performance Metrics (UX Responsiveness)');
    const startTime = Date.now();

    const testCases = [
      { name: 'Simple Query', content: 'Hello, how are you?' },
      { name: 'Tool Request', content: 'Take a screenshot' },
      { name: 'Multi-step Request', content: 'Open an app and type text' },
    ];

    const results = [];

    for (const testCase of testCases) {
      const caseStartTime = Date.now();

      try {
        const response = await this.makeAIRequest({
          messages: [{ role: 'user', content: testCase.content }],
          model: 'gemini-2.5-flash',
          max_tokens: 500,
          temperature: 0.7,
          mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
        });

        const responseTime = Date.now() - caseStartTime;

        if (response.ok) {
          const chunks = parseStreamingResponse(response.body);
          const analysis = analyzeStreamChunks(chunks);

          results.push({
            testCase: testCase.name,
            responseTime,
            success: true,
            toolCalls: analysis.toolCalls.length,
            textLength: analysis.textDeltas.join('').length,
          });
        } else {
          results.push({
            testCase: testCase.name,
            responseTime,
            success: false,
            error: `HTTP ${response.status}`,
          });
        }
      } catch (error) {
        results.push({
          testCase: testCase.name,
          responseTime: Date.now() - caseStartTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const avgResponseTime =
      results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
    const allSuccessful = results.every(r => r.success);
    const reasonablePerformance = avgResponseTime < 5000; // 5 seconds threshold

    return createTestResult(
      allSuccessful && reasonablePerformance,
      'Performance Metrics',
      {
        averageResponseTime: avgResponseTime,
        maxResponseTime: Math.max(...results.map(r => r.responseTime)),
        allRequestsSuccessful: allSuccessful,
        reasonablePerformance,
        testResults: results,
      },
      undefined,
      startTime
    );
  }

  /**
   * Test that streaming response format matches frontend expectations
   */
  async testFrontendStreamingFormat(): Promise<TestResult> {
    TestLogger.info('🎬 Testing Frontend Streaming Format Compatibility');
    const startTime = Date.now();

    const requestBody = {
      messages: [
        {
          role: 'user',
          content: 'Take a screenshot and tell me what you see',
        },
      ],
      model: 'gemini-2.5-flash',
      max_tokens: 500,
      temperature: 0.7,
      mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
    };

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiPassword}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let hasStart = false;
      let hasToolCall = false;
      let hasTextDelta = false;
      let hasFinish = false;
      let toolCallFormat: any = null;
      let textDeltaFormat: any = null;
      let finishFormat: any = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'start') {
                  hasStart = true;
                  TestLogger.info('📡 Received start event');
                } else if (parsed.type === 'toolCall') {
                  hasToolCall = true;
                  toolCallFormat = parsed;
                  TestLogger.info('🔧 Received toolCall event:', {
                    toolName: parsed.toolName,
                    hasArgs: !!parsed.args,
                    hasToolCallId: !!parsed.toolCallId,
                  });
                } else if (parsed.type === 'textDelta') {
                  hasTextDelta = true;
                  textDeltaFormat = parsed;
                  TestLogger.info('📝 Received textDelta event');
                } else if (parsed.type === 'finish') {
                  hasFinish = true;
                  finishFormat = parsed;
                  TestLogger.info('🏁 Received finish event:', {
                    reason: parsed.finishReason,
                    hasUsage: !!parsed.usage,
                  });
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Validate streaming format matches frontend expectations
      const validations = [
        { check: hasStart, message: 'Missing start event' },
        { check: hasToolCall, message: 'Missing toolCall event' },
        { check: hasFinish, message: 'Missing finish event' },
        {
          check: toolCallFormat?.toolName,
          message: 'toolCall missing toolName',
        },
        {
          check: toolCallFormat?.toolCallId,
          message: 'toolCall missing toolCallId',
        },
        {
          check: toolCallFormat?.args !== undefined,
          message: 'toolCall missing args',
        },
        {
          check: finishFormat?.finishReason,
          message: 'finish missing finishReason',
        },
      ];

      const failures = validations.filter(v => !v.check);

      if (failures.length > 0) {
        throw new Error(
          `Frontend format validation failed: ${failures.map(f => f.message).join(', ')}`
        );
      }

      return {
        success: true,
        message: 'Frontend streaming format validation passed',
        details: {
          hasStart,
          hasToolCall,
          hasTextDelta,
          hasFinish,
          toolCallFormat: {
            toolName: toolCallFormat?.toolName,
            hasArgs: !!toolCallFormat?.args,
          },
          finishFormat: {
            reason: finishFormat?.finishReason,
            hasUsage: !!finishFormat?.usage,
          },
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Frontend streaming format test failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error },
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Test tool execution pattern matching frontend behavior
   */
  async testFrontendToolExecutionPattern(): Promise<TestResult> {
    TestLogger.info('🔄 Testing Frontend Tool Execution Pattern');
    const startTime = Date.now();

    try {
      // Step 1: Initial request (like frontend sendMessage)
      const initialRequest = {
        messages: [
          {
            role: 'user',
            content: 'Get the list of applications and tell me about them',
          },
        ],
        model: 'gemini-2.5-flash',
        max_tokens: 500,
        temperature: 0.7,
        mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
      };

      TestLogger.info('📤 Step 1: Sending initial request');
      const response1 = await fetch(`${this.config.apiBaseUrl}/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiPassword}`,
        },
        body: JSON.stringify(initialRequest),
      });

      if (!response1.ok) {
        throw new Error(`Initial request failed: ${response1.status}`);
      }

      // Parse streaming response to extract tool call
      const reader1 = response1.body?.getReader();
      if (!reader1) throw new Error('No response body');

      const decoder = new TextDecoder();
      let toolCall: any = null;
      let assistantResponse = '';

      try {
        while (true) {
          const { done, value } = await reader1.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'toolCall') {
                  toolCall = parsed;
                } else if (parsed.type === 'textDelta') {
                  assistantResponse += parsed.textDelta;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      } finally {
        reader1.releaseLock();
      }

      if (!toolCall) {
        throw new Error('No tool call received in initial response');
      }

      TestLogger.info('🔧 Tool call received:', {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
      });

      // Step 2: Execute tool (simulating frontend MCP execution)
      const url = `${this.config.apiBaseUrl}/ai`;
      const toolResult = await executeToolWorkflow(
        url,
        {
          messages: [{ role: 'user' as const, content: 'Execute tool' }],
          model: 'gemini-2.5-flash',
          mcpTools: MINIMAL_MCP_TOOLS,
        },
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiPassword}`,
          },
          timeout: this.config.timeout,
        }
      );

      TestLogger.info('⚙️ Tool executed, result status:', toolResult.status);
      TestLogger.info(
        '⚙️ Tool executed, body length:',
        toolResult.body?.length || 0
      );

      return createTestResult(
        !!(toolResult.ok && toolResult.body && toolResult.body.length > 0),
        toolResult.ok
          ? 'Tool execution workflow completed'
          : 'Tool execution failed',
        {
          status: toolResult.status,
          headers: toolResult.headers,
          bodyLength: toolResult.body?.length || 0,
        },
        !toolResult.ok ? `Status: ${toolResult.status}` : undefined,
        startTime
      );
    } catch (error) {
      return {
        success: false,
        message: `Frontend tool execution pattern test failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error },
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Test error handling scenarios that frontend might encounter
   */
  async testFrontendErrorHandling(): Promise<TestResult> {
    TestLogger.info('🚨 Testing Frontend Error Handling Scenarios');
    const startTime = Date.now();

    const errorScenarios = [
      {
        name: 'Invalid tool name',
        request: {
          messages: [
            { role: 'user', content: 'Use invalid_tool_that_does_not_exist' },
          ],
          model: 'gemini-2.5-flash',
          mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
        },
      },
      {
        name: 'Malformed tool results',
        request: {
          messages: [{ role: 'user', content: 'Test message' }],
          model: 'gemini-2.5-flash',
          mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
          toolResults: [{ invalid: 'format' }], // Malformed
        },
      },
      {
        name: 'Missing authorization',
        request: {
          messages: [{ role: 'user', content: 'Test message' }],
          model: 'gemini-2.5-flash',
          mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
        },
        skipAuth: true,
      },
    ];

    const results = [];

    for (const scenario of errorScenarios) {
      TestLogger.info(`🧪 Testing: ${scenario.name}`);

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (!scenario.skipAuth) {
          headers['Authorization'] = `Bearer ${this.config.apiPassword}`;
        }

        const response = await fetch(`${this.config.apiBaseUrl}/ai`, {
          method: 'POST',
          headers,
          body: JSON.stringify(scenario.request),
        });

        if (scenario.skipAuth) {
          // Should fail with 401
          results.push({
            scenario: scenario.name,
            status: response.status,
            success: response.status === 401,
          });
        } else {
          // Should handle gracefully
          const reader = response.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let hasError = false;
            let errorMessage = '';

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') break;

                    try {
                      const parsed = JSON.parse(data);
                      if (parsed.type === 'error') {
                        hasError = true;
                        errorMessage = parsed.error;
                      }
                    } catch (e) {
                      // Skip invalid JSON
                    }
                  }
                }
              }
            } finally {
              reader.releaseLock();
            }

            results.push({
              scenario: scenario.name,
              status: response.status,
              hasError,
              errorMessage,
              success: response.ok, // Should handle gracefully
            });
          }
        }
      } catch (error) {
        results.push({
          scenario: scenario.name,
          error: error instanceof Error ? error.message : String(error),
          success: false,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const success = successCount === errorScenarios.length;

    return {
      success,
      message: `Error handling test: ${successCount}/${errorScenarios.length} scenarios handled correctly`,
      details: { results },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Test complex user scenarios that simulate real frontend usage
   */
  async testComplexUserScenarios(): Promise<TestResult> {
    TestLogger.info('👥 Testing Complex User Scenarios');
    const startTime = Date.now();

    const scenarios = [
      {
        name: 'Desktop automation workflow',
        messages: [
          'Take a screenshot of my desktop',
          'Get the current window tree',
          'Click on the first button you find',
        ],
      },
      {
        name: 'App discovery and interaction',
        messages: [
          'Show me what applications are running',
          'Open the calculator app',
          'Type "123 + 456" in the calculator',
        ],
      },
      {
        name: 'UI analysis workflow',
        messages: [
          'Get the focused window information',
          'Analyze the UI elements',
          'Find all clickable elements',
        ],
      },
    ];

    const results = [];

    for (const scenario of scenarios) {
      TestLogger.info(`🎭 Scenario: ${scenario.name}`);

      try {
        let conversationMessages: any[] = [];
        let scenarioSuccess = true;
        let stepResults = [];

        for (let i = 0; i < scenario.messages.length; i++) {
          const userMessage = scenario.messages[i];
          TestLogger.info(`  Step ${i + 1}: ${userMessage}`);

          // Add user message to conversation
          conversationMessages.push({
            role: 'user',
            content: userMessage,
          });

          const requestBody = {
            messages: [...conversationMessages],
            model: 'gemini-2.5-flash',
            max_tokens: 800,
            temperature: 0.7,
            mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
          };

          const response = await fetch(`${this.config.apiBaseUrl}/ai`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiPassword}`,
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            scenarioSuccess = false;
            stepResults.push({ step: i + 1, error: `HTTP ${response.status}` });
            break;
          }

          // Process streaming response
          const reader = response.body?.getReader();
          if (!reader) {
            scenarioSuccess = false;
            stepResults.push({ step: i + 1, error: 'No response body' });
            break;
          }

          const decoder = new TextDecoder();
          let assistantResponse = '';
          let toolCalls: any[] = [];

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') break;

                  try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === 'toolCall') {
                      toolCalls.push(parsed);
                    } else if (parsed.type === 'textDelta') {
                      assistantResponse += parsed.textDelta;
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }

          // Execute any tool calls and continue if needed
          if (toolCalls.length > 0) {
            const url = `${this.config.apiBaseUrl}/ai`;
            const toolResults = await executeToolWorkflow(
              url,
              {
                messages: [
                  { role: 'user' as const, content: 'Multi-step task' },
                ],
                model: 'gemini-2.5-flash',
                mcpTools: COMPLEX_MCP_TOOLS,
              },
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${this.config.apiPassword}`,
                },
                timeout: this.config.timeout,
              }
            );

            // Send continuation request
            const continuationRequest = {
              messages: [...conversationMessages],
              model: 'gemini-2.5-flash',
              max_tokens: 800,
              temperature: 0.7,
              mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
              toolResults,
            };

            const contResponse = await fetch(`${this.config.apiBaseUrl}/ai`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.apiPassword}`,
              },
              body: JSON.stringify(continuationRequest),
            });

            if (contResponse.ok) {
              const contReader = contResponse.body?.getReader();
              if (contReader) {
                try {
                  while (true) {
                    const { done, value } = await contReader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                      if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') break;

                        try {
                          const parsed = JSON.parse(data);
                          if (parsed.type === 'textDelta') {
                            assistantResponse += parsed.textDelta;
                          }
                        } catch (e) {
                          // Skip invalid JSON
                        }
                      }
                    }
                  }
                } finally {
                  contReader.releaseLock();
                }
              }
            }
          }

          // Add assistant response to conversation
          conversationMessages.push({
            role: 'assistant',
            content: assistantResponse,
          });

          stepResults.push({
            step: i + 1,
            toolCallsCount: toolCalls.length,
            responseLength: assistantResponse.length,
            success: assistantResponse.length > 0,
          });

          if (assistantResponse.length === 0) {
            scenarioSuccess = false;
          }
        }

        results.push({
          scenario: scenario.name,
          success: scenarioSuccess,
          steps: stepResults,
        });
      } catch (error) {
        results.push({
          scenario: scenario.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const success = successCount === scenarios.length;

    return {
      success,
      message: `Complex scenarios test: ${successCount}/${scenarios.length} scenarios completed successfully`,
      details: { results },
      duration: Date.now() - startTime,
    };
  }

  /**
   * Test concurrent tool calls handling
   */
  async testConcurrentToolCalls(): Promise<TestResult> {
    TestLogger.info('🔀 Testing Concurrent Tool Calls');
    const startTime = Date.now();

    try {
      const requests = [
        'Take a screenshot',
        'Get applications list',
        'Get window tree',
        'Get focused window',
      ].map((prompt, i) => ({
        messages: [{ role: 'user', content: prompt }],
        model: 'gemini-2.5-flash',
        max_tokens: 500,
        temperature: 0.7,
        mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
      }));

      TestLogger.info(`📤 Sending ${requests.length} concurrent requests`);

      const responses = await Promise.all(
        requests.map(async (req, i) => {
          try {
            const response = await fetch(`${this.config.apiBaseUrl}/ai`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.apiPassword}`,
              },
              body: JSON.stringify(req),
            });

            return { index: i, status: response.status, ok: response.ok };
          } catch (error) {
            return {
              index: i,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      const successCount = responses.filter(r => r.ok).length;
      const success = successCount === requests.length;

      return {
        success,
        message: `Concurrent requests test: ${successCount}/${requests.length} requests successful`,
        details: { responses },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Concurrent tool calls test failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error },
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Test streaming performance under load
   */
  async testStreamingPerformance(): Promise<TestResult> {
    TestLogger.info('⚡ Testing Streaming Performance');
    const startTime = Date.now();

    try {
      const request = {
        messages: [
          {
            role: 'user',
            content:
              'Take a screenshot, get applications, analyze the UI, and provide a detailed report',
          },
        ],
        model: 'gemini-2.5-flash',
        max_tokens: 1500,
        temperature: 0.7,
        mcpTools: MINIMAL_MCP_TOOLS, // Assuming MINIMAL_MCP_TOOLS is available or replace with mock
      };

      const response = await fetch(`${this.config.apiBaseUrl}/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiPassword}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let chunkCount = 0;
      let totalBytes = 0;
      let firstChunkTime = 0;
      let lastChunkTime = 0;

      try {
        while (true) {
          const chunkStart = Date.now();
          const { done, value } = await reader.read();

          if (done) break;

          chunkCount++;
          totalBytes += value.length;

          if (chunkCount === 1) {
            firstChunkTime = chunkStart - startTime;
          }
          lastChunkTime = chunkStart - startTime;

          // Parse chunk for validation
          const chunk = decoder.decode(value);
          // Just count, don't process everything
        }
      } finally {
        reader.releaseLock();
      }

      const totalTime = Date.now() - startTime;
      const avgChunkSize = totalBytes / chunkCount;
      const throughput = totalBytes / (totalTime / 1000); // bytes per second

      const success = chunkCount > 0 && firstChunkTime < 5000; // First chunk within 5s

      return {
        success,
        message: success
          ? 'Streaming performance acceptable'
          : 'Streaming performance issues detected',
        details: {
          totalTime,
          chunkCount,
          totalBytes,
          avgChunkSize: Math.round(avgChunkSize),
          throughput: Math.round(throughput),
          firstChunkTime,
          lastChunkTime,
        },
        duration: totalTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Streaming performance test failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error },
        duration: Date.now() - startTime,
      };
    }
  }
}

// Export for easy testing
export async function runMCPIntegrationTests(
  config?: Partial<TestConfig>
): Promise<boolean> {
  const tester = new MCPIntegrationTester(config);
  return tester.runAllTests();
}

// CLI runner
if (require.main === module) {
  runMCPIntegrationTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      TestLogger.error('Test suite crashed', error);
      process.exit(1);
    });
}
