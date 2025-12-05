'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useAuth, useOrganization } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { Activity, BarChart3, Cpu, RefreshCw } from 'lucide-react';

interface VertexUsage {
  timestamp: string;
  period: string;
  projectId: string;
  tokens: {
    input: number;
    output: number;
    total: number;
    byModel: Record<string, { input: number; output: number }>;
  };
  requests: {
    total: number;
    byService: Record<string, number>;
  };
}

function VertexUsageCard({ usage, loading, error, onRefresh }: {
  usage: VertexUsage | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="border-2 border-black bg-white">
      <div className="bg-black text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5" />
          <span className="font-mono font-bold">VERTEX AI USAGE (24H)</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1 hover:bg-white hover:text-black transition-colors rounded"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-6">
        {loading && !usage && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
          </div>
        )}

        {error && (
          <div className="border-2 border-black p-4 bg-gray-50">
            <p className="font-mono text-sm text-gray-600">{error}</p>
          </div>
        )}

        {usage && (
          <div className="space-y-6">
            {/* Token Stats */}
            <div>
              <h3 className="font-mono text-xs text-gray-600 uppercase mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Token Consumption
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="border-2 border-black p-4">
                  <div className="font-mono text-xs text-gray-600 uppercase">Input</div>
                  <div className="font-mono text-2xl font-bold">
                    {usage.tokens.input.toLocaleString()}
                  </div>
                </div>
                <div className="border-2 border-black p-4">
                  <div className="font-mono text-xs text-gray-600 uppercase">Output</div>
                  <div className="font-mono text-2xl font-bold">
                    {usage.tokens.output.toLocaleString()}
                  </div>
                </div>
                <div className="border-2 border-black p-4 bg-black text-white">
                  <div className="font-mono text-xs uppercase opacity-80">Total</div>
                  <div className="font-mono text-2xl font-bold">
                    {usage.tokens.total.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* By Model Breakdown */}
            {Object.keys(usage.tokens.byModel).length > 0 && (
              <div>
                <h3 className="font-mono text-xs text-gray-600 uppercase mb-3">By Model</h3>
                <div className="border-2 border-black divide-y divide-gray-200">
                  {Object.entries(usage.tokens.byModel).map(([model, counts]) => (
                    <div key={model} className="p-3 flex items-center justify-between">
                      <span className="font-mono text-sm">{model}</span>
                      <span className="font-mono text-sm text-gray-600">
                        {counts.input.toLocaleString()} in / {counts.output.toLocaleString()} out
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Request Stats */}
            <div>
              <h3 className="font-mono text-xs text-gray-600 uppercase mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                API Requests
              </h3>
              <div className="border-2 border-black p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-sm">Total Requests</span>
                  <span className="font-mono text-xl font-bold">{usage.requests.total}</span>
                </div>
                {Object.entries(usage.requests.byService).length > 0 && (
                  <div className="border-t border-gray-200 pt-3 space-y-2">
                    {Object.entries(usage.requests.byService).map(([service, count]) => (
                      <div key={service} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-gray-600 truncate max-w-[70%]">
                          {service}
                        </span>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Timestamp */}
            <div className="text-right">
              <span className="font-mono text-xs text-gray-500">
                Updated: {new Date(usage.timestamp).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsPageContent() {
  const { isLoaded } = useAuth();
  const { organization } = useOrganization();
  const [usage, setUsage] = useState<VertexUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMediarAdmin = organization && MEDIAR_ORG_IDS.includes(organization.id);

  const fetchUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/vertex-usage');
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch usage data');
      }
      const data = await response.json();
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch usage');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isMediarAdmin) {
      fetchUsage();
    }
  }, [isMediarAdmin]);

  if (!isLoaded) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      </DashboardLayout>
    );
  }

  if (!isMediarAdmin) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="border-2 border-black p-8 text-center">
            <h1 className="font-mono font-bold text-xl mb-2">ACCESS RESTRICTED</h1>
            <p className="font-mono text-gray-600">
              This page is only available to Mediar administrators.
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8 space-y-8">
        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-mono font-bold flex items-center gap-3">
            <BarChart3 className="w-8 h-8" />
            Analytics
          </h1>
          <p className="font-mono text-gray-600 mt-1">
            Usage metrics and product analytics
          </p>
        </div>

        {/* Vertex AI Usage Stats */}
        <VertexUsageCard
          usage={usage}
          loading={loading}
          error={error}
          onRefresh={fetchUsage}
        />

        {/* PostHog Dashboard Embed */}
        <div className="border-2 border-black bg-white">
          <div className="bg-black text-white p-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            <span className="font-mono font-bold">POSTHOG DASHBOARD</span>
          </div>
          <div className="p-0">
            <iframe
              src="https://eu.posthog.com/shared/jt7So78JysccVCjHHBRK6CBqhPJF-A"
              style={{
                width: '125%',
                height: '125%',
                border: 'none',
                transform: 'scale(0.8)',
                transformOrigin: 'top left',
              }}
              className="min-h-[800px]"
              title="PostHog Dashboard"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function AnalyticsPage() {
  return <AnalyticsPageContent />;
}
