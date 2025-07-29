import { VertexAI } from '@google-cloud/vertexai';
import { NextRequest, NextResponse } from 'next/server';

// =================================================================
// TYPE DEFINITIONS TO REPLACE 'any' TYPES
// =================================================================

import { FunctionDeclaration, SchemaType } from '@google-cloud/vertexai';

// OpenAI-compatible message types (supporting legacy formats)
export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'model' | 'function';
  content?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  parts?: MessagePart[];
  // Legacy function calling support
  functionCalls?: LegacyFunctionCall[];
  functionResponses?: LegacyFunctionResponse[];
}

export interface MessagePart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LegacyFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

// VertexAI-compatible message types
export interface VertexAIMessage {
  role: 'user' | 'model' | 'function';
  parts: (TextPart | FunctionCallPart | FunctionResponsePart)[];
}

export interface TextPart {
  text: string;
}

export interface FunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
}

export interface FunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
}

// JSON Schema types compatible with VertexAI
export interface VertexAISchema {
  type: SchemaType;
  properties?: Record<string, VertexAISchema>;
  items?: VertexAISchema;
  required?: string[];
  description?: string;
  enum?: string[];
  format?: string;
}

// Tool definition types
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface MCPTool {
  description?: string;
  inputSchema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

export type ToolFormat = OpenAITool[] | Record<string, MCPTool>;

// VertexAI function call (from response)
export interface VertexAIFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

// Function response types for message history
export interface LegacyFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export interface LegacyFunctionMessage {
  role: 'function';
  functionResponses?: LegacyFunctionResponse[];
  content?: string;
}

// =================================================================
// END TYPE DEFINITIONS
// =================================================================

/*

Project context: 

This is a .mdc rule in the tauyri app that consume this api route fyi

# Workflow System Documentation

## Overview

The Mediar app includes a workflow system that learns from user screen recordings and converts them into executable workflows. Users can run these workflows step-by-step with AI assistance and human oversight.

## How It Works

1. **Workflow List**: App shows available workflows compiled from user screen recordings
2. **Execute**: User clicks "Start" to run a workflow
3. **Step-by-Step**: AI executes each step and shows Accept/Reject buttons
4. **Human Oversight**: If Accept → continue; If Reject → ask what went wrong
5. **Correction**: Use chat feedback to correct the step and save new workflow file

## Real Workflow Format

Workflows use the `execute_sequence` tool format from the MCP server:

```yaml
tool_name: execute_sequence
arguments:
  variables:
    # User inputs with types, validation, defaults
    url:
      type: string
      label: URL
      description: The URL to navigate to
      default: https://example.com
    user_name:
      type: string
      label: Username
      description: User account name
      default: john@example.com

  selectors:
    # Element selectors for automation
    login_button: role:button|name:Login
    username_field: role:textbox|name:Username
    password_field: role:textbox|name:Password

  steps:
    # Sequential automation steps
    - tool_name: navigate_browser
      arguments:
        url: "${{url}}"
        include_tree: false
    - tool_name: set_value
      arguments:
        selector: "${{selectors.username_field}}"
        value: "${{user_name}}"
        timeout_ms: 1000
    - tool_name: click_element
      arguments:
        selector: "${{selectors.login_button}}"
        timeout_ms: 1000

  output_parser:
    # Parse results from UI
    ui_tree_source_step_id: final_step
    javascript_code: |
      // Parse results from the page
      return { success: true, message: "Login completed" };
```

## User Interface Flow

### 1. Workflow Dashboard

```
┌─────────────────────────────────────────┐
│ 📋 My Workflows                          │
├─────────────────────────────────────────┤
│ ▶️ Daily Login Process (3 steps)         │
│ ▶️ Generate Reports (8 steps)            │
│ ▶️ Data Backup (5 steps)                 │
└─────────────────────────────────────────┘
```

### 2. Step Execution

```
┌─────────────────────────────────────────┐
│ 🔄 Executing: Daily Login Process       │
│ Progress: ██████░░ 2/3 steps             │
├─────────────────────────────────────────┤
│ Current Step: Click Login Button        │
│                                         │
│ Tool: click_element                     │
│ Selector: role:button|name:Login        │
│                                         │
│ Result: ✅ Button clicked successfully   │
│                                         │
│ [ ✅ Accept ] [ ❌ Reject ]              │
└─────────────────────────────────────────┘
```

### 3. Correction Flow

When user clicks "Reject":

```
┌─────────────────────────────────────────┐
│ ❌ Step Correction Needed                │
├─────────────────────────────────────────┤
│ Step 2: Click Login Button failed       │
│                                         │
│ 💬 What went wrong?                     │
│ ┌─────────────────────────────────────┐ │
│ │ The button selector is wrong. The   │ │
│ │ login button is now called "Sign In"│ │
│ │ instead of "Login"                  │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [ 🔧 Apply Correction ] [ ⏭️ Skip ]     │
└─────────────────────────────────────────┘
```

## File Management

### Storage Structure

```
workflows/
├── original/
│   ├── daily_login_v1.yaml
│   ├── report_generation_v1.yaml
│   └── data_backup_v1.yaml
├── corrected/
│   ├── daily_login_v1_corrected_2024_01_15.yaml
│   ├── report_generation_v1_corrected_2024_01_16.yaml
│   └── data_backup_v1_corrected_2024_01_15.yaml
```

### Naming Convention

- **Original**: `{workflow_name}_v{version}.yaml`
- **Corrected**: `{workflow_name}_v{version}_corrected_{YYYY_MM_DD}.yaml`

## Implementation Components

### Frontend Components

- **WorkflowList**: Display available workflows
- **WorkflowExecutor**: Step-by-step execution with Accept/Reject buttons
- **CorrectionChat**: Chat interface for error feedback

### Backend (Tauri)

- **WorkflowManager**: Load/save workflows
- **MCPConnector**: Execute steps via MCP server
- **CorrectionEngine**: Process user feedback into corrections

### MCP Integration

- Use existing MCP server and `execute_sequence` tool
- Handle step execution and result capture
- Validate parameters before execution

## Error Handling

### Common Scenarios

1. **Selector Not Found**: Element selector doesn't match current page
2. **Tool Execution Failed**: MCP tool returns error
3. **User Rejection**: User indicates step didn't work as expected
4. **Timeout**: Step takes too long to complete

### Recovery

- Show clear error messages to user
- Allow manual correction via chat feedback
- Save corrected workflows for future use
- Option to retry failed steps

---

This system provides intelligent workflow automation with human oversight and continuous improvement through user feedback.

*/

// Simple password authentication - replace with your desired password
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Clean JSON Schema for Vertex AI compatibility
function cleanSchemaForVertexAI(
  schema: Record<string, unknown> | unknown
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {},
    };
  }

  const schemaObj = schema as Record<string, unknown>;

  // Create clean schema with only Vertex AI supported fields
  const cleanSchema: Record<string, unknown> = {
    type: (schemaObj.type as string) || 'object',
  };

  // Add properties if they exist
  if (schemaObj.properties && typeof schemaObj.properties === 'object') {
    cleanSchema.properties = {} as Record<string, unknown>;
    const properties = cleanSchema.properties as Record<string, unknown>;

    // Recursively clean each property
    for (const [propName, propSchema] of Object.entries(
      schemaObj.properties as Record<string, unknown>
    )) {
      properties[propName] = cleanSchemaForVertexAI(propSchema);
    }
  }

  // Add required array if it exists
  if (Array.isArray(schemaObj.required)) {
    cleanSchema.required = schemaObj.required;
  }

  // Add description if it exists
  if (typeof schemaObj.description === 'string') {
    cleanSchema.description = schemaObj.description;
  }

  // Add enum if it exists
  if (Array.isArray(schemaObj.enum)) {
    cleanSchema.enum = schemaObj.enum;
  }

  // Add format if it exists (for string types)
  if (typeof schemaObj.format === 'string') {
    cleanSchema.format = schemaObj.format;
  }

  // Add items for array types
  if (schemaObj.type === 'array' && schemaObj.items) {
    cleanSchema.items = cleanSchemaForVertexAI(schemaObj.items);
  }

  // Remove all unsupported fields (they're just not added)
  // Unsupported: $schema, title, definitions, $ref, additionalProperties, etc.

  return cleanSchema;
}

