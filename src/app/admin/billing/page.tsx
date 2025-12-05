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
} from 'lucide-react';

interface DailyCost {
  date: string;
  cost: number;
  currency: string;
}

interface ResourceGroupCost {
  resourceGroup: string;
  cost: number;
  currency: string;
}

interface BillingData {
  success: boolean;
  subscription: string;
  subscriptionId: string;
  period: {
    start: string;
    end: string;
    days: number;
  };
  costs: {
    total: number;
    currency: string;
    daily: DailyCost[];
    byResourceGroup: ResourceGroupCost[];
  };
}

export default function BillingPage() {
  const { user } = useUser();
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('30');

  const isMediarAdmin = user?.emailAddresses?.some(
    (e) => e.emailAddress.toLowerCase().endsWith('@mediar.ai')
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

  const maxDailyCost = billingData?.costs.daily.length
    ? Math.max(...billingData.costs.daily.map(d => d.cost))
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
              <p className="text-gray-600">Infrastructure cost tracking</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
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
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              REFRESH
            </button>
          </div>
        </div>

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <DollarSign className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">Total Cost</span>
                </div>
                <div className="text-4xl font-mono font-bold">
                  ${billingData.costs.total.toFixed(2)}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  {billingData.costs.currency}
                </div>
              </div>

              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <TrendingUp className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">Daily Average</span>
                </div>
                <div className="text-4xl font-mono font-bold">
                  ${(billingData.costs.total / billingData.period.days).toFixed(2)}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  per day
                </div>
              </div>

              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <Calendar className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">Period</span>
                </div>
                <div className="text-xl font-mono font-bold">
                  {billingData.period.start}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  to {billingData.period.end}
                </div>
              </div>
            </div>

            {/* Daily Cost Chart */}
            <div className="border-2 border-black mb-8">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold">DAILY COSTS</h2>
              </div>
              <div className="p-6">
                {billingData.costs.daily.length > 0 ? (
                  <div className="space-y-2">
                    {billingData.costs.daily.map((day) => (
                      <div key={day.date} className="flex items-center gap-4">
                        <span className="font-mono text-sm w-24 text-gray-600">
                          {day.date.slice(5)}
                        </span>
                        <div className="flex-1 h-6 bg-gray-100 relative">
                          <div
                            className="h-full bg-black"
                            style={{
                              width: `${maxDailyCost > 0 ? (day.cost / maxDailyCost) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono text-sm w-20 text-right">
                          ${day.cost.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    No cost data available for this period
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
                {billingData.costs.byResourceGroup.length > 0 ? (
                  billingData.costs.byResourceGroup.map((rg) => {
                    const percentage = billingData.costs.total > 0
                      ? (rg.cost / billingData.costs.total) * 100
                      : 0;
                    return (
                      <div key={rg.resourceGroup} className="p-4 flex items-center justify-between">
                        <div>
                          <div className="font-mono font-bold">{rg.resourceGroup}</div>
                          <div className="text-gray-600 text-sm">
                            {percentage.toFixed(1)}% of total
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold text-xl">
                            ${rg.cost.toFixed(2)}
                          </div>
                          <div className="text-gray-600 text-sm">{rg.currency}</div>
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
              <p>Subscription: {billingData.subscription}</p>
              <p>ID: {billingData.subscriptionId}</p>
            </div>
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
