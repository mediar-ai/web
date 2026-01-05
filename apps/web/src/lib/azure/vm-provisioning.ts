/**
 * Azure VM Provisioning
 * Creates new VMs with the same configuration as Terraform/Packer
 */

import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { ResourceManagementClient } from '@azure/arm-resources';
import { getAzureCredential, getSubscriptionId } from './client';

// VM Configuration (matching Terraform)
const DEFAULT_VM_CONFIG = {
  location: 'eastus',
  vmSize: 'Standard_D4s_v3',
  osDiskSizeGb: 128,
  osDiskType: 'Premium_LRS',
  imageResourceGroup: 'UI-AUTOMATION-IMAGES-RG',
  // Azure Compute Gallery for specialized images (no sysprep = faster boot!)
  galleryName: 'mcpimages',
  galleryImageName: 'mcp-full',
  // Legacy prefix for fallback to managed images
  imageNamePrefix: 'mcp-full-',
  ports: [
    { name: 'MCP', port: 8080, priority: 100 },
    { name: 'RDP', port: 3389, priority: 110 },
    { name: 'VNC', port: 5900, priority: 120 },
  ],
};

// Cost estimates (East US, per month)
const COST_ESTIMATES = {
  'Standard_D4s_v3': 140,
  'Standard_D2s_v3': 70,
  'Standard_D8s_v3': 280,
  disk_128gb_premium: 20,
  public_ip: 4,
};

export interface ProvisionVmOptions {
  name: string;
  customer: string;
  organizationId?: string;
  location?: string;
  vmSize?: string;
}

export interface ProvisionVmResult {
  success: boolean;
  vmId?: string;
  publicIp?: string;
  mcpEndpoint?: string;
  machineId?: number;
  error?: string;
  details?: {
    resourceGroup: string;
    vmName: string;
    location: string;
    vmSize: string;
  };
}

export interface ProvisioningProgress {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
}

/**
 * Get the latest image from Azure Compute Gallery (specialized, no sysprep)
 * Falls back to legacy managed images if gallery not available
 */
async function getLatestPackerImage(
  computeClient: ComputeManagementClient
): Promise<{ id: string; name: string; specialized: boolean } | null> {
  const subscriptionId = getSubscriptionId();
  const imageRg = DEFAULT_VM_CONFIG.imageResourceGroup;
  const galleryName = DEFAULT_VM_CONFIG.galleryName;
  const imageName = DEFAULT_VM_CONFIG.galleryImageName;

  // Try Azure Compute Gallery first (specialized images = faster boot)
  try {
    console.log(`[VM Provision] Looking for gallery image: ${galleryName}/${imageName}`);

    // List all versions of the image
    const versions: Array<{ name?: string }> = [];
    const paginator = computeClient.galleryImageVersions
      .listByGalleryImage(imageRg, galleryName, imageName)
      .byPage();

    for await (const page of paginator) {
      versions.push(...page);
    }

    console.log(`[VM Provision] Found ${versions.length} gallery image versions`);

    if (versions.length > 0) {
      // Sort by version name (format: YYYY.MMDD.HHmm) descending
      const sortedVersions = versions
        .filter((v): v is { name: string } => !!v.name)
        .sort((a, b) => b.name.localeCompare(a.name));

      const latestVersion = sortedVersions[0].name;
      const imageId = `/subscriptions/${subscriptionId}/resourceGroups/${imageRg}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageName}/versions/${latestVersion}`;

      console.log(`[VM Provision] Using gallery image: ${imageName}/${latestVersion} (specialized)`);
      return {
        id: imageId,
        name: `${imageName}/${latestVersion}`,
        specialized: true,
      };
    }
  } catch (error) {
    console.log(`[VM Provision] Gallery not available, falling back to managed images:`, error);
  }

  // Fallback to legacy managed images (generalized, slower boot)
  const prefix = DEFAULT_VM_CONFIG.imageNamePrefix;
  console.log(`[VM Provision] Falling back to managed images with prefix '${prefix}'`);

  try {
    const allImages: Array<{ name?: string }> = [];
    const paginator = computeClient.images.listByResourceGroup(imageRg).byPage();

    for await (const page of paginator) {
      allImages.push(...page);
    }

    console.log(`[VM Provision] Total managed images found: ${allImages.length}`);

    if (allImages.length === 0) {
      console.error('[VM Provision] No images found');
      return null;
    }

    // Filter for matching prefix
    const matchingImages: { name: string; id: string; timestamp: Date }[] = [];

    for (const image of allImages) {
      if (image.name?.startsWith(prefix)) {
        const timestampStr = image.name.replace(prefix, '');
        const timestamp = new Date(
          timestampStr.replace(
            /(\d{4})(\d{2})(\d{2})-?(\d{2})(\d{2})(\d{2})/,
            '$1-$2-$3T$4:$5:$6Z'
          )
        );

        matchingImages.push({
          name: image.name,
          id: `/subscriptions/${subscriptionId}/resourceGroups/${imageRg}/providers/Microsoft.Compute/images/${image.name}`,
          timestamp: isNaN(timestamp.getTime()) ? new Date(0) : timestamp,
        });
      }
    }

    if (matchingImages.length === 0) {
      console.error(`[VM Provision] No images with prefix '${prefix}' found`);
      return null;
    }

    // Sort by timestamp descending
    matchingImages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const latest = matchingImages[0];

    console.log(`[VM Provision] Using managed image: ${latest.name} (generalized - slower boot)`);
    return {
      id: latest.id,
      name: latest.name,
      specialized: false,
    };
  } catch (error) {
    console.error('[VM Provision] Error listing images:', error);
    return null;
  }
}

