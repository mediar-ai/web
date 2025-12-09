import { NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';
import { BigQuery } from '@google-cloud/bigquery';

// GCP billing export BigQuery dataset
// Table naming convention: gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>
// or gcp_billing_export_v1_<BILLING_ACCOUNT_ID> for standard export
// Uses existing GOOGLE_CLOUD_PROJECT env var for auth, GCP_BILLING_PROJECT for billing data
const GCP_PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
// Billing data may be in a different project than the main app
const GCP_BILLING_PROJECT =
  process.env.GCP_BILLING_PROJECT || GCP_PROJECT_ID || 'mediar';
const GCP_BILLING_DATASET =
  process.env.GCP_BILLING_DATASET || 'mediar_billing_data';
// Use wildcard to match any billing account ID
const GCP_BILLING_TABLE =
  process.env.GCP_BILLING_TABLE || 'gcp_billing_export_resource_v1_*';

// Service account credentials - prefer dedicated billing SA, fall back to general SA
const GCP_BILLING_SERVICE_ACCOUNT_KEY =
  process.env.GCP_BILLING_SERVICE_ACCOUNT_BASE64 ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

interface ServiceBreakdown {
  service: string;
  description: string;
  monthlyCost: number;
  usageAmount: number;
  usageUnit: string;
  projectId?: string;
}

interface ProjectBreakdown {
  projectId: string;
  projectName: string;
  monthlyCost: number;
  services: ServiceBreakdown[];
}

interface GCPBillingData {
  success: boolean;
  billingAccount: {
    dataset: string;
    table: string;
  };
  summary: {
    totalMonthly: number;
    totalDaily: number;
    currency: string;
    billingPeriod: {
      start: string;
      end: string;
    };
    projectCount: number;
    serviceCount: number;
  };
  byProject: ProjectBreakdown[];
  byService: ServiceBreakdown[];
  error?: string;
  setup?: {
    required?: string[];
    steps?: string[];
    documentation?: string;
  };
}

function getBigQueryClient(): BigQuery {
  if (GCP_BILLING_SERVICE_ACCOUNT_KEY) {
    try {
      // Try to decode as base64 first, then as raw JSON
      let credentialsJson = GCP_BILLING_SERVICE_ACCOUNT_KEY;
      try {
        credentialsJson = Buffer.from(
          GCP_BILLING_SERVICE_ACCOUNT_KEY,
          'base64'
        ).toString('utf-8');
      } catch {
        // Not base64, use as-is
      }
      const credentials = JSON.parse(credentialsJson);
      return new BigQuery({
        projectId: GCP_BILLING_PROJECT,
        credentials,
      });
    } catch {
      // Fall back to default credentials
      return new BigQuery({ projectId: GCP_BILLING_PROJECT });
    }
  }
  return new BigQuery({ projectId: GCP_BILLING_PROJECT });
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

    const bigquery = getBigQueryClient();

    // Query current month's billing data grouped by project and service
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // First, let's list tables to find the actual billing export table
    const tableQuery = `
      SELECT table_name
      FROM \`${GCP_BILLING_PROJECT}.${GCP_BILLING_DATASET}.INFORMATION_SCHEMA.TABLES\`
      WHERE table_name LIKE 'gcp_billing_export%'
      LIMIT 10
    `;

    let actualTable = GCP_BILLING_TABLE;
    try {
      const [tables] = await bigquery.query({ query: tableQuery });
      if (tables && tables.length > 0) {
        // Prefer detailed/resource export, fall back to standard
        const resourceTable = tables.find((t: { table_name: string }) =>
          t.table_name.includes('resource_v1')
        );
        const standardTable = tables.find((t: { table_name: string }) =>
          t.table_name.includes('export_v1')
        );
        actualTable =
          resourceTable?.table_name || standardTable?.table_name || actualTable;
      }
    } catch (tableErr) {
      console.log('Could not list tables, using default:', tableErr);
    }

    // Query billing data - no project filter to get all projects in billing account
    const query = `
      SELECT
        project.id as project_id,
        project.name as project_name,
        service.description as service_description,
        sku.description as sku_description,
        SUM(cost) as total_cost,
        SUM(CAST(usage.amount AS FLOAT64)) as total_usage,
        usage.unit as usage_unit,
        currency
      FROM \`${GCP_BILLING_PROJECT}.${GCP_BILLING_DATASET}.${actualTable}\`
      WHERE
        DATE(usage_start_time) >= @start_date
        AND DATE(usage_end_time) <= @end_date
      GROUP BY
        project.id,
        project.name,
        service.description,
        sku.description,
        usage.unit,
        currency
      HAVING SUM(cost) > 0
      ORDER BY total_cost DESC
      LIMIT 500
    `;

    const options = {
      query,
      params: {
        start_date: startOfMonth.toISOString().split('T')[0],
        end_date: endOfMonth.toISOString().split('T')[0],
      },
    };

    const [rows] = await bigquery.query(options);

    // Aggregate by service (across all projects)
    const serviceMap = new Map<
      string,
      { cost: number; usage: number; unit: string; description: string }
    >();

    // Aggregate by project
    const projectMap = new Map<
      string,
      {
        name: string;
        cost: number;
        services: Map<
          string,
          { cost: number; usage: number; unit: string; description: string }
        >;
      }
    >();

    let totalCost = 0;
    let currency = 'USD';

    for (const row of rows) {
      const service = row.service_description || 'Other';
      const projectId = row.project_id || 'unknown';
      const projectName = row.project_name || projectId;
      const cost = parseFloat(row.total_cost) || 0;
      const usage = parseFloat(row.total_usage) || 0;

      totalCost += cost;
      currency = row.currency || 'USD';

      // Service aggregation
      if (serviceMap.has(service)) {
        const existing = serviceMap.get(service)!;
        existing.cost += cost;
        existing.usage += usage;
      } else {
        serviceMap.set(service, {
          cost,
          usage,
          unit: row.usage_unit || '',
          description: row.sku_description || '',
        });
      }

      // Project aggregation
      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, {
          name: projectName,
          cost: 0,
          services: new Map(),
        });
      }
      const project = projectMap.get(projectId)!;
      project.cost += cost;

      if (project.services.has(service)) {
        const existing = project.services.get(service)!;
        existing.cost += cost;
        existing.usage += usage;
      } else {
        project.services.set(service, {
          cost,
          usage,
          unit: row.usage_unit || '',
          description: row.sku_description || '',
        });
      }
    }

    // Convert to arrays
    const byService: ServiceBreakdown[] = Array.from(serviceMap.entries())
      .map(([service, data]) => ({
        service,
        description: data.description,
        monthlyCost: Math.round(data.cost * 100) / 100,
        usageAmount: Math.round(data.usage * 100) / 100,
        usageUnit: data.unit,
      }))
      .sort((a, b) => b.monthlyCost - a.monthlyCost);

    const byProject: ProjectBreakdown[] = Array.from(projectMap.entries())
      .map(([projectId, data]) => ({
        projectId,
        projectName: data.name,
        monthlyCost: Math.round(data.cost * 100) / 100,
        services: Array.from(data.services.entries())
          .map(([service, svcData]) => ({
            service,
            description: svcData.description,
            monthlyCost: Math.round(svcData.cost * 100) / 100,
            usageAmount: Math.round(svcData.usage * 100) / 100,
            usageUnit: svcData.unit,
          }))
          .sort((a, b) => b.monthlyCost - a.monthlyCost),
      }))
      .sort((a, b) => b.monthlyCost - a.monthlyCost);

    const dayOfMonth = now.getDate();
    const dailyAverage = dayOfMonth > 0 ? totalCost / dayOfMonth : 0;

    const response: GCPBillingData = {
      success: true,
      billingAccount: {
        dataset: GCP_BILLING_DATASET,
        table: actualTable,
      },
      summary: {
        totalMonthly: Math.round(totalCost * 100) / 100,
        totalDaily: Math.round(dailyAverage * 100) / 100,
        currency,
        billingPeriod: {
          start: startOfMonth.toISOString().split('T')[0],
          end: endOfMonth.toISOString().split('T')[0],
        },
        projectCount: projectMap.size,
        serviceCount: serviceMap.size,
      },
      byProject,
      byService,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('GCP billing error:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    if (
      errorMessage.includes('Not found: Dataset') ||
      errorMessage.includes('Not found: Table')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Billing export table not found',
          details: errorMessage,
          setup: {
            steps: [
              '1. Go to GCP Console > Billing > Billing export',
              '2. Enable BigQuery export (Standard or Detailed)',
              '3. Wait 24-48 hours for data to populate',
              '4. Verify GCP_BILLING_DATASET matches your dataset name',
            ],
            documentation:
              'https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup',
          },
        },
        { status: 500 }
      );
    }

    if (
      errorMessage.includes('Permission denied') ||
      errorMessage.includes('403') ||
      errorMessage.includes('Access Denied')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied accessing BigQuery',
          details: errorMessage,
          setup: {
            required_roles: [
              'roles/bigquery.dataViewer on the billing dataset',
              'roles/bigquery.jobUser on the project',
            ],
            steps: [
              '1. Go to IAM & Admin > IAM',
              '2. Find your service account',
              '3. Add BigQuery Data Viewer and BigQuery Job User roles',
            ],
          },
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        details: 'Check server logs for more info',
      },
      { status: 500 }
    );
  }
}
