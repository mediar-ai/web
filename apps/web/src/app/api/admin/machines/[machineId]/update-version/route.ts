import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ComputeManagementClient } from '@azure/arm-compute';
import { DefaultAzureCredential } from '@azure/identity';
import { requireMediarAdmin } from '@/lib/auth/requireMediarAdmin';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase environment variables are not set');
}

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

// Update script content - embedded directly (no filesystem dependency)
const UPDATE_SCRIPT = `
# Update MCP Agent Script
param([string]$Version = "latest")

Start-Transcript -Path "C:\\MCP\\logs\\update-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

Write-Host "=== MCP Agent Update Script ==="
Write-Host "Target version: $Version"

try {
    # Stop the MCP agent process
    Write-Host "[1/5] Stopping MCP agent..."
    Get-Process terminator-mcp-agent -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2

    # Fetch latest release info
    Write-Host "[2/5] Fetching release info from GitHub..."
    $releaseUrl = if ($Version -eq "latest") {
        "https://api.github.com/repos/mediar-ai/terminator/releases/latest"
    } else {
        "https://api.github.com/repos/mediar-ai/terminator/releases/tags/$Version"
    }

    $release = Invoke-RestMethod -Uri $releaseUrl -Headers @{ "User-Agent" = "PowerShell" }
    $releaseVersion = $release.tag_name
    Write-Host "  Found version: $releaseVersion"

    # Find the Windows x64 asset
    $asset = $release.assets | Where-Object { $_.name -like '*terminator-mcp-agent-win32-x64-msvc.zip' }
    if (-not $asset) {
        throw "Windows x64 asset not found in release $releaseVersion"
    }

    $downloadUrl = $asset.browser_download_url
    Write-Host "  Download URL: $downloadUrl"

    # Download the new version
    Write-Host "[3/5] Downloading new version..."
    $zipPath = "C:\\Temp\\mcp-agent-update.zip"
    New-Item -ItemType Directory -Force -Path C:\\Temp | Out-Null
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
    $downloadSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Host "  Downloaded $downloadSize MB"

    # Backup current version
    Write-Host "[4/5] Backing up current version..."
    $backupPath = "C:\\MCP\\terminator-mcp-agent-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').exe"
    if (Test-Path "C:\\MCP\\terminator-mcp-agent.exe") {
        Copy-Item "C:\\MCP\\terminator-mcp-agent.exe" $backupPath
        Write-Host "  Backup saved to: $backupPath"
    }

    # Extract and replace binary
    Write-Host "[5/5] Installing new version..."
    Expand-Archive -Path $zipPath -DestinationPath C:\\MCP -Force
    Remove-Item $zipPath -Force
    $newSize = [math]::Round((Get-Item C:\\MCP\\terminator-mcp-agent.exe).Length / 1MB, 2)
    Write-Host "  Installed: $newSize MB"

    # Restart the MCP agent
    Write-Host "[RESTART] Starting MCP agent..."
    try {
        Start-Process "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File C:\\MCP\\start-mcp-user-session.ps1" -WindowStyle Hidden
        Write-Host "  Started successfully"
    } catch {
        Write-Host "  Will start on next login"
    }

    Write-Host ""
    Write-Host "=== UPDATE COMPLETE ==="
    Write-Host "New version: $releaseVersion"
    Write-Host ""

    Stop-Transcript
    exit 0

} catch {
    Write-Host ""
    Write-Host "=== UPDATE FAILED ==="
    Write-Host "Error: $_"

    # Try to restore backup if update failed
    if (Test-Path $backupPath) {
        Write-Host "Restoring backup..."
        Copy-Item $backupPath "C:\\MCP\\terminator-mcp-agent.exe" -Force
    }

    Stop-Transcript
    exit 1
}
`;

interface AzureVmState {
  powerState: string;
  provisioningState: string;
  extensionsReady: boolean;
  blockedExtensions: string[];
}

async function getVmState(
  computeClient: ComputeManagementClient,
  resourceGroup: string,
  vmName: string
): Promise<AzureVmState> {
  const instanceView = await computeClient.virtualMachines.instanceView(
    resourceGroup,
    vmName
  );

  const statuses = instanceView.statuses || [];
  const powerStatus = statuses.find((s) => s.code?.startsWith('PowerState/'));
  const provisioningStatus = statuses.find((s) =>
    s.code?.startsWith('ProvisioningState/')
  );

  // Check extensions
  const extensions = instanceView.extensions || [];
  const blockedExtensions = extensions
    .filter(
      (ext) =>
        ext.statuses?.some(
          (s) =>
            s.code?.includes('Updating') ||
            s.code?.includes('Transitioning') ||
            s.level === 'Error'
        )
    )
    .map((ext) => ext.name || 'unknown');

  return {
    powerState: powerStatus?.code?.replace('PowerState/', '') || 'unknown',
    provisioningState:
      provisioningStatus?.code?.replace('ProvisioningState/', '') || 'unknown',
    extensionsReady: blockedExtensions.length === 0,
    blockedExtensions,
  };
}