/**
 * Generate resource names based on VM name
 */
function generateResourceNames(vmName: string, customer: string) {
  const sanitizedName = vmName.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const sanitizedCustomer = customer.toLowerCase().replace(/[^a-z0-9-]/g, '');

  return {
    resourceGroup: `mcp-${sanitizedCustomer}-${sanitizedName}-rg`,
    vnet: `mcp-${sanitizedName}-vnet`,
    subnet: `mcp-${sanitizedName}-subnet`,
    publicIp: `mcp-${sanitizedName}-ip`,
    nsg: `mcp-${sanitizedName}-nsg`,
    nic: `mcp-${sanitizedName}-nic`,
    vm: `mcp-${sanitizedName}`,
  };
}

/**
 * Get estimated monthly cost for a VM
 */
export function getEstimatedMonthlyCost(vmSize: string = 'Standard_D4s_v3'): {
  monthly: number;
  breakdown: { item: string; cost: number }[];
} {
  const vmCost = COST_ESTIMATES[vmSize as keyof typeof COST_ESTIMATES] || 140;
  const diskCost = COST_ESTIMATES.disk_128gb_premium;
  const ipCost = COST_ESTIMATES.public_ip;

  return {
    monthly: vmCost + diskCost + ipCost,
    breakdown: [
      { item: `VM (${vmSize})`, cost: vmCost },
      { item: 'OS Disk (128GB Premium SSD)', cost: diskCost },
      { item: 'Public IP', cost: ipCost },
    ],
  };
}

/**
 * Available VM sizes for provisioning
 */
export function getAvailableVmSizes(): { id: string; name: string; monthlyCost: number }[] {
  return [
    { id: 'Standard_D2s_v3', name: 'D2s v3 (2 vCPUs, 8GB RAM)', monthlyCost: 70 },
    { id: 'Standard_D4s_v3', name: 'D4s v3 (4 vCPUs, 16GB RAM)', monthlyCost: 140 },
    { id: 'Standard_D8s_v3', name: 'D8s v3 (8 vCPUs, 32GB RAM)', monthlyCost: 280 },
  ];
}

/**
 * Available Azure regions for provisioning
 * Note: Currently limited to eastus because Packer images are regional
 * To add more regions, images need to be copied or use Azure Compute Gallery
 */
export function getAvailableRegions(): { id: string; name: string }[] {
  return [
    { id: 'eastus', name: 'East US (image available)' },
    // Other regions require image replication:
    // { id: 'westus2', name: 'West US 2' },
    // { id: 'westeurope', name: 'West Europe' },
    // { id: 'southeastasia', name: 'Southeast Asia' },
  ];
}

/**
 * Provision a new VM with full infrastructure
 */
