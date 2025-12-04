import { createClient } from '@supabase/supabase-js';
import type { WorkflowRecord, CachedTool, JSONSchemaProperty } from './types';
import { generateToolFromWorkflow } from './toolGenerator';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase configuration for MCP server');
}

// Use service key for full database access
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export class WorkflowDiscovery {
  private toolsCache = new Map<string, CachedTool>();
  private lastRefresh = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds

  async discoverWorkflows(orgId?: string, isMediarOrg?: boolean, isMediarAdmin?: boolean): Promise<WorkflowRecord[]> {
    console.log('[FIX] [MCP] Discovering workflows from database...');
    
    // If no org context provided, return empty (fail-safe)
    if (!orgId) {
      console.warn('[FIX] [MCP] No org context - returning empty workflow list');
      return [];
    }

    // Get accessible workflow IDs based on org permissions
    let accessibleWorkflowIds: number[] = [];

    if (isMediarOrg || isMediarAdmin) {
      // Mediar sees all workflows
      const { data: allWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id');
      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
      console.log(`[FIX] [MCP] Mediar/Admin - accessing ${accessibleWorkflowIds.length} workflows`);
    } else {
      // Regular org sees only their workflows and shared workflows
      const { data: ownedWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('organization_id', orgId);

      const { data: sharedAccess } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id')
        .eq('organization_id', orgId);

      const ownedIds = (ownedWorkflows || []).map(w => w.id);
      const sharedIds = (sharedAccess || []).map(a => a.workflow_id);
      accessibleWorkflowIds = [...new Set([...ownedIds, ...sharedIds])];
      console.log(`[FIX] [MCP] Org ${orgId} - accessing ${accessibleWorkflowIds.length} workflows (owned: ${ownedIds.length}, shared: ${sharedIds.length})`);
    }

    if (accessibleWorkflowIds.length === 0) {
      console.log('[FIX] [MCP] No accessible workflows for org:', orgId);
      return [];
    }

    // Fetch only workflows user has access to
    const { data: workflows, error } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('*')
      .in('id', accessibleWorkflowIds)
      .eq('status', 'deployed')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[FIX] [MCP] Error fetching workflows:', error);
      throw new Error(`Failed to fetch workflows: ${error.message}`);
    }

    console.log(`[FIX] [MCP] Found ${workflows?.length || 0} accessible workflows for org: ${orgId}`);
    return workflows || [];
  }

  async getTools(orgId?: string, isMediarOrg?: boolean, isMediarAdmin?: boolean): Promise<Map<string, CachedTool>> {
    // Return cached tools if still fresh
    const now = Date.now();
    if (this.toolsCache.size > 0 && (now - this.lastRefresh) < this.CACHE_TTL) {
      return this.toolsCache;
    }

    // Refresh tools with org filtering
    await this.refreshTools(orgId, isMediarOrg, isMediarAdmin);
    return this.toolsCache;
  }

  async refreshTools(orgId?: string, isMediarOrg?: boolean, isMediarAdmin?: boolean): Promise<void> {
    console.log('[FIX] [MCP] Refreshing workflow tools for org:', orgId);
    
    try {
      const workflows = await this.discoverWorkflows(orgId, isMediarOrg, isMediarAdmin);
      const newToolsCache = new Map<string, CachedTool>();

      for (const workflow of workflows) {
        try {
          const tool = await generateToolFromWorkflow(workflow);
          const cachedTool: CachedTool = {
            tool,
            workflow,
            lastUpdated: Date.now()
          };
          
          newToolsCache.set(tool.name, cachedTool);
          console.log(`[FIX] [MCP] Generated tool: ${tool.name} (workflow ${workflow.id})`);
        } catch (error) {
          console.error(`[FIX] [MCP] Failed to generate tool for workflow ${workflow.id}:`, error);
        }
      }

      this.toolsCache = newToolsCache;
      this.lastRefresh = Date.now();
      
      console.log(`[FIX] [MCP] Processed ${this.toolsCache.size} workflow tools`);
    } catch (error) {
      console.error('[FIX] [MCP] Error refreshing tools:', error);
      throw error;
    }
  }

  getTool(name: string): CachedTool | undefined {
    return this.toolsCache.get(name);
  }

  getToolsList(): Array<{ name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, JSONSchemaProperty>; required?: string[] } }> {
    return Array.from(this.toolsCache.values()).map(cachedTool => ({
      name: cachedTool.tool.name,
      description: cachedTool.tool.description,
      inputSchema: cachedTool.tool.inputSchema,
    }));
  }
}

// Singleton instance for Next.js
let discoveryInstance: WorkflowDiscovery | null = null;

export function getWorkflowDiscovery(): WorkflowDiscovery {
  if (!discoveryInstance) {
    discoveryInstance = new WorkflowDiscovery();
  }
  return discoveryInstance;
} 