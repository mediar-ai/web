import { NextResponse } from 'next/server';
import { getWorkflowDiscovery } from '@/lib/mcp/workflowDiscovery';

export async function GET() {
  try {
    // Test database connectivity by attempting to discover workflows
    const discovery = getWorkflowDiscovery();
    const workflows = await discovery.discoverWorkflows();
    
    return NextResponse.json({
      status: 'healthy',
      server: 'Workflow Automation MCP Server',
      version: '1.0.0',
      initialized: true,
      workflows_count: workflows.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[FIX] [MCP Health] Health check failed:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      server: 'Workflow Automation MCP Server',
      version: '1.0.0',
      initialized: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
} 