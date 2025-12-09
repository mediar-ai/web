import { NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const AZURE_SUBSCRIPTION_ID = '5c0a60d0-92cf-47ca-9430-b462bc2fe194';

// Azure pricing estimates (USD/hour) - East US 2 region
// Source: https://azure.microsoft.com/en-us/pricing/
const VM_HOURLY_RATES: Record<string, number> = {
  Standard_D2s_v3: 0.096,
  Standard_D4s_v3: 0.192,
  Standard_D8s_v3: 0.384,
  Standard_D16s_v3: 0.768,
  Standard_D32s_v3: 1.536,
  Standard_D2s_v5: 0.096,
  Standard_D4s_v5: 0.192,
  Standard_D8s_v5: 0.384,
  Standard_B2s: 0.0416,
  Standard_B4ms: 0.166,
};

// Disk pricing (USD/month per GB)
const DISK_MONTHLY_PER_GB: Record<string, number> = {
  Premium_LRS: 0.132, // P10-P80 average
  StandardSSD_LRS: 0.075,
  Standard_LRS: 0.04,
};

// Container Instance pricing (USD/hour)
const ACI_VCPU_HOUR = 0.0000125 * 3600; // ~$0.045/vCPU/hour
const ACI_GB_HOUR = 0.0000125 * 3600; // ~$0.045/GB/hour

// Other resources (USD/month)
const MONTHLY_RATES: Record<string, number> = {
  publicIP: 3.65, // Static IP
  loadBalancer: 18.25, // Basic
  natGateway: 32.85,
  containerRegistry: 5.0, // Basic tier
  logAnalytics: 2.76, // per GB ingested, estimate 1GB
};

async function getAzureAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: AZURE_CLIENT_ID!,
      client_secret: AZURE_CLIENT_SECRET!,
      scope: 'https://management.azure.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) throw new Error('Failed to get Azure token');
  return (await response.json()).access_token;
}

interface VMInfo {
  name: string;
  location: string;
  resourceGroup: string;
  vmSize: string;
  hourlyCost: number;
}

interface VMSSInfo {
  name: string;
  location: string;
  resourceGroup: string;
  vmSize: string;
  capacity: number;
  hourlyCost: number;
}

interface ContainerInfo {
  name: string;
  location: string;
  resourceGroup: string;
  vCPU: number;
  memoryGB: number;
  hourlyCost: number;
}

interface DiskInfo {
  name: string;
  resourceGroup: string;
  sku: string;
  sizeGB: number;
  monthlyCost: number;
}

async function getVirtualMachines(token: string): Promise<VMInfo[]> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.Compute/virtualMachines?api-version=2024-03-01`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return (data.value || []).map(
    (vm: {
      name: string;
      location: string;
      id: string;
      properties: { hardwareProfile: { vmSize: string } };
    }) => {
      const rgMatch = vm.id.match(/resourceGroups\/([^/]+)/i);
      const vmSize = vm.properties?.hardwareProfile?.vmSize || 'unknown';
      const hourlyRate = VM_HOURLY_RATES[vmSize] || 0.2;
      return {
        name: vm.name,
        location: vm.location,
        resourceGroup: rgMatch ? rgMatch[1] : 'unknown',
        vmSize,
        hourlyCost: hourlyRate,
      };
    }
  );
}

async function getVMScaleSets(token: string): Promise<VMSSInfo[]> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.Compute/virtualMachineScaleSets?api-version=2024-03-01`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return (data.value || []).map(
    (vmss: {
      name: string;
      location: string;
      id: string;
      sku: { name: string; capacity: number };
    }) => {
      const rgMatch = vmss.id.match(/resourceGroups\/([^/]+)/i);
      const vmSize = vmss.sku?.name || 'unknown';
      const capacity = vmss.sku?.capacity || 0;
      const hourlyRate = VM_HOURLY_RATES[vmSize] || 0.2;
      return {
        name: vmss.name,
        location: vmss.location,
        resourceGroup: rgMatch ? rgMatch[1] : 'unknown',
        vmSize,
        capacity,
        hourlyCost: hourlyRate * capacity,
      };
    }
  );
}

