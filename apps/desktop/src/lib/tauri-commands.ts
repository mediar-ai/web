/**
 * Type-Safe Tauri Command Wrappers
 *
 * These wrappers provide runtime validation of Tauri IPC calls
 * using Zod schemas for both inputs and outputs.
 */

import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import {
  McpServerStatusSchema,
  WorkflowMcpServerStatusSchema,
  type McpServerStatus,
  type WorkflowMcpServerStatus,
  validateTauriResponse,
  parseOrThrow,
} from './schemas/tauri';

// ============================================================================
// Error Handling
// ============================================================================

class TauriCommandError extends Error {
  constructor(
    message: string,
    public command: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'TauriCommandError';
  }
}

/**
 * Safe invoke wrapper with validation
 */
async function safeInvoke<TInput, TOutput>(
  command: string,
  inputSchema: z.ZodSchema<TInput> | null,
  outputSchema: z.ZodSchema<TOutput>,
  args?: TInput
): Promise<TOutput> {
  try {
    // Validate input if schema provided
    let validatedArgs = args;
    if (inputSchema && args !== undefined) {
      validatedArgs = parseOrThrow(inputSchema, args);
    }

    // Call Tauri command
    const result = await invoke(command, validatedArgs as any);

    // Validate output
    const validation = validateTauriResponse(outputSchema, result);
    if (!validation.success) {
      const error = 'error' in validation ? validation.error : new Error('Unknown validation error');
      console.error(`[Tauri] Command '${command}' returned invalid data:`, error);
      throw new TauriCommandError(
        `Invalid response from ${command}: ${error instanceof Error ? error.message : String(error)}`,
        command,
        error
      );
    }

    return validation.data;
  } catch (error) {
    if (error instanceof TauriCommandError) {
      throw error;
    }

    console.error(`[Tauri] Command '${command}' failed:`, error);
    throw new TauriCommandError(
      `Failed to execute ${command}: ${error instanceof Error ? error.message : String(error)}`,
      command,
      error
    );
  }
}

// ============================================================================
// MCP Server Commands
// ============================================================================

/**
 * Get MCP server status (terminator-mcp)
 */
export async function getMcpServerStatus(): Promise<McpServerStatus> {
  return safeInvoke(
    'get_mcp_server_info',
    null,
    McpServerStatusSchema,
    undefined
  );
}

/**
 * Get workflow MCP server status
 */
export async function getWorkflowMcpServerStatus(): Promise<WorkflowMcpServerStatus> {
  return safeInvoke(
    'get_workflow_mcp_server_status',
    null,
    WorkflowMcpServerStatusSchema,
    undefined
  );
}

/**
 * Restart MCP server
 */
export async function restartMcpServer(): Promise<McpServerStatus> {
  return safeInvoke(
    'restart_mcp_server',
    null,
    McpServerStatusSchema,
    undefined
  );
}

// ============================================================================
// Type Exports
// ============================================================================

export { TauriCommandError };

// Re-export types for convenience
export type {
  McpServerStatus,
  WorkflowMcpServerStatus,
} from './schemas/tauri';
