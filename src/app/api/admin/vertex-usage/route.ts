import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = 'mediar-394022';

interface TokenUsage {
  input: number;
  output: number;
  total: number;
  byModel: Record<string, { input: number; output: number }>;
}

interface RequestCount {
  total: number;
  byService: Record<string, number>;
}

async function getGoogleAuthClient() {
  const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  if (!credentialsBase64) {
    throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64');
  }

  const credentials = JSON.parse(
    Buffer.from(credentialsBase64, 'base64').toString('utf-8')
  );

  const googleAuth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/monitoring.read'],
  });

  return googleAuth.getClient();
}

async function queryMetrics(
  accessToken: string,
  metricType: string,
  aggregation: {
    alignmentPeriod: string;
    perSeriesAligner: string;
    crossSeriesReducer?: string;
  } | null = null
) {
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const filter = `metric.type="${metricType}"`;

  let url =
    `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries?` +
    `filter=${encodeURIComponent(filter)}` +
    `&interval.startTime=${startTime}` +
    `&interval.endTime=${endTime}`;

  if (aggregation) {
    url += `&aggregation.alignmentPeriod=${aggregation.alignmentPeriod}`;
    url += `&aggregation.perSeriesAligner=${aggregation.perSeriesAligner}`;
    if (aggregation.crossSeriesReducer) {
      url += `&aggregation.crossSeriesReducer=${aggregation.crossSeriesReducer}`;
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error ${response.status}: ${error}`);
  }

  return response.json();
}

async function getTokenUsage(accessToken: string): Promise<TokenUsage> {
  const data = await queryMetrics(
    accessToken,
    'aiplatform.googleapis.com/publisher/online_serving/token_count',
    {
      alignmentPeriod: '86400s',
      perSeriesAligner: 'ALIGN_SUM',
    }
  );

  let totalInput = 0;
  let totalOutput = 0;
  const byModel: Record<string, { input: number; output: number }> = {};

  if (data.timeSeries && data.timeSeries.length > 0) {
    for (const series of data.timeSeries) {
      const model =
        series.metric?.labels?.model_id ||
        series.resource?.labels?.model_id ||
        'unknown';
      const type = series.metric?.labels?.type || 'unknown';
      const value = parseInt(series.points?.[0]?.value?.int64Value || 0);

      if (!byModel[model]) byModel[model] = { input: 0, output: 0 };

      if (type === 'input') {
        totalInput += value;
        byModel[model].input += value;
      } else if (type === 'output') {
        totalOutput += value;
        byModel[model].output += value;
      }
    }
  }

  return {
    input: totalInput,
    output: totalOutput,
    total: totalInput + totalOutput,
    byModel,
  };
}

async function getRequestCount(accessToken: string): Promise<RequestCount> {
  const data = await queryMetrics(
    accessToken,
    'serviceruntime.googleapis.com/api/request_count',
    {
      alignmentPeriod: '86400s',
      perSeriesAligner: 'ALIGN_SUM',
    }
  );

  let total = 0;
  const byService: Record<string, number> = {};

  if (data.timeSeries && data.timeSeries.length > 0) {
    for (const series of data.timeSeries) {
      const service = series.resource?.labels?.service || 'unknown';
      if (
        service.includes('aiplatform') ||
        service.includes('generativelanguage')
      ) {
        const value = parseInt(series.points?.[0]?.value?.int64Value || 0);
        total += value;
        byService[service] = (byService[service] || 0) + value;
      }
    }
  }

  return { total, byService };
}

export async function GET() {
  try {
    // Check authentication
    const { orgId } = await auth();

    if (!orgId || !MEDIAR_ORG_IDS.includes(orgId)) {
      return NextResponse.json(
        { error: 'Unauthorized - Mediar admin access required' },
        { status: 403 }
      );
    }

    const client = await getGoogleAuthClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      throw new Error('Failed to get access token');
    }

    const [tokenUsage, requestCount] = await Promise.all([
      getTokenUsage(accessToken),
      getRequestCount(accessToken),
    ]);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      period: 'last_24_hours',
      projectId: PROJECT_ID,
      tokens: tokenUsage,
      requests: requestCount,
    });
  } catch (error) {
    console.error('Vertex AI usage error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch Vertex AI usage',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
