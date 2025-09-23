import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Process workflows in the background using edge runtime for long-running tasks
export const runtime = 'edge';
export const maxDuration = 300; // 5 minutes max

async function executeMCPWorkflow(
  workflowData: any,
  executionParams: any,
  mcpEndpoint: string
): Promise<{ success: boolean; results?: any; error?: string; logs: string[] }> {
  const logs: string[] = [];

  try {
    // Normalize the endpoint
    const endpointBase = mcpEndpoint.replace(/\/+$/, '').replace(/\/mcp$/, '');
    const endpointUrl = `${endpointBase}/mcp`;

    logs.push(`Connecting to MCP endpoint: ${endpointUrl}`);

    // Helper to send JSON-RPC requests
    const sendRequest = async (method: string, params: any, id: number) => {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
          id
        })
      });

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    };

    // Step 1: Initialize MCP session
    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        prompts: {},
        resources: {}
      },
      clientInfo: {
        name: 'browser-workflow-executor',
        version: '1.0.0'
      }
    }, 1);

    if (initResult.error) {
      throw new Error(`MCP initialization error: ${initResult.error.message}`);
    }

    logs.push('MCP session initialized');

    // Step 2: Execute the workflow
    const executeResult = await sendRequest('tools/call', {
      name: 'execute_sequence',
      arguments: {
        steps: workflowData.steps || workflowData.automation_sequence || [],
        inputs: executionParams || {},
        verbosity: 'normal'
      }
    }, 2);

    if (executeResult.error) {
      throw new Error(`Workflow execution error: ${executeResult.error.message}`);
    }

    logs.push('Workflow completed successfully');

    return {
      success: true,
      results: executeResult.result || executeResult,
      logs
    };

  } catch (error) {
    logs.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
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

    // Get one queued execution with assigned machine
    const { data: execution } = await supabase
      .from('workflow_executions')
      .select('*, deployed_workflows!inner(*)')
      .eq('status', 'queued')
      .not('mcp_endpoint', 'is', null)
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
        .not('mcp_endpoint', 'is', null)
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
      execution.mcp_endpoint
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