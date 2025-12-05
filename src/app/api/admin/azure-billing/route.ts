import { NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const AZURE_SUBSCRIPTION_ID = '5c0a60d0-92cf-47ca-9430-b462bc2fe194'; // Microsoft Azure Sponsorship

interface CostData {
  date: string;
  cost: number;
  currency: string;
}

interface ResourceCost {
  resourceGroup: string;
  resourceName: string;
  resourceType: string;
  cost: number;
  currency: string;
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

async function getCostManagementData(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<{ daily: CostData[]; byResource: ResourceCost[]; total: number }> {
  const costUrl = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION_ID}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  // Query for daily costs
  const dailyResponse = await fetch(costUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: {
        from: startDate,
        to: endDate,
      },
      dataset: {
        granularity: 'Daily',
        aggregation: {
          totalCost: {
            name: 'Cost',
            function: 'Sum',
          },
        },
        grouping: [
          {
            type: 'Dimension',
            name: 'ResourceGroup',
          },
        ],
      },
    }),
  });

  if (!dailyResponse.ok) {
    const error = await dailyResponse.text();
    throw new Error(`Cost Management API error: ${error}`);
  }

  const dailyData = await dailyResponse.json();

  // Parse daily costs
  const daily: CostData[] = [];
  const byResourceGroup: Record<string, number> = {};
  let total = 0;

  if (dailyData.properties?.rows) {
    for (const row of dailyData.properties.rows) {
      const cost = row[0] || 0;
      const resourceGroup = row[1] || 'Unknown';
      const dateNum = row[2];

      // Parse date from number format (20231215)
      const dateStr = String(dateNum);
      const date = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

      daily.push({
        date,
        cost,
        currency: 'USD',
      });

      byResourceGroup[resourceGroup] = (byResourceGroup[resourceGroup] || 0) + cost;
      total += cost;
    }
  }

  // Convert resource groups to array
  const byResource: ResourceCost[] = Object.entries(byResourceGroup)
    .map(([resourceGroup, cost]) => ({
      resourceGroup,
      resourceName: resourceGroup,
      resourceType: 'Resource Group',
      cost,
      currency: 'USD',
    }))
    .sort((a, b) => b.cost - a.cost);

  // Aggregate daily by date
  const dailyAggregated: Record<string, number> = {};
  for (const item of daily) {
    dailyAggregated[item.date] = (dailyAggregated[item.date] || 0) + item.cost;
  }

  const sortedDaily = Object.entries(dailyAggregated)
    .map(([date, cost]) => ({ date, cost, currency: 'USD' }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { daily: sortedDaily, byResource, total };
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
    const period = searchParams.get('period') || '30'; // days

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const accessToken = await getAzureAccessToken();
    const costData = await getCostManagementData(accessToken, startStr, endStr);

    return NextResponse.json({
      success: true,
      subscription: 'Microsoft Azure Sponsorship',
      subscriptionId: AZURE_SUBSCRIPTION_ID,
      period: {
        start: startStr,
        end: endStr,
        days: parseInt(period),
      },
      costs: {
        total: Math.round(costData.total * 100) / 100,
        currency: 'USD',
        daily: costData.daily.map(d => ({
          ...d,
          cost: Math.round(d.cost * 100) / 100,
        })),
        byResourceGroup: costData.byResource.map(r => ({
          ...r,
          cost: Math.round(r.cost * 100) / 100,
        })),
      },
    });
  } catch (error) {
    console.error('Azure billing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
