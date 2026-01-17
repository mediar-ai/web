/**
 * Test Data Factories
 *
 * Helper functions to create mock data for testing.
 * Use these to avoid repetitive test setup code.
 */

import type { McpTool } from '../../lib/mcp-client';

export interface MockMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: any[];
}

export interface MockWorkflow {
  id: string;
  name: string;
  steps: any[];
  created_at: Date;
}

/**
 * Create a mock MCP tool
 */
export const createMockTool = (overrides: Partial<McpTool> = {}): McpTool => ({
  name: 'click_element',
  description: 'Click an element on the screen',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'Element selector',
      },
    },
    required: ['selector'],
  },
  ...overrides,
});

/**
 * Create a mock chat message
 */
export const createMockMessage = (overrides: Partial<MockMessage> = {}): MockMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  content: 'Test message',
  timestamp: new Date(),
  ...overrides,
});

/**
 * Create a mock workflow
 */
export const createMockWorkflow = (overrides: Partial<MockWorkflow> = {}): MockWorkflow => ({
  id: crypto.randomUUID(),
  name: 'Test Workflow',
  steps: [
    {
      id: 'step_1',
      tool: 'click_element',
      arguments: { selector: 'button' },
    },
  ],
  created_at: new Date(),
  ...overrides,
});

/**
 * Create multiple mock tools
 */
export const createMockTools = (count: number = 3): Record<string, McpTool> => {
  const tools: Record<string, McpTool> = {};

  for (let i = 0; i < count; i++) {
    const toolName = `test_tool_${i}`;
    tools[toolName] = createMockTool({
      name: toolName,
      description: `Test tool ${i}`,
    });
  }

  return tools;
};

/**
 * Create a conversation (multiple messages)
 */
export const createMockConversation = (messageCount: number = 3): MockMessage[] => {
  const messages: MockMessage[] = [];

  for (let i = 0; i < messageCount; i++) {
    messages.push(
      createMockMessage({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
        timestamp: new Date(Date.now() + i * 1000),
      })
    );
  }

  return messages;
};

/**
 * Wait for a condition with timeout
 * Useful for async tests
 */
export const waitForCondition = async (
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> => {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
};

/**
 * Delay helper for testing
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
