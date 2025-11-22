import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ComputeManagementClient } from '@azure/arm-compute';
import { DefaultAzureCredential } from '@azure/identity';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ machineId: string }> }
) {
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  try {
    const { machineId: id } = await params;
    const machineId = parseInt(id);
    const { version = 'latest' } = await request.json();

    // Fetch machine details
    const { data: machine, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('id', machineId)
      .single();

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
    }

    // Ensure machine has Azure Resource ID
    if (!machine.azure_resource_id) {
      return NextResponse.json(
        { error: 'Machine does not have Azure Resource ID configured' },
        { status: 400 }
      );
    }

    // Parse Azure Resource ID
    // Format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{name}
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

    // Initialize Azure SDK client
    const credential = new DefaultAzureCredential();
    const computeClient = new ComputeManagementClient(
      credential,
      subscriptionId
    );

    // Execute Run Command using Azure SDK
    const runCommandParams = {
      commandId: 'RunPowerShellScript',
      script: [UPDATE_SCRIPT],
    };

    console.log(`[Update MCP] Executing Azure Run Command via SDK...`);

    const result = await computeClient.virtualMachines.beginRunCommandAndWait(
      resourceGroup,
      vmName,
      runCommandParams
    );

    console.log(`[Update MCP] Command executed:`, result);

    // Check if update was successful
    const output = result.value?.[0]?.message || '';
    const success = output.includes('UPDATE COMPLETE');

    if (!success) {
      console.warn('[Update MCP] Update may have failed:', output);
      return NextResponse.json(
        {
          error: 'Update command executed but may have failed',
          output,
        },
        { status: 500 }
      );
    }

    // Update machine status to trigger health check
    await supabase
      .from('remote_machines')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', machineId);

    return NextResponse.json({
      success: true,
      message: `Update triggered for ${machine.name}`,
      version,
      vmName,
      resourceGroup,
      output,
    });
  } catch (error: any) {
    console.error('[Update MCP] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Update failed' },
      { status: 500 }
    );
  }
}
