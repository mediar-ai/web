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

    let sessionId: string | null = null;

    // Simple JSON-RPC implementation that matches what the Python executor does
    const sendRequest = async (method: string, params: any, id?: number) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      };

      // Add session ID if we have one
      if (sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
      }

      const body: any = {
        jsonrpc: '2.0',
        method,
        params
      };

      // Only add ID for requests (not notifications)
      if (id !== undefined) {
        body.id = id;
      }

      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`MCP request failed (${response.status}): ${text}`);
      }

      // Extract session ID from headers if present
      const newSessionId = response.headers.get('Mcp-Session-Id');
      if (newSessionId) {
        sessionId = newSessionId;
        logs.push(`Got MCP session ID: ${sessionId}`);
      }

      // Handle SSE response format from Azure MCP servers
      const text = await response.text();

      // Check if it's SSE format (starts with "data: ")
      if (text.startsWith('data: ')) {
        // Parse SSE data
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6); // Remove "data: " prefix
            try {
              return JSON.parse(jsonStr);
            } catch (e) {
              // Continue to next line if parse fails
            }
          }
        }
        throw new Error('No valid JSON found in SSE response');
      }

      // For notifications (no response expected), return empty object
      if (id === undefined && text.trim() === '') {
        return {};
      }

      // Otherwise parse as regular JSON
      return JSON.parse(text);
    };

    // Step 1: Initialize MCP session
    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: false },
        sampling: {}
      },
      clientInfo: {
        name: 'browser-workflow-executor',
        version: '1.0.0'
      }
    }, 1);

    if (initResult.error) {
      throw new Error(`MCP initialization error: ${initResult.error.message || JSON.stringify(initResult.error)}`);
    }

    logs.push('MCP session initialized');

    // Step 1.5: Send initialized notification (required by MCP protocol)
    logs.push('Sending initialized notification...');
    await sendRequest('notifications/initialized', {}); // No ID for notifications
    logs.push('Initialized notification sent');

    // Prepare the workflow steps
    let steps = workflowData.automation_sequence || workflowData.steps || [];

    // Ensure steps is an array
    if (!Array.isArray(steps)) {
      steps = [steps];
    }

    logs.push(`Executing workflow with ${steps.length} steps`);

    // Step 2: Call the execute_sequence tool
    // The tool expects the arguments in a specific format
    const executeResult = await sendRequest('tools/call', {
      name: 'execute_sequence',
      arguments: {
        steps: steps,
        inputs: executionParams || {},
        verbosity: 'normal'
      }
    }, 3); // ID 3 since we used 1 for initialize

    if (executeResult.error) {
      throw new Error(`Workflow execution error: ${executeResult.error.message || JSON.stringify(executeResult.error)}`);
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
        .from('remote_machines')
        .select('mcp_endpoint')
        .eq('id', execution.assigned_machine_id)
        .single();

      if (machine?.mcp_endpoint) {
        mcpEndpoint = machine.mcp_endpoint;
      }
    }

    // If still no endpoint, use a default or skip
    if (!mcpEndpoint) {
      // Try to get any available Azure VM machine (prefer Load Balancer)
      const { data: anyMachine } = await supabase
        .from('remote_machines')
        .select('id, mcp_endpoint')
        .eq('status', 'active')
        .in('id', [4, 6, 7]) // Azure VM Desktop Balancer and Clean VMSS LB
        .limit(1)
        .single();

      if (anyMachine?.mcp_endpoint) {
        mcpEndpoint = anyMachine.mcp_endpoint;

        // Update the execution to assign this machine
        await supabase
          .from('workflow_executions')
          .update({
            assigned_machine_id: anyMachine.id,
            mcp_endpoint: anyMachine.mcp_endpoint
          })
          .eq('id', execution.id);
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