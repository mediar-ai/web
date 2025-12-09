import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const VM_CONFIG = {
  host: '48.214.144.108',
  port: 3389,
  serviceName: 'MCPServer',
  healthEndpoint: 'http://localhost:3000/health',
  serviceEndpoint: 'https://vm-windows-1.ngrok.dev',  // Ngrok tunnel to PowerShell server
  mcpEndpoint: 'https://mcp-server-1.ngrok.app'       // Ngrok tunnel to MCP server
};

// Utility function to execute remote PowerShell commands
async function executeRemoteCommand(command: string, options: { timeout?: number } = {}) {
  const { timeout = 30000 } = options;
  
  try {
    console.log(`[FIX] Executing remote command: ${command}`);
    
    const { stdout, stderr } = await execAsync(command, { timeout });
    
    return {
      success: true,
      output: stdout,
      error: stderr || null
    };
  } catch (error) {
    console.error('[ERROR] Remote command failed:', error);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Try direct HTTP endpoint via ngrok (simplest method)
async function tryDirectHTTP(action: string): Promise<{success: boolean, output: string | null, error: string | null}> {
  try {
    console.log(`🌐 Trying ngrok HTTP: ${action}`);
    
    const endpoint = action === 'health' ? '/health' : (action === 'status' ? '/status' : `/${action}`);
    const method = action === 'status' || action === 'health' ? 'GET' : 'POST';
    
    const response = await fetch(`${VM_CONFIG.serviceEndpoint}${endpoint}`, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'  // Required for ngrok tunnels
      },
      signal: AbortSignal.timeout(10000)  // 10 second timeout
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`[SUCCESS] Ngrok HTTP succeeded: ${action}`);
      return {
        success: true,
        output: JSON.stringify(data),
        error: null
      };
    } else {
      console.log(`[ERROR] Ngrok HTTP failed: ${response.status}`);
      return {
        success: false,
        output: null,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    console.log(`[ERROR] Ngrok HTTP error: ${error}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Try PowerShell remoting via WinRM
async function tryPowerShellRemoting(psCommand: string): Promise<{success: boolean, output: string | null, error: string | null}> {
  try {
    // Try WinRM with different methods
    const methods = [
      // Method 1: Direct PowerShell Invoke-Command (if credentials are configured)
      `pwsh -c "Invoke-Command -ComputerName ${VM_CONFIG.host} -ScriptBlock { ${psCommand} } -ErrorAction Stop"`,
      
      // Method 2: WinRM via curl (HTTP)
      `curl -s -X POST "http://${VM_CONFIG.host}:5985/wsman" -H "Content-Type: application/soap+xml" -d "<?xml version='1.0' encoding='utf-8'?><s:Envelope xmlns:s='http://schemas.xmlsoap.org/soap/envelope/'><s:Body><PowerShell>${psCommand}</PowerShell></s:Body></s:Envelope>"`,
      
      // Method 3: Using xfreerdp with app execution (if available)
      `xfreerdp /v:${VM_CONFIG.host}:${VM_CONFIG.port} /app:powershell /app-cmd:"${psCommand}" /cert:ignore /timeout:10000 +clipboard`
    ];
    
    for (const method of methods) {
      console.log(`[FIX] Trying method: ${method.substring(0, 50)}...`);
      
      try {
        const result = await executeRemoteCommand(method, { timeout: 15000 });
        if (result.success && result.output) {
          console.log(`[SUCCESS] Method succeeded: ${method.substring(0, 30)}...`);
          return result;
        }
             } catch {
         console.log(`[ERROR] Method failed: ${method.substring(0, 30)}...`);
         continue;
       }
    }
    
    return {
      success: false,
      output: null,
      error: 'All PowerShell remoting methods failed'
    };
    
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Check VM connectivity
async function checkVMConnectivity() {
  try {
    // Test RDP port connectivity
    await execAsync(`nc -z -w 5 ${VM_CONFIG.host} ${VM_CONFIG.port}`, { timeout: 10000 });
    return { reachable: true, message: 'VM is reachable via RDP' };
  } catch {
    return { reachable: false, message: 'VM unreachable via RDP' };
  }
}

// Service management operations
const ServiceOperations = {
  async status() {
    console.log('🔄 Attempting service status check...');
    
    // Try ngrok HTTP first (simplest method)
    let result = await tryDirectHTTP('status');
    if (result.success) {
      return result;
    }
    
    // Fallback to PowerShell remoting
    const psCommand = `Get-Service ${VM_CONFIG.serviceName} | ConvertTo-Json`;
    result = await tryPowerShellRemoting(psCommand);
    
    if (result.success) {
      return result;
    }
    
    // Fallback to SSH
    try {
      await execAsync(`ssh -o ConnectTimeout=5 -o BatchMode=yes administrator@${VM_CONFIG.host} exit`, { timeout: 6000 });
      const command = `ssh administrator@${VM_CONFIG.host} "Get-Service ${VM_CONFIG.serviceName} | ConvertTo-Json"`;
      return executeRemoteCommand(command, { timeout: 10000 });
    } catch {
      return {
        success: false,
        output: null,
        error: 'All remote access methods failed. Check ngrok tunnels, configure SSH, or use RDP access to administrator@' + VM_CONFIG.host
      };
    }
  },
  
  async start() {
    try {
      await execAsync(`ssh -o ConnectTimeout=5 -o BatchMode=yes administrator@${VM_CONFIG.host} exit`, { timeout: 6000 });
      const command = `ssh administrator@${VM_CONFIG.host} "Start-Service ${VM_CONFIG.serviceName}; Get-Service ${VM_CONFIG.serviceName} | ConvertTo-Json"`;
      return executeRemoteCommand(command, { timeout: 15000 });
    } catch {
      return {
        success: false,
        output: null,
        error: 'SSH not configured. Need to set up SSH key authentication to administrator@' + VM_CONFIG.host
      };
    }
  },
  
  async stop() {
    try {
      await execAsync(`ssh -o ConnectTimeout=5 -o BatchMode=yes administrator@${VM_CONFIG.host} exit`, { timeout: 6000 });
      const command = `ssh administrator@${VM_CONFIG.host} "Stop-Service ${VM_CONFIG.serviceName}; Get-Service ${VM_CONFIG.serviceName} | ConvertTo-Json"`;
      return executeRemoteCommand(command, { timeout: 15000 });
    } catch {
      return {
        success: false,
        output: null,
        error: 'SSH not configured. Need to set up SSH key authentication to administrator@' + VM_CONFIG.host
      };
    }
  },
  
  async restart() {
    console.log('🔄 Attempting service restart...');
    
    // Try ngrok HTTP first (simplest method)
    let result = await tryDirectHTTP('restart');
    if (result.success) {
      return result;
    }
    
    // Fallback to PowerShell remoting
    const psCommand = `Restart-Service ${VM_CONFIG.serviceName}; Get-Service ${VM_CONFIG.serviceName} | ConvertTo-Json`;
    result = await tryPowerShellRemoting(psCommand);
    
    if (result.success) {
      return result;
    }
    
    // Fallback to SSH
    try {
      await execAsync(`ssh -o ConnectTimeout=5 -o BatchMode=yes administrator@${VM_CONFIG.host} exit`, { timeout: 6000 });
      const command = `ssh administrator@${VM_CONFIG.host} "Restart-Service ${VM_CONFIG.serviceName}; Get-Service ${VM_CONFIG.serviceName} | ConvertTo-Json"`;
      return executeRemoteCommand(command, { timeout: 20000 });
    } catch {
      return {
        success: false,
        output: null,
        error: 'All remote access methods failed. Check ngrok tunnels, configure SSH, or use RDP access to administrator@' + VM_CONFIG.host
      };
    }
  },
  
  async healthCheck() {
    console.log('🔄 Attempting health check...');
    
    // Try management server health first
    const managementResult = await tryDirectHTTP('health');
    if (managementResult.success) {
      // Also check MCP server health
      try {
        const mcpResponse = await fetch(`${VM_CONFIG.mcpEndpoint}/health`, {
          headers: {
            'ngrok-skip-browser-warning': 'true',
            'Authorization': 'Bearer cargorunmediar123'
          },
          signal: AbortSignal.timeout(5000)
        });
        
        if (mcpResponse.ok) {
          const mcpData = await mcpResponse.json();
          const combinedResult = {
            success: true,
            management_server: JSON.parse(managementResult.output!),
            mcp_server: mcpData,
            timestamp: new Date().toISOString()
          };
          return {
            success: true,
            output: JSON.stringify(combinedResult),
            error: null
          };
        }
      } catch (mcpError) {
        console.log(`[WARN] MCP server health check failed: ${mcpError}`);
      }
      
      // Return management server health even if MCP fails
      return managementResult;
    }
    
    // Fallback to SSH
    try {
      await execAsync(`ssh -o ConnectTimeout=5 -o BatchMode=yes administrator@${VM_CONFIG.host} exit`, { timeout: 6000 });
      const command = `ssh administrator@${VM_CONFIG.host} "Invoke-WebRequest -Uri '${VM_CONFIG.healthEndpoint}' -Method GET -UseBasicParsing | ConvertTo-Json"`;
      return executeRemoteCommand(command, { timeout: 10000 });
    } catch {
      return {
        success: false,
        output: null,
        error: 'All remote access methods failed. Management server and MCP server unreachable via ngrok. Check deployment and tunnels.'
      };
    }
  }
};

export async function POST(req: NextRequest) {
  try {
    const { action, force = false } = await req.json();
    
    if (!action) {
      return NextResponse.json({ 
        error: 'Missing action parameter. Valid actions: status, start, stop, restart, health' 
      }, { status: 400 });
    }

    console.log(`🚀 NSSM Service Management - Action: ${action}`);

    // First check VM connectivity
    const connectivity = await checkVMConnectivity();
    
    if (!connectivity.reachable && !force) {
      return NextResponse.json({
        success: false,
        error: 'VM is not reachable',
        details: connectivity.message,
        vm_status: 'unreachable',
        timestamp: new Date().toISOString()
      }, { status: 503 });
    }

    let result;
    
    switch (action) {
      case 'status':
        result = await ServiceOperations.status();
        break;
        
      case 'start':
        result = await ServiceOperations.start();
        break;
        
      case 'stop':
        result = await ServiceOperations.stop();
        break;
        
      case 'restart':
        result = await ServiceOperations.restart();
        break;
        
      case 'health':
        result = await ServiceOperations.healthCheck();
        break;
        
      default:
        return NextResponse.json({ 
          error: `Invalid action: ${action}. Valid actions: status, start, stop, restart, health` 
        }, { status: 400 });
    }

    // Parse service status if available
    let serviceStatus = null;
    if (result.success && result.output) {
      try {
        serviceStatus = JSON.parse(result.output);
      } catch {
        // Output might not be JSON, that's ok
        serviceStatus = { raw_output: result.output };
      }
    }

    const response = {
      success: result.success,
      action,
      vm_status: connectivity.reachable ? 'reachable' : 'unreachable',
      service_status: serviceStatus,
      raw_output: result.output,
      error: result.error,
      timestamp: new Date().toISOString(),
      vm_config: {
        host: VM_CONFIG.host,
        port: VM_CONFIG.port,
        service_name: VM_CONFIG.serviceName
      }
    };

    console.log(`[SUCCESS] NSSM Service Management completed:`, { 
      action, 
      success: result.success,
      vm_reachable: connectivity.reachable 
    });

    return NextResponse.json(response, { 
      status: result.success ? 200 : 500 
    });

  } catch (error) {
    console.error('[ERROR] NSSM Service Management error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Service management failed',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// GET endpoint to check service status without making changes
export async function GET() {
  try {
    console.log('🔍 Checking NSSM service status...');
    
    const connectivity = await checkVMConnectivity();
    const statusResult = await ServiceOperations.status();
    const healthResult = await ServiceOperations.healthCheck();
    
    let serviceStatus = null;
    let healthStatus = null;
    
    if (statusResult.success && statusResult.output) {
      try {
        serviceStatus = JSON.parse(statusResult.output);
      } catch {
        serviceStatus = { raw_output: statusResult.output };
      }
    }
    
    if (healthResult.success && healthResult.output) {
      try {
        healthStatus = JSON.parse(healthResult.output);
      } catch {
        healthStatus = { raw_output: healthResult.output };
      }
    }

    return NextResponse.json({
      success: true,
      vm_status: connectivity.reachable ? 'reachable' : 'unreachable',
      service_status: serviceStatus,
      health_status: healthStatus,
      connectivity_message: connectivity.message,
      timestamp: new Date().toISOString(),
      vm_config: {
        host: VM_CONFIG.host,
        port: VM_CONFIG.port,
        service_name: VM_CONFIG.serviceName,
        health_endpoint: VM_CONFIG.healthEndpoint
      }
    });
    
  } catch (error) {
    console.error('[ERROR] Status check error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Status check failed',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 