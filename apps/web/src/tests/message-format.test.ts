/**
 * Message Format Unit Tests
 *
 * Tests message validation and conversion logic for the AI API
 */

import { TestLogger } from './utils';

// Mock message conversion functions from the route
function convertUIMessagesToModel(messages: any[]): any[] {
  return messages.map((msg: any) => {
    // Handle both old format (content) and new format (parts)
    if (msg.parts && Array.isArray(msg.parts)) {
      // Convert parts array to content string for model
      const textParts = msg.parts
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join('\n');
      return {
        role: msg.role,
        content: textParts || msg.content || '',
      };
    }

    return {
      role: msg.role,
      content: msg.content || '',
    };
  });
}

function convertMessagesToVertexAI(messages: any[]): any[] {
  return messages.map(msg => {
    // Handle different message types
    if (msg.role === 'user') {
      return {
        role: 'user',
        parts: [{ text: msg.content }],
      };
    } else if (msg.role === 'model' || msg.role === 'assistant') {
      const parts = [];

      // Add text content if present
      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Add function calls if present (OpenAI format)
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const toolCall of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments || '{}'),
            },
          });
        }
      }

      // Legacy support for functionCalls format
      if (msg.functionCalls && Array.isArray(msg.functionCalls)) {
        for (const functionCall of msg.functionCalls) {
          parts.push({
            functionCall: {
              name: functionCall.name,
              args: functionCall.args || {},
            },
          });
        }
      }

      return {
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: msg.content || '' }],
      };
    } else if (msg.role === 'tool') {
      // Handle OpenAI tool messages - need to map tool_call_id to function name
      // Find the corresponding function name from the assistant message
      let functionName = msg.tool_call_id || '';

      // Look backward through messages to find the assistant message with tool_calls
      for (let i = messages.indexOf(msg) - 1; i >= 0; i--) {
        const prevMsg = messages[i];
        if (prevMsg.role === 'assistant' && prevMsg.tool_calls) {
          const toolCall = prevMsg.tool_calls.find(
            (tc: any) => tc.id === msg.tool_call_id
          );
          if (toolCall) {
            functionName = toolCall.function.name;
            break;
          }
        }
      }

      return {
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: functionName, // Use actual function name, not tool_call_id
              response: { result: msg.content || '' },
            },
          },
        ],
      };
    } else if (msg.role === 'function') {
      // Handle legacy function responses
      return {
        role: 'function',
        parts: msg.functionResponses
          ? msg.functionResponses.map((fr: any) => ({
              functionResponse: {
                name: fr.name,
                response: fr.response,
              },
            }))
          : [{ text: msg.content || '' }],
      };
    }

    // Default fallback
    const vertexRole = ['user', 'system'].includes(msg.role) ? 'user' : 'model';
    return {
      role: vertexRole,
      parts: [{ text: msg.content || '' }],
    };
  });
}

function validateMessages(messages: any[]): { valid: boolean; error?: string } {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return {
      valid: false,
      error: 'Messages are required and must be a non-empty array',
    };
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (!msg || typeof msg !== 'object') {
      return {
        valid: false,
        error: `Message at index ${i} must be an object`,
      };
    }

    if (!msg.role || typeof msg.role !== 'string') {
      return {
        valid: false,
        error: `Message at index ${i} must have a valid role`,
      };
    }

    const validRoles = ['user', 'assistant', 'system', 'model', 'function'];
    if (!validRoles.includes(msg.role)) {
      return {
        valid: false,
        error: `Message at index ${i} has invalid role: ${msg.role}`,
      };
    }

    if (!msg.content && !msg.parts) {
      return {
        valid: false,
        error: `Message at index ${i} must have content or parts`,
      };
    }
  }

  return { valid: true };
}

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
  duration?: number;
}

class MessageFormatTests {
  async runAllTests(): Promise<boolean> {
    TestLogger.info('💬 Starting Message Format Unit Tests');

    const tests = [
      () => this.testValidBasicMessages(),
      () => this.testValidPartsFormat(),
      () => this.testEmptyMessagesArray(),
      () => this.testInvalidMessageStructure(),
      () => this.testInvalidRoles(),
      () => this.testMissingContent(),
      () => this.testUIToModelConversion(),
      () => this.testVertexAIConversion(),
      () => this.testFunctionCallMessages(),
      () => this.testFunctionResponseMessages(),
      () => this.testToolMessages(),
      () => this.testMixedMessageFormats(),
      () => this.testEdgeCases(),
      () => this.testComplexToolConversation(),
    ];

    const results: TestResult[] = [];

    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);

