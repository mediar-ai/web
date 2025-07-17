# MCP Client Setup Guide

Your Workflow Automation MCP Server supports **both HTTP and SSE transports** for maximum compatibility with different MCP clients.

## Transport Options

### Option 1: HTTP Transport (Recommended)
Best for: Simple request/response, easier debugging, most compatible

```json
{
  "mcpServers": {
    "workflow-automation": {
      "url": "http://localhost:3000/api/mcp",
      "enabled": true
    }
  }
}
```

### Option 2: SSE Transport 
Best for: Real-time streaming, persistent connections, server-push notifications

```json
{
  "mcpServers": {
    "workflow-automation": {
      "transport": "sse",
      "url": "http://localhost:3000/api/mcp",
      "enabled": true
    }
  }
}
```

## Available Endpoints

### HTTP Transport
- **POST** `/api/mcp` - All MCP operations (initialize, tools/list, tools/call, notifications)

### SSE Transport  
- **GET** `/api/mcp` - Server-Sent Events stream for real-time communication
- **POST** `/api/mcp` - JSON-RPC operations

## Complete Configuration Examples

### Cursor IDE with Multiple MCP Servers
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
      "enabled": true
    },
    "workflow-automation": {
      "url": "http://localhost:3000/api/mcp",
      "enabled": true
    }
  }
}
```

### Claude Desktop Application
```json
{
  "mcpServers": {
    "workflow-automation": {
      "transport": "sse", 
      "url": "http://localhost:3000/api/mcp",
      "enabled": true
    }
  }
}
```

## Server Status

Check if your MCP server is running:

```bash
# Health check
curl http://localhost:3000/api/mcp/health

# Test HTTP transport
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'

# Test SSE transport
curl -N -H "Accept: text/event-stream" http://localhost:3000/api/mcp
```

## Available Tools

Your MCP server automatically discovers workflows from your database and exposes them as tools:

1. **`insurance_best_plan_pro_insurance_quote`** - Complete insurance quote automation
2. **`insurance_set_available_products`** - Product configuration workflow

## Usage Examples

Once configured, you can use natural language with your MCP client:

- *"Get me a life insurance quote for a 30-year-old male in California"*
- *"Set up the insurance products for quoting"*
- *"Generate quotes for someone born 1/15/1985 in Texas"*

The MCP server will automatically map your requests to the appropriate workflow tools and execute them using your existing automation infrastructure.

## Troubleshooting

### MCP Server Not Loading
1. Ensure Next.js dev server is running: `npm run dev`
2. Check server health: `curl http://localhost:3000/api/mcp/health`
3. Verify MCP configuration syntax in your client
4. Restart your MCP client after configuration changes

### Transport Issues
- **HTTP issues**: Check POST requests work with curl
- **SSE issues**: Verify GET endpoint streams events with curl -N
- **Mixed transport**: Some clients auto-detect, others need explicit transport specified

### Authentication
Currently no authentication required. For production deployment, consider adding API key authentication. 