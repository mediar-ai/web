/**
 * Azure Image Builder
 * Replaces Packer for building VM images with full TypeScript control.
 * Supports specialized images (no sysprep) for faster VM boot times.
 */

import { ImageBuilderClient, ImageTemplate } from '@azure/arm-imagebuilder';
import { ComputeManagementClient } from '@azure/arm-compute';
import { getAzureCredential, getSubscriptionId } from './client';

// Config matching existing infrastructure
const IMAGE_CONFIG = {
  location: 'eastus',
  resourceGroup: 'UI-AUTOMATION-IMAGES-RG',
  galleryName: 'mcpimages',
  galleryImageName: 'mcp-full',
  vmSize: 'Standard_D4s_v3',
  // Base image: Windows Server 2022 Datacenter
  baseImagePublisher: 'MicrosoftWindowsServer',
  baseImageOffer: 'WindowsServer',
  baseImageSku: '2022-datacenter-g2',
};

// User-assigned managed identity for Image Builder
// This identity needs contributor access to the image RG
const IMAGE_BUILDER_IDENTITY = '/subscriptions/{subscriptionId}/resourceGroups/UI-AUTOMATION-IMAGES-RG/providers/Microsoft.ManagedIdentity/userAssignedIdentities/image-builder-identity';

export interface ImageBuildOptions {
  vmPassword: string;
  vncPassword: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3Endpoint?: string;
}

export interface ImageBuildResult {
  success: boolean;
  imageId?: string;
  versionName?: string;
  templateName?: string;
  error?: string;
  runOutputId?: string;
}

export interface ImageBuildProgress {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
  runState?: string;
}

// Singleton client
let imageBuilderClient: ImageBuilderClient | null = null;

function getImageBuilderClient(): ImageBuilderClient {
  if (!imageBuilderClient) {
    const subscriptionId = getSubscriptionId();
    const credential = getAzureCredential();
    imageBuilderClient = new ImageBuilderClient(credential, subscriptionId);
  }
  return imageBuilderClient;
}

/**
 * Generate the PowerShell provisioning script
 * This is the same as what Packer runs, but as a single inline script for Image Builder
 */
