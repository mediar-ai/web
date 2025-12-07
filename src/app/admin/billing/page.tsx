'use client';

import { useEffect, useState } from 'react';
import { CreditCard, RefreshCw, TrendingUp, DollarSign, Server, Calendar } from 'lucide-react';
import { toast } from 'sonner';

interface CostData {
  totalCost: number;
  currency: string;
  period: string;
  breakdown: {
    category: string;
    cost: number;
    percentage: number;
  }[];
  dailyCosts: {
    date: string;
    cost: number;
  }[];
}

export default function AdminBillingPage() {
  const [costData, setCostData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    fetchCostData();
  }, [period]);

  const fetchCostData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/billing?period=${period}`);
      if (res.ok) {
        const data = await res.json();
        setCostData(data);
      } else {
        // If API doesn't exist yet, show placeholder data
        setCostData({
          totalCost: 0,
          currency: 'USD',
          period: period,
          breakdown: [],
          dailyCosts: [],
        });
      }
    } catch (error) {
      console.error('Failed to fetch cost data:', error);
      toast.error('Failed to load billing data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <CreditCard className="w-6 h-6" />
            BILLING
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Azure costs and resource usage overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period Selector */}
          <div className="flex border-2 border-black">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 font-mono text-sm ${
                  period === p
                    ? 'bg-black text-white'
                    : 'bg-white text-black hover:bg-gray-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={fetchCostData}
            className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Total Cost</span>
              </div>
              <div className="font-mono font-bold text-3xl">
                ${costData?.totalCost.toFixed(2) || '0.00'}
              </div>
              <div className="font-mono text-xs text-gray-500 mt-1">
                {costData?.currency || 'USD'} - Last {period}
              </div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Daily Average</span>
              </div>
              <div className="font-mono font-bold text-3xl">
                ${costData?.dailyCosts?.length
                  ? (costData.totalCost / costData.dailyCosts.length).toFixed(2)
                  : '0.00'}
              </div>
              <div className="font-mono text-xs text-gray-500 mt-1">Per day</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Categories</span>
              </div>
              <div className="font-mono font-bold text-3xl">
                {costData?.breakdown?.length || 0}
              </div>
              <div className="font-mono text-xs text-gray-500 mt-1">Resource types</div>
            </div>
          </div>

          {/* Cost Breakdown */}
          <div className="border-2 border-black mb-6">
            <div className="p-3 border-b-2 border-black bg-black text-white">
              <span className="font-mono font-bold text-sm">COST BREAKDOWN</span>
            </div>
            {costData?.breakdown && costData.breakdown.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {costData.breakdown.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold">{item.category}</div>
                      <div className="font-mono text-xs text-gray-500">
                        {item.percentage.toFixed(1)}% of total
                      </div>
                    </div>
                    <div className="font-mono font-bold">${item.cost.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center font-mono text-gray-600">
                <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No cost data available</p>
                <p className="text-sm text-gray-500 mt-2">
                  Configure Azure Cost Management API to view billing data
                </p>
              </div>
            )}
          </div>

          {/* Daily Costs */}
          {costData?.dailyCosts && costData.dailyCosts.length > 0 && (
            <div className="border-2 border-black">
              <div className="p-3 border-b-2 border-black bg-black text-white">
                <span className="font-mono font-bold text-sm">DAILY COSTS</span>
              </div>
              <div className="p-4 overflow-x-auto">
                <div className="flex gap-1 min-w-max">
                  {costData.dailyCosts.map((day, idx) => {
                    const maxCost = Math.max(...costData.dailyCosts.map(d => d.cost));
                    const heightPercent = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                    return (
                      <div key={idx} className="flex flex-col items-center">
                        <div className="h-32 w-6 bg-gray-100 relative">
                          <div
                            className="absolute bottom-0 w-full bg-black"
                            style={{ height: `${heightPercent}%` }}
                          />
                        </div>
                        <div className="font-mono text-xs mt-1 -rotate-45 origin-top-left">
                          {new Date(day.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
