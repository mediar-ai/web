'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useUser } from '@clerk/nextjs';
import { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Calendar,
  Server,
  RefreshCw,
  AlertCircle,
  Box,
  Layers,
} from 'lucide-react';

interface ResourceTypeBreakdown {
  type: string;
  shortType: string;
  count: number;
  estimatedMonthlyCost: number;
}

interface ResourceGroupBreakdown {
  name: string;
  resourceCount: number;
  estimatedMonthlyCost: number;
  topTypes: { type: string; count: number }[];
}

interface BillingData {
  success: boolean;
  subscription: {
    name: string;
    id: string;
    type: string;
    note: string;
  };
  summary: {
    totalResources: number;
    resourceGroups: number;
    estimatedMonthlyCost: number;
    estimatedDailyCost: number;
    estimatedPeriodCost: number;
    currency: string;
    period: {
      days: number;
    };
  };
  byResourceType: ResourceTypeBreakdown[];
  byResourceGroup: ResourceGroupBreakdown[];
}

export default function BillingPage() {
  const { user } = useUser();
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('30');

  const isMediarAdmin = user?.emailAddresses?.some(e =>
    e.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

  useEffect(() => {
    if (!isMediarAdmin) return;
    fetchBillingData();
  }, [isMediarAdmin, period]);

  const fetchBillingData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/azure-billing?period=${period}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch billing data');
      }

      setBillingData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (!isMediarAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4" />
            <h2 className="text-xl font-mono font-bold">ACCESS DENIED</h2>
            <p className="text-gray-600 mt-2">Mediar admin only</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const maxTypeCost = billingData?.byResourceType.length
    ? Math.max(...billingData.byResourceType.map(t => t.estimatedMonthlyCost))
    : 0;

  const maxRgCost = billingData?.byResourceGroup.length
    ? Math.max(
        ...billingData.byResourceGroup.map(rg => rg.estimatedMonthlyCost)
      )
    : 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <DollarSign className="w-8 h-8" />
            <div>
              <h1 className="text-3xl font-mono font-bold">AZURE BILLING</h1>
              <p className="text-gray-600">
                Infrastructure cost estimates (Sponsorship)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="border-2 border-black px-3 py-2 font-mono"
            >
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <button
              onClick={fetchBillingData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white font-mono hover:bg-gray-800 disabled:bg-gray-400"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              />
              REFRESH
            </button>
          </div>
        </div>

        {/* Note about estimates */}
        {billingData?.subscription.note && (
          <div className="border-2 border-dashed border-gray-400 bg-gray-50 p-4 mb-6">
            <div className="flex items-start gap-2 text-gray-700">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <span className="font-mono text-sm">
                {billingData.subscription.note}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="border-2 border-black bg-gray-100 p-4 mb-6">
            <div className="flex items-center gap-2 text-black">
              <AlertCircle className="w-5 h-5" />
              <span className="font-mono font-bold">Error:</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {loading && !billingData ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin" />
          </div>
        ) : billingData ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <DollarSign className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">
                    Est. Monthly
                  </span>
                </div>
                <div className="text-3xl font-mono font-bold">
                  ${billingData.summary.estimatedMonthlyCost.toFixed(2)}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  {billingData.summary.currency}
                </div>
              </div>

              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <TrendingUp className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">
                    Est. Daily
                  </span>
                </div>
                <div className="text-3xl font-mono font-bold">
                  ${billingData.summary.estimatedDailyCost.toFixed(2)}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  per day
                </div>
              </div>

              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <Calendar className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">
                    Est. {period} Days
                  </span>
                </div>
                <div className="text-3xl font-mono font-bold">
                  ${billingData.summary.estimatedPeriodCost.toFixed(2)}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  projected
                </div>
              </div>

              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <Box className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">Resources</span>
                </div>
                <div className="text-3xl font-mono font-bold">
                  {billingData.summary.totalResources}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  across {billingData.summary.resourceGroups} groups
                </div>
              </div>
            </div>

            {/* Resource Type Breakdown */}
            <div className="border-2 border-black mb-8">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold flex items-center gap-2">
                  <Layers className="w-5 h-5" />
                  COST BY RESOURCE TYPE
                </h2>
              </div>
              <div className="p-6">
                {billingData.byResourceType.length > 0 ? (
                  <div className="space-y-3">
                    {billingData.byResourceType.map(item => (
                      <div key={item.type} className="flex items-center gap-4">
                        <span className="font-mono text-sm w-48 text-gray-600 truncate">
                          {item.shortType}
                        </span>
                        <span className="font-mono text-xs w-12 text-gray-500">
                          x{item.count}
                        </span>
                        <div className="flex-1 h-6 bg-gray-100 relative">
                          <div
                            className="h-full bg-black"
                            style={{
                              width: `${maxTypeCost > 0 ? (item.estimatedMonthlyCost / maxTypeCost) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono text-sm w-24 text-right">
                          ${item.estimatedMonthlyCost.toFixed(2)}/mo
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    No resource data available
                  </div>
                )}
              </div>
            </div>

            {/* Resource Group Breakdown */}
            <div className="border-2 border-black">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold flex items-center gap-2">
                  <Server className="w-5 h-5" />
                  COST BY RESOURCE GROUP
                </h2>
              </div>
              <div className="divide-y divide-gray-200">
                {billingData.byResourceGroup.length > 0 ? (
                  billingData.byResourceGroup.map(rg => {
                    const percentage =
                      billingData.summary.estimatedMonthlyCost > 0
                        ? (rg.estimatedMonthlyCost /
                            billingData.summary.estimatedMonthlyCost) *
                          100
                        : 0;
                    return (
                      <div
                        key={rg.name}
                        className="p-4 flex items-center justify-between"
                      >
                        <div className="flex-1">
                          <div className="font-mono font-bold">{rg.name}</div>
                          <div className="text-gray-600 text-sm flex items-center gap-2">
                            <span>{rg.resourceCount} resources</span>
                            <span>•</span>
                            <span>{percentage.toFixed(1)}% of total</span>
                          </div>
                          {rg.topTypes.length > 0 && (
                            <div className="text-gray-500 text-xs mt-1 font-mono">
                              {rg.topTypes
                                .map(t => `${t.type} (${t.count})`)
                                .join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="w-32 h-4 bg-gray-100">
                            <div
                              className="h-full bg-black"
                              style={{
                                width: `${maxRgCost > 0 ? (rg.estimatedMonthlyCost / maxRgCost) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <div className="text-right w-28">
                            <div className="font-mono font-bold">
                              ${rg.estimatedMonthlyCost.toFixed(2)}
                            </div>
                            <div className="text-gray-600 text-xs">
                              /month est.
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    No resource group data available
                  </div>
                )}
              </div>
            </div>

            {/* Subscription Info */}
            <div className="mt-6 text-gray-600 font-mono text-sm">
              <p>Subscription: {billingData.subscription.name}</p>
              <p>Type: {billingData.subscription.type}</p>
              <p>ID: {billingData.subscription.id}</p>
            </div>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
