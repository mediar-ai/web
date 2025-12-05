import { NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const AZURE_SUBSCRIPTION_ID = '5c0a60d0-92cf-47ca-9430-b462bc2fe194';

// Estimated hourly costs for common resource types (USD)
const ESTIMATED_HOURLY_COSTS: Record<string, number> = {
  'Microsoft.Compute/virtualMachines': 0.2, // ~D4s_v3
  'Microsoft.Compute/virtualMachineScaleSets': 0.2,
  'Microsoft.ContainerInstance/containerGroups': 0.05,
  'Microsoft.Compute/disks': 0.002, // P10 SSD
  'Microsoft.Network/publicIPAddresses': 0.004,
  'Microsoft.Network/loadBalancers': 0.025,
  'Microsoft.Network/natGateways': 0.045,
  'Microsoft.Storage/storageAccounts': 0.02,
  'Microsoft.ContainerRegistry/registries': 0.17,
  'Microsoft.OperationalInsights/workspaces': 0.01,
};

interface Resource {
  id: string;
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
}

async function getAzureAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: AZURE_CLIENT_ID!,
      client_secret: AZURE_CLIENT_SECRET!,
      scope: 'https://management.azure.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get Azure token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function getResources(accessToken: string): Promise<Resource[]> {
  const url = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resources?api-version=2021-04-01`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resources API error: ${error}`);
  }

  const data = await response.json();
  return (data.value || []).map(
    (r: { id: string; name: string; type: string; location: string }) => {
      const rgMatch = r.id.match(/resourceGroups\/([^/]+)/i);
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        location: r.location,
        resourceGroup: rgMatch ? rgMatch[1] : 'Unknown',
      };
    }
  );
}

async function getResourceGroups(
  accessToken: string
): Promise<{ name: string; location: string }[]> {
  const url = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourcegroups?api-version=2021-04-01`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return (data.value || []).map((rg: { name: string; location: string }) => ({
    name: rg.name,
    location: rg.location,
  }));
}

function extractResourceGroup(resourceId: string): string {
  const match = resourceId.match(/resourceGroups\/([^/]+)/i);
  return match ? match[1] : 'Unknown';
}

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const period = parseInt(searchParams.get('period') || '30');

    const accessToken = await getAzureAccessToken();

    const [resources, resourceGroups] = await Promise.all([
      getResources(accessToken),
      getResourceGroups(accessToken),
    ]);

    // Count by type
    const byType: Record<
      string,
      { count: number; estimatedMonthlyCost: number }
    > = {};
    for (const r of resources) {
      if (!byType[r.type]) {
        byType[r.type] = { count: 0, estimatedMonthlyCost: 0 };
      }
      byType[r.type].count++;
      const hourlyRate = ESTIMATED_HOURLY_COSTS[r.type] || 0;
      byType[r.type].estimatedMonthlyCost += hourlyRate * 24 * 30;
    }

    // Count by resource group
    const byResourceGroup: Record<
      string,
      {
        count: number;
        types: Record<string, number>;
        estimatedMonthlyCost: number;
      }
    > = {};
    for (const r of resources) {
      const rg = r.resourceGroup;
      if (!byResourceGroup[rg]) {
        byResourceGroup[rg] = { count: 0, types: {}, estimatedMonthlyCost: 0 };
      }
      byResourceGroup[rg].count++;
      byResourceGroup[rg].types[r.type] =
        (byResourceGroup[rg].types[r.type] || 0) + 1;
      const hourlyRate = ESTIMATED_HOURLY_COSTS[r.type] || 0;
      byResourceGroup[rg].estimatedMonthlyCost += hourlyRate * 24 * 30;
    }

    // Calculate totals
    const totalEstimatedMonthlyCost = Object.values(byType).reduce(
      (sum, t) => sum + t.estimatedMonthlyCost,
      0
    );

    // Format for response
    const typeBreakdown = Object.entries(byType)
      .map(([type, data]) => ({
        type,
        shortType: type.split('/').pop() || type,
        count: data.count,
        estimatedMonthlyCost: Math.round(data.estimatedMonthlyCost * 100) / 100,
      }))
      .sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);

    const rgBreakdown = Object.entries(byResourceGroup)
      .map(([name, data]) => ({
        name,
        resourceCount: data.count,
        estimatedMonthlyCost: Math.round(data.estimatedMonthlyCost * 100) / 100,
        topTypes: Object.entries(data.types)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t, c]) => ({ type: t.split('/').pop(), count: c })),
      }))
      .sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);

    return NextResponse.json({
      success: true,
      subscription: {
        name: 'Microsoft Azure Sponsorship',
        id: AZURE_SUBSCRIPTION_ID,
        type: 'Sponsorship (credits-based)',
        note: 'Cost data not available via API for sponsorship subscriptions. Showing estimated costs based on resource inventory.',
      },
      summary: {
        totalResources: resources.length,
        resourceGroups: resourceGroups.length,
        estimatedMonthlyCost: Math.round(totalEstimatedMonthlyCost * 100) / 100,
        estimatedDailyCost:
          Math.round((totalEstimatedMonthlyCost / 30) * 100) / 100,
        estimatedPeriodCost:
          Math.round((totalEstimatedMonthlyCost / 30) * period * 100) / 100,
        currency: 'USD',
        period: {
          days: period,
        },
      },
      byResourceType: typeBreakdown,
      byResourceGroup: rgBreakdown,
    });
  } catch (error) {
    console.error('Azure billing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
