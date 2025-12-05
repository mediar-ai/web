'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useUser } from '@clerk/nextjs';
import { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  RefreshCw,
  AlertCircle,
  Server,
  HardDrive,
  Container,
  Network,
  ChevronDown,
  ChevronRight,
  Monitor,
} from 'lucide-react';

interface BreakdownItem {
  name: string;
  detail: string;
  location: string;
  monthlyCost: number;
}

interface CategoryBreakdown {
  category: string;
  items: BreakdownItem[];
  subtotal: number;
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
    estimatedMonthly: number;
    estimatedDaily: number;
    currency: string;
    resourceCounts: {
      vms: number;
      vmss: number;
      vmssInstances: number;
      containers: number;
      disks: number;
      totalDiskGB: number;
      publicIPs: number;
      images: number;
    };
  };
  breakdown: CategoryBreakdown[];
}

const categoryIcons: Record<string, React.ReactNode> = {
  'Virtual Machines': <Monitor className="w-5 h-5" />,
  'Virtual Machine Scale Sets': <Server className="w-5 h-5" />,
  'Container Instances': <Container className="w-5 h-5" />,
  'Managed Disks': <HardDrive className="w-5 h-5" />,
  'Networking & Other': <Network className="w-5 h-5" />,
};

export default function BillingPage() {
  const { user } = useUser();
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );

  const isMediarAdmin = user?.emailAddresses?.some(e =>
    e.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

  useEffect(() => {
    if (!isMediarAdmin) return;
    fetchBillingData();
  }, [isMediarAdmin]);

  const fetchBillingData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/azure-billing');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch billing data');
      }
      setBillingData(data);
      // Expand all categories by default
      setExpandedCategories(
        new Set(data.breakdown?.map((b: CategoryBreakdown) => b.category) || [])
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
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

  const totalMonthly = billingData?.summary.estimatedMonthly || 0;

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
          <button
            onClick={fetchBillingData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white font-mono hover:bg-gray-800 disabled:bg-gray-400"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            REFRESH
          </button>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <DollarSign className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">
                    Est. Monthly
                  </span>
                </div>
                <div className="text-3xl font-mono font-bold">
                  ${billingData.summary.estimatedMonthly.toLocaleString()}
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
                  ${billingData.summary.estimatedDaily.toFixed(2)}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  per day
                </div>
              </div>

              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <Server className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">Compute</span>
                </div>
                <div className="text-3xl font-mono font-bold">
                  {billingData.summary.resourceCounts.vms +
                    billingData.summary.resourceCounts.vmssInstances +
                    billingData.summary.resourceCounts.containers}
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  {billingData.summary.resourceCounts.vms} VMs +{' '}
                  {billingData.summary.resourceCounts.vmssInstances} VMSS +{' '}
                  {billingData.summary.resourceCounts.containers} containers
                </div>
              </div>

              <div className="border-2 border-black p-6">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <HardDrive className="w-5 h-5" />
                  <span className="font-mono text-xs uppercase">Storage</span>
                </div>
                <div className="text-3xl font-mono font-bold">
                  {billingData.summary.resourceCounts.totalDiskGB} GB
                </div>
                <div className="text-gray-600 font-mono text-sm mt-1">
                  across {billingData.summary.resourceCounts.disks} disks +{' '}
                  {billingData.summary.resourceCounts.images} images
                </div>
              </div>
            </div>

            {/* Cost Breakdown */}
            <div className="border-2 border-black">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold">COST BREAKDOWN</h2>
              </div>

              {billingData.breakdown.map(category => {
                const isExpanded = expandedCategories.has(category.category);
                const percentage =
                  totalMonthly > 0
                    ? (category.subtotal / totalMonthly) * 100
                    : 0;

                return (
                  <div
                    key={category.category}
                    className="border-b border-gray-200 last:border-b-0"
                  >
                    {/* Category Header */}
                    <button
                      onClick={() => toggleCategory(category.category)}
                      className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        {categoryIcons[category.category] || (
                          <Server className="w-5 h-5" />
                        )}
                        <span className="font-mono font-bold">
                          {category.category}
                        </span>
                        <span className="text-gray-500 text-sm">
                          ({category.items.length} items)
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="w-32 h-3 bg-gray-100">
                          <div
                            className="h-full bg-black"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="text-right min-w-[100px]">
                          <span className="font-mono font-bold">
                            ${category.subtotal.toLocaleString()}
                          </span>
                          <span className="text-gray-500 text-sm ml-1">
                            /mo
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Category Items */}
                    {isExpanded && category.items.length > 0 && (
                      <div className="bg-gray-50 border-t border-gray-200">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left text-xs font-mono text-gray-500 uppercase">
                              <th className="px-4 py-2 pl-12">Resource</th>
                              <th className="px-4 py-2">Details</th>
                              <th className="px-4 py-2">Location</th>
                              <th className="px-4 py-2 text-right">Monthly</th>
                            </tr>
                          </thead>
                          <tbody>
                            {category.items.map((item, idx) => (
                              <tr
                                key={idx}
                                className="border-t border-gray-200 hover:bg-gray-100"
                              >
                                <td className="px-4 py-2 pl-12 font-mono text-sm">
                                  {item.name}
                                </td>
                                <td className="px-4 py-2 text-gray-600 text-sm">
                                  {item.detail}
                                </td>
                                <td className="px-4 py-2 text-gray-500 text-sm">
                                  {item.location}
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  ${item.monthlyCost.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Total */}
              <div className="bg-black text-white p-4 flex items-center justify-between">
                <span className="font-mono font-bold">TOTAL ESTIMATED</span>
                <span className="font-mono font-bold text-xl">
                  ${totalMonthly.toLocaleString()}/mo
                </span>
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
