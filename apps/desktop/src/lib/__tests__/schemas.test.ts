import { describe, it, expect } from 'vitest';
import {
  McpToolSchema,
  McpToolsResponseSchema,
  McpInitializeResponseSchema,
  WorkflowSchema,
  WorkflowStepSchema,
  validateMcpResponse,
} from '../schemas/mcp';
import {
  McpServerStatusSchema,
  WorkflowMcpServerStatusSchema,
  AuthTokenResponseSchema,
} from '../schemas/tauri';

describe('MCP Schemas', () => {
  describe('McpToolSchema', () => {
    it('should validate a valid tool', () => {
      const validTool = {
        name: 'click_element',
        description: 'Click on an element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string' },
          },
        },
      };

      const result = McpToolSchema.safeParse(validTool);
      expect(result.success).toBe(true);
    });

    it('should fail when name is empty', () => {
      const invalidTool = {
        name: '',
        description: 'Click on an element',
        inputSchema: {},
      };

      const result = McpToolSchema.safeParse(invalidTool);
      expect(result.success).toBe(false);
    });

    it('should use default empty description if not provided', () => {
      const toolWithoutDesc = {
        name: 'test_tool',
        inputSchema: {},
      };

      const result = McpToolSchema.safeParse(toolWithoutDesc);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe('');
      }
    });

    it('should use default empty inputSchema if not provided', () => {
      const toolWithoutSchema = {
        name: 'test_tool',
        description: 'Test tool',
      };

      const result = McpToolSchema.safeParse(toolWithoutSchema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.inputSchema).toEqual({});
      }
    });
  });

  describe('McpToolsResponseSchema', () => {
    it('should validate a valid tools response', () => {
      const validResponse = {
        tools: [
          {
            name: 'click_element',
            description: 'Click on an element',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'type_into_element',
            description: 'Type into an element',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };

      const result = McpToolsResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should accept empty tools array', () => {
      const emptyResponse = {
        tools: [],
      };

      const result = McpToolsResponseSchema.safeParse(emptyResponse);
      expect(result.success).toBe(true);
    });

    it('should fail if tools is not an array', () => {
      const invalidResponse = {
        tools: 'not an array',
      };

      const result = McpToolsResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('McpInitializeResponseSchema', () => {
    it('should validate a valid initialize response', () => {
      const validResponse = {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'terminator-mcp',
          version: '1.0.0',
        },
        capabilities: {},
      };

      const result = McpInitializeResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should accept serverInfo with optional instructions', () => {
      const responseWithInstructions = {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'terminator-mcp',
          version: '1.0.0',
          instructions: 'Computer control MCP server instructions',
        },
        capabilities: {},
      };

      const result = McpInitializeResponseSchema.safeParse(responseWithInstructions);
      expect(result.success).toBe(true);
    });

    it('should accept capabilities with tools property', () => {
      const responseWithCapabilities = {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'terminator-mcp',
          version: '1.0.0',
        },
        capabilities: {
          tools: { some: 'data' },
        },
      };

      const result = McpInitializeResponseSchema.safeParse(responseWithCapabilities);
      expect(result.success).toBe(true);
    });

    it('should fail if protocolVersion is missing', () => {
      const invalidResponse = {
        serverInfo: {
          name: 'test',
          version: '1.0.0',
        },
        capabilities: {},
      };

      const result = McpInitializeResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it('should accept response without serverInfo (optional)', () => {
      const responseWithoutServerInfo = {
        protocolVersion: '2024-11-05',
        capabilities: {},
      };

      const result = McpInitializeResponseSchema.safeParse(responseWithoutServerInfo);
      expect(result.success).toBe(true);
    });
  });

  describe('WorkflowStepSchema', () => {
    it('should validate a valid workflow step', () => {
      const validStep = {
        id: 'step_1',
        tool: 'click_element',
        arguments: { selector: '#button' },
      };

      const result = WorkflowStepSchema.safeParse(validStep);
      expect(result.success).toBe(true);
    });

    it('should accept optional fields', () => {
      const stepWithOptionals = {
        id: 'step_1',
        tool: 'click_element',
        arguments: { selector: '#button' },
        description: 'Click the button',
        fallback_id: 'step_fallback',
        retry_count: 3,
      };

      const result = WorkflowStepSchema.safeParse(stepWithOptionals);
      expect(result.success).toBe(true);
    });

    it('should accept step without retry_count (optional)', () => {
      const stepWithoutRetry = {
        id: 'step_1',
        tool: 'click_element',
        arguments: {},
      };

      const result = WorkflowStepSchema.safeParse(stepWithoutRetry);
      expect(result.success).toBe(true);
    });

    it('should fail if required fields are missing', () => {
      const invalidStep = {
        id: 'step_1',
        // missing tool
      };

      const result = WorkflowStepSchema.safeParse(invalidStep);
      expect(result.success).toBe(false);
    });
  });

  describe('WorkflowSchema', () => {
    it('should validate a complete workflow', () => {
      const validWorkflow = {
        id: 'workflow_123',
        name: 'Test Workflow',
        description: 'A test workflow',
        steps: [
          {
            id: 'step_1',
            tool: 'click_element',
            arguments: { selector: '#button' },
          },
          {
            id: 'step_2',
            tool: 'type_into_element',
            arguments: { selector: '#input', text: 'Hello' },
          },
        ],
        metadata: {
          author: 'Test',
          version: '1.0',
        },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      const result = WorkflowSchema.safeParse(validWorkflow);
      expect(result.success).toBe(true);
    });

    it('should validate a minimal workflow', () => {
      const minimalWorkflow = {
        name: 'Minimal Workflow',
        steps: [
          {
            id: 'step_1',
            tool: 'test_tool',
          },
        ],
      };

      const result = WorkflowSchema.safeParse(minimalWorkflow);
      expect(result.success).toBe(true);
    });

    it('should fail if name is missing', () => {
      const invalidWorkflow = {
        steps: [
          {
            id: 'step_1',
            action: 'test_action',
            arguments: {},
          },
        ],
      };

      const result = WorkflowSchema.safeParse(invalidWorkflow);
      expect(result.success).toBe(false);
    });

    it('should fail if steps is not an array', () => {
      const invalidWorkflow = {
        name: 'Test',
        steps: 'not an array',
      };

      const result = WorkflowSchema.safeParse(invalidWorkflow);
      expect(result.success).toBe(false);
    });

    it('should fail if datetime strings are invalid', () => {
      const invalidWorkflow = {
        name: 'Test',
        steps: [],
        created_at: 'not a valid datetime',
      };

      const result = WorkflowSchema.safeParse(invalidWorkflow);
      expect(result.success).toBe(false);
    });
  });

  describe('validateMcpResponse helper', () => {
    it('should return success for valid data', () => {
      const validTool = {
        name: 'test_tool',
        description: 'Test',
        inputSchema: {},
      };

      const result = validateMcpResponse(McpToolSchema, validTool);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: 'test_tool',
          description: 'Test',
          inputSchema: {},
        });
      }
    });

    it('should return error for invalid data', () => {
      const invalidTool = {
        name: '',
        description: 'Test',
      };

      const result = validateMcpResponse(McpToolSchema, invalidTool);

      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toBeDefined();
      }
    });

    it('should work with complex schemas', () => {
      const validResponse = {
        tools: [
          {
            name: 'tool1',
            description: 'First tool',
            inputSchema: {},
          },
        ],
      };

      const result = validateMcpResponse(McpToolsResponseSchema, validResponse);

      expect(result.success).toBe(true);
    });
  });
});

