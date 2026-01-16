import { inngest } from '../client';
import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { ResourceManagementClient } from '@azure/arm-resources';
import { getAzureCredential, getSubscriptionId } from '@/lib/azure/client';
import { createClient } from '@supabase/supabase-js';
import { clerkClient } from '@clerk/nextjs/server';
import { Resend } from 'resend';
import { getPostHogClient } from '@/lib/posthog-server';

// VM Configuration
const VM_CONFIG = {
  location: 'eastus',
  vmSize: 'Standard_D4s_v3',
  osDiskSizeGb: 128,
  osDiskType: 'Premium_LRS',
  imageResourceGroup: 'UI-AUTOMATION-IMAGES-RG',
  galleryName: 'mcpimages',
  galleryImageName: 'mcp-full',
  imageNamePrefix: 'mcp-full-',
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

export const provisionVmFunction = inngest.createFunction(
  {
    id: 'provision-vm',
    retries: 2,
  },
  { event: 'vm/provision.requested' },
  async ({ event, step }) => {
    const { requestId, vmName, customer, location, vmSize, userId, orgId, clientIp, isTrial, trialConfig: _trialConfig, launchCost: _launchCost } = event.data;

    // Step 0: Create the database record (INNGEST-FIRST approach)
    // This is the first step - if it fails, no orphan records are created
    const { machineId } = await step.run('create-db-record', async () => {
      console.log(`[Provision] Creating DB record for requestId: ${requestId}`);
      const supabase = getSupabase();

      // Build tags array (same format as original API)
      const terraformKey = `user-${userId}-${vmName}`;
      const placeholderIp = '0.0.0.0';
      const tags = [
        `terraform:${terraformKey}`,
        `user:${userId}`,
        `vm:${vmName}`,
        `request:${requestId}`,
      ];
      if (clientIp && clientIp !== 'unknown') {
        tags.push(`ip:${clientIp}`);
      }
      if (isTrial) {
        tags.push('trial:true');
      }

      const { data: machine, error } = await supabase
        .from('remote_machines')
        .insert({
          name: vmName,
          mcp_endpoint: `http://${placeholderIp}:8080/mcp`,
          health_endpoint: `http://${placeholderIp}:8080/health`,
          management_endpoint: `http://${placeholderIp}:8080/management`,
          terraform_key: terraformKey,
          tags,
          status: 'inactive',
          health_status: 'unknown',
          machine_type: 'windows_vm',
          region: location || 'eastus',
          is_global: false,
          owner_user_id: userId,
          owner_org_id: orgId || null,
          provisioned_at: new Date().toISOString(),
          provisioning_step: JSON.stringify({
            step: 'init',
            status: 'in_progress',
            message: 'Inngest job started, creating VM...',
            timestamp: new Date().toISOString(),
          }),
        })
        .select('id')
        .single();

      if (error || !machine) {
        console.error('[Provision] Failed to create DB record:', error);
        throw new Error(`Failed to create provisioning record: ${error?.message || 'Unknown error'}`);
      }

      console.log(`[Provision] DB record created with machineId: ${machine.id}`);
      return { machineId: machine.id };
    });
    const names = generateResourceNames(vmName, customer);
    const subscriptionId = getSubscriptionId();
    const credential = getAzureCredential();

    const computeClient = new ComputeManagementClient(credential, subscriptionId);
    const networkClient = new NetworkManagementClient(credential, subscriptionId);
    const resourceClient = new ResourceManagementClient(credential, subscriptionId);

    // Step 1: Find latest image
    const image = await step.run('find-image', async () => {
      await updateProvisioningStep(machineId, 'image', 'in_progress', 'Finding latest VM image...');

      const imageRg = VM_CONFIG.imageResourceGroup;
      const galleryName = VM_CONFIG.galleryName;
      const imageName = VM_CONFIG.galleryImageName;

      // Try gallery first
      try {
        const versions: Array<{ name?: string }> = [];
        const paginator = computeClient.galleryImageVersions
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
        console.log('[Provision] Gallery not available, trying managed images');
      }

      // Fallback to managed images
      const prefix = VM_CONFIG.imageNamePrefix;
      const allImages: Array<{ name?: string }> = [];
      const paginator = computeClient.images.listByResourceGroup(imageRg).byPage();

      for await (const page of paginator) {
        allImages.push(...page);
      }

      const matchingImages = allImages
        .filter((img): img is { name: string } => !!img.name && img.name.startsWith(prefix))
        .sort((a, b) => b.name.localeCompare(a.name));

      if (matchingImages.length === 0) {
        throw new Error('No VM images found');
      }

      const latest = matchingImages[0];
      const imageId = `/subscriptions/${subscriptionId}/resourceGroups/${imageRg}/providers/Microsoft.Compute/images/${latest.name}`;

      await updateProvisioningStep(machineId, 'image', 'completed', `Using managed image: ${latest.name}`);
      return { id: imageId, name: latest.name, specialized: false };
    });

    // Step 2: Create Resource Group
    await step.run('create-resource-group', async () => {
      await updateProvisioningStep(machineId, 'resource_group', 'in_progress', `Creating resource group: ${names.resourceGroup}`);

      await resourceClient.resourceGroups.createOrUpdate(names.resourceGroup, {
        location: location || VM_CONFIG.location,
        tags: {
          customer,
          'managed-by': 'mediar-dashboard',
          'created-at': new Date().toISOString(),
        },
      });

      await updateProvisioningStep(machineId, 'resource_group', 'completed', 'Resource group created');
      return names.resourceGroup;
    });

    // Step 3: Create Network (VNet + Subnet)
    const vnet = await step.run('create-network', async () => {
      await updateProvisioningStep(machineId, 'network', 'in_progress', 'Creating virtual network...');

      const vnetPoller = await networkClient.virtualNetworks.beginCreateOrUpdate(
        names.resourceGroup,
        names.vnet,
        {
          location: location || VM_CONFIG.location,
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

      const ipPoller = await networkClient.publicIPAddresses.beginCreateOrUpdate(
        names.resourceGroup,
        names.publicIp,
        {
          location: location || VM_CONFIG.location,
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

      const nsgPoller = await networkClient.networkSecurityGroups.beginCreateOrUpdate(
        names.resourceGroup,
        names.nsg,
        {
          location: location || VM_CONFIG.location,
          securityRules: VM_CONFIG.ports.map((p) => ({
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

      const nicPoller = await networkClient.networkInterfaces.beginCreateOrUpdate(
        names.resourceGroup,
        names.nic,
        {
          location: location || VM_CONFIG.location,
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
      await updateProvisioningStep(machineId, 'vm', 'in_progress', 'Creating virtual machine (this takes a few minutes)...');

      const vmAdminUsername = process.env.AZURE_VM_ADMIN_USERNAME || 'vmuser';
      const vmAdminPassword = process.env.AZURE_VM_ADMIN_PASSWORD;

      // For specialized images, osProfile must NOT be provided (already baked in).
      // For generalized images, osProfile is required.
      const vmParameters: any = {
        location: location || VM_CONFIG.location,
        hardwareProfile: { vmSize: vmSize || VM_CONFIG.vmSize },
        storageProfile: {
          imageReference: { id: image.id },
          osDisk: {
            createOption: 'FromImage',
            managedDisk: { storageAccountType: VM_CONFIG.osDiskType },
            diskSizeGB: VM_CONFIG.osDiskSizeGb,
          },
        },
        networkProfile: {
          networkInterfaces: [{ id: nic.id }],
        },
        tags: {
          customer,
          'managed-by': 'mediar-dashboard',
          'organization-id': orgId || '',
          'is-trial': isTrial ? 'true' : 'false',
          'request-id': requestId,
        },
      };

      // Only add osProfile for generalized images (not specialized)
      if (!image.specialized) {
        if (!vmAdminPassword) {
          throw new Error('AZURE_VM_ADMIN_PASSWORD not set (required for generalized images)');
        }
        vmParameters.osProfile = {
          computerName: names.vm,
          adminUsername: vmAdminUsername,
          adminPassword: vmAdminPassword,
          windowsConfiguration: {
            provisionVMAgent: true,
            enableAutomaticUpdates: false,
          },
        };
      }

      const vmPoller = await computeClient.virtualMachines.beginCreateOrUpdate(
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

      // Get auth token from event data (if provided for trial VM auto-auth)
      const authToken = event.data.authToken;

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

        ${authToken ? `# Set auth token for mediar-app auto-login (trial VM)
        [System.Environment]::SetEnvironmentVariable('MEDIAR_AUTH_TOKEN', '${authToken}', 'Machine')
        Write-Host 'MEDIAR_AUTH_TOKEN set for auto-login'` : '# No auth token provided'}

        $mcpProcess = Get-Process -Name 'terminator-mcp-agent' -ErrorAction SilentlyContinue
        if (-not $mcpProcess) {
          Start-Process -FilePath 'C:\\MCP\\terminator-mcp-agent.exe' -ArgumentList '-t http --host 0.0.0.0 -p 8080 --auth-token ***REMOVED***' -WindowStyle Hidden
          Start-Sleep -Seconds 3
        }

        $listening = netstat -an | Select-String ':8080.*LISTENING'
        if ($listening) { 'MCP_STARTED' } else { 'MCP_NOT_LISTENING' }
      `;

      try {
        const runCommandPoller = await computeClient.virtualMachines.beginRunCommand(
          names.resourceGroup,
          names.vm,
          { commandId: 'RunPowerShellScript', script: [configScript] }
        );
        const result = await runCommandPoller.pollUntilDone();
        const output = result.value?.[0]?.message || '';

        if (output.includes('MCP_STARTED')) {
          await updateProvisioningStep(machineId, 'configure', 'completed', 'MCP agent started');
        } else {
          await updateProvisioningStep(machineId, 'configure', 'completed', 'VM configured (MCP may need manual start)');
        }
      } catch (e) {
        await updateProvisioningStep(machineId, 'configure', 'completed', 'VM configured (configure step had issues)');
      }

      return { configured: true };
    });

    // Step 9: Update database with final details
    await step.run('finalize', async () => {
      await updateProvisioningStep(machineId, 'finalize', 'in_progress', 'Finalizing...');

      const supabase = getSupabase();
      const mcpEndpoint = `http://${publicIp.ipAddress}:8080/mcp`;

      await supabase
        .from('remote_machines')
        .update({
          mcp_endpoint: mcpEndpoint,
          health_endpoint: `http://${publicIp.ipAddress}:8080/health`,
          management_endpoint: `http://${publicIp.ipAddress}:8080/management`,
          azure_resource_id: vm.azureResourceId,
          status: 'active',
          provisioning_step: JSON.stringify({ step: 'done', status: 'completed', message: 'VM ready!', timestamp: new Date().toISOString() }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', machineId);

      // Track trial sandbox provisioned server-side
      if (isTrial) {
        try {
          const posthog = getPostHogClient();
          posthog.capture({
            distinctId: userId || 'system',
            event: 'trial_sandbox_provisioned_server',
            properties: {
              machine_id: machineId,
              machine_name: vmName,
              location,
              vm_size: vmSize,
              public_ip: publicIp.ipAddress,
              provisioning_duration_estimate: 'unknown', // Could calculate from step timestamps
              is_trial: true,
            },
          });
        } catch (e) {
          console.warn('[Provision] Failed to track PostHog event:', e);
        }
      }

      return { success: true, mcpEndpoint, publicIp: publicIp.ipAddress };
    });

    // Step 10: Send email notification to user
    await step.run('send-email', async () => {
      const { userId } = event.data;
      if (!userId) {
        console.log('[Provision] No userId provided, skipping email notification');
        return { sent: false, reason: 'no_user_id' };
      }

      try {
        const clerk = await clerkClient();
        const user = await clerk.users.getUser(userId);
        const email = user.emailAddresses?.[0]?.emailAddress;

        if (!email) {
          console.log('[Provision] No email found for user, skipping notification');
          return { sent: false, reason: 'no_email' };
        }

        const resendApiKey = process.env.RESEND_API_KEY;
        if (!resendApiKey) {
          console.log('[Provision] RESEND_API_KEY not configured, skipping email');
          return { sent: false, reason: 'no_resend_key' };
        }

        const resend = new Resend(resendApiKey);
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai';
        const fromEmail = (process.env.RESEND_FROM_EMAIL || 'alerts@alerts.mediar.ai').trim();

        const { data, error } = await resend.emails.send({
          from: `Mediar.ai <${fromEmail}>`,
          replyTo: ['matt@mediar.ai', 'louis@mediar.ai'],
          to: email,
          subject: `🖥️ Your sandbox "${vmName}" is ready!`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 0 auto; }
                .content { background: white; padding: 32px 24px; }
                .action-button { display: inline-block; background: #000; color: white !important; padding: 14px 28px; border-radius: 6px; text-decoration: none !important; font-weight: 600; margin: 8px; font-size: 14px; }
                .footer { padding: 24px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e5e5e5; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="content">
                  <h2 style="margin: 0 0 16px 0; font-size: 24px;">Your Sandbox is Ready! 🎉</h2>

                  <p style="font-size: 16px; margin: 16px 0;">
                    Great news! Your cloud sandbox <strong>"${vmName}"</strong> is ready to use.
                  </p>

                  <p style="font-size: 15px; margin: 20px 0;">
                    Click the button below to access your sandbox and start building automations.
                  </p>

                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${baseUrl}/my-machines" class="action-button">
                      Open Sandbox
                    </a>
                  </div>

                  <p style="font-size: 14px; color: #666; margin-top: 24px;">
                    Need help? Reply to this email and we'll get back to you.
                  </p>
                </div>

                <div class="footer">
                  <p style="margin: 0;">Mediar • Workflow Automation</p>
                  <p style="margin: 8px 0 0 0; font-size: 10px; color: #999;">Machine ID: ${machineId}</p>
                </div>
              </div>
            </body>
            </html>
          `,
        });

        if (error) {
          console.error('[Provision] Failed to send email:', error);
          return { sent: false, error: error.message };
        }

        console.log(`[Provision] Email sent successfully to ${email}, id: ${data?.id}`);
        return { sent: true, email, messageId: data?.id };
      } catch (err) {
        console.error('[Provision] Error sending email:', err);
        return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    });

    return {
      success: true,
      machineId,
      vmName: names.vm,
      publicIp: publicIp.ipAddress,
      resourceGroup: names.resourceGroup,
    };
  }
);
