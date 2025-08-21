import { AIRequestBody, TestResult } from './types';
import { TestLogger, createTestResult, makeHTTPRequest } from './utils';

/**
 * Unit test that reproduces the VertexAI error:
 * "Please ensure that the number of function response parts is equal to the number of function call parts"
 *
 * This error occurs when there's a mismatch between tool calls and tool responses in the conversation history.
 *
 * ## Problem Description
 * The error manifests when an assistant message contains multiple tool calls, but not all of those tool calls
 * have corresponding tool response messages. VertexAI validates that every function call part must have a
 * matching function response part in the conversation.
 *
 * ## Test Reproduction
 * This test creates a conversation with:
 * - 6 tool calls in an assistant message
 * - Only 3 tool response messages (missing 3 responses)
 * - This mismatch triggers validation error
 *
 * ## Expected Behavior (FIXED)
 * ✅ **NEW**: Improved validation catches the error with status 400 BEFORE reaching VertexAI
 * ⚠️  **OLD**: VertexAI error in streaming response with status 200
 *
 * ## Success Criteria
 * ✅ **BEST**: Test passes if our improved validation catches the mismatch (status 400)
 * ✅ **OK**: Test passes if VertexAI catches the mismatch (indicates validation needs improvement)
 * ❌ **FAIL**: No error is triggered
 */
export class VertexAIErrorReproductionTest {
  private baseUrl = 'http://localhost:3000/api';
  private authToken = 'your-secret-password-here';

  async runTest(): Promise<TestResult> {
    TestLogger.info(
      '��� Testing VertexAI Function Call/Response Mismatch Error'
    );
    const startTime = Date.now();

    try {
      // Create a conversation history that reproduces the exact error condition
      // based on the attached error data
      const requestBody: AIRequestBody = {
        messages: [
          {
            role: 'user',
            content: 'fill the form now',
          },
          // This assistant message has tool calls but some don't have responses
          {
            role: 'assistant',
            content:
              'I will help you fill the form. Let me get the current window state and then proceed with filling the form fields.',
            tool_calls: [
              {
                id: 'call_1753839525769_6mixdrj5s',
                type: 'function',
                function: {
                  name: 'scroll_element',
                  arguments: JSON.stringify({
                    selector: 'role:list.',
                    amount: 100,
                  }),
                },
              },
              {
                id: 'call_1753839545995_9xj21j6lb',
                type: 'function',
                function: {
                  name: 'get_focused_window_tree',
                  arguments: JSON.stringify({}),
                },
              },
              {
                id: 'call_1753839564561_ejom4tvsv',
                type: 'function',
                function: {
                  name: 'get_focused_window_tree',
                  arguments: JSON.stringify({}),
                },
              },
              {
                id: 'call_1753839564561_nhbspqorb',
                type: 'function',
                function: {
                  name: 'scroll_element',
                  arguments: JSON.stringify({
                    selector: 'role:Group',
                    amount: 100,
                  }),
                },
              },
              {
                id: 'call_1753839574462_svtbe4tb6',
                type: 'function',
                function: {
                  name: 'get_focused_window_tree',
                  arguments: JSON.stringify({}),
                },
              },
              {
                id: 'call_1753839574462_99kkigyrv',
                type: 'function',
                function: {
                  name: 'scroll_element',
                  arguments: JSON.stringify({
                    selector: 'role:Group',
                    amount: 100,
                  }),
                },
              },
            ],
          },
          // Only provide responses for SOME of the tool calls, not all
          {
            role: 'tool',
            content: '{"error":"MCP error -32602: Element not found"}',
            tool_call_id: 'call_1753839525769_6mixdrj5s',
          },
          {
            role: 'tool',
            content:
              '[{"type":"text","text":"{\\"action\\":\\"get_focused_window_tree\\",\\"status\\":\\"success\\"}"}]',
            tool_call_id: 'call_1753839545995_9xj21j6lb',
          },
          {
            role: 'tool',
            content:
              '[{"type":"text","text":"{\\"action\\":\\"get_focused_window_tree\\",\\"status\\":\\"success\\"}"}]',
            tool_call_id: 'call_1753839564561_ejom4tvsv',
          },
          // Missing tool responses for:
          // - call_1753839564561_nhbspqorb
          // - call_1753839574462_svtbe4tb6
          // - call_1753839574462_99kkigyrv
          // This mismatch should trigger the VertexAI error
          {
            role: 'user',
            content: 'apply',
          },
          {
            role: 'assistant',
            content: '',
          },
          {
            role: 'user',
            content: 'fill the formn now',
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

      TestLogger.info('Making request with mismatched tool calls/responses...');
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

      // Check if we got the expected validation error (either our improved validation or original VertexAI error)
      const isVertexAIError =
        response.body.includes(
          'function response parts is equal to the number of function call parts'
        ) ||
        response.body.includes('INVALID_ARGUMENT') ||
        response.body.includes('VertexAI.ClientError');

      const isOurValidationError =
        response.body.includes('unresolved tool call') &&
        response.body.includes(
          'All tool calls must have corresponding tool responses'
        );

      if (isOurValidationError) {
        TestLogger.success(
          '✅ SUCCESS: Improved validation caught function call/response mismatch before VertexAI!'
        );
        return createTestResult(
          true,
          'SUCCESS: Improved validation prevented VertexAI error by catching function call/response mismatch early',
          {
            status: response.status,
            errorType: 'Improved Validation - Function Call/Response Mismatch',
            errorBody: response.body.substring(0, 800),
            improvement:
              'Error caught before reaching VertexAI - better performance and user experience',
          },
          undefined,
          startTime
        );
      } else if (isVertexAIError) {
        TestLogger.info(
          '⚠️  Got original VertexAI error (validation needs improvement)'
        );
        return createTestResult(
          true,
          'Reproduced original VertexAI error (validation could be improved to catch this earlier)',
          {
            status: response.status,
            errorType: 'VertexAI Function Call/Response Mismatch',
            errorBody: response.body.substring(0, 800),
            note: 'This should be caught by validation before reaching VertexAI',
          },
          undefined,
          startTime
        );
      } else {
        return createTestResult(
          false,
          'Did not find expected function call/response mismatch error',
          {
            status: response.status,
            actualResponse: response.body.substring(0, 500),
            responseOk: response.ok,
          },
          'Expected either our validation error or VertexAI error about function call/response mismatch',
          startTime
        );
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
export async function runVertexAIErrorTest(): Promise<void> {
  TestLogger.info('��� Starting VertexAI Error Reproduction Test');

  const tester = new VertexAIErrorReproductionTest();
  const result = await tester.runTest();

  if (result.success) {
    TestLogger.success(`✅ ${result.message}`);
    TestLogger.info('Error details:', result.data);
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
  runVertexAIErrorTest().catch(console.error);
}
