import { AIRequestBody, TestResult } from './types';
import { TestLogger, createTestResult, makeHTTPRequest } from './utils';

/**
 * Unit test that verifies valid tool call sequences work properly
 * after our improved validation fixes.
 *
 * This test ensures that when all tool calls have corresponding tool responses,
 * the conversation processes successfully without validation errors.
 *
 * ## Test Validation
 * This test creates a conversation with:
 * - 3 tool calls in an assistant message
 * - 3 corresponding tool response messages (complete match)
 * - This should pass validation and work normally
 *
 * ## Success Criteria
 * ✅ Test passes if the request succeeds (status 200) and processes normally
 * ❌ Test fails if validation incorrectly blocks valid tool call sequences
 */
export class ValidToolCallsTest {
  private baseUrl = 'http://localhost:3000/api';
  private authToken = 'your-secret-password-here';

  async runTest(): Promise<TestResult> {
    TestLogger.info('🧪 Testing Valid Tool Call Sequences');
    const startTime = Date.now();

    try {
      // Create a conversation history with COMPLETE tool call/response matching
      const requestBody: AIRequestBody = {
        messages: [
          {
            role: 'user',
            content: 'Please help me with the current window',
          },
          // Assistant message with tool calls
          {
            role: 'assistant',
            content: 'I will help you get the current window information.',
            tool_calls: [
              {
                id: 'call_valid_1',
                type: 'function',
                function: {
                  name: 'get_focused_window_tree',
                  arguments: JSON.stringify({}),
                },
              },
              {
                id: 'call_valid_2',
                type: 'function',
                function: {
                  name: 'scroll_element',
                  arguments: JSON.stringify({ selector: 'body', amount: 100 }),
                },
              },
              {
                id: 'call_valid_3',
                type: 'function',
                function: {
                  name: 'get_focused_window_tree',
                  arguments: JSON.stringify({}),
                },
              },
            ],
          },
          // ALL tool calls have corresponding responses
          {
            role: 'tool',
            content:
              '{"action":"get_focused_window_tree","status":"success","ui_tree":{}}',
            tool_call_id: 'call_valid_1',
          },
          {
            role: 'tool',
            content: '{"action":"scroll_element","status":"success"}',
            tool_call_id: 'call_valid_2',
          },
          {
            role: 'tool',
            content:
              '{"action":"get_focused_window_tree","status":"success","ui_tree":{}}',
            tool_call_id: 'call_valid_3',
          },
          // Continue conversation
          {
            role: 'user',
            content: 'Great! Now please continue with the next step.',
          },
        ],
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        max_tokens: 1000,
        tools: [
          {
            type: 'function',
            function: {
              name: 'scroll_element',
              description: 'Scroll an element on the page',
              parameters: {
                type: 'object',
                properties: {
                  selector: { type: 'string' },
                  amount: { type: 'number' },
                },
                required: ['selector', 'amount'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'get_focused_window_tree',
              description: 'Get the UI tree of the focused window',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
        ],
      };

      TestLogger.info(
        'Making request with valid (complete) tool call/response pairs...'
      );
      TestLogger.debug('Request body:', {
        messageCount: requestBody.messages.length,
        toolCallsInAssistantMessage: requestBody.messages[1].tool_calls?.length,
        toolResponseCount: requestBody.messages.filter(m => m.role === 'tool')
          .length,
      });

      const response = await makeHTTPRequest(`${this.baseUrl}/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(requestBody),
        timeout: 30000,
      });

      TestLogger.info('Response received:', {
        status: response.status,
        ok: response.ok,
        bodyLength: response.body.length,
      });

      // Check if request succeeded (validation passed)
      if (response.ok) {
        TestLogger.success(
          '✅ Valid tool call sequence processed successfully!'
        );
        return createTestResult(
          true,
          'SUCCESS: Valid tool call sequence passed validation and processed normally',
          {
            status: response.status,
            validationPassed: true,
            responseLength: response.body.length,
            note: 'All tool calls had corresponding responses - validation working correctly',
          },
          undefined,
          startTime
        );
      } else {
        // Check if it's a validation error (which would be incorrect for valid sequence)
        if (response.body.includes('unresolved tool call')) {
          return createTestResult(
            false,
            'FAIL: Validation incorrectly blocked valid tool call sequence',
            {
              status: response.status,
              errorType: 'False Positive Validation Error',
              errorBody: response.body.substring(0, 500),
              issue: 'Validation is too strict - blocking valid sequences',
            },
            'Valid tool call sequences should not be blocked by validation',
            startTime
          );
        } else {
          return createTestResult(
            false,
            'Request failed for unknown reason (not validation error)',
            {
              status: response.status,
              actualError: response.body.substring(0, 500),
            },
            'Valid tool call sequence should succeed',
            startTime
          );
        }
      }
    } catch (error) {
      TestLogger.error('Test execution failed', error);
      return createTestResult(
        false,
        'Test execution failed',
        undefined,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

// Export function to run the test
export async function runValidToolCallsTest(): Promise<void> {
  TestLogger.info('🚀 Starting Valid Tool Calls Test');

  const tester = new ValidToolCallsTest();
  const result = await tester.runTest();

  if (result.success) {
    TestLogger.success(`✅ ${result.message}`);
    TestLogger.info('Test details:', result.data);
  } else {
    TestLogger.error(`❌ ${result.message}`);
    if (result.error) {
      TestLogger.error('Error:', result.error);
    }
    if (result.data) {
      TestLogger.info('Additional data:', result.data);
    }
  }

  TestLogger.info(`⏱️ Test completed in ${result.duration}ms`);
}

// Run the test if this file is executed directly
if (require.main === module) {
  runValidToolCallsTest().catch(console.error);
}
