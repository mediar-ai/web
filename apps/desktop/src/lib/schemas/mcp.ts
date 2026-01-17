/**
 * Zod Schemas for MCP Runtime Validation
 *
 * These schemas validate MCP server responses at runtime to ensure
 * type safety beyond TypeScript's compile-time checks.
 */

import { z } from "zod";

// ============================================================================
// MCP Tool Schemas
// ============================================================================

/**
 * Schema for a single tool's input schema (JSON Schema format)
 */
export const McpInputSchemaSchema = z.object({
  type: z.literal("object").optional(),
  properties: z.record(z.string(), z.any()).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

/**
 * Schema for a single MCP tool definition
 */
export const McpToolSchema = z.object({
  name: z.string().min(1, "Tool name cannot be empty"),
  description: z.string().optional().default(""),
  inputSchema: McpInputSchemaSchema.optional().default({}),
});

/**
 * Schema for the tools list response from MCP server
 */
export const McpToolsResponseSchema = z.object({
  tools: z.array(McpToolSchema),
});

// ============================================================================
// MCP Server Info Schemas
// ============================================================================

/**
 * Schema for MCP server information
 */
export const McpServerInfoSchema = z.object({
  port: z.number().int().positive(),
  isConnected: z.boolean(),
  url: z.string().url("Invalid URL format"),
  instructions: z.string().optional(),
});

/**
 * Schema for MCP server initialization response
 */
export const McpInitializeResponseSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.string(), z.any()).optional().default({}),
  serverInfo: z
    .object({
      name: z.string(),
      version: z.string(),
      instructions: z.string().optional(),
    })
    .optional(),
  instructions: z.string().optional(),
});

// ============================================================================
// MCP Tool Execution Schemas
// ============================================================================

/**
 * Schema for tool execution content (text or image)
 */
export const McpContentSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image"),
    data: z.string(),
    mimeType: z.string(),
  }),
  z.object({
    type: z.literal("resource"),
    resource: z.object({
      uri: z.string(),
      mimeType: z.string().optional(),
      text: z.string().optional(),
    }),
  }),
  z.string(), // Allow plain strings as content
  z.record(z.string(), z.any()), // Allow generic objects
]);

/**
 * Schema for successful tool execution result
 */
export const McpToolResultSchema = z.object({
  content: z.union([z.array(McpContentSchema), z.string(), z.record(z.string(), z.any())]),
  isError: z.boolean().optional().default(false),
});

/**
 * Schema for tool execution error
 */
export const McpToolErrorSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.any().optional(),
  }),
});

/**
 * Schema for complete tool call response
 */
export const McpToolCallResponseSchema = z.union([McpToolResultSchema, McpToolErrorSchema]);

// ============================================================================
// MCP Progress/Notification Schemas
// ============================================================================

/**
 * Schema for progress notifications from MCP server
 */
export const McpProgressNotificationSchema = z.object({
  method: z.literal("progress"),
  params: z.object({
    message: z.string(),
    level: z.enum(["log", "error", "warn", "info"]).optional().default("log"),
    percentage: z.number().min(0).max(100).optional(),
    currentStep: z.number().int().positive().optional(),
    totalSteps: z.number().int().positive().optional(),
  }),
});

/**
 * Schema for elicitation request from MCP server
 */
export const McpElicitationRequestSchema = z.object({
  message: z.string(),
  schema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.any()),
    required: z.array(z.string()).optional(),
  }),
});

// ============================================================================
// Workflow MCP Schemas (for workflow-builder-mcp)
// ============================================================================

/**
 * Schema for workflow step
 */
export const WorkflowStepSchema = z.object({
  id: z.string(),
  tool: z.string(),
  arguments: z.record(z.string(), z.any()).optional().default({}),
  description: z.string().optional(),
  fallback_id: z.string().optional(),
  retry_count: z.number().int().nonnegative().optional().default(0),
});

/**
 * Schema for complete workflow
 */
export const WorkflowSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(WorkflowStepSchema),
  metadata: z.record(z.string(), z.any()).optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

/**
 * Schema for workflow list response
 */
export const WorkflowListResponseSchema = z.object({
  workflows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      step_count: z.number().int().nonnegative(),
    })
  ),
});

/**
 * Schema for workflow execution result
 */
export const WorkflowExecutionResultSchema = z.object({
  workflow_id: z.string(),
  status: z.enum(["executed_without_error", "executed_with_warnings", "execution_error"]),
  steps_executed: z.number().int().nonnegative(),
  steps_failed: z.number().int().nonnegative(),
  results: z.array(z.any()),
  errors: z.array(z.string()).optional(),
  execution_time_ms: z.number().nonnegative().optional(),
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

export type McpTool = z.infer<typeof McpToolSchema>;
export type McpToolsResponse = z.infer<typeof McpToolsResponseSchema>;
export type McpServerInfo = z.infer<typeof McpServerInfoSchema>;
export type McpInitializeResponse = z.infer<typeof McpInitializeResponseSchema>;
export type McpToolResult = z.infer<typeof McpToolResultSchema>;
export type McpToolError = z.infer<typeof McpToolErrorSchema>;
export type McpProgressNotification = z.infer<typeof McpProgressNotificationSchema>;
export type McpElicitationRequest = z.infer<typeof McpElicitationRequestSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>;
export type WorkflowExecutionResult = z.infer<typeof WorkflowExecutionResultSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Safely parse and validate MCP response
 * Returns { success: true, data } or { success: false, error }
 */
export function validateMcpResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Parse and validate, throwing on error
 */
export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
      throw new Error(`Validation failed: ${issues}`);
    }
    throw error;
  }
}
