import { z } from 'zod';

// Client -> Server messages
export const InitMessageSchema = z.object({
  type: z.literal('init'),
  token: z.string(),
  workflowId: z.number().optional(),
  sessionId: z.string().optional(), // Resume existing session
});

export const ChatMessageSchema = z.object({
  type: z.literal('message'),
  content: z.string(),
});

export const ToolResultSchema = z.object({
  type: z.literal('tool_result'),
  id: z.string(),
  result: z.record(z.any()),
});

export const CancelSchema = z.object({
  type: z.literal('cancel'),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  InitMessageSchema,
  ChatMessageSchema,
  ToolResultSchema,
  CancelSchema,
]);

export type InitMessage = z.infer<typeof InitMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type CancelMessage = z.infer<typeof CancelSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Server -> Client messages
export interface ReadyMessage {
  type: 'ready';
  sessionId: string;
  userId: string;
  organizationId: string;
}

export interface TokenMessage {
  type: 'token';
  content: string;
}

export interface ToolRequestMessage {
  type: 'tool_request';
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface DoneMessage {
  type: 'done';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

export interface ThinkingMessage {
  type: 'thinking';
  content: string;
}

export type ServerMessage =
  | ReadyMessage
  | TokenMessage
  | ToolRequestMessage
  | DoneMessage
  | ErrorMessage
  | ThinkingMessage;
