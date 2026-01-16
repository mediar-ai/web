import { inngest } from '../client';
import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { ResourceManagementClient } from '@azure/arm-resources';
import { getAzureCredential, getSubscriptionId } from '@/lib/azure/client';
import { createClient } from '@supabase/supabase-js';
import {
  WARM_POOL_CONFIG,
  generatePoolVmName,
  getNewPoolVmTags,
  updateTagsToClaimedStatus,
} from '@/lib/config/warm-pool';

// VM Configuration for pool VMs (matches trial config from provision-vm.ts)
const POOL_VM_CONFIG = {
  location: 'eastus',
  vmSize: WARM_POOL_CONFIG.vmSize,
  osDiskSizeGb: 128,
  osDiskType: 'Premium_LRS',
  imageResourceGroup: 'UI-AUTOMATION-IMAGES-RG',
  galleryName: 'mcpimages',
  galleryImageName: 'mcp-full',
  ports: [
    { name: 'MCP', port: 8080, priority: 100 },
    { name: 'RDP', port: 3389, priority: 110 },
    { name: 'VNC', port: 5900, priority: 120 },
  ],
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

function getAzureClients() {
  const subscriptionId = getSubscriptionId();
  const credential = getAzureCredential();
  return {
    compute: new ComputeManagementClient(credential, subscriptionId),
    network: new NetworkManagementClient(credential, subscriptionId),
    resource: new ResourceManagementClient(credential, subscriptionId),
    subscriptionId,
  };
}

function generatePoolResourceNames(vmName: string) {
  const sanitizedName = vmName.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return {
    resourceGroup: `${WARM_POOL_CONFIG.resourceGroup}`,
    vnet: `mcp-${sanitizedName}-vnet`,
    subnet: `mcp-${sanitizedName}-subnet`,
    publicIp: `mcp-${sanitizedName}-ip`,
    nsg: `mcp-${sanitizedName}-nsg`,
    nic: `mcp-${sanitizedName}-nic`,
    vm: `mcp-${sanitizedName}`,
  };
}

// Parse resource group and VM name from azure_resource_id
function parseAzureResourceId(resourceId: string): { resourceGroup: string; vmName: string } | null {
  const match = resourceId.match(/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/]+)/i);
  if (match) {
    return { resourceGroup: match[1], vmName: match[2] };
  }
  return null;
}