        if (result.success) {
          TestLogger.success(`✅ ${test.name}: ${result.message}`);
        } else {
          TestLogger.error(`❌ ${test.name}: ${result.message}`);
        }
      } catch (error) {
        const errorResult: TestResult = {
          success: false,
          message: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        results.push(errorResult);
        TestLogger.error(`❌ ${test.name}: ${errorResult.message}`);
      }
    }

    const passed = results.filter(r => r.success).length;
    const total = results.length;

    TestLogger.info(
      `📊 Message Format Tests Summary: ${passed}/${total} passed`
    );
    return passed === total;
  }

  async testValidBasicMessages(): Promise<TestResult> {
    const startTime = Date.now();

    const validMessages = [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I am doing well, thank you!' },
      { role: 'user', content: 'Can you help me with something?' },
    ];

    const validation = validateMessages(validMessages);
    const converted = convertUIMessagesToModel(validMessages);

    const success =
      validation.valid &&
      converted.length === validMessages.length &&
      converted.every(msg => msg.role && msg.content);

    return {
      success,
      message: success
        ? 'Valid basic messages processed correctly'
        : 'Valid basic messages failed processing',
      details: {
        validation,
        originalCount: validMessages.length,
        convertedCount: converted.length,
        converted: converted.slice(0, 2), // Sample
      },
      duration: Date.now() - startTime,
    };
  }

  async testValidPartsFormat(): Promise<TestResult> {
    const startTime = Date.now();

    const partsMessages = [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'How are you?' },
        ],
      },
      {
        role: 'assistant',
        content: 'I am fine',
        parts: [{ type: 'text', text: 'I am doing well!' }],
      },
    ];

    const validation = validateMessages(partsMessages);
    const converted = convertUIMessagesToModel(partsMessages);

    const expectedContent = ['Hello\nHow are you?', 'I am doing well!'];

    const hasCorrectContent = converted.every(
      (msg, i) => msg.content === expectedContent[i]
    );

    const success = validation.valid && hasCorrectContent;

    return {
      success,
      message: success
        ? 'Parts format messages processed correctly'
        : 'Parts format messages failed processing',
      details: {
        validation,
        converted,
        expectedContent,
        hasCorrectContent,
      },
      duration: Date.now() - startTime,
    };
  }

  async testEmptyMessagesArray(): Promise<TestResult> {
    const startTime = Date.now();

    const testCases = [
      { input: [], name: 'empty array' },
      { input: null, name: 'null' },
      { input: undefined, name: 'undefined' },
      { input: 'not an array', name: 'string' },
    ];

    let allPassed = true;
    const results = [];

    for (const testCase of testCases) {
      const validation = validateMessages(testCase.input as any);
      const shouldFail = !validation.valid;

      results.push({
        input: testCase.name,
        valid: validation.valid,
        error: validation.error,
        correctlyRejected: shouldFail,
      });

      if (validation.valid) allPassed = false; // Should all be invalid
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'Empty/invalid message arrays correctly rejected'
        : 'Some invalid arrays incorrectly accepted',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }

  async testInvalidMessageStructure(): Promise<TestResult> {
    const startTime = Date.now();

    const invalidMessages = [
      [null], // null message
      ['not an object'], // string instead of object
      [{ role: 'user' }], // missing content
      [{ content: 'hello' }], // missing role
      [{}], // empty object
    ];

    let allPassed = true;
    const results = [];

    for (let i = 0; i < invalidMessages.length; i++) {
      const validation = validateMessages(invalidMessages[i]);
      const correctlyRejected = !validation.valid;

      results.push({
        testCase: i,
        messages: invalidMessages[i],
        valid: validation.valid,
        error: validation.error,
        correctlyRejected,
      });

      if (validation.valid) allPassed = false; // Should all be invalid
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'Invalid message structures correctly rejected'
        : 'Some invalid structures incorrectly accepted',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }

  async testInvalidRoles(): Promise<TestResult> {
    const startTime = Date.now();

    const invalidRoles = [
      'invalid_role',
      'admin',
      'moderator',
      '',
      null,
      123,
      {},
    ];

    let allPassed = true;
    const results = [];

    for (const role of invalidRoles) {
      const messages = [{ role, content: 'test' }];
      const validation = validateMessages(messages);
      const correctlyRejected = !validation.valid;

      results.push({
        role,
        valid: validation.valid,
        error: validation.error,
        correctlyRejected,
      });

      if (validation.valid) allPassed = false; // Should all be invalid
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'Invalid roles correctly rejected'
        : 'Some invalid roles incorrectly accepted',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }

  async testMissingContent(): Promise<TestResult> {
    const startTime = Date.now();

    const messagesWithoutContent = [
      [{ role: 'user' }], // No content or parts - invalid
      [{ role: 'user', content: null }], // Null content - invalid
      [{ role: 'user', content: '' }], // Empty content - invalid (empty string is falsy)
      [{ role: 'user', parts: [] }], // Empty parts array - valid (array exists, even if empty)
    ];

    const results = [];

    for (let i = 0; i < messagesWithoutContent.length; i++) {
      const validation = validateMessages(messagesWithoutContent[i]);

      // Cases 0-2 should be invalid, case 3 (empty parts array) is valid because ![] is false
      const shouldBeValid = i === 3;
      const correctResult = validation.valid === shouldBeValid;

      results.push({
        testCase: i,
        messages: messagesWithoutContent[i],
        valid: validation.valid,
        shouldBeValid,
        correctResult,
        error: validation.error,
      });
    }

    const allCorrect = results.every(r => r.correctResult);

    return {
      success: allCorrect,
      message: allCorrect
        ? 'Content validation handled correctly'
        : 'Content validation issues found',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }

  async testUIToModelConversion(): Promise<TestResult> {
    const startTime = Date.now();

    const uiMessages = [
      { role: 'user', content: 'Simple message' },
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
      {
        role: 'assistant',
        content: 'Original content',
        parts: [{ type: 'text', text: 'Parts override' }],
      },
    ];

    const converted = convertUIMessagesToModel(uiMessages);

    const expectedContent = [
      'Simple message',
      'Part 1\nPart 2',
      'Parts override',
    ];

    const hasCorrectStructure = converted.every(
      msg => msg.role && typeof msg.content === 'string'
    );

    const hasCorrectContent = converted.every(
      (msg, i) => msg.content === expectedContent[i]
    );

    const success = hasCorrectStructure && hasCorrectContent;

    return {
      success,
      message: success
        ? 'UI to model conversion working correctly'
        : 'UI to model conversion failed',
      details: {
        hasCorrectStructure,
        hasCorrectContent,
        converted,
        expectedContent,
      },
      duration: Date.now() - startTime,
    };
  }

  async testVertexAIConversion(): Promise<TestResult> {
    const startTime = Date.now();

    const modelMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ];

    const converted = convertMessagesToVertexAI(modelMessages);

    // Should convert ALL messages (new behavior includes complete conversation history)
    const expectedCount = modelMessages.length;
    const hasCorrectCount = converted.length === expectedCount;

    const hasCorrectStructure = converted.every(
      msg => msg.role && Array.isArray(msg.parts) && msg.parts.length > 0
    );

    const hasTextParts = converted.every(msg =>
      msg.parts.some((part: any) => part.text)
    );

    const success = hasCorrectCount && hasCorrectStructure && hasTextParts;

    return {
      success,
      message: success
        ? 'Vertex AI conversion working correctly'
        : 'Vertex AI conversion failed',
      details: {
        originalCount: modelMessages.length,
        convertedCount: converted.length,
        expectedCount,
        hasCorrectCount,
        hasCorrectStructure,
        hasTextParts,
        sample: converted[0],
      },
      duration: Date.now() - startTime,
    };
  }

  async testFunctionCallMessages(): Promise<TestResult> {
    const startTime = Date.now();

    const messageWithFunctionCalls = {
      role: 'assistant',
      content: 'I will help you with that.',
      functionCalls: [
        { name: 'get_weather', args: { location: 'New York' } },
        { name: 'calculate', args: { expression: '2+2' } },
      ],
    };

    const converted = convertMessagesToVertexAI([messageWithFunctionCalls]);

    const hasTextPart = converted[0].parts.some((part: any) => part.text);
    const hasFunctionParts = converted[0].parts.some(
      (part: any) => part.functionCall
    );
    const correctFunctionCount =
      converted[0].parts.filter((part: any) => part.functionCall).length === 2;

    const success = hasTextPart && hasFunctionParts && correctFunctionCount;

    return {
      success,
      message: success
        ? 'Function call messages converted correctly'
        : 'Function call conversion failed',
      details: {
        hasTextPart,
        hasFunctionParts,
        correctFunctionCount,
        partsCount: converted[0].parts.length,
        converted: converted[0],
      },
      duration: Date.now() - startTime,
    };
  }

  async testFunctionResponseMessages(): Promise<TestResult> {
    const startTime = Date.now();

    const functionResponseMessage = {
      role: 'function',
      functionResponses: [
        {
          name: 'get_weather',
          response: { temperature: 25, conditions: 'sunny' },
        },
        { name: 'calculate', response: { result: 4 } },
      ],
    };

    const converted = convertMessagesToVertexAI([functionResponseMessage]);

    const hasFunctionResponseParts = converted[0].parts.every(
      (part: any) => part.functionResponse
    );
    const correctResponseCount = converted[0].parts.length === 2;
    const hasResponseData = converted[0].parts.every(
      (part: any) =>
        part.functionResponse.name && part.functionResponse.response
    );

    const success =
      hasFunctionResponseParts && correctResponseCount && hasResponseData;

    return {
      success,
      message: success
        ? 'Function response messages converted correctly'
        : 'Function response conversion failed',
      details: {
        hasFunctionResponseParts,
        correctResponseCount,
        hasResponseData,
        converted: converted[0],
      },
      duration: Date.now() - startTime,
    };
  }

  async testToolMessages(): Promise<TestResult> {
    const startTime = Date.now();

    // Test OpenAI-style tool messages with tool_calls and tool responses
    const toolMessages = [
      { role: 'user', content: 'What is the weather in NYC?' },
      {
        role: 'assistant',
        content: 'I will check the weather for you.',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: JSON.stringify({ location: 'New York City' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_123',
        content: JSON.stringify({ temperature: 72, conditions: 'sunny' }),
      },
      {
        role: 'assistant',
        content: 'The weather in NYC is 72°F and sunny.',
      },
    ];

    const converted = convertMessagesToVertexAI(toolMessages);

    // Should convert all 4 messages
    const hasCorrectCount = converted.length === 4;

    // Check assistant message with tool call
    const assistantMessage = converted[1];
    const hasToolCall = assistantMessage.parts.some(
      (part: any) => part.functionCall
    );
    const toolCallCorrect =
      assistantMessage.parts.find((part: any) => part.functionCall)
        ?.functionCall?.name === 'get_weather';

    // Check tool response message - should use function name, not tool_call_id
    const toolMessage = converted[2];
    const hasToolResponse =
      toolMessage.role === 'function' &&
      toolMessage.parts.some((part: any) => part.functionResponse);
    const toolResponseCorrect =
      toolMessage.parts[0]?.functionResponse?.name === 'get_weather'; // Should be function name, not call_123

    const success =
      hasCorrectCount &&
      hasToolCall &&
      toolCallCorrect &&
      hasToolResponse &&
      toolResponseCorrect;

    return {
      success,
      message: success
        ? 'OpenAI tool messages converted correctly'
        : 'Tool message conversion failed',
      details: {
        messageCount: converted.length,
        hasCorrectCount,
        hasToolCall,
        toolCallCorrect,
        hasToolResponse,
        toolResponseCorrect,
        expectedFunctionName: 'get_weather',
        actualFunctionName: toolMessage.parts[0]?.functionResponse?.name,
        assistantMessage: assistantMessage,
        toolMessage: toolMessage,
      },
      duration: Date.now() - startTime,
    };
  }

  async testComplexToolConversation(): Promise<TestResult> {
    const startTime = Date.now();

    // Reproduce the exact scenario that's causing the VertexAI error
    const complexConversation = [
      { role: 'user', content: 'did not scroll' },
      {
        role: 'assistant',
        content:
          'It seems I misunderstood and only focused the terms area instead of scrolling it. My apologies. Let me try to scroll down the terms and conditions so you can agree.\n\nIt seems that the element I was trying to scroll was not found. This could mean the element changed, or the selector is incorrect for scrolling. I need to re-examine the current UI to identify the correct element to scroll.\n',
        tool_calls: [
          {
            id: 'call_1753822896319_3h74wvbl3',
            type: 'function',
            function: {
              name: 'scroll_element',
              arguments: JSON.stringify({ selector: 'terms-area' }),
            },
          },
          {
            id: 'call_1753822898721_ak1yff9iy',
            type: 'function',
            function: {
              name: 'get_focused_window_tree',
              arguments: JSON.stringify({}),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1753822896319_3h74wvbl3',
        content: '{"error":"MCP error -32602: Element not found"}',
      },
      {
        role: 'tool',
        tool_call_id: 'call_1753822898721_ak1yff9iy',
        content:
          '[{"type":"text","text":"{\\"action\\":\\"get_focused_window_tree\\",\\"status\\":\\"success\\"}"}]',
      },
    ];

    const converted = convertMessagesToVertexAI(complexConversation);

    console.log('🔍 Debug - Complex conversation conversion:');
    console.log('Original messages:', complexConversation.length);
    console.log('Converted messages:', converted.length);

    // Check the assistant message with multiple tool calls
    const assistantMessage = converted[1];
    console.log('Assistant message parts:', assistantMessage.parts.length);
    console.log(
      'Function calls found:',
      assistantMessage.parts.filter((p: any) => p.functionCall).length
    );

    // Check both tool response messages
    const toolMessage1 = converted[2];
    const toolMessage2 = converted[3];
    console.log(
      'Tool response 1 function name:',
      toolMessage1.parts[0]?.functionResponse?.name
    );
    console.log(
      'Tool response 2 function name:',
      toolMessage2.parts[0]?.functionResponse?.name
    );

    // Validate the structure
    const hasCorrectCount = converted.length === 4;
    const hasTwoToolCalls =
      assistantMessage.parts.filter((p: any) => p.functionCall).length === 2;
    const firstToolResponseCorrect =
      toolMessage1.parts[0]?.functionResponse?.name === 'scroll_element';
    const secondToolResponseCorrect =
      toolMessage2.parts[0]?.functionResponse?.name ===
      'get_focused_window_tree';

    const success =
      hasCorrectCount &&
      hasTwoToolCalls &&
      firstToolResponseCorrect &&
      secondToolResponseCorrect;

    return {
      success,
      message: success
        ? 'Complex tool conversation converted correctly'
        : 'Complex tool conversation conversion failed',
      details: {
        messageCount: converted.length,
        hasCorrectCount,
        hasTwoToolCalls,
        firstToolResponseCorrect,
        secondToolResponseCorrect,
        assistantMessage: assistantMessage,
        toolMessage1: toolMessage1,
        toolMessage2: toolMessage2,
      },
      duration: Date.now() - startTime,
    };
  }

  async testMixedMessageFormats(): Promise<TestResult> {
    const startTime = Date.now();

    const mixedMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi!' }] },
      {
        role: 'user',
        content: '',
        parts: [{ type: 'text', text: 'How are you?' }],
      },
      { role: 'assistant', content: 'Good' },
    ];

    const validation = validateMessages(mixedMessages);
    const converted = convertUIMessagesToModel(mixedMessages);

    const expectedContent = ['Hello', 'Hi!', 'How are you?', 'Good'];

    const hasCorrectContent = converted.every(
      (msg, i) => msg.content === expectedContent[i]
    );

    const success = validation.valid && hasCorrectContent;

    return {
      success,
      message: success
        ? 'Mixed message formats handled correctly'
        : 'Mixed format handling failed',
      details: {
        validation,
        hasCorrectContent,
        converted,
        expectedContent,
      },
      duration: Date.now() - startTime,
    };
  }

  async testEdgeCases(): Promise<TestResult> {
    const startTime = Date.now();

    const edgeCases = [
      {
        name: 'Very long content',
        messages: [{ role: 'user', content: 'A'.repeat(10000) }],
        shouldPass: true,
      },
      {
        name: 'Unicode content',
        messages: [{ role: 'user', content: '🚀 Hello 世界 🌍' }],
        shouldPass: true,
      },
      {
        name: 'HTML content',
        messages: [{ role: 'user', content: '<script>alert("test")</script>' }],
        shouldPass: true,
      },
      {
        name: 'JSON content',
        messages: [
          { role: 'user', content: '{"key": "value", "number": 123}' },
        ],
        shouldPass: true,
      },
      {
        name: 'Newlines and special chars',
        messages: [
          { role: 'user', content: 'Line 1\nLine 2\tTabbed\r\nWindows line' },
        ],
        shouldPass: true,
      },
    ];

    let allPassed = true;
    const results = [];

    for (const testCase of edgeCases) {
      const validation = validateMessages(testCase.messages);
      const converted = convertUIMessagesToModel(testCase.messages);

      const passed =
        validation.valid === testCase.shouldPass &&
        converted.length === testCase.messages.length;

      results.push({
        name: testCase.name,
        valid: validation.valid,
        shouldPass: testCase.shouldPass,
        converted: converted.length > 0,
        passed,
      });

      if (!passed) allPassed = false;
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'Edge cases handled correctly'
        : 'Some edge cases failed',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }
}

// CLI runner
if (require.main === module) {
  const tester = new MessageFormatTests();
  tester
    .runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      TestLogger.error('Message format test suite crashed', error);
      process.exit(1);
    });
}

export { MessageFormatTests };