describe('Tauri Schemas', () => {
  describe('McpServerStatusSchema', () => {
    it('should validate a valid MCP server status', () => {
      const validStatus = {
        port: 8080,
        is_running: true,
        url: 'http://127.0.0.1:8080',
        uptime_seconds: 120,
      };

      const result = McpServerStatusSchema.safeParse(validStatus);
      expect(result.success).toBe(true);
    });

    it('should fail if port is not a number', () => {
      const invalidStatus = {
        port: '8080',
        is_running: true,
        url: 'http://127.0.0.1:8080',
        uptime_seconds: 120,
      };

      const result = McpServerStatusSchema.safeParse(invalidStatus);
      expect(result.success).toBe(false);
    });

    it('should fail if required fields are missing', () => {
      const invalidStatus = {
        port: 8080,
        // missing is_running, url, uptime_seconds
      };

      const result = McpServerStatusSchema.safeParse(invalidStatus);
      expect(result.success).toBe(false);
    });
  });

  describe('WorkflowMcpServerStatusSchema', () => {
    it('should validate a valid workflow MCP server status', () => {
      const validStatus = {
        port: 8081,
        is_running: true,
        url: 'http://127.0.0.1:8081',
        uptime_seconds: 60,
      };

      const result = WorkflowMcpServerStatusSchema.safeParse(validStatus);
      expect(result.success).toBe(true);
    });

    it('should accept same structure as McpServerStatusSchema', () => {
      const status = {
        port: 8081,
        is_running: false,
        url: 'http://127.0.0.1:8081',
        uptime_seconds: 0,
      };

      const result1 = McpServerStatusSchema.safeParse(status);
      const result2 = WorkflowMcpServerStatusSchema.safeParse(status);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  describe('AuthTokenResponseSchema', () => {
    it('should validate a valid auth token response', () => {
      const validResponse = {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        expires_in: 3600,
        user: {
          id: 'user123',
          email: 'user@example.com',
          name: 'Test User',
        },
      };

      const result = AuthTokenResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should accept optional refresh_token', () => {
      const responseWithRefresh = {
        token: 'token123',
        expires_in: 3600,
        refresh_token: 'refresh123',
        user: {
          id: 'user123',
          email: 'user@example.com',
          name: 'Test User',
        },
      };

      const result = AuthTokenResponseSchema.safeParse(responseWithRefresh);
      expect(result.success).toBe(true);
    });

    it('should fail if token is missing', () => {
      const invalidResponse = {
        expires_in: 3600,
        user: {
          id: 'user123',
          email: 'user@example.com',
          name: 'Test User',
        },
      };

      const result = AuthTokenResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it('should fail if expires_in is not a number', () => {
      const invalidResponse = {
        token: 'token123',
        expires_in: '3600',
        user: {
          id: 'user123',
          email: 'user@example.com',
          name: 'Test User',
        },
      };

      const result = AuthTokenResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it('should fail if user email is invalid', () => {
      const invalidResponse = {
        token: 'token123',
        expires_in: 3600,
        user: {
          id: 'user123',
          email: 'not-an-email',
          name: 'Test User',
        },
      };

      const result = AuthTokenResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });
});

describe('Schema Integration Tests', () => {
  it('should validate a complete MCP tools list response', () => {
    const completeResponse = {
      result: {
        tools: [
          {
            name: 'click_element',
            description: 'Click on a UI element',
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
          },
          {
            name: 'type_into_element',
            description: 'Type text into an element',
            inputSchema: {
              type: 'object',
              properties: {
                selector: { type: 'string' },
                text_to_type: { type: 'string' },
              },
              required: ['selector', 'text_to_type'],
            },
          },
          {
            name: 'create_workflow',
            description: 'Create a new workflow',
            inputSchema: {
              type: 'object',
              properties: {
                workflow_json: { type: 'string' },
              },
              required: ['workflow_json'],
            },
          },
        ],
      },
    };

    const result = validateMcpResponse(
      McpToolsResponseSchema,
      completeResponse.result
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toHaveLength(3);
      expect(result.data.tools[0].name).toBe('click_element');
      expect(result.data.tools[1].name).toBe('type_into_element');
      expect(result.data.tools[2].name).toBe('create_workflow');
    }
  });

  it('should validate server initialization from both MCP servers', () => {
    const terminatorInit = {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'terminator-mcp',
        version: '1.0.0',
        instructions: 'Computer control MCP server',
      },
      capabilities: {
        tools: {},
      },
    };

    const workflowBuilderInit = {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'workflow-builder-mcp',
        version: '1.0.0',
        instructions: 'Workflow management MCP server',
      },
      capabilities: {
        tools: {},
      },
    };

    const result1 = McpInitializeResponseSchema.safeParse(terminatorInit);
    const result2 = McpInitializeResponseSchema.safeParse(workflowBuilderInit);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
  });

  it('should handle malformed data gracefully', () => {
    const malformedData = {
      unexpected_field: 'unexpected_value',
      another_field: 123,
    };

    const result = validateMcpResponse(McpToolSchema, malformedData);

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error.issues).toBeTruthy();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