async function runCommandWithTimeout(
  computeClient: ComputeManagementClient,
  resourceGroup: string,
  vmName: string,
  script: string[],
  timeoutMs: number = 120000
): Promise<{ success: boolean; output: string; timedOut: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const poller = await computeClient.virtualMachines.beginRunCommand(
      resourceGroup,
      vmName,
      {
        commandId: 'RunPowerShellScript',
        script,
      }
    );

    // Poll with timeout
    const result = await Promise.race([
      poller.pollUntilDone(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Operation timed out'));
        });
      }),
    ]);

    clearTimeout(timeoutId);
    const output = result.value?.[0]?.message || '';
    return {
      success: output.includes('UPDATE COMPLETE'),
      output,
      timedOut: false,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.message === 'Operation timed out') {
      return {
        success: false,
        output: 'Operation timed out after ' + timeoutMs / 1000 + 's',
        timedOut: true,
      };
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const denied = await requireMediarAdmin();
  if (denied) return denied;

  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  try {
    const { machineId: id } = await params;
    const machineId = parseInt(id);
    const { version = 'latest', force = false } = await request.json();

    // Fetch machine details
    const { data: machine, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('id', machineId)
      .single();

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
    }

    if (!machine.azure_resource_id) {
      return NextResponse.json(
        { error: 'Machine does not have Azure Resource ID configured' },
        { status: 400 }
      );
    }

    // Parse Azure Resource ID
    const parts = machine.azure_resource_id.split('/');
    const subscriptionIndex = parts.indexOf('subscriptions');
    const rgIndex = parts.indexOf('resourceGroups');
    const vmIndex = parts.indexOf('virtualMachines');

    if (subscriptionIndex === -1 || rgIndex === -1 || vmIndex === -1) {
      return NextResponse.json(
        { error: 'Invalid Azure Resource ID format' },
        { status: 400 }
      );
    }

    const subscriptionId = parts[subscriptionIndex + 1];
    const resourceGroup = parts[rgIndex + 1];
    const vmName = parts[vmIndex + 1];

    console.log(
      `[Update MCP] Triggering update for ${vmName} in ${resourceGroup} to version ${version}`
    );

    const credential = new DefaultAzureCredential();
    const computeClient = new ComputeManagementClient(
      credential,
      subscriptionId
    );

    // Pre-flight check: Get VM state
    console.log(`[Update MCP] Running pre-flight checks...`);
    const vmState = await getVmState(computeClient, resourceGroup, vmName);

    // Check if VM is in a good state
    if (vmState.powerState !== 'running') {
      return NextResponse.json(
        {
          error: `VM is not running (state: ${vmState.powerState})`,
          vmState,
          action: 'start_vm',
        },
        { status: 409 }
      );
    }

    if (vmState.provisioningState === 'Updating' && !force) {
      return NextResponse.json(
        {
          error: `VM has pending operations (state: ${vmState.provisioningState})`,
          vmState,
          action: 'wait_or_restart',
          hint: 'Use force=true to attempt anyway, or restart the VM to clear stuck state',
        },
        { status: 409 }
      );
    }

    if (!vmState.extensionsReady && !force) {
      return NextResponse.json(
        {
          error: `VM extensions are not ready: ${vmState.blockedExtensions.join(', ')}`,
          vmState,
          action: 'restart_vm',
          hint: 'Restart the VM to clear stuck extensions, or use force=true',
        },
        { status: 409 }
      );
    }

    // Record update attempt in database
    await supabase
      .from('remote_machines')
      .update({
        update_status: 'updating',
        update_started_at: new Date().toISOString(),
        update_target_version: version,
      })
      .eq('id', machineId);

    console.log(`[Update MCP] Executing Azure Run Command with 2min timeout...`);

    // Execute with timeout
    const result = await runCommandWithTimeout(
      computeClient,
      resourceGroup,
      vmName,
      [UPDATE_SCRIPT],
      120000 // 2 minutes
    );

    if (result.timedOut) {
      console.warn('[Update MCP] Command timed out');
      await supabase
        .from('remote_machines')
        .update({
          update_status: 'timeout',
          update_error: 'Azure RunCommand timed out after 2 minutes',
        })
        .eq('id', machineId);

      return NextResponse.json(
        {
          error: 'Update timed out - VM may be stuck',
          action: 'restart_vm',
          hint: 'The VM may need a restart to clear stuck operations',
        },
        { status: 504 }
      );
    }

    if (!result.success) {
      console.warn('[Update MCP] Update failed:', result.output);
      await supabase
        .from('remote_machines')
        .update({
          update_status: 'failed',
          update_error: result.output.slice(0, 1000),
        })
        .eq('id', machineId);

      return NextResponse.json(
        {
          error: 'Update command executed but failed',
          output: result.output,
        },
        { status: 500 }
      );
    }

    // Success - update database
    await supabase
      .from('remote_machines')
      .update({
        update_status: 'completed',
        update_completed_at: new Date().toISOString(),
        update_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', machineId);

    return NextResponse.json({
      success: true,
      message: `Update completed for ${machine.name}`,
      version,
      vmName,
      resourceGroup,
      output: result.output,
    });
  } catch (error: any) {
    console.error('[Update MCP] Error:', error);

    // Try to update status on error
    try {
      const { machineId: id } = await params;
      await supabase
        ?.from('remote_machines')
        .update({
          update_status: 'error',
          update_error: error.message?.slice(0, 500),
        })
        .eq('id', parseInt(id));
    } catch {}

    return NextResponse.json(
      { error: error.message || 'Update failed' },
      { status: 500 }
    );
  }
}