async function updateProvisioningStep(
  machineId: number,
  step: string,
  status: 'in_progress' | 'completed' | 'failed',
  message: string
) {
  const supabase = getSupabase();
  await supabase
    .from('remote_machines')
    .update({
      provisioning_step: JSON.stringify({ step, status, message, timestamp: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', machineId);
}

/**
 * Cron job to maintain the warm pool at target size
 * Runs every 5 minutes to check and replenish pool VMs
 */
export const maintainWarmPoolFunction = inngest.createFunction(
  {
    id: 'maintain-warm-pool',
    retries: 1,
  },
  { cron: '*/5 * * * *' }, // Every 5 minutes
  async ({ step }) => {
    const supabase = getSupabase();

    // Count available pool VMs
    const availableCount = await step.run('count-available-pool-vms', async () => {
      const { count, error } = await supabase
        .from('remote_machines')
        .select('id', { count: 'exact', head: true })
        .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
        .eq('status', 'inactive'); // Stopped/deallocated

      if (error) {
        console.error('[Warm Pool Maintain] Failed to count available VMs:', error);
        return 0;
      }

      return count || 0;
    });

    console.log(`[Warm Pool Maintain] Available pool VMs: ${availableCount}/${WARM_POOL_CONFIG.targetSize}`);

    // Check if we need to provision more
    if (availableCount >= WARM_POOL_CONFIG.targetSize) {
      return {
        action: 'none',
        availableCount,
        targetSize: WARM_POOL_CONFIG.targetSize,
        message: 'Pool is at target size',
      };
    }

    // Check total pool VMs (including claimed) to respect max limit
    const totalPoolCount = await step.run('count-total-pool-vms', async () => {
      const { count, error } = await supabase
        .from('remote_machines')
        .select('id', { count: 'exact', head: true })
        .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm])
        .not('status', 'eq', 'deleted');

      if (error) {
        console.error('[Warm Pool Maintain] Failed to count total pool VMs:', error);
        return 0;
      }

      return count || 0;
    });

    if (totalPoolCount >= WARM_POOL_CONFIG.maxPoolVms) {
      console.log(`[Warm Pool Maintain] At max pool VMs: ${totalPoolCount}/${WARM_POOL_CONFIG.maxPoolVms}`);
      return {
        action: 'none',
        availableCount,
        totalCount: totalPoolCount,
        maxPoolVms: WARM_POOL_CONFIG.maxPoolVms,
        message: 'Pool is at maximum capacity',
      };
    }

    // Calculate how many VMs to provision
    const neededCount = Math.min(
      WARM_POOL_CONFIG.targetSize - availableCount,
      WARM_POOL_CONFIG.maxPoolVms - totalPoolCount
    );

    console.log(`[Warm Pool Maintain] Need to provision ${neededCount} pool VMs`);

    // Trigger provisioning events
    const events = await step.run('trigger-provision-events', async () => {
      const triggered: string[] = [];

      for (let i = 0; i < neededCount; i++) {
        const poolVmName = generatePoolVmName();
        await inngest.send({
          name: 'pool/provision.requested',
          data: { poolVmName },
        });
        triggered.push(poolVmName);
        console.log(`[Warm Pool Maintain] Triggered provision for: ${poolVmName}`);
      }

      return triggered;
    });

    return {
      action: 'provisioning',
      availableCount,
      targetSize: WARM_POOL_CONFIG.targetSize,
      triggered: events,
      message: `Triggered ${events.length} pool VM provisions`,
    };
  }
);

/**
 * Provision a new pool VM
 * Creates the VM, then stops it to save costs while keeping it ready
 */
export const provisionPoolVmFunction = inngest.createFunction(
  {
    id: 'provision-pool-vm',
    retries: 2,
  },
  { event: 'pool/provision.requested' },
  async ({ event, step }) => {
    const { poolVmName } = event.data;
    const supabase = getSupabase();

    const names = generatePoolResourceNames(poolVmName);
    const { compute, network, resource, subscriptionId } = getAzureClients();

    // Step 0: Create the database record
    const { machineId } = await step.run('create-db-record', async () => {
      console.log(`[Pool Provision] Creating DB record for pool VM: ${poolVmName}`);

      const terraformKey = `pool-${poolVmName}`;
      const placeholderIp = '0.0.0.0';
      const tags = getNewPoolVmTags(terraformKey);

      const { data: machine, error } = await supabase
        .from('remote_machines')
        .insert({
          name: poolVmName,
          mcp_endpoint: `http://${placeholderIp}:8080/mcp`,
          health_endpoint: `http://${placeholderIp}:8080/health`,
          management_endpoint: `http://${placeholderIp}:8080/management`,
          terraform_key: terraformKey,
          tags,
          status: 'inactive',
          health_status: 'unknown',
          machine_type: 'windows_vm',
          region: POOL_VM_CONFIG.location,
          is_global: false,
          owner_user_id: null, // Pool-owned, no owner
          owner_org_id: null,
          provisioned_at: new Date().toISOString(),
          provisioning_step: JSON.stringify({
            step: 'init',
            status: 'in_progress',
            message: 'Provisioning pool VM...',
            timestamp: new Date().toISOString(),
          }),
        })
        .select('id')
        .single();

      if (error || !machine) {
        console.error('[Pool Provision] Failed to create DB record:', error);
        throw new Error(`Failed to create pool VM record: ${error?.message || 'Unknown error'}`);
      }

      console.log(`[Pool Provision] DB record created with machineId: ${machine.id}`);
      return { machineId: machine.id };
    });

    // Step 1: Ensure resource group exists
    await step.run('ensure-resource-group', async () => {
      await updateProvisioningStep(machineId, 'resource_group', 'in_progress', 'Ensuring resource group exists...');

      try {
        await resource.resourceGroups.createOrUpdate(names.resourceGroup, {
          location: POOL_VM_CONFIG.location,
          tags: {
            'managed-by': 'mediar-warm-pool',
            'created-at': new Date().toISOString(),
          },
        });
      } catch (err: unknown) {
        // Resource group might already exist, which is fine
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('already exists')) {
          throw err;
        }
      }

      await updateProvisioningStep(machineId, 'resource_group', 'completed', 'Resource group ready');
      return names.resourceGroup;
    });

    // Step 2: Find latest image
    const image = await step.run('find-image', async () => {
      await updateProvisioningStep(machineId, 'image', 'in_progress', 'Finding latest VM image...');

      const imageRg = POOL_VM_CONFIG.imageResourceGroup;
      const galleryName = POOL_VM_CONFIG.galleryName;
      const imageName = POOL_VM_CONFIG.galleryImageName;

      // Try gallery first
      try {
        const versions: Array<{ name?: string }> = [];
        const paginator = compute.galleryImageVersions
          .listByGalleryImage(imageRg, galleryName, imageName)
          .byPage();

        for await (const page of paginator) {
          versions.push(...page);
        }

        if (versions.length > 0) {
          const sortedVersions = versions
            .filter((v): v is { name: string } => !!v.name)
            .sort((a, b) => b.name.localeCompare(a.name));

          const latestVersion = sortedVersions[0].name;
          const imageId = `/subscriptions/${subscriptionId}/resourceGroups/${imageRg}/providers/Microsoft.Compute/galleries/${galleryName}/images/${imageName}/versions/${latestVersion}`;

          await updateProvisioningStep(machineId, 'image', 'completed', `Using gallery image: ${imageName}/${latestVersion}`);
          return { id: imageId, name: `${imageName}/${latestVersion}`, specialized: true };
        }
      } catch (e) {
        console.log('[Pool Provision] Gallery not available, trying managed images');
      }

      throw new Error('No VM images found for pool provisioning');
    });

    // Step 3: Create Network (VNet + Subnet)
    const vnet = await step.run('create-network', async () => {
      await updateProvisioningStep(machineId, 'network', 'in_progress', 'Creating virtual network...');

      const vnetPoller = await network.virtualNetworks.beginCreateOrUpdate(
        names.resourceGroup,
        names.vnet,
        {
          location: POOL_VM_CONFIG.location,
          addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
          subnets: [{ name: names.subnet, addressPrefix: '10.0.1.0/24' }],
        }
      );
      const result = await vnetPoller.pollUntilDone();

      await updateProvisioningStep(machineId, 'network', 'completed', 'Virtual network created');
      return { id: result.id, subnetId: result.subnets?.[0]?.id };
    });

    // Step 4: Create Public IP
    const publicIp = await step.run('create-public-ip', async () => {
      await updateProvisioningStep(machineId, 'public_ip', 'in_progress', 'Creating public IP address...');

      const ipPoller = await network.publicIPAddresses.beginCreateOrUpdate(
        names.resourceGroup,
        names.publicIp,
        {
          location: POOL_VM_CONFIG.location,
          publicIPAllocationMethod: 'Static',
          sku: { name: 'Standard' },
        }
      );
      const result = await ipPoller.pollUntilDone();

      await updateProvisioningStep(machineId, 'public_ip', 'completed', `Public IP: ${result.ipAddress}`);
      return { id: result.id, ipAddress: result.ipAddress };
    });

    // Step 5: Create NSG
    const nsg = await step.run('create-nsg', async () => {
      await updateProvisioningStep(machineId, 'nsg', 'in_progress', 'Creating network security group...');

      const nsgPoller = await network.networkSecurityGroups.beginCreateOrUpdate(
        names.resourceGroup,
        names.nsg,
        {
          location: POOL_VM_CONFIG.location,
          securityRules: POOL_VM_CONFIG.ports.map((p) => ({
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
      const result = await nsgPoller.pollUntilDone();

      await updateProvisioningStep(machineId, 'nsg', 'completed', 'Network security group created');
      return { id: result.id };
    });

    // Step 6: Create NIC
    const nic = await step.run('create-nic', async () => {
      await updateProvisioningStep(machineId, 'nic', 'in_progress', 'Creating network interface...');

      const nicPoller = await network.networkInterfaces.beginCreateOrUpdate(
        names.resourceGroup,
        names.nic,
        {
          location: POOL_VM_CONFIG.location,
          ipConfigurations: [
            {
              name: 'ipconfig1',
              subnet: { id: vnet.subnetId },
              publicIPAddress: { id: publicIp.id },
            },
          ],
          networkSecurityGroup: { id: nsg.id },
        }
      );
      const result = await nicPoller.pollUntilDone();

      await updateProvisioningStep(machineId, 'nic', 'completed', 'Network interface created');
      return { id: result.id };
    });

    // Step 7: Create VM
    const vm = await step.run('create-vm', async () => {
      await updateProvisioningStep(machineId, 'vm', 'in_progress', 'Creating virtual machine...');

      const vmParameters: Parameters<ComputeManagementClient['virtualMachines']['beginCreateOrUpdate']>[2] = {
        location: POOL_VM_CONFIG.location,
        hardwareProfile: { vmSize: POOL_VM_CONFIG.vmSize },
        storageProfile: {
          imageReference: { id: image.id },
          osDisk: {
            createOption: 'FromImage',
            managedDisk: { storageAccountType: POOL_VM_CONFIG.osDiskType },
            diskSizeGB: POOL_VM_CONFIG.osDiskSizeGb,
          },
        },
        networkProfile: {
          networkInterfaces: [{ id: nic.id }],
        },
        tags: {
          'managed-by': 'mediar-warm-pool',
          'is-pool-vm': 'true',
          'is-trial': 'true',
        },
      };

      const vmPoller = await compute.virtualMachines.beginCreateOrUpdate(
        names.resourceGroup,
        names.vm,
        vmParameters
      );
      const result = await vmPoller.pollUntilDone();

      const azureResourceId = `/subscriptions/${subscriptionId}/resourceGroups/${names.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${names.vm}`;
      await updateProvisioningStep(machineId, 'vm', 'completed', `VM created: ${result.name}`);
      return { id: result.id, name: result.name, azureResourceId };
    });

    // Step 8: Configure VM (auto-login + start MCP)
    await step.run('configure-vm', async () => {
      await updateProvisioningStep(machineId, 'configure', 'in_progress', 'Configuring VM and starting MCP agent...');

      const vmAdminUsername = process.env.AZURE_VM_ADMIN_USERNAME || 'vmuser';
      const vmAdminPassword = process.env.AZURE_VM_ADMIN_PASSWORD!;

      const configScript = `
        $winlogonPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'
        Set-ItemProperty -Path $winlogonPath -Name 'AutoAdminLogon' -Value '1' -Type String
        Set-ItemProperty -Path $winlogonPath -Name 'DefaultUsername' -Value '${vmAdminUsername}' -Type String
        Set-ItemProperty -Path $winlogonPath -Name 'DefaultPassword' -Value '${vmAdminPassword}' -Type String
        Set-ItemProperty -Path $winlogonPath -Name 'DefaultDomainName' -Value '.' -Type String
        Set-ItemProperty -Path $winlogonPath -Name 'ForceAutoLogon' -Value '1' -Type String
        Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'DisableCAD' -Value 1 -Type DWord -ErrorAction SilentlyContinue

        # Optimize TightVNC for low-latency internet streaming
        $vncPath = 'HKLM:\\SOFTWARE\\TightVNC\\Server'
        if (Test-Path $vncPath) {
          Set-ItemProperty -Path $vncPath -Name 'PollingInterval' -Value 30 -Type DWord
          Set-ItemProperty -Path $vncPath -Name 'UseD3D' -Value 1 -Type DWord
          Set-ItemProperty -Path $vncPath -Name 'GrabTransparentWindows' -Value 0 -Type DWord
          Set-ItemProperty -Path $vncPath -Name 'RemoveWallpaper' -Value 1 -Type DWord
          Set-ItemProperty -Path $vncPath -Name 'RemovePattern' -Value 1 -Type DWord
          Set-ItemProperty -Path $vncPath -Name 'UseMirrorDriver' -Value 1 -Type DWord
          Restart-Service tvnserver -ErrorAction SilentlyContinue
          Write-Host 'TightVNC optimized for streaming'
        }

        $mcpProcess = Get-Process -Name 'terminator-mcp-agent' -ErrorAction SilentlyContinue
        if (-not $mcpProcess) {
          Start-Process -FilePath 'C:\\MCP\\terminator-mcp-agent.exe' -ArgumentList '-t http --host 0.0.0.0 -p 8080 --auth-token cargorunmediar123' -WindowStyle Hidden
          Start-Sleep -Seconds 3
        }

        $listening = netstat -an | Select-String ':8080.*LISTENING'
        if ($listening) { 'MCP_STARTED' } else { 'MCP_NOT_LISTENING' }
      `;

      try {
        const runCommandPoller = await compute.virtualMachines.beginRunCommand(
          names.resourceGroup,
          names.vm,
          { commandId: 'RunPowerShellScript', script: [configScript] }
        );
        await runCommandPoller.pollUntilDone();

        await updateProvisioningStep(machineId, 'configure', 'completed', 'VM configured');
      } catch (e) {
        await updateProvisioningStep(machineId, 'configure', 'completed', 'VM configured (configure step had issues)');
      }

      return { configured: true };
    });

    // Step 9: Update database with actual IP and azure_resource_id
    await step.run('update-db-with-ip', async () => {
      await updateProvisioningStep(machineId, 'finalize', 'in_progress', 'Updating database...');

      await supabase
        .from('remote_machines')
        .update({
          mcp_endpoint: `http://${publicIp.ipAddress}:8080/mcp`,
          health_endpoint: `http://${publicIp.ipAddress}:8080/health`,
          management_endpoint: `http://${publicIp.ipAddress}:8080/management`,
          azure_resource_id: vm.azureResourceId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', machineId);

      await updateProvisioningStep(machineId, 'finalize', 'completed', 'Database updated');
    });

    // Step 10: Stop (deallocate) the VM to save costs
    await step.run('deallocate-vm', async () => {
      await updateProvisioningStep(machineId, 'deallocate', 'in_progress', 'Stopping VM to save costs...');

      const poller = await compute.virtualMachines.beginDeallocate(names.resourceGroup, names.vm);
      await poller.pollUntilDone();

      // Update status to inactive (pool VM ready to claim)
      await supabase
        .from('remote_machines')
        .update({
          status: 'inactive',
          provisioning_step: JSON.stringify({
            step: 'pool_ready',
            status: 'completed',
            message: 'Pool VM ready for claiming',
            timestamp: new Date().toISOString(),
          }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', machineId);

      console.log(`[Pool Provision] VM ${poolVmName} provisioned and stopped, ready for claiming`);
    });

    return {
      success: true,
      machineId,
      vmName: poolVmName,
      resourceGroup: names.resourceGroup,
      publicIp: publicIp.ipAddress,
    };
  }
);

/**
 * Claim a pool VM for a user
 * Starts the VM and assigns it to the user
 */
export const claimPoolVmFunction = inngest.createFunction(
  {
    id: 'claim-pool-vm',
    retries: 2,
  },
  { event: 'pool/claim.requested' },
  async ({ event, step }) => {
    const { machineId, userId, orgId, requestId, vmName, authToken } = event.data;
    const supabase = getSupabase();

    // Step 1: Get machine details and verify it's still available
    const machine = await step.run('get-machine', async () => {
      const { data, error } = await supabase
        .from('remote_machines')
        .select('id, name, azure_resource_id, status, tags, mcp_endpoint')
        .eq('id', machineId)
        .single();

      if (error || !data) {
        throw new Error(`Machine ${machineId} not found`);
      }

      // Verify it's still claiming (we set this status before sending the event)
      const tags = data.tags || [];
      if (!tags.includes(WARM_POOL_CONFIG.tags.poolStatusClaiming)) {
        throw new Error(`Machine ${machineId} is no longer in claiming state`);
      }

      return data;
    });

    if (!machine.azure_resource_id) {
      throw new Error(`Machine ${machineId} has no Azure resource ID`);
    }

    const parsed = parseAzureResourceId(machine.azure_resource_id);
    if (!parsed) {
      throw new Error(`Invalid Azure resource ID: ${machine.azure_resource_id}`);
    }

    // Step 2: Start the VM
    await step.run('start-vm', async () => {
      await updateProvisioningStep(machineId, 'starting', 'in_progress', 'Starting your sandbox...');

      const { compute } = getAzureClients();

      const poller = await compute.virtualMachines.beginStart(parsed.resourceGroup, parsed.vmName);
      await poller.pollUntilDone();

      console.log(`[Pool Claim] VM ${parsed.vmName} started`);
    });

    // Step 2.5: Set auth token for auto-login (if provided)
    if (authToken) {
      await step.run('set-auth-token', async () => {
        await updateProvisioningStep(machineId, 'configure', 'in_progress', 'Configuring auto-login...');

        const { compute } = getAzureClients();

        const configScript = `
          # Set auth token for mediar-app auto-login (trial VM)
          [System.Environment]::SetEnvironmentVariable('MEDIAR_AUTH_TOKEN', '${authToken}', 'Machine')
          Write-Host 'MEDIAR_AUTH_TOKEN set for auto-login'
        `;

        try {
          const runCommandPoller = await compute.virtualMachines.beginRunCommand(
            parsed.resourceGroup,
            parsed.vmName,
            { commandId: 'RunPowerShellScript', script: [configScript] }
          );
          await runCommandPoller.pollUntilDone();
          console.log(`[Pool Claim] Auth token set for VM ${parsed.vmName}`);
        } catch (e) {
          // Non-fatal: VM will still work, just won't auto-login
          console.warn(`[Pool Claim] Failed to set auth token, VM will require manual login:`, e);
        }

        await updateProvisioningStep(machineId, 'configure', 'completed', 'Auto-login configured');
      });
    }

    // Step 3: Update tags to claimed and set owner
    await step.run('finalize-claim', async () => {
      await updateProvisioningStep(machineId, 'finalizing', 'in_progress', 'Almost ready...');

      const updatedTags = updateTagsToClaimedStatus(machine.tags || []);
      // Add user-specific tags
      updatedTags.push(`user:${userId}`);
      updatedTags.push(`request:${requestId}`);

      // Rename the VM in our DB if a new name was provided
      const finalName = vmName || machine.name;

      await supabase
        .from('remote_machines')
        .update({
          name: finalName,
          tags: updatedTags,
          owner_user_id: userId,
          owner_org_id: orgId || null,
          status: 'active',
          provisioning_step: JSON.stringify({
            step: 'done',
            status: 'completed',
            message: 'Sandbox ready!',
            timestamp: new Date().toISOString(),
          }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', machineId);

      console.log(`[Pool Claim] Machine ${machineId} claimed by user ${userId}`);
    });

    return {
      success: true,
      machineId,
      vmName: vmName || machine.name,
      mcpEndpoint: machine.mcp_endpoint,
    };
  }
);

/**
 * Replenish the warm pool after a VM is claimed
 * Triggered after a successful claim
 */
export const replenishWarmPoolFunction = inngest.createFunction(
  {
    id: 'replenish-warm-pool',
    retries: 1,
  },
  { event: 'pool/replenish.requested' },
  async ({ step }) => {
    // Simply trigger the maintain function logic
    const supabase = getSupabase();

    const availableCount = await step.run('count-available', async () => {
      const { count } = await supabase
        .from('remote_machines')
        .select('id', { count: 'exact', head: true })
        .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
        .eq('status', 'inactive');

      return count || 0;
    });

    if (availableCount < WARM_POOL_CONFIG.targetSize) {
      const poolVmName = generatePoolVmName();
      await step.run('trigger-provision', async () => {
        await inngest.send({
          name: 'pool/provision.requested',
          data: { poolVmName },
        });
      });

      console.log(`[Pool Replenish] Triggered provision for: ${poolVmName}`);
      return { triggered: poolVmName };
    }

    return { triggered: null, message: 'Pool already at target size' };
  }
);