async function getContainerInstances(token: string): Promise<ContainerInfo[]> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.ContainerInstance/containerGroups?api-version=2023-05-01`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return (data.value || []).map(
    (cg: {
      name: string;
      location: string;
      id: string;
      properties: {
        containers: {
          properties: {
            resources: { requests: { cpu: number; memoryInGB: number } };
          };
        }[];
      };
    }) => {
      const rgMatch = cg.id.match(/resourceGroups\/([^/]+)/i);
      const containers = cg.properties?.containers || [];
      const vCPU = containers.reduce(
        (
          sum: number,
          c: { properties: { resources: { requests: { cpu: number } } } }
        ) => sum + (c.properties?.resources?.requests?.cpu || 0),
        0
      );
      const memoryGB = containers.reduce(
        (
          sum: number,
          c: { properties: { resources: { requests: { memoryInGB: number } } } }
        ) => sum + (c.properties?.resources?.requests?.memoryInGB || 0),
        0
      );
      return {
        name: cg.name,
        location: cg.location,
        resourceGroup: rgMatch ? rgMatch[1] : 'unknown',
        vCPU,
        memoryGB,
        hourlyCost: vCPU * ACI_VCPU_HOUR + memoryGB * ACI_GB_HOUR,
      };
    }
  );
}

async function getDisks(token: string): Promise<DiskInfo[]> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.Compute/disks?api-version=2024-03-02`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return (data.value || []).map(
    (d: {
      name: string;
      id: string;
      sku: { name: string };
      properties: { diskSizeGB: number };
    }) => {
      const rgMatch = d.id.match(/resourceGroups\/([^/]+)/i);
      const sku = d.sku?.name || 'Standard_LRS';
      const sizeGB = d.properties?.diskSizeGB || 0;
      const ratePerGB = DISK_MONTHLY_PER_GB[sku] || 0.04;
      return {
        name: d.name,
        resourceGroup: rgMatch ? rgMatch[1] : 'unknown',
        sku,
        sizeGB,
        monthlyCost: sizeGB * ratePerGB,
      };
    }
  );
}