// Convert tools format (OpenAI or MCP) to Vertex AI function declarations
function convertToolsToVertexAI(
  tools: ToolFormat | undefined
): FunctionDeclaration[] {
  if (!tools) {
    return [];
  }

  const functionDeclarations: FunctionDeclaration[] = [];

  // Handle OpenAI tools format (array of tool objects)
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (tool.type === 'function' && tool.function) {
        const cleanedSchema = cleanSchemaForVertexAI(
          tool.function.parameters || {}
        );
        functionDeclarations.push({
          name: tool.function.name,
          description:
            tool.function.description ||
            `Execute ${tool.function.name} function`,
          parameters: cleanedSchema as any, // Type assertion needed for VertexAI compatibility
        });
      }
    }
  }
  // Handle legacy MCP tools format (object with tool names as keys)
  else if (typeof tools === 'object') {
    for (const [toolName, mcpTool] of Object.entries(tools)) {
      if (typeof mcpTool === 'object' && mcpTool !== null) {
        // Clean the input schema to remove Vertex AI incompatible fields
        const cleanedSchema = cleanSchemaForVertexAI(
          mcpTool.inputSchema || mcpTool.parameters || {}
        );

        functionDeclarations.push({
          name: toolName,
          description: mcpTool.description || `Execute ${toolName} tool`,
          parameters: cleanedSchema as any, // Type assertion needed for VertexAI compatibility
        });
      }
    }
  }

  return functionDeclarations;
}

