import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Fallback endpoints if Supabase is not available
const FALLBACK_ENDPOINTS = [
  { id: 4, name: 'Azure Load Balancer', mcp_endpoint: 'http://172.203.20.145:8080' },
];

interface VMStatus {
  id: string;
  name: string;
  endpoint: string;
  status: 'online' | 'offline' | 'busy';
  lastSeen: string;
  activeWorkflows: number;
  health?: {
    cpu?: number;
    memory?: number;
    uptime?: number;
  };
  lastError?: string;
  recentLogs?: string[];
}

async function checkVMHealth(vm: any): Promise<VMStatus> {
  const endpoint = vm.mcp_endpoint || vm.endpoint;
  const id = vm.id?.toString() || 'unknown';
  const name = vm.name || 'Unknown VM';
  
  try {
    // Parse endpoint to handle different formats
    const url = new URL(endpoint);
    const healthUrl = `${url.protocol}//${url.host}/health`;
    
    // Try to hit the health endpoint
    const healthResponse = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
      headers: {
        'ngrok-skip-browser-warning': 'true', // For ngrok endpoints
      },
    });

    const healthData = await healthResponse.json();

    // Try to get status for active workflows
    let statusData: any = {};
    try {
      const statusUrl = `${url.protocol}//${url.host}/status`;
      const statusResponse = await fetch(statusUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
        headers: {
          'ngrok-skip-browser-warning': 'true',
        },
      });
      statusData = await statusResponse.json();
    } catch {
      // Status endpoint might not exist
    }

    return {
      id,
      name,
      endpoint,
      status: statusData.busy ? 'busy' : 'online',
      lastSeen: new Date().toISOString(),
      activeWorkflows: statusData.activeRequests || 0,
      health: {
        cpu: Math.random() * 100, // Will be replaced with actual metrics from telemetry_metrics
        memory: Math.random() * 8192,
        uptime: healthData.uptime || 0,
      },
      recentLogs: [],
    };
  } catch (error) {
    return {
      id,
      name,
      endpoint,
      status: 'offline',
      lastSeen: new Date().toISOString(),
      activeWorkflows: 0,
      lastError: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    // Get VM endpoints from Supabase remote_machines table
    let vmEndpoints = FALLBACK_ENDPOINTS;
    
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      // Fetch active machines from database
      const { data: machines, error: machineError } = await supabase
        .from('remote_machines')
        .select('id, name, mcp_endpoint, status, region, machine_type')
        .eq('status', 'active')
        .order('priority', { ascending: true });
      
      if (!machineError && machines && machines.length > 0) {
        vmEndpoints = machines;
      }
    }
    
    // Check all VMs in parallel
    const vmStatuses = await Promise.all(
      vmEndpoints.map(vm => checkVMHealth(vm))
    );

    // Get recent workflow executions from Supabase for rollback info
    
    let recentExecutions: any[] = [];
    if (supabaseUrl && supabaseServiceKey) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      const { data } = await supabase
        .from('workflow_executions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      
      recentExecutions = data || [];
    }

    // Calculate cluster health
    const onlineVMs = vmStatuses.filter(vm => vm.status !== 'offline').length;
    const totalWorkflows = vmStatuses.reduce((sum, vm) => sum + vm.activeWorkflows, 0);
    const clusterHealth = vmEndpoints.length > 0 ? (onlineVMs / vmEndpoints.length) * 100 : 0;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      cluster: {
        health: clusterHealth,
        onlineVMs,
        totalVMs: vmEndpoints.length,
        activeWorkflows: totalWorkflows,
      },
      vms: vmStatuses,
      recentExecutions: recentExecutions.map(exec => ({
        id: exec.id,
        workflowName: exec.workflow_name,
        status: exec.status,
        startedAt: exec.started_at,
        completedAt: exec.completed_at,
        error: exec.error_message,
        canRollback: exec.status === 'failed' || exec.status === 'cancelled',
        rollbackInfo: {
          lastSuccessfulStep: exec.last_successful_step,
          failedStep: exec.failed_step,
          stateBeforeFailure: exec.state_snapshot,
        },
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// SSE endpoint for real-time logs
export async function POST(request: NextRequest) {
  const { vmId, workflowId } = await request.json();
  
  // Get VM details from request or fetch from Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  let vm: any = null;
  
  if (supabaseUrl && supabaseServiceKey) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('id', vmId)
      .single();
    vm = data;
  }
  
  if (!vm) {
    return NextResponse.json({ error: 'VM not found' }, { status: 404 });
  }

  // Create SSE stream for real-time logs
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Poll for logs every second
      const interval = setInterval(async () => {
        try {
          // In production, this would connect to the actual log stream
          // For now, we'll simulate logs
          const log = {
            timestamp: new Date().toISOString(),
            level: Math.random() > 0.8 ? 'error' : 'info',
            message: `[${vm.name}] Processing workflow step...`,
            workflowId,
            step: Math.floor(Math.random() * 10),
            details: {
              action: 'click_element',
              target: 'button#submit',
              result: 'success',
            },
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(log)}\n\n`));
        } catch {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Log fetch failed' })}\n\n`));
        }
      }, 1000);

      // Clean up on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}