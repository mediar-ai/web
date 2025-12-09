import { TestLogger } from './utils';

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
  duration?: number;
}

interface StreamEvent {
  type: 'start' | 'toolCall' | 'toolResult' | 'textDelta' | 'finish' | 'error';
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

class FrontendIntegrationTests {
  private baseUrl = 'http://localhost:3000';
  private authToken = 'your-secret-password-here';

  async runAllTests(): Promise<void> {
    TestLogger.info('🚀 Starting Frontend Integration Tests');

    const tests = [
      this.testBasicMessageFormat,
      this.testStreamingResponseFormat,
      this.testToolExecutionCycle,
      this.testMultiStepWorkflowFromFrontend,
      this.testErrorHandling,
      this.testToolResultsContinuation,
      this.testConcurrentToolCalls,
      this.testLongConversationHistory,
    ];

    const results: TestResult[] = [];

    for (const test of tests) {
      try {
        const result = await test.call(this);
        results.push(result);

        if (result.success) {
          TestLogger.success(`✅ ${test.name}: ${result.message}`);
        } else {
          TestLogger.error(`❌ ${test.name}: ${result.message}`);
          if (result.details) {
            TestLogger.info(
              `   Details: ${JSON.stringify(result.details, null, 2)}`
            );
          }
        }
      } catch (error) {
        const errorResult: TestResult = {
          success: false,
          message: `Test failed with exception: ${error instanceof Error ? error.message : String(error)}`,
        };
        results.push(errorResult);
        TestLogger.error(`❌ ${test.name}: ${errorResult.message}`);
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Summary
    const passed = results.filter(r => r.success).length;
    const total = results.length;

    TestLogger.info(
      `\n📊 Frontend Integration Test Summary: ${passed}/${total} passed`
    );

    if (passed === total) {
      TestLogger.success('🎉 All frontend integration tests passed!');
    } else {
      TestLogger.error(`⚠️ ${total - passed} tests failed`);
    }
  }

  async testBasicMessageFormat(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Basic Message Format (Frontend Compatible)');
    const startTime = Date.now();

    try {
      // Simulate exact frontend message format
      const frontendMessages: FrontendMessage[] = [
        {
          role: 'user',
          content: 'Take a screenshot of my desktop',
        },
      ];

      const requestBody = {
        messages: frontendMessages,
        model: 'gemini-2.5-flash',
        maxOutputTokens: 1000,
        temperature: 0.7,
        mcpTools: {
          take_screenshot: {
            name: 'take_screenshot',
            description:
              'Takes a screenshot of the desktop or specific element',
            inputSchema: {
              type: 'object',
              properties: {
                selector: {
                  type: 'string',
                  description:
                    'Element selector (use "desktop" for full screenshot)',
                },
              },
              required: ['selector'],
            },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `HTTP ${response.status}: ${response.statusText}`,
          duration: Date.now() - startTime,
        };
      }

      // Verify streaming response format
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          message: 'No response body received',
          duration: Date.now() - startTime,
        };
      }

      const decoder = new TextDecoder();
      let hasStart = false;
      let hasToolCall = false;
      let hasFinish = false;

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
                const event: StreamEvent = JSON.parse(data);

                if (event.type === 'start') hasStart = true;
                if (event.type === 'toolCall') hasToolCall = true;
                if (event.type === 'finish') hasFinish = true;
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        success: hasStart && hasToolCall && hasFinish,
        message:
          hasStart && hasToolCall && hasFinish
            ? 'Frontend message format properly handled'
            : `Missing events: start=${hasStart}, toolCall=${hasToolCall}, finish=${hasFinish}`,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  async testStreamingResponseFormat(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Streaming Response Format');
    const startTime = Date.now();

    try {
      const requestBody = {
        messages: [
          { role: 'user', content: 'Get a list of running applications' },
        ],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 1000,
        temperature: 0.7,
        mcpTools: {
          get_applications: {
            name: 'get_applications',
            description: 'Get all running applications',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          message: 'No response body',
          duration: Date.now() - startTime,
        };
      }

      const decoder = new TextDecoder();
      const events: StreamEvent[] = [];
      let toolCallEvent: any = null;

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
                const event: StreamEvent = JSON.parse(data);
                events.push(event);

                if (event.type === 'toolCall') {
                  toolCallEvent = event;
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Validate event structure
      const requiredEventTypes = ['start', 'toolCall', 'finish'];
      const receivedTypes = events.map(e => e.type);
      const missingTypes = requiredEventTypes.filter(
        (type: string) => !receivedTypes.includes(type as any)
      );

      if (missingTypes.length > 0) {
        return {
          success: false,
          message: `Missing event types: ${missingTypes.join(', ')}`,
          details: { receivedTypes },
          duration: Date.now() - startTime,
        };
      }

      // Validate toolCall event structure
      if (
        !toolCallEvent ||
        !toolCallEvent.toolName ||
        !toolCallEvent.toolCallId
      ) {
        return {
          success: false,
          message: 'ToolCall event missing required fields',
          details: { toolCallEvent },
          duration: Date.now() - startTime,
        };
      }

      return {
        success: true,
        message: 'Streaming response format is correct',
        details: {
          eventCount: events.length,
          toolCallId: toolCallEvent.toolCallId,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  async testToolExecutionCycle(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Complete Tool Execution Cycle');
    const startTime = Date.now();

    try {
      // Step 1: Initial request
      const initialMessages: FrontendMessage[] = [
        { role: 'user', content: 'Get applications and tell me about them' },
      ];

      let toolCallId = '';
      let toolName = '';

      // Make initial request
      const initialResponse = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({
          messages: initialMessages,
          model: 'gemini-2.5-flash',
          mcpTools: {
            get_applications: {
              name: 'get_applications',
              description: 'Get all running applications',
              inputSchema: { type: 'object', properties: {}, required: [] },
            },
          },
        }),
      });

      // Parse initial response to get tool call
      const reader1 = initialResponse.body?.getReader();
      if (!reader1) {
        return {
          success: false,
          message: 'No initial response body',
          duration: Date.now() - startTime,
        };
      }

      const decoder = new TextDecoder();
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
                const event = JSON.parse(data);
                if (event.type === 'toolCall') {
                  toolCallId = event.toolCallId;
                  toolName = event.toolName;
                }
              } catch {}
            }
          }
        }
      } finally {
        reader1.releaseLock();
      }

      if (!toolCallId || !toolName) {
        return {
          success: false,
          message: 'No tool call found in initial response',
          duration: Date.now() - startTime,
        };
      }

      // Step 2: Simulate tool execution and send results back
      const toolResults: ToolResult[] = [
        {
          toolCallId,
          toolName,
          result: {
            applications: [
              { name: 'Chrome', pid: 1234, focused: true },
              { name: 'VSCode', pid: 5678, focused: false },
            ],
          },
        },
      ];

      const continuationMessages: FrontendMessage[] = [
        ...initialMessages,
        { role: 'assistant', content: '' }, // Assistant message with tool call
      ];

      // Make continuation request
      const continuationResponse = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({
          messages: continuationMessages,
          model: 'gemini-2.5-flash',
          toolResults,
          mcpTools: {
            get_applications: {
              name: 'get_applications',
              description: 'Get all running applications',
              inputSchema: { type: 'object', properties: {}, required: [] },
            },
          },
        }),
      });

      // Parse continuation response
      const reader2 = continuationResponse.body?.getReader();
      if (!reader2) {
        return {
          success: false,
          message: 'No continuation response body',
          duration: Date.now() - startTime,
        };
      }

      let hasTextDelta = false;
      let textContent = '';

      try {
        while (true) {
          const { done, value } = await reader2.read();
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
                  hasTextDelta = true;
                  textContent += event.textDelta || '';
                }
              } catch {}
            }
          }
        }
      } finally {
        reader2.releaseLock();
      }

      return {
        success: hasTextDelta && textContent.length > 0,
        message: hasTextDelta
          ? `Tool execution cycle completed with ${textContent.length} chars of response`
          : 'No text response after tool execution',
        details: { toolCallId, toolName, responseLength: textContent.length },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Tool execution cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  async testMultiStepWorkflowFromFrontend(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Multi-Step Workflow (Frontend Perspective)');
    const startTime = Date.now();

    try {
      const messages: FrontendMessage[] = [
        {
          role: 'user',
          content: 'Open Cursor application and type "Hello World" in the chat',
        },
      ];

      let conversationHistory = [...messages];
      let stepCount = 0;
      const maxSteps = 4;
      let totalToolCalls = 0;
      let totalTextDeltas = 0;

      while (stepCount < maxSteps) {
        stepCount++;
        TestLogger.info(`   Step ${stepCount}: Making request...`);

        const requestBody: any = {
          messages: conversationHistory,
          model: 'gemini-2.5-flash',
          maxOutputTokens: 1000,
          temperature: 0.7,
          mcpTools: {
            get_applications: {
              name: 'get_applications',
              description: 'Get all running applications',
              inputSchema: { type: 'object', properties: {}, required: [] },
            },
            open_application: {
              name: 'open_application',
              description: 'Open an application by name',
              inputSchema: {
                type: 'object',
                properties: {
                  app_name: {
                    type: 'string',
                    description: 'Name of application to open',
                  },
                },
                required: ['app_name'],
              },
            },
            get_window_tree: {
              name: 'get_window_tree',
              description: 'Get UI tree for application window',
              inputSchema: {
                type: 'object',
                properties: {
                  pid: { type: 'number', description: 'Process ID' },
                },
                required: ['pid'],
              },
            },
            type_into_element: {
              name: 'type_into_element',
              description: 'Type text into UI element',
              inputSchema: {
                type: 'object',
                properties: {
                  selector: { type: 'string', description: 'Element selector' },
                  text_to_type: { type: 'string', description: 'Text to type' },
                },
                required: ['selector', 'text_to_type'],
              },
            },
          },
        };

        const response = await fetch(`${this.baseUrl}/api/ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.authToken}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          return {
            success: false,
            message: `Step ${stepCount} HTTP error: ${response.status}`,
            duration: Date.now() - startTime,
          };
        }

        // Parse response
        const reader = response.body?.getReader();
        if (!reader) {
          return {
            success: false,
            message: `Step ${stepCount}: No response body`,
            duration: Date.now() - startTime,
          };
        }

        const decoder = new TextDecoder();
        let toolCallsInStep = 0;
        let textDeltasInStep = 0;
        let assistantResponse = '';
        let toolCallId = '';
        let toolName = '';
        let toolArgs: any = {};

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
                  const event = JSON.parse(data);

                  if (event.type === 'toolCall') {
                    toolCallsInStep++;
                    toolCallId = event.toolCallId;
                    toolName = event.toolName;
                    toolArgs = event.args || {};
                    TestLogger.info(`     Tool call: ${toolName}`);
                  } else if (event.type === 'textDelta') {
                    textDeltasInStep++;
                    assistantResponse += event.textDelta || '';
                  }
                } catch {}
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        totalToolCalls += toolCallsInStep;
        totalTextDeltas += textDeltasInStep;

        // Add assistant response to conversation
        conversationHistory.push({
          role: 'assistant',
          content: assistantResponse,
        });

        // If we got a tool call, simulate execution and continue
        if (toolCallId && toolName) {
          // Simulate tool execution
          let toolResult: any;

          switch (toolName) {
            case 'get_applications':
              toolResult = {
                applications: [
                  { name: 'Cursor', pid: 12345, focused: false },
                  { name: 'Chrome', pid: 67890, focused: true },
                ],
              };
              break;
            case 'open_application':
              toolResult = {
                success: true,
                message: `Opened ${toolArgs.app_name}`,
              };
              break;
            case 'get_window_tree':
              toolResult = {
                elements: [
                  {
                    selector: 'role:Edit|name:Chat Input',
                    type: 'input',
                    visible: true,
                    focused: false,
                  },
                ],
              };
              break;
            case 'type_into_element':
              toolResult = {
                success: true,
                message: `Typed "${toolArgs.text_to_type}" into element ${toolArgs.selector}`,
              };
              break;
            default:
              toolResult = { success: true, message: `Executed ${toolName}` };
          }

          // Add tool result to next request
          requestBody.toolResults = [
            {
              toolCallId,
              toolName,
              args: toolArgs,
              result: toolResult,
            },
          ];

          // Continue with tool result
          continue;
        } else {
          // No more tool calls, workflow complete
          break;
        }
      }

      const success = totalToolCalls >= 2 && totalTextDeltas > 0;

      return {
        success,
        message: success
          ? `Multi-step workflow completed successfully`
          : `Insufficient activity: ${totalToolCalls} tool calls, ${totalTextDeltas} text deltas`,
        details: {
          steps: stepCount,
          totalToolCalls,
          totalTextDeltas,
          conversationLength: conversationHistory.length,
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Multi-step workflow failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  async testErrorHandling(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Error Handling');
    const startTime = Date.now();

    try {
      // Test with invalid tool
      const requestBody = {
        messages: [{ role: 'user', content: 'Use the nonexistent tool' }],
        model: 'gemini-2.5-flash',
        mcpTools: {
          invalid_tool: {
            name: 'invalid_tool',
            description: 'This tool will fail',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      // Should still get a response, even if tools fail
      if (!response.ok) {
        return {
          success: false,
          message: `HTTP error: ${response.status}`,
          duration: Date.now() - startTime,
        };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          message: 'No response body',
          duration: Date.now() - startTime,
        };
      }

      const decoder = new TextDecoder();
      let hasErrorEvent = false;
      let hasFinishEvent = false;

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
                const event = JSON.parse(data);
                if (event.type === 'error') hasErrorEvent = true;
                if (event.type === 'finish') hasFinishEvent = true;
              } catch {}
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        success: hasFinishEvent, // Should finish gracefully even with errors
        message: hasFinishEvent
          ? 'Error handling works correctly'
          : 'Stream did not finish properly',
        details: { hasErrorEvent, hasFinishEvent },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error handling test failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  async testToolResultsContinuation(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Tool Results Continuation Format');
    const startTime = Date.now();

    try {
      // Test the exact format that frontend sends for tool results continuation
      const messages: FrontendMessage[] = [
        { role: 'user', content: 'Get applications' },
        { role: 'assistant', content: '' }, // Empty assistant message (frontend pattern)
      ];

      const toolResults: ToolResult[] = [
        {
          toolCallId: 'test-tool-call-123',
          toolName: 'get_applications',
          result: {
            applications: [{ name: 'TestApp', pid: 999, focused: true }],
          },
        },
      ];

      const requestBody = {
        messages,
        model: 'gemini-2.5-flash',
        toolResults,
        mcpTools: {
          get_applications: {
            name: 'get_applications',
            description: 'Get all running applications',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `HTTP ${response.status}: ${response.statusText}`,
          duration: Date.now() - startTime,
        };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          message: 'No response body',
          duration: Date.now() - startTime,
        };
      }

      const decoder = new TextDecoder();
      let hasTextDelta = false;
      let textContent = '';

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
                const event = JSON.parse(data);
                if (event.type === 'textDelta') {
                  hasTextDelta = true;
                  textContent += event.textDelta || '';
                }
              } catch {}
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        success: hasTextDelta && textContent.length > 0,
        message: hasTextDelta
          ? `Tool results continuation successful (${textContent.length} chars)`
          : 'No text response after tool results',
        details: { responseLength: textContent.length },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Tool results continuation failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  async testConcurrentToolCalls(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Concurrent Tool Calls');
    const startTime = Date.now();

    try {
      const requestBody = {
        messages: [
          {
            role: 'user',
            content: 'Take a screenshot and get applications simultaneously',
          },
        ],
        model: 'gemini-2.5-flash',
        maxOutputTokens: 1000,
        mcpTools: {
          take_screenshot: {
            name: 'take_screenshot',
            description: 'Take a screenshot',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'Element selector' },
              },
              required: ['selector'],
            },
          },
          get_applications: {
            name: 'get_applications',
            description: 'Get running applications',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          message: 'No response body',
          duration: Date.now() - startTime,
        };
      }

      const decoder = new TextDecoder();
      const toolCalls: string[] = [];

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
                const event = JSON.parse(data);
                if (event.type === 'toolCall') {
                  toolCalls.push(event.toolName);
                }
              } catch {}
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Should handle at least one tool call properly
      return {
        success: toolCalls.length > 0,
        message:
          toolCalls.length > 0
            ? `Handled ${toolCalls.length} tool calls: ${toolCalls.join(', ')}`
            : 'No tool calls detected',
        details: { toolCalls },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Concurrent tool calls test failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  async testLongConversationHistory(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Long Conversation History');
    const startTime = Date.now();

    try {
      // Simulate a long conversation with multiple exchanges
      const messages: FrontendMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi! How can I help you?' },
        { role: 'user', content: 'What applications are running?' },
        {
          role: 'assistant',
          content: 'Let me check the running applications for you.',
        },
        { role: 'user', content: 'Can you take a screenshot too?' },
        {
          role: 'assistant',
          content: "I'll take a screenshot and get the applications.",
        },
        {
          role: 'user',
          content: 'Now get applications and take screenshot please',
        },
      ];

      const requestBody = {
        messages,
        model: 'gemini-2.5-flash',
        maxOutputTokens: 1000,
        mcpTools: {
          get_applications: {
            name: 'get_applications',
            description: 'Get running applications',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
          take_screenshot: {
            name: 'take_screenshot',
            description: 'Take a screenshot',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'Element selector' },
              },
              required: ['selector'],
            },
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/api/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `HTTP ${response.status}: ${response.statusText}`,
          duration: Date.now() - startTime,
        };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          message: 'No response body',
          duration: Date.now() - startTime,
        };
      }

      const decoder = new TextDecoder();
      let hasToolCall = false;
      let hasFinish = false;

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
                const event = JSON.parse(data);
                if (event.type === 'toolCall') hasToolCall = true;
                if (event.type === 'finish') hasFinish = true;
              } catch {}
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        success: hasToolCall && hasFinish,
        message:
          hasToolCall && hasFinish
            ? 'Long conversation history handled correctly'
            : `Missing events: toolCall=${hasToolCall}, finish=${hasFinish}`,
        details: { conversationLength: messages.length },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Long conversation test failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }
}

// Export for use in other test files
export { FrontendIntegrationTests };

// Main test runner
async function main() {
  const tester = new FrontendIntegrationTests();
  await tester.runAllTests();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
