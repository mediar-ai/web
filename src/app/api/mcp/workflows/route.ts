import { NextResponse } from 'next/server';
import { getWorkflowDiscovery } from '@/lib/mcp/workflowDiscovery';

export async function GET() {
  try {
    const discovery = getWorkflowDiscovery();
    await discovery.refreshTools(); // Ensure fresh data
    
    const toolsMap = await discovery.getTools();
    const workflows = Array.from(toolsMap.values()).map(cachedTool => ({
      name: cachedTool.tool.name,
      description: cachedTool.tool.description,
      workflow_id: cachedTool.tool.metadata?.workflow_id,
      category: cachedTool.workflow.category,
      parameters: Object.keys(cachedTool.tool.inputSchema.properties || {}).length,
      estimated_duration_seconds: cachedTool.tool.metadata?.estimated_duration_seconds,
      last_updated: cachedTool.lastUpdated,
      // Add parameter details for debugging
      parameter_names: Object.keys(cachedTool.tool.inputSchema.properties || {}),
    }));

    return NextResponse.json({ 
      workflows, 
      count: workflows.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[FIX] [MCP Workflows] Error listing workflows:', error);
    
    return NextResponse.json({ 
      error: 'Failed to list workflows',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 