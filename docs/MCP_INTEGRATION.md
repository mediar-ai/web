# MCP Integration with AI SDK

This document explains how to integrate Model Context Protocol (MCP) with your Next.js backend and Tauri desktop application, following the solution from [Vercel AI SDK Issue #7499](https://github.com/vercel/ai/issues/7499).

## Architecture Overview

```
┌─────────────────┐    SSE    ┌──────────────────┐    AI SDK    ┌─────────────────┐
│  Tauri Desktop  │◄─────────►│ Next.js Backend │◄────────────►│ Vertex AI + LLM │
│                 │  Transport │                  │   with Tools │                 │
│ • MCP Server    │           │ • MCP Client     │              │ • Text Gen      │
│ • SSE Mode      │           │ • AI SDK v5      │              │ • Tool Calling  │
│ • Local Tools   │           │ • Tool Discovery │              │ • Streaming     │
└─────────────────┘           └──────────────────┘              └─────────────────┘
```

## Key Components

### 1. **AI SDK v5 Beta** (Required)
- Includes `experimental_createMCPClient()`
- Supports SSE transport for MCP servers
- Automatically converts MCP tools to AI SDK tools

### 2. **Enhanced AI Route** (`/api/ai`)
- Connects to MCP servers via SSE
- Retrieves tools dynamically
- Passes tools to `generateText()` or `streamText()`

### 3. **MCP Client Utilities** (`src/lib/mcp/client.ts`)
- Helper functions for MCP connections
- Health checks and discovery
- Multi-server support

## Setup Instructions

### Step 1: Install AI SDK v5 Beta

```bash
bun add ai@beta
```

### Step 2: Configure Your Tauri App

Ensure your Tauri app runs an MCP server in SSE mode. Your MCP server should be accessible at something like:

```
http://localhost:3001/api/mcp  # From your Tauri app
```

### Step 3: Use the Enhanced AI Route

The AI route now accepts these additional parameters:

```typescript
{
  "prompt": "Your prompt here",
  "model": "gemini-2.5-pro",
  "enableTools": true,           // Enable MCP tools
  "mcpServerUrl": "http://localhost:3001/api/mcp",  // Your Tauri MCP server
  "stream": false,
  "temperature": 0.7,
  "maxTokens": 1000
}
```

## Usage Examples

### Basic Tool Usage

```javascript
// From your frontend or another service
const response = await fetch('/api/ai', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-password'
  },
  body: JSON.stringify({
    prompt: "Use the workflow tools to get me an insurance quote",
    enableTools: true,
    mcpServerUrl: "http://localhost:3001/api/mcp",
    model: "gemini-2.5-pro"
  })
});

const result = await response.json();
console.log(result.text);
console.log(result.toolCalls);  // Shows which tools were used
console.log(result.mcpToolsUsed);  // Lists available tools
```

### Streaming with Tools

```javascript
const response = await fetch('/api/ai', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-password'
  },
  body: JSON.stringify({
    prompt: "Generate an insurance quote using available tools",
    enableTools: true,
    mcpServerUrl: "http://localhost:3001/api/mcp",
    stream: true
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      
      try {
        const parsed = JSON.parse(data);
        if (parsed.text) {
          console.log('Text chunk:', parsed.text);
        }
        if (parsed.type === 'tool_call') {
          console.log('Tool call:', parsed.toolCall);
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
  }
}
```

### Multiple MCP Servers

```typescript
import { createMultipleMCPClients } from '@/lib/mcp/client';

// Connect to multiple MCP servers
const mcpConfigs = [
  { url: 'http://localhost:3001/api/mcp' },  // Tauri app
  { url: 'http://localhost:3002/api/mcp' },  // Another service
];

const { tools, clients } = await createMultipleMCPClients(mcpConfigs);

// Use merged tools with AI SDK
const result = await generateText({
  model: vertexModel,
  tools,
  messages: [{ role: 'user', content: 'Use any available tools' }]
});
```

## Architecture Benefits

### 1. **Clean Separation**
- Tauri app handles local system integration
- Next.js backend handles AI orchestration
- No serialization plumbing needed

### 2. **Dynamic Tool Discovery**
- Tools are discovered at runtime
- No manual tool registration required
- Automatic tool conversion from MCP to AI SDK format

### 3. **Scalable Design**
- Support for multiple MCP servers
- Health checks and fallbacks
- Easy to add new tool sources

### 4. **Type Safety**
- TypeScript interfaces for all components
- Proper error handling and cleanup
- Resource management for MCP connections

## Configuration Options

### Environment Variables

```bash
# AI API Configuration
AI_API_PASSWORD=your-secret-password
GOOGLE_APPLICATION_CREDENTIALS_BASE64=your-base64-credentials
GOOGLE_CLOUD_PROJECT=your-project-id
VERTEX_AI_LOCATION=us-central1

# MCP Configuration (optional defaults)
DEFAULT_MCP_SERVER_URL=http://localhost:3001/api/mcp
MCP_CONNECTION_TIMEOUT=5000
```

### Request Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enableTools` | boolean | false | Enable MCP tool integration |
| `mcpServerUrl` | string | undefined | URL of MCP server (required if enableTools=true) |
| `prompt` | string | required | The user prompt |
| `model` | string | "gemini-2.5-pro" | AI model to use |
| `stream` | boolean | false | Enable streaming response |
| `temperature` | number | 0.7 | AI creativity level |
| `maxTokens` | number | 1000 | Maximum response tokens |
| `systemPrompt` | string | undefined | System instructions |

## Error Handling

The implementation includes comprehensive error handling:

```typescript
// MCP connection errors
if (mcpServerUrl && enableTools) {
  try {
    const mcpResult = await getMCPTools(mcpServerUrl);
    // Use tools...
  } catch (error) {
    // Falls back to no tools, continues with AI generation
    console.error('MCP connection failed:', error.message);
  }
}
```

### Common Issues and Solutions

1. **MCP Server Not Available**
   - Solution: The AI route continues without tools
   - Check: Ensure your Tauri app MCP server is running

2. **Tool Execution Failures**
   - Solution: AI SDK handles tool errors gracefully
   - Check: Verify tool implementation in MCP server

3. **Connection Timeouts**
   - Solution: Configure appropriate timeout values
   - Check: Network connectivity between services

## Next Steps

1. **Test the Integration**: Use the examples above to test tool calling
2. **Monitor Performance**: Check tool execution times and success rates
3. **Add More Tools**: Extend your Tauri MCP server with additional tools
4. **Production Setup**: Add proper authentication and rate limiting

## Related Files

- `/src/app/api/ai/route.ts` - Enhanced AI route with MCP support
- `/src/lib/mcp/client.ts` - MCP client utilities
- `/src/lib/mcp/types.ts` - Type definitions
- `/src/lib/mcp/CLIENT_SETUP.md` - Original MCP server setup

## References

- [Vercel AI SDK Issue #7499](https://github.com/vercel/ai/issues/7499)
- [AI SDK v5 MCP Documentation](https://sdk.vercel.ai/docs/reference/ai-sdk-core/create-mcp-client)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/) 