import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowDiscovery } from '@/lib/mcp/workflowDiscovery';

export async function GET(_request: NextRequest) {
  try {
    // Get user's organization context (optional for health check)
    let orgId: string | null = null;
    let isMediarOrg = false;
    let isMediarAdmin = false;
    
    try {
      const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
      const orgContext = await getEffectiveOrgId(null);
      orgId = orgContext.orgId;
      isMediarOrg = orgContext.isMediarOrg;
      isMediarAdmin = orgContext.isMediarAdmin;
    } catch (e) {
      // Auth not available - health check will show 0 workflows
      console.log('[FIX] [MCP Health] No auth context available');
    }

    // Test database connectivity by attempting to discover workflows
    const discovery = getWorkflowDiscovery();
    const workflows = orgId 
      ? await discovery.discoverWorkflows(orgId, isMediarOrg, isMediarAdmin)
      : [];
    
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