async function getResourceCounts(token: string): Promise<{
  publicIPs: number;
  loadBalancers: number;
  natGateways: number;
  containerRegistries: number;
  images: number;
}> {
  const res = await fetch(
    `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resources?api-version=2021-04-01`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const counts = {
    publicIPs: 0,
    loadBalancers: 0,
    natGateways: 0,
    containerRegistries: 0,
    images: 0,
  };
  for (const r of data.value || []) {
    if (r.type === 'Microsoft.Network/publicIPAddresses') counts.publicIPs++;
    if (r.type === 'Microsoft.Network/loadBalancers') counts.loadBalancers++;
    if (r.type === 'Microsoft.Network/natGateways') counts.natGateways++;
    if (r.type === 'Microsoft.ContainerRegistry/registries')
      counts.containerRegistries++;
    if (r.type === 'Microsoft.Compute/images') counts.images++;
  }
  return counts;
}

export async function GET() {
  try {
    const isAdmin = await isMediarAdmin();
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Access denied. Mediar admin only.' },
        { status: 403 }
      );
    }

    if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
      return NextResponse.json(
        { error: 'Azure credentials not configured' },
        { status: 500 }
      );
    }

    const token = await getAzureAccessToken();

    const [vms, vmss, containers, disks, counts] = await Promise.all([
      getVirtualMachines(token),
      getVMScaleSets(token),
      getContainerInstances(token),
      getDisks(token),
      getResourceCounts(token),
    ]);

    // Calculate costs
    const vmMonthly = vms.reduce((sum, v) => sum + v.hourlyCost * 24 * 30, 0);
    const vmssMonthly = vmss.reduce(
      (sum, v) => sum + v.hourlyCost * 24 * 30,
      0
    );
    const containerMonthly = containers.reduce(
      (sum, c) => sum + c.hourlyCost * 24 * 30,
      0
    );
    const diskMonthly = disks.reduce((sum, d) => sum + d.monthlyCost, 0);
    const otherMonthly =
      counts.publicIPs * MONTHLY_RATES.publicIP +
      counts.loadBalancers * MONTHLY_RATES.loadBalancer +
      counts.natGateways * MONTHLY_RATES.natGateway +
      counts.containerRegistries * MONTHLY_RATES.containerRegistry;

    const totalMonthly =
      vmMonthly + vmssMonthly + containerMonthly + diskMonthly + otherMonthly;

    // Build cost breakdown
    const breakdown = [
      {
        category: 'Virtual Machines',
        items: vms.map(v => ({
          name: v.name,
          detail: v.vmSize,
          location: v.location,
          monthlyCost: Math.round(v.hourlyCost * 24 * 30 * 100) / 100,
        })),
        subtotal: Math.round(vmMonthly * 100) / 100,
      },
      {
        category: 'Virtual Machine Scale Sets',
        items: vmss.map(v => ({
          name: v.name,
          detail: `${v.vmSize} x${v.capacity}`,
          location: v.location,
          monthlyCost: Math.round(v.hourlyCost * 24 * 30 * 100) / 100,
        })),
        subtotal: Math.round(vmssMonthly * 100) / 100,
      },
      {
        category: 'Container Instances',
        items: containers.map(c => ({
          name: c.name,
          detail: `${c.vCPU} vCPU, ${c.memoryGB}GB RAM`,
          location: c.location,
          monthlyCost: Math.round(c.hourlyCost * 24 * 30 * 100) / 100,
        })),
        subtotal: Math.round(containerMonthly * 100) / 100,
      },
      {
        category: 'Managed Disks',
        items: disks.map(d => ({
          name: d.name,
          detail: `${d.sku} ${d.sizeGB}GB`,
          location: '-',
          monthlyCost: Math.round(d.monthlyCost * 100) / 100,
        })),
        subtotal: Math.round(diskMonthly * 100) / 100,
      },
      {
        category: 'Networking & Other',
        items: [
          {
            name: 'Public IPs',
            detail: `${counts.publicIPs} static IPs`,
            location: '-',
            monthlyCost:
              Math.round(counts.publicIPs * MONTHLY_RATES.publicIP * 100) / 100,
          },
          {
            name: 'Load Balancers',
            detail: `${counts.loadBalancers} instances`,
            location: '-',
            monthlyCost:
              Math.round(
                counts.loadBalancers * MONTHLY_RATES.loadBalancer * 100
              ) / 100,
          },
          {
            name: 'NAT Gateways',
            detail: `${counts.natGateways} instances`,
            location: '-',
            monthlyCost:
              Math.round(counts.natGateways * MONTHLY_RATES.natGateway * 100) /
              100,
          },
          {
            name: 'Container Registries',
            detail: `${counts.containerRegistries} registries`,
            location: '-',
            monthlyCost:
              Math.round(
                counts.containerRegistries *
                  MONTHLY_RATES.containerRegistry *
                  100
              ) / 100,
          },
        ].filter(i => i.monthlyCost > 0),
        subtotal: Math.round(otherMonthly * 100) / 100,
      },
    ];

    return NextResponse.json({
      success: true,
      subscription: {
        name: 'Microsoft Azure Sponsorship',
        id: AZURE_SUBSCRIPTION_ID,
        type: 'Sponsorship (credits-based)',
        note: 'Azure Sponsorship does not expose actual cost data via API. These are estimates based on current resource inventory and Azure published pricing. Deleted resources are not included.',
      },
      summary: {
        estimatedMonthly: Math.round(totalMonthly * 100) / 100,
        estimatedDaily: Math.round((totalMonthly / 30) * 100) / 100,
        currency: 'USD',
        resourceCounts: {
          vms: vms.length,
          vmss: vmss.length,
          vmssInstances: vmss.reduce((sum, v) => sum + v.capacity, 0),
          containers: containers.length,
          disks: disks.length,
          totalDiskGB: disks.reduce((sum, d) => sum + d.sizeGB, 0),
          publicIPs: counts.publicIPs,
          images: counts.images,
        },
      },
      breakdown,
    });
  } catch (error) {
    console.error('Azure billing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
