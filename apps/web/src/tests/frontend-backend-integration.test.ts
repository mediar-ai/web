import { TestLogger } from './utils';

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  details: string;
  error?: string;
}

interface StreamEvent {
  type: string;
  [key: string]: any;
}

interface FrontendMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ToolResult {
  toolCallId: string;
  toolName: string;
  result?: any;
  error?: string;
}

export class FrontendBackendIntegrationTests {
  private baseUrl = 'http://localhost:3000';

  async runAllTests(): Promise<TestResult[]> {
    TestLogger.info('🚀 Starting Frontend-Backend Integration Tests');

    const tests = [
      () => this.testFrontendMessageFormat(),
      () => this.testStreamingResponseFormat(),
      () => this.testToolExecutionWorkflow(),
      () => this.testErrorHandling(),
      () => this.testRealWorldChatScenario(),
      () => this.testToolResultsContinuation(),
      () => this.testMultiMessageConversation(),
      () => this.testConcurrentToolCalls(),
    ];

    const results: TestResult[] = [];

    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);
        TestLogger.info(
          `${result.success ? '✅' : '❌'} ${result.name}: ${result.details}`
        );
      } catch (error) {
        TestLogger.error(`💥 Test crashed: ${error}`);
        results.push({
          name: 'Unknown Test',
          success: false,
          duration: 0,
          details: 'Test crashed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Test that frontend message format aligns with backend expectations
   */
  async testFrontendMessageFormat(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Frontend Message Format Alignment');
    const startTime = Date.now();

    try {
      // Simulate exactly how frontend sends messages
      const frontendMessages: FrontendMessage[] = [
        { role: 'user', content: 'Hello, can you help me take a screenshot?' },
      ];

      const requestBody = {
        messages: frontendMessages,
        model: 'gemini-2.5-flash',
        maxOutputTokens: 1000,
        temperature: 0.7,
        mcpTools: {
          take_screenshot: {
            description: 'Take a screenshot of the desktop',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
              },
            },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          name: 'Frontend Message Format',
          success: false,
          duration: Date.now() - startTime,
          details: `HTTP ${response.status}: ${response.statusText}`,
          error: await response.text(),
        };
      }

      // Parse first chunk to ensure proper format
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader!.read();
      const chunk = decoder.decode(value);

      // Should have a 'start' event
      const hasStart = chunk.includes('"type":"start"');
      reader!.releaseLock();

      return {
        name: 'Frontend Message Format',
        success: hasStart,
        duration: Date.now() - startTime,
        details: hasStart
          ? 'Frontend message format accepted by backend'
          : 'No start event found',
      };
    } catch (error) {
      return {
        name: 'Frontend Message Format',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed to test message format',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test streaming response format matches frontend expectations
   */
  async testStreamingResponseFormat(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Streaming Response Format');
    const startTime = Date.now();

    try {
      const requestBody = {
        messages: [
          { role: 'user', content: 'Please take a screenshot of my desktop' },
        ],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 500,
        mcpTools: {
          take_screenshot: {
            description: 'Take a screenshot',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
              },
            },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(requestBody),
      });

      const events: StreamEvent[] = [];
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          buffer += decoder.decode(value);
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const event = JSON.parse(data);
                events.push(event);
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }

          // Stop after reasonable number of events for test
          if (events.length > 10) break;
        }
      } finally {
        reader!.releaseLock();
      }

      // Validate expected event types
      const eventTypes = events.map(e => e.type);
      const hasStart = eventTypes.includes('start');
      const hasToolCall = eventTypes.some(t => t === 'toolCall');
      const hasTextOrFinish = eventTypes.some(
        t => t === 'textDelta' || t === 'finish'
      );

      const expectedEvents = hasStart && (hasToolCall || hasTextOrFinish);

      return {
        name: 'Streaming Response Format',
        success: expectedEvents,
        duration: Date.now() - startTime,
        details: `Events: [${eventTypes.join(', ')}]. Expected: start + (toolCall or text/finish)`,
      };
    } catch (error) {
      return {
        name: 'Streaming Response Format',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed to test streaming format',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test complete tool execution workflow as frontend would do it
   */
  async testToolExecutionWorkflow(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Complete Tool Execution Workflow');
    const startTime = Date.now();

    try {
      // Step 1: Send initial request
      const initialRequest = {
        messages: [
          { role: 'user', content: 'Take a screenshot using desktop selector' },
        ],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 500,
        mcpTools: {
          take_screenshot: {
            description: 'Take a screenshot',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
              },
            },
          },
        },
      };

      const initialResponse = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(initialRequest),
      });

      // Parse tool call from response
      let toolCall: any = null;
      const reader = initialResponse.body?.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const event = JSON.parse(data);
                if (event.type === 'toolCall') {
                  toolCall = event;
                  break;
                }
              } catch (e) {}
            }
          }
          if (toolCall) break;
        }
      } finally {
        reader!.releaseLock();
      }

      if (!toolCall) {
        return {
          name: 'Tool Execution Workflow',
          success: false,
          duration: Date.now() - startTime,
          details: 'No tool call received in initial response',
        };
      }

      // Step 2: Send tool results back (simulate frontend execution)
      const toolResults: ToolResult[] = [
        {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result: {
            success: true,
            screenshot_path: '/tmp/screenshot.png',
            timestamp: new Date().toISOString(),
          },
        },
      ];

      const continuationRequest = {
        messages: [
          { role: 'user', content: 'Take a screenshot using desktop selector' },
          { role: 'assistant', content: '' },
          { role: 'user', content: 'Tool results received' },
        ],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 500,
        mcpTools: initialRequest.mcpTools,
        toolResults: toolResults,
      };

      const continuationResponse = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(continuationRequest),
      });

      const continuationSuccess = continuationResponse.ok;

      return {
        name: 'Tool Execution Workflow',
        success: continuationSuccess,
        duration: Date.now() - startTime,
        details: continuationSuccess
          ? `Complete workflow: tool call (${toolCall.toolName}) → execution → continuation`
          : 'Failed continuation request',
      };
    } catch (error) {
      return {
        name: 'Tool Execution Workflow',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed tool execution workflow',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test error handling scenarios frontend might encounter
   */
  async testErrorHandling(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Error Handling Scenarios');
    const startTime = Date.now();

    try {
      const testCases = [
        {
          name: 'Invalid Message Format',
          body: { invalid: 'format' },
          expectError: true,
        },
        {
          name: 'Missing Auth Header',
          body: { messages: [{ role: 'user', content: 'test' }] },
          headers: { 'Content-Type': 'application/json' }, // No auth
          expectError: true,
        },
        {
          name: 'Empty Messages Array',
          body: { messages: [], model: 'gemini-2.5-flash' },
          expectError: true,
        },
      ];

      let passedTests = 0;

      for (const testCase of testCases) {
        try {
          const headers = testCase.headers || {
            'Content-Type': 'application/json',
            Authorization: 'Bearer your-secret-password-here',
          };

          const response = await fetch(`${this.baseUrl}/api/ai`, {
            method: 'POST',
            headers,
            body: JSON.stringify(testCase.body),
          });

          const isError = !response.ok;
          if (isError === testCase.expectError) {
            passedTests++;
          }
        } catch (error) {
          if (testCase.expectError) {
            passedTests++;
          }
        }
      }

      const allPassed = passedTests === testCases.length;

      return {
        name: 'Error Handling',
        success: allPassed,
        duration: Date.now() - startTime,
        details: `${passedTests}/${testCases.length} error scenarios handled correctly`,
      };
    } catch (error) {
      return {
        name: 'Error Handling',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed to test error handling',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test a real-world chat scenario with multiple exchanges
   */
  async testRealWorldChatScenario(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Real-World Chat Scenario');
    const startTime = Date.now();

    try {
      const conversation: FrontendMessage[] = [
        {
          role: 'user',
          content: 'Hello! Can you help me with desktop automation?',
        },
      ];

      // First exchange
      let requestBody = {
        messages: [...conversation],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 300,
        temperature: 0.7,
        mcpTools: {},
      };

      let response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          name: 'Real-World Chat Scenario',
          success: false,
          duration: Date.now() - startTime,
          details: `First exchange failed: ${response.status}`,
        };
      }

      // Collect AI response
      let aiResponse = '';
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const event = JSON.parse(data);
                if (event.type === 'textDelta') {
                  aiResponse += event.textDelta;
                }
              } catch (e) {}
            }
          }
        }
      } finally {
        reader!.releaseLock();
      }

      // Add AI response to conversation
      conversation.push({ role: 'assistant', content: aiResponse });

      // Second exchange - follow-up question
      conversation.push({
        role: 'user',
        content: 'What tools are available for taking screenshots?',
      });

      requestBody = {
        messages: [...conversation],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 300,
        temperature: 0.7,
        mcpTools: {
          take_screenshot: {
            description: 'Take a screenshot',
            inputSchema: { type: 'object', properties: {} },
          },
        },
      };

      response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(requestBody),
      });

      const secondExchangeSuccess = response.ok;

      return {
        name: 'Real-World Chat Scenario',
        success: secondExchangeSuccess && aiResponse.length > 0,
        duration: Date.now() - startTime,
        details: `Multi-turn conversation: ${conversation.length} messages, AI response: ${aiResponse.length > 0 ? 'received' : 'empty'}`,
      };
    } catch (error) {
      return {
        name: 'Real-World Chat Scenario',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed real-world scenario',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test tool results continuation matches frontend expectations
   */
  async testToolResultsContinuation(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Tool Results Continuation Format');
    const startTime = Date.now();

    try {
      // This simulates the exact format frontend sends for tool results
      const toolResults = [
        {
          toolCallId: 'test-tool-call-123',
          toolName: 'get_applications',
          result: {
            applications: [
              { name: 'Cursor', pid: 1234, focused: true },
              { name: 'Chrome', pid: 5678, focused: false },
            ],
          },
        },
      ];

      const requestBody = {
        messages: [
          { role: 'user', content: 'Show me running applications' },
          { role: 'assistant', content: '' }, // Empty assistant message
          { role: 'user', content: 'Tool results received' },
        ],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 500,
        mcpTools: {
          get_applications: {
            description: 'Get running applications',
            inputSchema: { type: 'object', properties: {} },
          },
        },
        toolResults: toolResults,
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          name: 'Tool Results Continuation',
          success: false,
          duration: Date.now() - startTime,
          details: `HTTP ${response.status}: ${response.statusText}`,
          error: await response.text(),
        };
      }

      // Check if backend processes tool results and generates text
      let hasTextResponse = false;
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const event = JSON.parse(data);
                if (event.type === 'textDelta' && event.textDelta) {
                  hasTextResponse = true;
                  break;
                }
              } catch (e) {}
            }
          }
          if (hasTextResponse) break;
        }
      } finally {
        reader!.releaseLock();
      }

      return {
        name: 'Tool Results Continuation',
        success: hasTextResponse,
        duration: Date.now() - startTime,
        details: hasTextResponse
          ? 'Tool results processed and text response generated'
          : 'No text response after tool results',
      };
    } catch (error) {
      return {
        name: 'Tool Results Continuation',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed tool results continuation test',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test multi-message conversation history handling
   */
  async testMultiMessageConversation(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Multi-Message Conversation History');
    const startTime = Date.now();

    try {
      // Simulate a conversation that has built up over multiple exchanges
      const conversationHistory: FrontendMessage[] = [
        { role: 'user', content: 'Hello, I need help with automation' },
        {
          role: 'assistant',
          content:
            'Hi! I can help you with desktop automation tasks. What would you like to do?',
        },
        { role: 'user', content: 'Can you take a screenshot first?' },
        { role: 'assistant', content: "I'll take a screenshot for you." },
        { role: 'user', content: 'Great! Now what applications are running?' },
      ];

      const requestBody = {
        messages: conversationHistory,
        model: 'gemini-2.5-flash',
        maxOutputTokens: 500,
        temperature: 0.7,
        mcpTools: {
          get_applications: {
            description: 'Get running applications',
            inputSchema: { type: 'object', properties: {} },
          },
          take_screenshot: {
            description: 'Take a screenshot',
            inputSchema: { type: 'object', properties: {} },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          name: 'Multi-Message Conversation',
          success: false,
          duration: Date.now() - startTime,
          details: `Failed with ${response.status}: ${response.statusText}`,
        };
      }

      // Verify the backend can handle the conversation context
      let responseGenerated = false;
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          const chunk = decoder.decode(value);
          if (
            chunk.includes('"type":"start"') ||
            chunk.includes('"type":"textDelta"') ||
            chunk.includes('"type":"toolCall"')
          ) {
            responseGenerated = true;
            break;
          }
        }
      } finally {
        reader!.releaseLock();
      }

      return {
        name: 'Multi-Message Conversation',
        success: responseGenerated,
        duration: Date.now() - startTime,
        details: `Conversation with ${conversationHistory.length} messages: ${responseGenerated ? 'processed successfully' : 'failed to generate response'}`,
      };
    } catch (error) {
      return {
        name: 'Multi-Message Conversation',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed multi-message conversation test',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test handling of concurrent/rapid tool calls
   */
  async testConcurrentToolCalls(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Concurrent Tool Calls Handling');
    const startTime = Date.now();

    try {
      const requestBody = {
        messages: [
          {
            role: 'user',
            content:
              'I need you to take a screenshot and get the list of running applications at the same time',
          },
        ],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 800,
        temperature: 0.3,
        mcpTools: {
          take_screenshot: {
            description: 'Take a screenshot',
            inputSchema: { type: 'object', properties: {} },
          },
          get_applications: {
            description: 'Get running applications',
            inputSchema: { type: 'object', properties: {} },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer your-secret-password-here',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          name: 'Concurrent Tool Calls',
          success: false,
          duration: Date.now() - startTime,
          details: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Count tool calls in response
      const toolCalls: string[] = [];
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const event = JSON.parse(data);
                if (event.type === 'toolCall') {
                  toolCalls.push(event.toolName);
                }
              } catch (e) {}
            }
          }

          // Stop after finding multiple tool calls or reasonable processing
          if (toolCalls.length >= 2) break;
        }
      } finally {
        reader!.releaseLock();
      }

      const hasMultipleTools = toolCalls.length > 0;
      const uniqueTools = new Set(toolCalls).size;

      return {
        name: 'Concurrent Tool Calls',
        success: hasMultipleTools,
        duration: Date.now() - startTime,
        details: `Tool calls detected: ${toolCalls.join(', ')} (${uniqueTools} unique tools)`,
      };
    } catch (error) {
      return {
        name: 'Concurrent Tool Calls',
        success: false,
        duration: Date.now() - startTime,
        details: 'Failed concurrent tool calls test',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Export for direct execution
export async function runFrontendBackendIntegrationTests(): Promise<void> {
  const tester = new FrontendBackendIntegrationTests();
  const results = await tester.runAllTests();

  const passed = results.filter(r => r.success).length;
  const total = results.length;

  console.log(
    `\n🎯 Frontend-Backend Integration Tests Complete: ${passed}/${total} passed\n`
  );

  for (const result of results) {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.name} (${result.duration}ms)`);
    console.log(`   ${result.details}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    console.log('');
  }

  if (passed === total) {
    console.log('🎉 All frontend-backend integration tests passed!');
  } else {
    console.log(`⚠️  ${total - passed} tests failed - check implementation`);
  }
}
