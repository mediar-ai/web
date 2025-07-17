import { createClient } from '@supabase/supabase-js';
import type { WorkflowRecord, CachedTool, JSONSchemaProperty } from './types';
import { generateToolFromWorkflow } from './toolGenerator';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase configuration for MCP server');
}

// Use service key for full database access
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export class WorkflowDiscovery {
  private toolsCache = new Map<string, CachedTool>();
  private lastRefresh = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds

  async discoverWorkflows(): Promise<WorkflowRecord[]> {
    console.log('🔧 [MCP] Discovering workflows from database...');
    
    const { data: workflows, error } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('*')
      .eq('status', 'deployed')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('🔧 [MCP] Error fetching workflows:', error);
      throw new Error(`Failed to fetch workflows: ${error.message}`);
    }

    console.log(`🔧 [MCP] Found ${workflows?.length || 0} workflows`);
    return workflows || [];
  }

  async getTools(): Promise<Map<string, CachedTool>> {
    // Return cached tools if still fresh
    const now = Date.now();
    if (this.toolsCache.size > 0 && (now - this.lastRefresh) < this.CACHE_TTL) {
      return this.toolsCache;
    }

    // Refresh tools
    await this.refreshTools();
    return this.toolsCache;
  }

  async refreshTools(): Promise<void> {
    console.log('🔧 [MCP] Refreshing workflow tools...');
    
    try {
      const workflows = await this.discoverWorkflows();
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
          console.log(`🔧 [MCP] Generated tool: ${tool.name} (workflow ${workflow.id})`);
        } catch (error) {
          console.error(`🔧 [MCP] Failed to generate tool for workflow ${workflow.id}:`, error);
        }
      }

      this.toolsCache = newToolsCache;
      this.lastRefresh = Date.now();
      
      console.log(`🔧 [MCP] Processed ${this.toolsCache.size} workflow tools`);
    } catch (error) {
      console.error('🔧 [MCP] Error refreshing tools:', error);
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