export async function provisionVm(
  options: ProvisionVmOptions,
  onProgress?: (progress: ProvisioningProgress) => void
): Promise<ProvisionVmResult> {
  const subscriptionId = getSubscriptionId();
  const credential = getAzureCredential();

  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const networkClient = new NetworkManagementClient(credential, subscriptionId);
  const resourceClient = new ResourceManagementClient(credential, subscriptionId);

  const location = options.location || DEFAULT_VM_CONFIG.location;
  const vmSize = options.vmSize || DEFAULT_VM_CONFIG.vmSize;
  const names = generateResourceNames(options.name, options.customer);

  const progress = (step: string, status: ProvisioningProgress['status'], message: string) => {
    console.log(`[VM Provision] ${step}: ${message}`);
    onProgress?.({ step, status, message });
  };

  try {
    // Step 1: Get the latest Packer image (prefer gallery for specialized/faster boot)
    progress('image', 'in_progress', 'Finding latest image...');
    const image = await getLatestPackerImage(computeClient);
    if (!image) {
      return {
        success: false,
        error: 'No image found. Please ensure gallery or managed images exist in UI-AUTOMATION-IMAGES-RG.',
      };
    }
    const imageType = image.specialized ? 'specialized (fast boot)' : 'generalized (slower boot)';
    progress('image', 'completed', `Using ${imageType}: ${image.name}`);

    // Step 2: Create Resource Group
    progress('resource_group', 'in_progress', `Creating resource group: ${names.resourceGroup}`);
    await resourceClient.resourceGroups.createOrUpdate(names.resourceGroup, {
      location,
      tags: {
        customer: options.customer,
        'managed-by': 'mediar-dashboard',
        'created-at': new Date().toISOString(),
      },
    });
    progress('resource_group', 'completed', 'Resource group created');

    // Step 3: Create VNet and Subnet
    progress('network', 'in_progress', 'Creating virtual network...');
    const vnetPoller = await networkClient.virtualNetworks.beginCreateOrUpdate(
      names.resourceGroup,
      names.vnet,
      {
        location,
        addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
        subnets: [
          {
            name: names.subnet,
            addressPrefix: '10.0.1.0/24',
          },
        ],
      }
    );
    const vnet = await vnetPoller.pollUntilDone();
    progress('network', 'completed', 'Virtual network created');

    // Step 4: Create Public IP
    progress('public_ip', 'in_progress', 'Creating public IP...');
    const ipPoller = await networkClient.publicIPAddresses.beginCreateOrUpdate(
      names.resourceGroup,
      names.publicIp,
      {
        location,
        publicIPAllocationMethod: 'Static',
        sku: { name: 'Standard' },
      }
    );
    const publicIp = await ipPoller.pollUntilDone();
    progress('public_ip', 'completed', `Public IP: ${publicIp.ipAddress}`);

    // Step 5: Create NSG
    progress('nsg', 'in_progress', 'Creating network security group...');
    const nsgPoller = await networkClient.networkSecurityGroups.beginCreateOrUpdate(
      names.resourceGroup,
      names.nsg,
      {
        location,
        securityRules: DEFAULT_VM_CONFIG.ports.map(p => ({
          name: `Allow-${p.name}`,
          protocol: 'Tcp',
          sourcePortRange: '*',
          destinationPortRange: String(p.port),
          sourceAddressPrefix: '*',
          destinationAddressPrefix: '*',
          access: 'Allow',
          priority: p.priority,
          direction: 'Inbound',
        })),
      }
    );
    const nsg = await nsgPoller.pollUntilDone();
    progress('nsg', 'completed', 'Network security group created');

    // Step 6: Create NIC
    progress('nic', 'in_progress', 'Creating network interface...');
    const subnetId = vnet.subnets?.[0]?.id;
    if (!subnetId) {
      throw new Error('Failed to get subnet ID');
    }

    const nicPoller = await networkClient.networkInterfaces.beginCreateOrUpdate(
      names.resourceGroup,
      names.nic,
      {
        location,
        ipConfigurations: [
          {
            name: 'ipconfig1',
            subnet: { id: subnetId },
            publicIPAddress: { id: publicIp.id },
          },
        ],
        networkSecurityGroup: { id: nsg.id },
      }
    );
    const nic = await nicPoller.pollUntilDone();
    progress('nic', 'completed', 'Network interface created');

    // Step 7: Create VM
    progress('vm', 'in_progress', 'Creating virtual machine (this may take a few minutes)...');
    const vmAdminUsername = process.env.AZURE_VM_ADMIN_USERNAME || 'vmuser';
    const vmAdminPassword = process.env.AZURE_VM_ADMIN_PASSWORD;

    // For generalized images, we need credentials
    if (!image.specialized && !vmAdminPassword) {
      throw new Error('AZURE_VM_ADMIN_PASSWORD environment variable is required for generalized images');
    }

    // Build VM parameters - osProfile differs based on image type
    // CRITICAL: Specialized images already have user/password baked in from Packer
    // Providing osProfile for specialized images breaks the VM Agent!
    const vmParameters: Parameters<typeof computeClient.virtualMachines.beginCreateOrUpdate>[2] = {
      location,
      hardwareProfile: { vmSize },
      storageProfile: {
        imageReference: { id: image.id },
        osDisk: {
          createOption: 'FromImage',
          managedDisk: {
            storageAccountType: DEFAULT_VM_CONFIG.osDiskType,
          },
          diskSizeGB: DEFAULT_VM_CONFIG.osDiskSizeGb,
        },
      },
      networkProfile: {
        networkInterfaces: [{ id: nic.id }],
      },
      tags: {
        customer: options.customer,
        'managed-by': 'mediar-dashboard',
        'organization-id': options.organizationId || '',
        'image-type': image.specialized ? 'specialized' : 'generalized',
      },
    };

    // Only set osProfile for generalized images
    // Specialized images have credentials baked in and setting osProfile breaks VM Agent
    if (!image.specialized) {
      vmParameters.osProfile = {
        computerName: names.vm,
        adminUsername: vmAdminUsername,
        adminPassword: vmAdminPassword,
        windowsConfiguration: {
          provisionVMAgent: true,
          enableAutomaticUpdates: false,
        },
      };
      progress('vm', 'in_progress', 'Creating VM with osProfile (generalized image)...');
    } else {
      progress('vm', 'in_progress', 'Creating VM without osProfile (specialized image - faster boot)...');
    }

    const vmPoller = await computeClient.virtualMachines.beginCreateOrUpdate(
      names.resourceGroup,
      names.vm,
      vmParameters
    );
    const vm = await vmPoller.pollUntilDone();
    progress('vm', 'completed', `Virtual machine created: ${vm.name}`);

    // Construct the Azure Resource ID
    const azureResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${names.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${names.vm}`;

    // Calculate MCP endpoint
    const mcpEndpoint = `http://${publicIp.ipAddress}:8080/mcp`;

    // Step 8: Configure VM and start MCP agent
    progress('configure', 'in_progress', 'Configuring VM and starting MCP agent...');
    try {
      // Run command to set resolution, auto-login, and start MCP
      const configScript = `
        # Set display resolution to 1920x1080 for better VNC experience
        try {
          Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DisplaySettings {
    [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public short dmLogPixels, dmBitsPerPel;
        public int dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
}
'@
          \$dm = New-Object DisplaySettings+DEVMODE
          \$dm.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf(\$dm)
          \$dm.dmPelsWidth = 1920
          \$dm.dmPelsHeight = 1080
          \$dm.dmFields = 0x180000
          [DisplaySettings]::ChangeDisplaySettings([ref]\$dm, 0) | Out-Null
          Write-Host 'Display resolution set to 1920x1080'
        } catch {
          Write-Host "Could not set resolution: \$_"
        }

        # Set auto-login registry keys
        \$winlogonPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'
        Set-ItemProperty -Path \$winlogonPath -Name 'AutoAdminLogon' -Value '1' -Type String
        Set-ItemProperty -Path \$winlogonPath -Name 'DefaultUsername' -Value '${vmAdminUsername}' -Type String
        Set-ItemProperty -Path \$winlogonPath -Name 'DefaultPassword' -Value '${vmAdminPassword}' -Type String
        Set-ItemProperty -Path \$winlogonPath -Name 'DefaultDomainName' -Value '.' -Type String
        Set-ItemProperty -Path \$winlogonPath -Name 'ForceAutoLogon' -Value '1' -Type String

        # Disable Ctrl+Alt+Del requirement
        Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'DisableCAD' -Value 1 -Type DWord -ErrorAction SilentlyContinue

        # Start MCP agent if not already running
        \$mcpProcess = Get-Process -Name 'terminator-mcp-agent' -ErrorAction SilentlyContinue
        if (-not \$mcpProcess) {
          Start-Process -FilePath 'C:\\MCP\\terminator-mcp-agent.exe' -ArgumentList '-t http --host 0.0.0.0 -p 8080 --auth-token ***REMOVED***' -WindowStyle Hidden
          Start-Sleep -Seconds 3
        }

        # Verify MCP is listening
        \$listening = netstat -an | Select-String ':8080.*LISTENING'
        if (\$listening) { 'MCP_STARTED' } else { 'MCP_NOT_LISTENING' }
      `;

      const runCommandPoller = await computeClient.virtualMachines.beginRunCommand(
        names.resourceGroup,
        names.vm,
        {
          commandId: 'RunPowerShellScript',
          script: [configScript],
        }
      );
      const runResult = await runCommandPoller.pollUntilDone();
      const output = runResult.value?.[0]?.message || '';

      if (output.includes('MCP_STARTED')) {
        progress('configure', 'completed', 'MCP agent started successfully');
      } else {
        console.warn('[VM Provision] MCP may not have started correctly:', output);
        progress('configure', 'completed', 'VM configured (MCP may need manual start)');
      }
    } catch (configError) {
      console.error('[VM Provision] Configure step failed:', configError);
      progress('configure', 'completed', 'VM created (configure step failed - MCP may need manual start)');
    }

    return {
      success: true,
      vmId: azureResourceId,
      publicIp: publicIp.ipAddress || undefined,
      mcpEndpoint,
      details: {
        resourceGroup: names.resourceGroup,
        vmName: names.vm,
        location,
        vmSize,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[VM Provision] Failed:', error);

    // Attempt cleanup on failure
    progress('cleanup', 'in_progress', 'Cleaning up failed resources...');
    try {
      await resourceClient.resourceGroups.beginDelete(names.resourceGroup);
      progress('cleanup', 'completed', 'Cleanup initiated');
    } catch (cleanupError) {
      console.error('[VM Provision] Cleanup failed:', cleanupError);
      progress('cleanup', 'failed', 'Cleanup failed - manual cleanup may be required');
    }

    return {
      success: false,
      error: errorMessage,
      details: {
        resourceGroup: names.resourceGroup,
        vmName: names.vm,
        location,
        vmSize,
      },
    };
  }
}

/**
 * Test Azure image listing (diagnostic)
 */
export async function testImageListing(): Promise<{
  success: boolean;
  subscriptionId: string;
  resourceGroup: string;
  // Gallery info
  galleryName: string;
  galleryImageVersions: number;
  latestGalleryVersion: string | null;
  // Legacy managed images
  totalManagedImages: number;
  matchingManagedImages: number;
  latestManagedImage: string | null;
  // Which will be used
  selectedImage: string | null;
  imageType: 'gallery' | 'managed' | null;
  error?: string;
}> {
  const subscriptionId = getSubscriptionId();
  const credential = getAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const imageRg = DEFAULT_VM_CONFIG.imageResourceGroup;
  const galleryName = DEFAULT_VM_CONFIG.galleryName;
  const imageName = DEFAULT_VM_CONFIG.galleryImageName;
  const prefix = DEFAULT_VM_CONFIG.imageNamePrefix;

  let galleryVersions: string[] = [];
  let managedImages: string[] = [];

  try {
    // Check gallery
    try {
      const versions: Array<{ name?: string }> = [];
      const paginator = computeClient.galleryImageVersions
        .listByGalleryImage(imageRg, galleryName, imageName)
        .byPage();

      for await (const page of paginator) {
        versions.push(...page);
      }

      galleryVersions = versions
        .filter((v): v is { name: string } => !!v.name)
        .map(v => v.name)
        .sort((a, b) => b.localeCompare(a));
    } catch {
      // Gallery not available
    }

    // Check managed images
    const allImages: Array<{ name?: string }> = [];
    const paginator = computeClient.images.listByResourceGroup(imageRg).byPage();

    for await (const page of paginator) {
      allImages.push(...page);
    }

    managedImages = allImages
      .filter((img): img is { name: string } => !!img.name && img.name.startsWith(prefix))
      .map(img => img.name)
      .sort((a, b) => b.localeCompare(a));

    // Determine which will be used
    const useGallery = galleryVersions.length > 0;

    return {
      success: true,
      subscriptionId,
      resourceGroup: imageRg,
      galleryName,
      galleryImageVersions: galleryVersions.length,
      latestGalleryVersion: galleryVersions[0] || null,
      totalManagedImages: allImages.length,
      matchingManagedImages: managedImages.length,
      latestManagedImage: managedImages[0] || null,
      selectedImage: useGallery
        ? `${imageName}/${galleryVersions[0]}`
        : managedImages[0] || null,
      imageType: useGallery ? 'gallery' : managedImages.length > 0 ? 'managed' : null,
    };
  } catch (error) {
    return {
      success: false,
      subscriptionId,
      resourceGroup: imageRg,
      galleryName,
      galleryImageVersions: 0,
      latestGalleryVersion: null,
      totalManagedImages: 0,
      matchingManagedImages: 0,
      latestManagedImage: null,
      selectedImage: null,
      imageType: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete a VM and all its associated resources
 */
export async function deleteVmResources(resourceGroup: string): Promise<{ success: boolean; error?: string }> {
  const subscriptionId = getSubscriptionId();
  const credential = getAzureCredential();
  const resourceClient = new ResourceManagementClient(credential, subscriptionId);

  try {
    console.log(`[VM Provision] Deleting resource group: ${resourceGroup}`);
    await resourceClient.resourceGroups.beginDelete(resourceGroup);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[VM Provision] Delete failed:', error);
    return { success: false, error: errorMessage };
  }
}
