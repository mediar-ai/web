import { VertexAI } from '@google-cloud/vertexai';
import { NextRequest, NextResponse } from 'next/server';

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
function cleanSchemaForVertexAI(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {},
    };
  }

  // Create clean schema with only Vertex AI supported fields
  const cleanSchema: any = {
    type: schema.type || 'object',
  };

  // Add properties if they exist
  if (schema.properties && typeof schema.properties === 'object') {
    cleanSchema.properties = {};

    // Recursively clean each property
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      cleanSchema.properties[propName] = cleanSchemaForVertexAI(propSchema);
    }
  }

  // Add required array if it exists
  if (Array.isArray(schema.required)) {
    cleanSchema.required = schema.required;
  }

  // Add description if it exists
  if (schema.description) {
    cleanSchema.description = schema.description;
  }

  // Add enum if it exists
  if (Array.isArray(schema.enum)) {
    cleanSchema.enum = schema.enum;
  }

  // Add format if it exists (for string types)
  if (schema.format) {
    cleanSchema.format = schema.format;
  }

  // Add items for array types
  if (schema.type === 'array' && schema.items) {
    cleanSchema.items = cleanSchemaForVertexAI(schema.items);
  }

  // Remove all unsupported fields (they're just not added)
  // Unsupported: $schema, title, definitions, $ref, additionalProperties, etc.

  return cleanSchema;
}

