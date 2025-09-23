import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Process workflows in the background using Node.js runtime for MCP SDK compatibility
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

async function executeMCPWorkflow(
  workflowData: any,
  executionParams: any,
  mcpEndpoint: string
): Promise<{ success: boolean; results?: any; error?: string; logs: string[] }> {
  const logs: string[] = [];
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;

  try {
    // Normalize the endpoint
    const endpointBase = mcpEndpoint.replace(/\/+$/, '').replace(/\/mcp$/, '');
    const endpointUrl = `${endpointBase}/mcp`;

    logs.push(`Connecting to MCP endpoint: ${endpointUrl}`);

    // Create MCP client
    client = new Client({
      name: 'browser-workflow-executor',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {}
      }
    });

    // Create transport with the endpoint URL
    transport = new StreamableHTTPClientTransport(
      new URL(endpointUrl)
    );

    // Connect the client
    await client.connect(transport);
    logs.push('MCP client connected');

    // Prepare the steps - ensure it's an array
    let steps = workflowData.steps || workflowData.automation_sequence || [];

    // If steps is a single object, wrap it in an array
    if (!Array.isArray(steps)) {
      steps = [steps];
    }

    logs.push(`Executing ${steps.length} steps`);

    // Call the execute_sequence tool - the MCP server expects the steps directly as arguments
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'execute_sequence',
        arguments: steps
      }
    }, CallToolResultSchema);

    logs.push('Workflow completed successfully');

    // Close the connection
    await transport.close();

    return {
      success: true,
      results: result.content || result,
      logs
    };

  } catch (error) {
    logs.push(`Error: ${error instanceof Error ? error.message : String(error)}`);

    // Clean up on error
    if (transport) {
      try {
        await transport.close();
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      logs
    };
  }
}

export async function POST(_request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get one queued execution (mcp_endpoint might be null, we'll get it from assigned_machine_id)
    const { data: execution } = await supabase
      .from('workflow_executions')
      .select('*, deployed_workflows!inner(*)')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (!execution) {
      // Try to find executions stuck in running state for > 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: stuckExecution } = await supabase
        .from('workflow_executions')
        .select('*, deployed_workflows!inner(*)')
        .eq('status', 'running')
        .lt('started_at', fiveMinutesAgo)
        .order('started_at', { ascending: true })
        .limit(1)
        .single();

      if (!stuckExecution) {
        return NextResponse.json({
          success: true,
          message: 'No workflows to process'
        });
      }

      // Reset stuck execution to queued
      await supabase
        .from('workflow_executions')
        .update({
          status: 'queued',
          started_at: null,
          error_message: 'Reset from stuck state'
        })
        .eq('id', stuckExecution.id);

      return NextResponse.json({
        success: true,
        message: `Reset stuck execution ${stuckExecution.id} to queued`
      });
    }

    // Mark as running
    await supabase
      .from('workflow_executions')
      .update({
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', execution.id);

    const workflow = execution.deployed_workflows;

    // Get MCP endpoint - either from execution or from machines table
    let mcpEndpoint = execution.mcp_endpoint;

    if (!mcpEndpoint && execution.assigned_machine_id) {
      const { data: machine } = await supabase
        .from('machines')
        .select('mcp_endpoint')
        .eq('id', execution.assigned_machine_id)
        .single();

      if (machine?.mcp_endpoint) {
        mcpEndpoint = machine.mcp_endpoint;
      }
    }

    // If still no endpoint, use a default or skip
    if (!mcpEndpoint) {
      // Try to get any available machine
      const { data: anyMachine } = await supabase
        .from('machines')
        .select('mcp_endpoint')
        .eq('is_available', true)
        .limit(1)
        .single();

      if (anyMachine?.mcp_endpoint) {
        mcpEndpoint = anyMachine.mcp_endpoint;
      } else {
        return NextResponse.json({
          success: false,
          message: `No MCP endpoint available for execution ${execution.id}`,
          error: 'No machine available'
        });
      }
    }

    // Prepare workflow data
    const workflowData = {
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
      steps: workflow.automation_sequence || [],
      yaml_content: workflow.yaml_content
    };

    // Execute via MCP
    const result = await executeMCPWorkflow(
      workflowData,
      execution.execution_params || {},
      mcpEndpoint
    );

    // Transform logs to UI format
    const formattedLogs = result.logs.map(log => ({
      timestamp: new Date().toISOString(),
      level: log.includes('Error') ? 'error' : log.includes('success') ? 'success' : 'info',
      message: log
    }));

    if (result.success) {
      // Update execution as completed
      await supabase
        .from('workflow_executions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          execution_logs: formattedLogs,
          results: result.results || {
            success: true,
            message: 'Workflow executed successfully',
            data: result.results
          }
        })
        .eq('id', execution.id);

      return NextResponse.json({
        success: true,
        message: `Completed execution ${execution.id}`,
        execution_id: execution.id
      });
    } else {
      // Mark as failed
      await supabase
        .from('workflow_executions')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: result.error,
          execution_logs: formattedLogs
        })
        .eq('id', execution.id);

      return NextResponse.json({
        success: false,
        message: `Failed execution ${execution.id}`,
        error: result.error,
        execution_id: execution.id
      });
    }

  } catch (error) {
    console.error('Workflow processor error:', error);
    return NextResponse.json({
      success: false,
      error: 'Processing error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// GET endpoint to check processor status
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Count queued workflows
    const { count: queuedCount } = await supabase
      .from('workflow_executions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'queued');

    // Count running workflows
    const { count: runningCount } = await supabase
      .from('workflow_executions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'running');

    return NextResponse.json({
      success: true,
      status: 'ready',
      queued: queuedCount || 0,
      running: runningCount || 0,
      processor: 'nextjs-edge-runtime'
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}