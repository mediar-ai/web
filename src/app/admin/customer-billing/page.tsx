'use client';

import { useEffect, useState } from 'react';
import { Receipt, RefreshCw, Building2, Search, Clock, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface Organization {
  id: string;
  name: string;
  clerk_organization_id: string;
}

interface UsageMetrics {
  organizationId: string;
  organizationName: string;
  totalExecutions: number;
  totalMinutes: number;
  activeWorkflows: number;
  lastExecution: string | null;
  period: string;
}

export default function AdminCustomerBillingPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [usageData, setUsageData] = useState<UsageMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    fetchData();
  }, [period]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch organizations
      const orgsRes = await fetch('/api/admin/organizations');
      const orgsData = orgsRes.ok ? await orgsRes.json() : { organizations: [] };
      setOrganizations(orgsData.organizations || []);

      // Fetch usage metrics (placeholder - would need API)
      const usageRes = await fetch(`/api/admin/customer-billing?period=${period}`);
      if (usageRes.ok) {
        const data = await usageRes.json();
        setUsageData(data.usage || []);
      } else {
        // Generate placeholder data from organizations
        const placeholderUsage = (orgsData.organizations || []).map((org: Organization) => ({
          organizationId: org.id,
          organizationName: org.name,
          totalExecutions: 0,
          totalMinutes: 0,
          activeWorkflows: 0,
          lastExecution: null,
          period: period,
        }));
        setUsageData(placeholderUsage);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load customer billing data');
    } finally {
      setLoading(false);
    }
  };

  const filteredUsage = usageData.filter(usage =>
    usage.organizationName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalExecutions = usageData.reduce((sum, u) => sum + u.totalExecutions, 0);
  const totalMinutes = usageData.reduce((sum, u) => sum + u.totalMinutes, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <Receipt className="w-6 h-6" />
            CUSTOMER BILLING
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Customer usage metrics and invoicing
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
            onClick={fetchData}
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Customers</span>
              </div>
              <div className="font-mono font-bold text-3xl">{organizations.length}</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Executions</span>
              </div>
              <div className="font-mono font-bold text-3xl">{totalExecutions}</div>
              <div className="font-mono text-xs text-gray-500 mt-1">Last {period}</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Total Minutes</span>
              </div>
              <div className="font-mono font-bold text-3xl">{totalMinutes}</div>
              <div className="font-mono text-xs text-gray-500 mt-1">Compute time</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <Receipt className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Active</span>
              </div>
              <div className="font-mono font-bold text-3xl">
                {usageData.filter(u => u.totalExecutions > 0).length}
              </div>
              <div className="font-mono text-xs text-gray-500 mt-1">With usage</div>
            </div>
          </div>

          {/* Customer Usage Table */}
          <div className="border-2 border-black">
            <div className="p-3 border-b-2 border-black bg-black text-white flex items-center justify-between">
              <span className="font-mono font-bold text-sm">CUSTOMER USAGE</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3 py-1 font-mono text-sm text-black focus:outline-none"
                />
              </div>
            </div>
            {filteredUsage.length === 0 ? (
              <div className="p-8 text-center font-mono text-gray-600">
                No customer usage data found
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredUsage.map(usage => (
                  <div key={usage.organizationId} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Building2 className="w-5 h-5 text-gray-400" />
                      <div>
                        <div className="font-mono font-bold">{usage.organizationName}</div>
                        <div className="font-mono text-xs text-gray-500">
                          {usage.activeWorkflows} active workflows
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="font-mono font-bold">{usage.totalExecutions}</div>
                        <div className="font-mono text-xs text-gray-500">executions</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold">{usage.totalMinutes}</div>
                        <div className="font-mono text-xs text-gray-500">minutes</div>
                      </div>
                      <div className="text-right w-32">
                        <div className="font-mono text-xs text-gray-500">
                          {usage.lastExecution
                            ? new Date(usage.lastExecution).toLocaleDateString()
                            : 'Never'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