// Convert tools format (OpenAI or MCP) to Vertex AI function declarations
function convertToolsToVertexAI(tools: any) {
  if (!tools) {
    return [];
  }

  const functionDeclarations = [];

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
          parameters: cleanedSchema,
        });
      }
    }
  }
  // Handle legacy MCP tools format (object with tool names as keys)
  else if (typeof tools === 'object') {
    for (const [toolName, mcpTool] of Object.entries(tools)) {
      if (typeof mcpTool === 'object' && mcpTool !== null) {
        const tool = mcpTool as any;

        // Clean the input schema to remove Vertex AI incompatible fields
        const cleanedSchema = cleanSchemaForVertexAI(
          tool.inputSchema || tool.parameters || {}
        );

        functionDeclarations.push({
          name: toolName,
          description: tool.description || `Execute ${toolName} tool`,
          parameters: cleanedSchema,
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
  messages: any[],
  functionDeclarations: any[],
  toolResults?: any[],
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
              role: 'user',
              parts: [{ text: msg.content }],
            };
          } else if (msg.role === 'model' || msg.role === 'assistant') {
            const parts = [];

            // Add text content if present
            if (msg.content) {
              parts.push({ text: msg.content });
            }

            // Add function calls if present
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
          } else if (msg.role === 'function') {
            // Handle function responses
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
          return {
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content || '' }],
          };
        });

        const lastMessage = messages[messages.length - 1];

        // Start chat session
        const chat = generativeModel.startChat({
          history: chatHistory,
        });

        let result;

        // If we have tool results, continue with function responses
        if (toolResults && toolResults.length > 0) {
          // For continuation with tool results, we need to add the function calls to the chat history
          // and then send the function responses as a new message

          // First, add the function calls to chat history
          const functionCallParts = toolResults.map(toolResult => ({
            functionCall: {
              name: toolResult.toolName,
              args: toolResult.args || {},
            },
          }));

          // Add the function calls as a model message to the history
          const functionCallMessage = {
            role: 'model' as const,
            parts: functionCallParts,
          };

          // Create a new chat with the updated history
          const updatedHistory = [...chatHistory, functionCallMessage];
          const updatedChat = generativeModel.startChat({
            history: updatedHistory,
          });

          // Create function response parts
          const functionResponseParts = toolResults.map(toolResult => ({
            functionResponse: {
              name: toolResult.toolName,
              response: { result: JSON.stringify(toolResult.result) },
            },
          }));

          // Now send the function responses
          result = await updatedChat.sendMessageStream(functionResponseParts);
        } else {
          // Normal user message
          const userMessage = lastMessage.content;
          result = await chat.sendMessageStream(userMessage);
        }

        let fullText = '';
        const functionCalls: any[] = [];

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
                functionCalls.push(part.functionCall);

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
        const finishReason =
          functionCalls.length > 0 && (!toolResults || toolResults.length === 0)
            ? 'tool_calls'
            : 'stop';

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
      tools, // OpenAI format instead of mcpTools
      tool_choice, // OpenAI format
      max_tokens = 1000, // OpenAI format (underscore)
      maxTokens = 1000, // Keep backwards compatibility
      maxOutputTokens = 1000, // Keep Vertex AI compatibility
      temperature = 0.7,
      stream = true, // OpenAI format
      // Internal fields for continuation (hidden from OpenAI compatibility)
      _toolResults, // Prefix with _ to indicate internal
      _mcpTools, // Legacy support
    } = body;

    // Use max_tokens if provided (OpenAI standard), otherwise fall back to alternatives
    const finalMaxTokens = max_tokens || maxOutputTokens || maxTokens;

    console.log('🚀 === NEW AI CHAT REQUEST ===');
    console.log('📝 Chat request received:', {
      messageCount: messages ? messages.length : 0,
      model,
      isToolContinuation: !!_toolResults,
    });

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        {
          error: 'Messages are required and must be a non-empty array',
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Convert UI messages to model messages format
    const modelMessages = messages.map((msg: any) => {
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

    console.log('📨 Converted messages for model:', modelMessages.length);

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
    let functionDeclarations: any[] = [];
    if (
      tools &&
      (Array.isArray(tools) ? tools.length > 0 : Object.keys(tools).length > 0)
    ) {
      functionDeclarations = convertToolsToVertexAI(tools);
    }

    // Add system message to encourage tool usage when tools are available
    let enhancedMessages = modelMessages;
    if (
      functionDeclarations.length > 0 &&
      (!_toolResults || _toolResults.length === 0)
    ) {
      const toolNames = functionDeclarations.map(f => f.name);
      // System prompt to guide behavior
      const systemMessage = {
        role: 'system',
        content: `You are an AI assistant with access to powerful tools for automating desktop workflows and UI interactions. You have access to these tools: ${toolNames.join(', ')}.

**Multi-Step Tool Usage Guidelines:**
- Break complex tasks into logical steps
- Use tools sequentially when needed (e.g., first get applications, then interact with specific windows)
- Always get current UI state before making UI interactions
- For app automation: first get applications → open/focus app → get window tree → perform actions
- For text input: first validate the target element exists and is visible
- Explain your reasoning and next steps clearly

**Examples of Multi-Step Workflows:**
1. "Open Cursor and type text" → get_applications() → open_application() → get_window_tree() → type_into_element()
2. "Take screenshot then analyze UI" → take_screenshot() → get_window_tree() → analyze elements
3. "Find and click button" → get_window_tree() → validate element → click_element()

For screenshot requests, use "desktop" as the selector for full desktop screenshots.`,
      };

      // Add system message at the beginning
      enhancedMessages = [systemMessage, ...modelMessages];
    }

    // Create and return streaming response
    return createStreamingResponse(
      vertexAI,
      model,
      enhancedMessages,
      functionDeclarations,
      _toolResults, // Pass tool results for continuation
      temperature,
      finalMaxTokens
    );
  } catch (error: any) {
    console.error('\n🚨 === AI CHAT REQUEST FAILED ===');
    console.error('❌ Error type:', error?.constructor?.name || 'Unknown');
    console.error('❌ Error message:', error?.message || String(error));
    console.error('❌ Stack trace:', error?.stack);

    return NextResponse.json(
      {
        error: 'Failed to generate response',
        details: error?.message || String(error),
        errorType: error?.constructor?.name || 'Unknown',
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