function generateProvisioningScript(options: ImageBuildOptions): string {
  const s3Endpoint = options.s3Endpoint || 'https://eshwntsgsputksqamckh.storage.supabase.co/storage/v1/s3';

  return `
# Enable TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Store credentials for later use
$vmPassword = '${options.vmPassword}'
$vncPassword = '${options.vncPassword}'
$s3AccessKey = '${options.s3AccessKey || ''}'
$s3SecretKey = '${options.s3SecretKey || ''}'
$s3Endpoint = '${s3Endpoint}'

# ==============================================================================
# 1. Create Directories
# ==============================================================================
Write-Host 'Creating directories...'
New-Item -ItemType Directory -Force -Path C:\\MCP
New-Item -ItemType Directory -Force -Path C:\\MCP\\logs
New-Item -ItemType Directory -Force -Path C:\\Temp
New-Item -ItemType Directory -Force -Path C:\\Scripts
New-Item -ItemType Directory -Force -Path C:\\Workflows

# ==============================================================================
# 2. Install MCP Agent
# ==============================================================================
Write-Host 'Fetching latest MCP agent version...'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/mediar-ai/terminator/releases/latest'
$version = $release.tag_name
Write-Host "Downloading MCP agent $version..."
$asset = $release.assets | Where-Object { $_.name -like '*terminator-mcp-agent-win32-x64-msvc.zip' }
$url = $asset.browser_download_url
Invoke-WebRequest -Uri $url -OutFile 'C:\\Temp\\mcp-agent.zip' -UseBasicParsing
Expand-Archive -Path 'C:\\Temp\\mcp-agent.zip' -DestinationPath C:\\MCP -Force
Remove-Item 'C:\\Temp\\mcp-agent.zip'

# ==============================================================================
# 3. Install Node.js & terminator.js
# ==============================================================================
Write-Host 'Installing Node.js...'
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile 'C:\\Temp\\node.msi' -UseBasicParsing
Start-Process msiexec.exe -ArgumentList '/i', 'C:\\Temp\\node.msi', '/quiet', '/norestart' -Wait
Remove-Item 'C:\\Temp\\node.msi'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

Write-Host 'Pre-installing terminator.js...'
$mcpDir = 'C:\\Users\\vmuser\\AppData\\Local\\Temp\\terminator_mcp_persistent'
New-Item -ItemType Directory -Force -Path $mcpDir
Set-Location $mcpDir
$packageJson = @{ name = 'terminator-mcp-persistent'; version = '1.0.0'; dependencies = @{ 'terminator.js' = 'latest'; tsx = '^4.7.0'; typescript = '^5.3.0'; '@types/node' = '^20.0.0' } } | ConvertTo-Json -Depth 10
$packageJson | Out-File -FilePath 'package.json' -Encoding UTF8
npm install
Set-Location C:\\

# ==============================================================================
# 4. Install Chocolatey
# ==============================================================================
Write-Host 'Installing Chocolatey...'
Set-ExecutionPolicy Bypass -Scope Process -Force
Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

# ==============================================================================
# 5. Install Bun
# ==============================================================================
Write-Host 'Installing Bun...'
Invoke-WebRequest -Uri 'https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip' -OutFile 'C:\\Temp\\bun.zip' -UseBasicParsing
Expand-Archive -Path 'C:\\Temp\\bun.zip' -DestinationPath 'C:\\Temp\\bun-extract' -Force
New-Item -ItemType Directory -Force -Path 'C:\\MCP\\bun' | Out-Null
$bunExe = Get-ChildItem -Path 'C:\\Temp\\bun-extract' -Filter 'bun.exe' -Recurse | Select-Object -First 1
Copy-Item -Path $bunExe.FullName -Destination 'C:\\MCP\\bun\\bun.exe' -Force
Remove-Item 'C:\\Temp\\bun.zip'
Remove-Item 'C:\\Temp\\bun-extract' -Recurse -Force
$existingPath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
if ($existingPath -notlike '*C:\\MCP\\bun*') {
  [System.Environment]::SetEnvironmentVariable('Path', "$existingPath;C:\\MCP\\bun", 'Machine')
}

# ==============================================================================
# 6. Install Tools via Chocolatey
# ==============================================================================
Write-Host 'Installing rclone, ffmpeg, chrome...'
choco install -y rclone ffmpeg googlechrome --ignore-checksums

# ==============================================================================
# 7. Configure Chrome
# ==============================================================================
Write-Host 'Configuring Chrome...'
$chromePoliciesPath = 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome'
New-Item -Path $chromePoliciesPath -Force | Out-Null
Set-ItemProperty -Path $chromePoliciesPath -Name 'SuppressFirstRunBubble' -Value 1 -Type DWord
Set-ItemProperty -Path $chromePoliciesPath -Name 'DefaultBrowserSettingEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $chromePoliciesPath -Name 'MetricsReportingEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $chromePoliciesPath -Name 'PasswordManagerEnabled' -Value 0 -Type DWord

$chromeUserDataPath = 'C:\\Users\\vmuser\\AppData\\Local\\Google\\Chrome\\User Data'
New-Item -ItemType Directory -Force -Path "$chromeUserDataPath\\Default" | Out-Null
New-Item -ItemType File -Force -Path "$chromeUserDataPath\\First Run" | Out-Null

# Install Terminator extension
Write-Host 'Installing Terminator extension...'
try {
  Invoke-WebRequest -Uri 'https://github.com/mediar-ai/terminator/releases/latest/download/terminator-extension.zip' -OutFile 'C:\\Temp\\ext.zip' -UseBasicParsing
  Expand-Archive -Path 'C:\\Temp\\ext.zip' -DestinationPath 'C:\\MCP\\terminator-extension' -Force
  Remove-Item 'C:\\Temp\\ext.zip' -Force
} catch { Write-Host "Extension download failed: $_" }

# ==============================================================================
# 8. Install WinFsp
# ==============================================================================
Write-Host 'Installing WinFsp...'
Invoke-WebRequest -Uri 'https://github.com/winfsp/winfsp/releases/download/v2.0/winfsp-2.0.23075.msi' -OutFile 'C:\\Temp\\winfsp.msi' -UseBasicParsing
Start-Process msiexec.exe -ArgumentList '/i', 'C:\\Temp\\winfsp.msi', '/quiet', '/norestart' -Wait
Remove-Item 'C:\\Temp\\winfsp.msi' -Force

# ==============================================================================
# 9. Configure rclone
# ==============================================================================
if ($s3AccessKey -and $s3SecretKey) {
  Write-Host 'Configuring rclone...'
  $rcloneConfigDir = "$env:ProgramData\\rclone"
  New-Item -ItemType Directory -Path $rcloneConfigDir -Force | Out-Null
  @"
[s3]
type = s3
provider = Other
access_key_id = $s3AccessKey
secret_access_key = $s3SecretKey
region = us-west-1
endpoint = $s3Endpoint
"@ | Out-File -FilePath "$rcloneConfigDir\\rclone.conf" -Encoding ASCII
}

# ==============================================================================
# 10. Install VNC Server
# ==============================================================================
Write-Host 'Installing TightVNC...'
Invoke-WebRequest -Uri 'https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi' -OutFile 'C:\\Temp\\vnc.msi' -UseBasicParsing
Start-Process msiexec.exe -ArgumentList '/i', 'C:\\Temp\\vnc.msi', '/quiet', '/norestart', 'ADDLOCAL=Server', 'SET_USEVNCAUTHENTICATION=1', 'VALUE_OF_USEVNCAUTHENTICATION=1', 'SET_PASSWORD=1', "VALUE_OF_PASSWORD=$vncPassword" -Wait
Remove-Item 'C:\\Temp\\vnc.msi' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Allow VNC 5900' -Direction Inbound -LocalPort 5900 -Protocol TCP -Action Allow -Enabled True -ErrorAction SilentlyContinue

# ==============================================================================
# 11. Create vmuser account
# ==============================================================================
Write-Host 'Creating vmuser account...'
if (-not (Get-LocalUser -Name 'vmuser' -ErrorAction SilentlyContinue)) {
  New-LocalUser -Name 'vmuser' -Password (ConvertTo-SecureString $vmPassword -AsPlainText -Force) -Description 'MCP User' -PasswordNeverExpires
  Add-LocalGroupMember -Group 'Administrators' -Member 'vmuser'
}

# ==============================================================================
# 12. Configure Auto-login
# ==============================================================================
Write-Host 'Configuring auto-login...'
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v AutoAdminLogon /t REG_SZ /d 1 /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultUsername /t REG_SZ /d vmuser /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultPassword /t REG_SZ /d $vmPassword /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultDomainName /t REG_SZ /d . /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v ForceAutoLogon /t REG_SZ /d 1 /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' /v DisableCAD /t REG_DWORD /d 1 /f

# ==============================================================================
# 13. Create MCP Startup Script
# ==============================================================================
Write-Host 'Creating MCP startup script...'
@'
Start-Transcript -Path C:\\MCP\\logs\\mcp-startup-$((Get-Date).ToString('yyyyMMdd-HHmmss')).log
Write-Host 'Starting MCP agent...'
Get-Process terminator* -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'C:\\MCP\\terminator-mcp-agent.exe'
$psi.Arguments = '-t http --host 0.0.0.0 -p 8080 --auth-token cargorunmediar123'
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

foreach ($key in [System.Environment]::GetEnvironmentVariables().Keys) {
  $psi.EnvironmentVariables[$key] = [System.Environment]::GetEnvironmentVariable($key)
}

$psi.EnvironmentVariables['USERPROFILE'] = 'C:\\Users\\vmuser'
$psi.EnvironmentVariables['LOCALAPPDATA'] = 'C:\\Users\\vmuser\\AppData\\Local'
$psi.EnvironmentVariables['APPDATA'] = 'C:\\Users\\vmuser\\AppData\\Roaming'
$psi.EnvironmentVariables['MCP_AUTH_TOKEN'] = 'cargorunmediar123'

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "MCP started with PID: $($proc.Id)"
Stop-Transcript
'@ | Out-File -FilePath C:\\MCP\\start-mcp-user-session.ps1 -Encoding UTF8

# ==============================================================================
# 14. Create Scheduled Tasks
# ==============================================================================
Write-Host 'Creating scheduled tasks...'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -File C:\\MCP\\start-mcp-user-session.ps1'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User 'vmuser'
$principal = New-ScheduledTaskPrincipal -UserId 'vmuser' -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'StartMCPUserSession' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

# ==============================================================================
# 15. Configure Firewall
# ==============================================================================
Write-Host 'Configuring firewall...'
New-NetFirewallRule -DisplayName 'Allow MCP 8080' -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow -Enabled True -ErrorAction SilentlyContinue

# ==============================================================================
# 16. Disable Server Manager
# ==============================================================================
Write-Host 'Disabling Server Manager...'
$serverManagerPath = 'HKLM:\\SOFTWARE\\Microsoft\\ServerManager'
if (-not (Test-Path $serverManagerPath)) { New-Item -Path $serverManagerPath -Force | Out-Null }
Set-ItemProperty -Path $serverManagerPath -Name 'DoNotOpenServerManagerAtLogon' -Value 1 -Type DWord

# ==============================================================================
# 17. Cleanup
# ==============================================================================
Write-Host 'Cleaning up...'
Remove-Item -Path 'C:\\Windows\\Temp\\*' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'C:\\Users\\*\\AppData\\Local\\Temp\\*' -Recurse -Force -ErrorAction SilentlyContinue
wevtutil cl System
wevtutil cl Application
wevtutil cl Security

Write-Host 'Provisioning complete!'
`;
}

