import { NextRequest, NextResponse } from 'next/server';

// VM endpoints from your infrastructure
const VM_ENDPOINTS = [
  { id: 'vm1', name: 'Primary Windows VM', endpoint: 'https://mcp-server-1.ngrok.app' },
  { id: 'vm2', name: 'Matt Test Machine', endpoint: 'https://willingly-settling-husky.ngrok-free.app' },
  { id: 'vm3', name: 'Louis Computer', endpoint: 'https://select-merely-gelding.ngrok-free.app' },
  { id: 'azure-lb', name: 'Azure Load Balancer', endpoint: 'http://172.203.20.145:8080' },
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

async function checkVMHealth(vm: typeof VM_ENDPOINTS[0]): Promise<VMStatus> {
  try {
    // Try to hit the health endpoint
    const healthResponse = await fetch(`${vm.endpoint}/health`, {
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
      const statusResponse = await fetch(`${vm.endpoint}/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
        headers: {
          'ngrok-skip-browser-warning': 'true',
        },
      });
      statusData = await statusResponse.json();
    } catch (e) {
      // Status endpoint might not exist
    }

    return {
      id: vm.id,
      name: vm.name,
      endpoint: vm.endpoint,
      status: statusData.busy ? 'busy' : 'online',
      lastSeen: new Date().toISOString(),
      activeWorkflows: statusData.activeRequests || 0,
      health: {
        cpu: Math.random() * 100, // These would come from actual metrics
        memory: Math.random() * 8192,
        uptime: healthData.uptime || 0,
      },
      recentLogs: [], // Will be populated from execute_sequence logs
    };
  } catch (error) {
    return {
      id: vm.id,
      name: vm.name,
      endpoint: vm.endpoint,
      status: 'offline',
      lastSeen: new Date().toISOString(),
      activeWorkflows: 0,
      lastError: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check all VMs in parallel
    const vmStatuses = await Promise.all(
      VM_ENDPOINTS.map(vm => checkVMHealth(vm))
    );

    // Get recent workflow executions from Supabase for rollback info
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
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
    const clusterHealth = (onlineVMs / VM_ENDPOINTS.length) * 100;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      cluster: {
        health: clusterHealth,
        onlineVMs,
        totalVMs: VM_ENDPOINTS.length,
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
  
  const vm = VM_ENDPOINTS.find(v => v.id === vmId);
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
        } catch (error) {
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