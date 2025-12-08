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
 * Get the latest Packer image from the UI-AUTOMATION-IMAGES-RG
 */
async function getLatestPackerImage(
  computeClient: ComputeManagementClient
): Promise<{ id: string; name: string } | null> {
  const subscriptionId = getSubscriptionId();
  const imageRg = DEFAULT_VM_CONFIG.imageResourceGroup;
  const prefix = DEFAULT_VM_CONFIG.imageNamePrefix;

  console.log(`[VM Provision] Looking for images with prefix '${prefix}' in ${imageRg} (subscription: ${subscriptionId})`);

  try {
    const images: { name: string; id: string; timestamp: Date }[] = [];
    let totalImages = 0;

    for await (const image of computeClient.images.listByResourceGroup(imageRg)) {
      totalImages++;
      console.log(`[VM Provision] Found image: ${image.name}`);
      if (image.name?.startsWith(prefix)) {
        // Extract timestamp from image name (e.g., mcp-full-20241201-123456)
        const timestampStr = image.name.replace(prefix, '');
        // Handle format: 20251207-050456 (date-time with dash separator)
        const timestamp = new Date(
          timestampStr.replace(
            /(\d{4})(\d{2})(\d{2})-?(\d{2})(\d{2})(\d{2})/,
            '$1-$2-$3T$4:$5:$6Z'
          )
        );

        images.push({
          name: image.name,
          id: `/subscriptions/${subscriptionId}/resourceGroups/${imageRg}/providers/Microsoft.Compute/images/${image.name}`,
          timestamp: isNaN(timestamp.getTime()) ? new Date(0) : timestamp,
        });
      }
    }

    console.log(`[VM Provision] Total images in RG: ${totalImages}, matching prefix: ${images.length}`);

    if (images.length === 0) {
      console.error(`[VM Provision] No images found with prefix '${prefix}' out of ${totalImages} total images`);
      return null;
    }

    // Sort by timestamp descending and get the latest
    images.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const latest = images[0];

    console.log(`[VM Provision] Using image: ${latest.name}`);
    return { id: latest.id, name: latest.name };
  } catch (error) {
    console.error('[VM Provision] Failed to list images:', error);
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
 */
export function getAvailableRegions(): { id: string; name: string }[] {
  return [
    { id: 'eastus', name: 'East US' },
    { id: 'westus2', name: 'West US 2' },
    { id: 'westeurope', name: 'West Europe' },
    { id: 'southeastasia', name: 'Southeast Asia' },
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
    // Step 1: Get the latest Packer image
    progress('image', 'in_progress', 'Finding latest Packer image...');
    const image = await getLatestPackerImage(computeClient);
    if (!image) {
      return {
        success: false,
        error: 'No Packer image found. Please ensure images exist in UI-AUTOMATION-IMAGES-RG.',
      };
    }
    progress('image', 'completed', `Using image: ${image.name}`);

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

    if (!vmAdminPassword) {
      throw new Error('AZURE_VM_ADMIN_PASSWORD environment variable is required');
    }

    const vmPoller = await computeClient.virtualMachines.beginCreateOrUpdate(
      names.resourceGroup,
      names.vm,
      {
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
        osProfile: {
          computerName: names.vm,
          adminUsername: vmAdminUsername,
          adminPassword: vmAdminPassword,
          windowsConfiguration: {
            provisionVMAgent: true,
            enableAutomaticUpdates: false,
          },
        },
        networkProfile: {
          networkInterfaces: [{ id: nic.id }],
        },
        tags: {
          customer: options.customer,
          'managed-by': 'mediar-dashboard',
          'organization-id': options.organizationId || '',
        },
      }
    );
    const vm = await vmPoller.pollUntilDone();
    progress('vm', 'completed', `Virtual machine created: ${vm.name}`);

    // Construct the Azure Resource ID
    const azureResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${names.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${names.vm}`;

    // Calculate MCP endpoint
    const mcpEndpoint = `http://${publicIp.ipAddress}:8080/mcp`;

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