/**
 * Create an Image Builder template for the MCP image
 */
export async function createImageTemplate(
  templateName: string,
  options: ImageBuildOptions,
  onProgress?: (progress: ImageBuildProgress) => void
): Promise<ImageBuildResult> {
  const subscriptionId = getSubscriptionId();
  const client = getImageBuilderClient();
  const identityId = IMAGE_BUILDER_IDENTITY.replace('{subscriptionId}', subscriptionId);

  const progress = (step: string, status: ImageBuildProgress['status'], message: string) => {
    console.log(`[Image Builder] ${step}: ${message}`);
    onProgress?.({ step, status, message });
  };

  try {
    progress('template', 'in_progress', `Creating image template: ${templateName}`);

    const versionName = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const formattedVersion = `${versionName.slice(0, 4)}.${versionName.slice(4, 8)}.${versionName.slice(8, 12)}`;

    const template: ImageTemplate = {
      location: IMAGE_CONFIG.location,
      identity: {
        type: 'UserAssigned',
        userAssignedIdentities: {
          [identityId]: {},
        },
      },
      source: {
        type: 'PlatformImage',
        publisher: IMAGE_CONFIG.baseImagePublisher,
        offer: IMAGE_CONFIG.baseImageOffer,
        sku: IMAGE_CONFIG.baseImageSku,
        version: 'latest',
      },
      customize: [
        {
          type: 'PowerShell',
          name: 'ProvisionMCP',
          inline: [generateProvisioningScript(options)],
          runElevated: true,
          runAsSystem: true,
        },
      ],
      distribute: [
        {
          type: 'SharedImage',
          galleryImageId: `/subscriptions/${subscriptionId}/resourceGroups/${IMAGE_CONFIG.resourceGroup}/providers/Microsoft.Compute/galleries/${IMAGE_CONFIG.galleryName}/images/${IMAGE_CONFIG.galleryImageName}`,
          runOutputName: `${templateName}-output`,
          artifactTags: {
            'created-by': 'mediar-image-builder',
            'created-at': new Date().toISOString(),
          },
          replicationRegions: [IMAGE_CONFIG.location],
          versioning: {
            scheme: 'Latest',
          },
          excludeFromLatest: false,
        },
      ],
      vmProfile: {
        vmSize: IMAGE_CONFIG.vmSize,
        osDiskSizeGB: 128,
      },
      buildTimeoutInMinutes: 120,
    };

    const poller = await client.virtualMachineImageTemplates.beginCreateOrUpdate(
      IMAGE_CONFIG.resourceGroup,
      templateName,
      template
    );

    await poller.pollUntilDone();
    progress('template', 'completed', 'Image template created');

    return {
      success: true,
      templateName,
      versionName: formattedVersion,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Image Builder] Template creation failed:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Start building an image from a template
 */
export async function runImageBuild(
  templateName: string,
  onProgress?: (progress: ImageBuildProgress) => void
): Promise<ImageBuildResult> {
  const client = getImageBuilderClient();

  const progress = (step: string, status: ImageBuildProgress['status'], message: string, runState?: string) => {
    console.log(`[Image Builder] ${step}: ${message}`);
    onProgress?.({ step, status, message, runState });
  };

  try {
    progress('build', 'in_progress', 'Starting image build...');

    const poller = await client.virtualMachineImageTemplates.beginRun(
      IMAGE_CONFIG.resourceGroup,
      templateName
    );

    progress('build', 'in_progress', 'Build started, waiting for completion (this may take 30-60 minutes)...');

    // Poll for status
    while (!poller.isDone()) {
      await new Promise(resolve => setTimeout(resolve, 30000)); // Check every 30s

      try {
        const template = await client.virtualMachineImageTemplates.get(
          IMAGE_CONFIG.resourceGroup,
          templateName
        );
        const runState = template.lastRunStatus?.runState || 'Unknown';
        const runSubState = template.lastRunStatus?.runSubState || '';
        progress('build', 'in_progress', `Build state: ${runState} - ${runSubState}`, runState);

        if (runState === 'Failed') {
          const errorMessage = template.lastRunStatus?.message || 'Build failed';
          return { success: false, error: errorMessage, templateName };
        }
      } catch {
        // Continue polling even if status check fails
      }
    }

    await poller.pollUntilDone();

    // Get final status
    const finalTemplate = await client.virtualMachineImageTemplates.get(
      IMAGE_CONFIG.resourceGroup,
      templateName
    );

    if (finalTemplate.lastRunStatus?.runState === 'Succeeded') {
      progress('build', 'completed', 'Image build completed successfully');
      return {
        success: true,
        templateName,
        runOutputId: `${templateName}-output`,
      };
    } else {
      const errorMessage = finalTemplate.lastRunStatus?.message || 'Build failed';
      return { success: false, error: errorMessage, templateName };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Image Builder] Build failed:', error);
    return { success: false, error: errorMessage, templateName };
  }
}

/**
 * Full image build workflow: create template + run build
 */
export async function buildImage(
  options: ImageBuildOptions,
  onProgress?: (progress: ImageBuildProgress) => void
): Promise<ImageBuildResult> {
  const templateName = `mcp-full-${Date.now()}`;

  // Step 1: Create template
  const templateResult = await createImageTemplate(templateName, options, onProgress);
  if (!templateResult.success) {
    return templateResult;
  }

  // Step 2: Run build
  return runImageBuild(templateName, onProgress);
}

/**
 * Delete an image template
 */
export async function deleteImageTemplate(templateName: string): Promise<{ success: boolean; error?: string }> {
  const client = getImageBuilderClient();

  try {
    const poller = await client.virtualMachineImageTemplates.beginDelete(
      IMAGE_CONFIG.resourceGroup,
      templateName
    );
    await poller.pollUntilDone();
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * List all image templates
 */
export async function listImageTemplates(): Promise<{
  success: boolean;
  templates?: Array<{
    name: string;
    location: string;
    lastRunState?: string;
    lastRunTime?: Date;
  }>;
  error?: string;
}> {
  const client = getImageBuilderClient();

  try {
    const templates: Array<{
      name: string;
      location: string;
      lastRunState?: string;
      lastRunTime?: Date;
    }> = [];

    for await (const template of client.virtualMachineImageTemplates.listByResourceGroup(IMAGE_CONFIG.resourceGroup)) {
      templates.push({
        name: template.name || 'unknown',
        location: template.location || IMAGE_CONFIG.location,
        lastRunState: template.lastRunStatus?.runState,
        lastRunTime: template.lastRunStatus?.endTime,
      });
    }

    return { success: true, templates };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Get latest gallery image version
 */
export async function getLatestGalleryImageVersion(): Promise<{
  success: boolean;
  version?: string;
  imageId?: string;
  error?: string;
}> {
  const subscriptionId = getSubscriptionId();
  const credential = getAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);

  try {
    const versions: Array<{ name?: string }> = [];
    const paginator = computeClient.galleryImageVersions
      .listByGalleryImage(IMAGE_CONFIG.resourceGroup, IMAGE_CONFIG.galleryName, IMAGE_CONFIG.galleryImageName)
      .byPage();

    for await (const page of paginator) {
      versions.push(...page);
    }

    if (versions.length === 0) {
      return { success: false, error: 'No gallery image versions found' };
    }

    const sortedVersions = versions
      .filter((v): v is { name: string } => !!v.name)
      .sort((a, b) => b.name.localeCompare(a.name));

    const latestVersion = sortedVersions[0].name;
    const imageId = `/subscriptions/${subscriptionId}/resourceGroups/${IMAGE_CONFIG.resourceGroup}/providers/Microsoft.Compute/galleries/${IMAGE_CONFIG.galleryName}/images/${IMAGE_CONFIG.galleryImageName}/versions/${latestVersion}`;

    return {
      success: true,
      version: latestVersion,
      imageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Check if the Image Builder managed identity exists
 * If not, provides instructions to create it
 */
export async function checkImageBuilderPrerequisites(): Promise<{
  ready: boolean;
  missing: string[];
  instructions: string[];
}> {
  const subscriptionId = getSubscriptionId();
  const missing: string[] = [];
  const instructions: string[] = [];

  // Check for managed identity (we can't easily check this without ManagedIdentity SDK)
  // For now, just return info about what needs to be set up

  instructions.push(
    '1. Create user-assigned managed identity:',
    `   az identity create -g UI-AUTOMATION-IMAGES-RG -n image-builder-identity`,
    '',
    '2. Assign Contributor role to the identity:',
    `   IDENTITY_ID=$(az identity show -g UI-AUTOMATION-IMAGES-RG -n image-builder-identity --query principalId -o tsv)`,
    `   az role assignment create --assignee $IDENTITY_ID --role Contributor --scope /subscriptions/${subscriptionId}/resourceGroups/UI-AUTOMATION-IMAGES-RG`,
    '',
    '3. Register the Image Builder provider:',
    `   az provider register -n Microsoft.VirtualMachineImages`,
    '',
    '4. Ensure the Compute Gallery exists with specialized image definition:',
    `   The gallery 'mcpimages' and image 'mcp-full' should already exist from Terraform`
  );

  return {
    ready: true, // Assume ready, will fail at runtime if not
    missing,
    instructions,
  };
}
