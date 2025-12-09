import { NextRequest, NextResponse } from 'next/server';
import { WorkflowDiscovery } from '@/lib/mcp/workflowDiscovery';
import { ExecutionHandler } from '@/lib/mcp/executionHandler';

// Initialize handlers
const workflowDiscovery = new WorkflowDiscovery();
const executionHandler = new ExecutionHandler();

// Handle MCP requests via HTTP POST
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[FIX] [MCP API] Received request:', body.method);

    // Get user's organization context for filtering (middleware already authenticated)
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { orgId, isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    if (!orgId) {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32600,
          message: 'No organization context - authentication required'
        }
      }, { status: 401 });
    }

    // Handle different MCP methods
    switch (body.method) {
      case 'initialize':
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {
                listChanged: true
              }
            },
            serverInfo: {
              name: 'Workflow Automation MCP Server',
              version: '1.0.0'
            }
          }
        });

      case 'tools/list':
        // Pass org context to workflow discovery for filtering
        await workflowDiscovery.refreshTools(orgId, isMediarOrg, isMediarAdmin);
        const tools = workflowDiscovery.getToolsList();
        console.log('[FIX] [MCP API] Serving', tools.length, 'workflow tools for org:', orgId);
        
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: tools
          }
        });

      case 'tools/call':
        const { name, arguments: toolArgs } = body.params;
        console.log('[FIX] [MCP API] Executing tool:', name, 'with args:', toolArgs);
        
        // Ensure tools cache is populated first
        await workflowDiscovery.getTools();
        
        // Get the cached tool from discovery
        const cachedTool = workflowDiscovery.getTool(name);
        if (!cachedTool) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32602,
              message: `Tool not found: ${name}`
            }
          }, { status: 404 });
        }
        
        const result = await executionHandler.executeWorkflowTool(name, toolArgs || {}, cachedTool);
        
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          }
        });

      case 'notifications/initialized':
        // Client notification that initialization is complete
        console.log('[FIX] [MCP API] Client initialized successfully');
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {}
        });

      default:
        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: -32601,
            message: `Method not found: ${body.method}`
          }
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[FIX] [MCP API] Error:', error);
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
} 