// Authentication middleware
function authenticate(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  // Support both Bearer token and basic auth formats
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7) === API_PASSWORD;
  }

  if (authHeader.startsWith('Basic ')) {
    const credentials = Buffer.from(
      authHeader.substring(6),
      'base64'
    ).toString();
    const [, password] = credentials.split(':');
    return password === API_PASSWORD;
  }

  return false;
}

// Create a streaming response with OpenAI-compatible format
function createStreamingResponse(
  vertexAI: VertexAI,
  model: string,
  messages: OpenAIMessage[],
  functionDeclarations: FunctionDeclaration[],
  temperature: number = 0.7,
  maxTokens: number = 1000
) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const chatId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const created = Math.floor(Date.now() / 1000);

      try {
        // Send initial chunk (OpenAI format)
        const startChunk = {
          id: chatId,
          object: 'chat.completion.chunk',
          created: created,
          model: model,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: null,
            },
          ],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(startChunk)}\n\n`)
        );

        // Initialize the generative model
        const modelConfig = {
          model: model,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
          tools:
            functionDeclarations.length > 0
              ? [{ functionDeclarations }]
              : undefined,
        };

        const generativeModel = vertexAI.getGenerativeModel(modelConfig);

        // Convert messages to Vertex AI format
        const chatHistory = messages.slice(0, -1).map(msg => {
          // Handle different message types
          if (msg.role === 'user') {
            return {
              role: 'user' as const,
              parts: [{ text: msg.content || '' }],
            };
          } else if (msg.role === 'model' || msg.role === 'assistant') {
            const parts: (TextPart | FunctionCallPart)[] = [];

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
              role: 'model' as const,
              parts: parts.length > 0 ? parts : [{ text: msg.content || '' }],
            };
          } else if (msg.role === 'tool') {
            // Handle OpenAI tool messages
            return {
              role: 'function' as const,
              parts: [
                {
                  functionResponse: {
                    name: msg.tool_call_id || '', // Use tool_call_id as function name for Vertex AI
                    response: { result: msg.content || '' },
                  },
                },
              ],
            };
          } else if (msg.role === 'function') {
            // Handle legacy function responses
            return {
              role: 'function' as const,
              parts: msg.functionResponses
                ? msg.functionResponses.map((fr: LegacyFunctionResponse) => ({
                    functionResponse: {
                      name: fr.name,
                      response: fr.response,
                    },
                  }))
                : [{ text: msg.content || '' }],
            };
          }

          // Default fallback - handle all role types explicitly
          const vertexRole = ['user', 'system'].includes(msg.role)
            ? ('user' as const)
            : ('model' as const);
          return {
            role: vertexRole,
            parts: [{ text: msg.content || '' }],
          };
        });

        const lastMessage = messages[messages.length - 1];

        // Start chat session - use type assertion for VertexAI compatibility
        const chat = generativeModel.startChat({
          history: chatHistory as any,
        });

        let result;

        // Check if last message is a tool message (indicates continuation)
        if (lastMessage.role === 'tool') {
          // Find the corresponding assistant message with tool calls
          const assistantMessage = messages[messages.length - 2];
          if (assistantMessage && assistantMessage.tool_calls) {
            // Create function response parts for continuation
            const functionResponseParts = [
              {
                functionResponse: {
                  name: lastMessage.tool_call_id || '',
                  response: { result: lastMessage.content || '' },
                },
              },
            ];

            // Send the function responses to continue the conversation
            result = await chat.sendMessageStream(functionResponseParts as any);
          } else {
            // Fallback: treat as regular user message
            result = await chat.sendMessageStream(
              lastMessage.content || 'Continue'
            );
          }
        } else {
          // Normal user message
          const userMessage = lastMessage.content || '';
          result = await chat.sendMessageStream(userMessage);
        }

        let fullText = '';
        const functionCalls: VertexAIFunctionCall[] = [];

        // Process streaming chunks
        for await (const chunk of result.stream) {
          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;

          // Extract text from the response
          const textParts =
            candidate.content?.parts?.filter(part => part.text) || [];
          if (textParts.length > 0) {
            const chunkText = textParts.map(part => part.text).join('');
            if (chunkText) {
              fullText += chunkText;

              // Send text delta in OpenAI format
              const textChunk = {
                id: chatId,
                object: 'chat.completion.chunk',
                created: created,
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: { content: chunkText },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`)
              );
            }
          }

          // Check for function calls
          const functionCallParts =
            candidate.content?.parts?.filter(part => part.functionCall) || [];
          if (functionCallParts.length > 0) {
            for (const part of functionCallParts) {
              if (part.functionCall) {
                functionCalls.push({
                  name: part.functionCall.name,
                  args: part.functionCall.args as Record<string, unknown>,
                });

                // Send function call in OpenAI format
                const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const toolCallChunk = {
                  id: chatId,
                  object: 'chat.completion.chunk',
                  created: created,
                  model: model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: toolCallId,
                            type: 'function',
                            function: {
                              name: part.functionCall.name,
                              arguments: JSON.stringify(part.functionCall.args),
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(toolCallChunk)}\n\n`)
                );
              }
            }
          }
        }

        // Send final chunk with finish_reason
        const finishReason = functionCalls.length > 0 ? 'tool_calls' : 'stop';

        const finalChunk = {
          id: chatId,
          object: 'chat.completion.chunk',
          created: created,
          model: model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason,
            },
          ],
          usage: {
            prompt_tokens: 0, // We don't have exact counts from Vertex AI
            completion_tokens: Math.floor(fullText.length / 4), // Rough estimate
            total_tokens: Math.floor(fullText.length / 4),
          },
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`)
        );

        // Send completion marker (OpenAI standard)
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        console.error('❌ Streaming error:', error);

        // Send error in OpenAI format
        const errorChunk = {
          id: chatId,
          object: 'chat.completion.chunk',
          created: created,
          model: model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'error',
            },
          ],
          error: {
            message: (error as Error).message,
            type: 'server_error',
            code: 'internal_error',
          },
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`)
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// Validate tool call sequences to prevent VertexAI errors
function validateToolCallSequence(messages: OpenAIMessage[]): string | null {
  for (let i = 0; i < messages.length - 1; i++) {
    const currentMsg = messages[i];
    const nextMsg = messages[i + 1];

    // Check if assistant message has tool calls
    if (
      currentMsg.role === 'assistant' &&
      currentMsg.tool_calls &&
      currentMsg.tool_calls.length > 0
    ) {
      // The next message should be a tool response, not another user message
      if (nextMsg.role === 'user') {
        return `Assistant made ${currentMsg.tool_calls.length} tool call(s) but got user message instead of tool response. Tool calls must be followed by tool responses.`;
      }

      // If next message is tool response, validate it
      if (nextMsg.role === 'tool') {
        if (!nextMsg.tool_call_id) {
          return `Tool response message missing required 'tool_call_id' field.`;
        }

        // Check if tool_call_id matches any of the tool calls
        const matchingToolCall = currentMsg.tool_calls.find(
          tc => tc.id === nextMsg.tool_call_id
        );
        if (!matchingToolCall) {
          return `Tool response has tool_call_id '${nextMsg.tool_call_id}' but no matching tool call found.`;
        }
      }
    }

    // Check for orphaned tool responses
    if (currentMsg.role === 'tool') {
      // Look backwards to find the assistant message with tool calls
      let foundMatchingToolCall = false;
      for (let j = i - 1; j >= 0; j--) {
        const prevMsg = messages[j];
        if (prevMsg.role === 'assistant' && prevMsg.tool_calls) {
          const matchingCall = prevMsg.tool_calls.find(
            tc => tc.id === currentMsg.tool_call_id
          );
          if (matchingCall) {
            foundMatchingToolCall = true;
            break;
          }
        }
        // Stop looking if we hit another user message
        if (prevMsg.role === 'user') break;
      }

      if (!foundMatchingToolCall) {
        return `Tool response with tool_call_id '${currentMsg.tool_call_id}' has no matching tool call in conversation history.`;
      }
    }
  }

  // Check if conversation ends with unresolved tool calls
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (
      lastMsg.role === 'assistant' &&
      lastMsg.tool_calls &&
      lastMsg.tool_calls.length > 0
    ) {
      return `Conversation ends with ${lastMsg.tool_calls.length} unresolved tool call(s). Expected tool responses but got end of conversation.`;
    }
  }

  return null;
}

// OPTIONS endpoint for CORS preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// POST endpoint for AI chat with direct Vertex AI
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    // Extract parameters using OpenAI-compatible names
    const {
      messages,
      model = 'gemini-2.5-flash',
      tools,
      max_tokens = 1000,
      maxTokens = 1000,
      maxOutputTokens = 1000,
      temperature = 0.7,
    } = body;

    // Use max_tokens if provided (OpenAI standard), otherwise fall back to alternatives
    const finalMaxTokens = max_tokens || maxOutputTokens || maxTokens;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        {
          error: 'Messages are required and must be a non-empty array',
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Convert UI messages to model messages format
    const modelMessages: OpenAIMessage[] = messages.map(
      (msg: OpenAIMessage) => {
        // Handle both old format (content) and new format (parts)
        if (msg.parts && Array.isArray(msg.parts)) {
          // Convert parts array to content string for model
          const textParts = msg.parts
            .filter((part: MessagePart) => part.type === 'text')
            .map((part: MessagePart) => part.text)
            .join('\n');

          const result: any = {
            role: msg.role,
            content: textParts || msg.content || '',
          };

          // Only include tool_calls and tool_call_id if they have actual values
          if (msg.tool_calls) {
            result.tool_calls = msg.tool_calls;
          }
          if (msg.tool_call_id) {
            result.tool_call_id = msg.tool_call_id;
          }

          return result;
        }

        const result: any = {
          role: msg.role,
          content: msg.content || '',
        };

        // Only include tool_calls and tool_call_id if they have actual values
        if (msg.tool_calls) {
          result.tool_calls = msg.tool_calls;
        }
        if (msg.tool_call_id) {
          result.tool_call_id = msg.tool_call_id;
        }

        return result;
      }
    );

    console.log('📨 Chat history:', modelMessages);

    // Validate tool call sequences
    const validationError = validateToolCallSequence(modelMessages);
    if (validationError) {
      return NextResponse.json(
        {
          error: `Invalid message sequence: ${validationError}`,
          details:
            'Tool calls must be followed by corresponding tool responses before the next user message.',
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Initialize Vertex AI
    let vertexAI: VertexAI;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      const credentialsJson = Buffer.from(
        process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
        'base64'
      ).toString('utf-8');
      const credentials = JSON.parse(credentialsJson);

      vertexAI = new VertexAI({
        project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
        location: process.env.VERTEX_AI_LOCATION || 'us-central1',
        googleAuthOptions: {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
        },
      });
    } else {
      throw new Error(
        'GOOGLE_APPLICATION_CREDENTIALS_BASE64 environment variable is required'
      );
    }

    // Convert tools to Vertex AI format if provided
    let functionDeclarations: FunctionDeclaration[] = [];
    if (
      tools &&
      (Array.isArray(tools) ? tools.length > 0 : Object.keys(tools).length > 0)
    ) {
      functionDeclarations = convertToolsToVertexAI(tools);
    }

    // Create and return streaming response
    return createStreamingResponse(
      vertexAI,
      model,
      modelMessages,
      functionDeclarations,
      temperature,
      finalMaxTokens
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error('\n🚨 === AI CHAT REQUEST FAILED ===');
    console.error('❌ Error type:', err?.constructor?.name || 'Unknown');
    console.error('❌ Error message:', err?.message || String(error));
    console.error('❌ Stack trace:', err?.stack);

    return NextResponse.json(
      {
        error: 'Failed to generate response',
        details: err?.message || String(error),
        errorType: err?.constructor?.name || 'Unknown',
        timestamp: new Date().toISOString(),
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// GET endpoint for health check
export async function GET(request: NextRequest) {
  try {
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Please provide valid credentials.' },
        { status: 401, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        message: 'OpenAI-Compatible AI Chat API',
        format: 'OpenAI API Compatible (Vertex AI Backend)',
        availableModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        compatibility: {
          openai_api: 'Full compatibility with OpenAI client libraries',
          streaming: 'Server-Sent Events with OpenAI chunk format',
          tools: 'OpenAI function calling format supported',
        },
        endpoints: {
          chat: {
            method: 'POST',
            description: 'OpenAI-compatible chat completions with streaming',
            parameters: {
              messages:
                'array (required) - OpenAI format conversation messages',
              model:
                'string (optional) - Model name, default: gemini-2.5-flash',
              max_tokens:
                'number (optional) - Maximum tokens (OpenAI format), default: 1000',
              temperature: 'number (optional) - Temperature 0-1, default: 0.7',
              stream: 'boolean (optional) - Enable streaming, default: true',
              tools: 'array (optional) - OpenAI function calling format',
              tool_choice:
                'string|object (optional) - OpenAI tool choice format',
            },
            response_format: 'OpenAI streaming chunks with Server-Sent Events',
            example_tools: [
              {
                type: 'function',
                function: {
                  name: 'get_weather',
                  description: 'Get weather information',
                  parameters: {
                    type: 'object',
                    properties: {
                      location: { type: 'string', description: 'City name' },
                    },
                    required: ['location'],
                  },
                },
              },
            ],
          },
        },
        authentication: {
          method: 'Bearer token or Basic auth',
          note: 'Include Authorization header with your API password',
        },
      },
      { headers: corsHeaders }
    );
  } catch (error: unknown) {
    console.error('AI API Health Check Error:', error);
    return NextResponse.json(
      {
        error: 'Health check failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
