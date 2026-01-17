/**
 * Zod Schemas for Tauri IPC Runtime Validation
 *
 * These schemas validate Tauri command inputs and responses at runtime
 * to ensure type safety between Rust backend and TypeScript frontend.
 */

import { z } from 'zod';

// ============================================================================
// MCP Server Status Schemas
// ============================================================================

/**
 * Schema for MCP server status response
 */
export const McpServerStatusSchema = z.object({
  port: z.number().int().positive(),
  is_running: z.boolean(),
  url: z.string().url().optional(),
  uptime_seconds: z.number().nonnegative(),
});

/**
 * Schema for workflow MCP server status response
 */
export const WorkflowMcpServerStatusSchema = z.object({
  port: z.number().int().positive(),
  is_running: z.boolean(),
  uptime_seconds: z.number().nonnegative(),
});

// ============================================================================
// Authentication Schemas
// ============================================================================

/**
 * Schema for login credentials
 */
export const LoginCredentialsSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * Schema for registration data
 */
export const RegisterDataSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

/**
 * Schema for auth token response
 */
export const AuthTokenResponseSchema = z.object({
  token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
  }),
});

// ============================================================================
// File System Schemas
// ============================================================================

/**
 * Schema for file path input
 */
export const FilePathSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
});

/**
 * Schema for file read response
 */
export const FileReadResponseSchema = z.object({
  content: z.string(),
  path: z.string(),
  size: z.number().nonnegative(),
  modified: z.string().datetime().optional(),
});

/**
 * Schema for file write input
 */
export const FileWriteInputSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
  content: z.string(),
  create_dirs: z.boolean().optional().default(false),
});

/**
 * Schema for directory list response
 */
export const DirectoryListResponseSchema = z.object({
  entries: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      is_dir: z.boolean(),
      is_file: z.boolean(),
      size: z.number().nonnegative().optional(),
      modified: z.string().datetime().optional(),
    })
  ),
});

// ============================================================================
// Recording/Workflow Schemas
// ============================================================================

/**
 * Schema for recording session
 */
export const RecordingSessionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  events: z.array(z.any()),
});

/**
 * Schema for start recording input
 */
export const StartRecordingInputSchema = z.object({
  name: z.string().optional(),
  options: z
    .object({
      capture_screenshots: z.boolean().optional(),
      capture_mouse: z.boolean().optional(),
      capture_keyboard: z.boolean().optional(),
    })
    .optional(),
});

// ============================================================================
// Settings Schemas
// ============================================================================

/**
 * Schema for application settings
 */
export const AppSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional().default('system'),
  mcp_auto_start: z.boolean().optional().default(true),
  workflow_auto_start: z.boolean().optional().default(true),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
  api_key: z.string().optional(),
  vertex_ai_endpoint: z.string().url().optional(),
  mastra_endpoint: z.string().url().optional(),
});

/**
 * Schema for updating settings
 */
export const UpdateSettingsInputSchema = z.object({
  settings: AppSettingsSchema.partial(),
});

// ============================================================================
// Error Response Schema
// ============================================================================

/**
 * Schema for Tauri error response
 */
export const TauriErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;
export type WorkflowMcpServerStatus = z.infer<typeof WorkflowMcpServerStatusSchema>;
export type LoginCredentials = z.infer<typeof LoginCredentialsSchema>;
export type RegisterData = z.infer<typeof RegisterDataSchema>;
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;
export type FilePath = z.infer<typeof FilePathSchema>;
export type FileReadResponse = z.infer<typeof FileReadResponseSchema>;
export type FileWriteInput = z.infer<typeof FileWriteInputSchema>;
export type DirectoryListResponse = z.infer<typeof DirectoryListResponseSchema>;
export type RecordingSession = z.infer<typeof RecordingSessionSchema>;
export type StartRecordingInput = z.infer<typeof StartRecordingInputSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInputSchema>;
export type TauriError = z.infer<typeof TauriErrorSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Safely parse and validate Tauri response
 * Returns { success: true, data } or { success: false, error }
 */
export function validateTauriResponse<T>(
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
      const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Tauri IPC validation failed: ${issues}`);
    }
    throw error;
  }
}

/**
 * Validate input before sending to Tauri command
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return parseOrThrow(schema, data);
}
