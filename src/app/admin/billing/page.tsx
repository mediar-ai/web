'use client';

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
  Cloud,
  FolderOpen,
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

interface AzureBillingData {
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

interface GCPServiceBreakdown {
  service: string;
  description: string;
  monthlyCost: number;
  usageAmount: number;
  usageUnit: string;
}

interface GCPProjectBreakdown {
  projectId: string;
  projectName: string;
  monthlyCost: number;
  services: GCPServiceBreakdown[];
}

interface GCPBillingData {
  success: boolean;
  billingAccount?: {
    dataset: string;
    table: string;
  };
  summary?: {
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
  byProject?: GCPProjectBreakdown[];
  byService?: GCPServiceBreakdown[];
  error?: string;
  setup?: {
    required?: string[];
    steps?: string[];
    required_roles?: string[];
    documentation?: string;
  };
}

const categoryIcons: Record<string, React.ReactNode> = {
  'Virtual Machines': <Monitor className="w-5 h-5" />,
  'Virtual Machine Scale Sets': <Server className="w-5 h-5" />,
  'Container Instances': <Container className="w-5 h-5" />,
  'Managed Disks': <HardDrive className="w-5 h-5" />,
  'Networking & Other': <Network className="w-5 h-5" />,
};

type CloudProvider = 'azure' | 'gcp';
type GCPViewMode = 'service' | 'project';

export default function BillingPage() {
  const [activeProvider, setActiveProvider] = useState<CloudProvider>('azure');
  const [azureData, setAzureData] = useState<AzureBillingData | null>(null);
  const [gcpData, setGcpData] = useState<GCPBillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    fetchBillingData();
  }, []);

  const fetchBillingData = async () => {
    setLoading(true);
    setError(null);

    const [azureRes, gcpRes] = await Promise.allSettled([
      fetch('/api/admin/azure-billing').then(r => r.json()),
      fetch('/api/admin/gcp-billing').then(r => r.json()),
    ]);

    if (azureRes.status === 'fulfilled' && azureRes.value.success) {
      setAzureData(azureRes.value);
      setExpandedCategories(
        new Set(
          azureRes.value.breakdown?.map((b: CategoryBreakdown) => b.category) ||
            []
        )
      );
    } else if (azureRes.status === 'fulfilled') {
      console.error('Azure billing error:', azureRes.value.error);
    }

    if (gcpRes.status === 'fulfilled') {
      setGcpData(gcpRes.value);
    } else {
      console.error('GCP billing fetch failed:', gcpRes.reason);
    }

    setLoading(false);
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

  const azureTotal = azureData?.summary.estimatedMonthly || 0;
  const gcpTotal = gcpData?.summary?.totalMonthly || 0;
  const combinedTotal = azureTotal + gcpTotal;

  return (
    <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <DollarSign className="w-8 h-8" />
            <div>
              <h1 className="text-3xl font-mono font-bold">CLOUD BILLING</h1>
              <p className="text-gray-600">
                Infrastructure cost estimates across providers
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

        {/* Combined Summary */}
        <div className="border-2 border-black p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-xs text-gray-600 uppercase">
                Total Monthly (All Providers)
              </span>
              <div className="text-4xl font-mono font-bold">
                ${combinedTotal.toLocaleString()}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="text-right">
                <div className="font-mono text-xs text-gray-600">Azure</div>
                <div className="font-mono font-bold">
                  ${azureTotal.toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs text-gray-600">GCP</div>
                <div className="font-mono font-bold">
                  ${gcpTotal.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Provider Tabs */}
        <div className="flex border-2 border-black mb-6">
          <button
            onClick={() => setActiveProvider('azure')}
            className={`flex-1 px-6 py-3 font-mono font-bold flex items-center justify-center gap-2 transition-colors ${
              activeProvider === 'azure'
                ? 'bg-black text-white'
                : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            <Cloud className="w-5 h-5" />
            AZURE
            {azureData && (
              <span className="ml-2 text-sm">
                (${azureData.summary.estimatedMonthly.toLocaleString()})
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveProvider('gcp')}
            className={`flex-1 px-6 py-3 font-mono font-bold flex items-center justify-center gap-2 transition-colors border-l-2 border-black ${
              activeProvider === 'gcp'
                ? 'bg-black text-white'
                : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            <Cloud className="w-5 h-5" />
            GCP
            {gcpData?.success && gcpData.summary && (
              <span className="ml-2 text-sm">
                (${gcpData.summary.totalMonthly.toLocaleString()})
              </span>
            )}
          </button>
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

        {loading && !azureData && !gcpData ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin" />
          </div>
        ) : activeProvider === 'azure' ? (
          <AzureBillingView
            data={azureData}
            expandedCategories={expandedCategories}
            toggleCategory={toggleCategory}
          />
        ) : (
          <GCPBillingView data={gcpData} />
        )}
    </div>
  );
}

function AzureBillingView({
  data,
  expandedCategories,
  toggleCategory,
}: {
  data: AzureBillingData | null;
  expandedCategories: Set<string>;
  toggleCategory: (category: string) => void;
}) {
  if (!data) {
    return (
      <div className="border-2 border-dashed border-gray-400 p-8 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p className="font-mono text-gray-600">
          Azure billing data not available
        </p>
      </div>
    );
  }

  const totalMonthly = data.summary.estimatedMonthly;

  return (
    <>
      {data.subscription.note && (
        <div className="border-2 border-dashed border-gray-400 bg-gray-50 p-4 mb-6">
          <div className="flex items-start gap-2 text-gray-700">
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <span className="font-mono text-sm">{data.subscription.note}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <DollarSign className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Est. Monthly</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            ${data.summary.estimatedMonthly.toLocaleString()}
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">
            {data.summary.currency}
          </div>
        </div>

        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <TrendingUp className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Est. Daily</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            ${data.summary.estimatedDaily.toFixed(2)}
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">per day</div>
        </div>

        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <Server className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Compute</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            {data.summary.resourceCounts.vms +
              data.summary.resourceCounts.vmssInstances +
              data.summary.resourceCounts.containers}
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">
            {data.summary.resourceCounts.vms} VMs +{' '}
            {data.summary.resourceCounts.vmssInstances} VMSS +{' '}
            {data.summary.resourceCounts.containers} containers
          </div>
        </div>

        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <HardDrive className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Storage</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            {data.summary.resourceCounts.totalDiskGB} GB
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">
            across {data.summary.resourceCounts.disks} disks +{' '}
            {data.summary.resourceCounts.images} images
          </div>
        </div>
      </div>

      <div className="border-2 border-black">
        <div className="bg-black text-white p-4">
          <h2 className="font-mono font-bold">COST BREAKDOWN</h2>
        </div>

        {data.breakdown.map(category => {
          const isExpanded = expandedCategories.has(category.category);
          const percentage =
            totalMonthly > 0 ? (category.subtotal / totalMonthly) * 100 : 0;

          return (
            <div
              key={category.category}
              className="border-b border-gray-200 last:border-b-0"
            >
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
                    <span className="text-gray-500 text-sm ml-1">/mo</span>
                  </div>
                </div>
              </button>

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

        <div className="bg-black text-white p-4 flex items-center justify-between">
          <span className="font-mono font-bold">TOTAL ESTIMATED</span>
          <span className="font-mono font-bold text-xl">
            ${totalMonthly.toLocaleString()}/mo
          </span>
        </div>
      </div>

      <div className="mt-6 text-gray-600 font-mono text-sm">
        <p>Subscription: {data.subscription.name}</p>
        <p>Type: {data.subscription.type}</p>
        <p>ID: {data.subscription.id}</p>
      </div>
    </>
  );
}

function GCPBillingView({ data }: { data: GCPBillingData | null }) {
  const [viewMode, setViewMode] = useState<GCPViewMode>('service');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  if (!data) {
    return (
      <div className="border-2 border-dashed border-gray-400 p-8 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p className="font-mono text-gray-600">
          GCP billing data not available
        </p>
      </div>
    );
  }

  if (!data.success) {
    return (
      <div className="border-2 border-black p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-6 h-6 flex-shrink-0" />
          <div>
            <h3 className="font-mono font-bold mb-2">
              GCP Billing Not Configured
            </h3>
            <p className="text-gray-600 mb-4">{data.error}</p>
          </div>
        </div>

        {data.setup?.required && (
          <div className="bg-gray-50 p-4 mb-4">
            <h4 className="font-mono font-bold text-sm mb-2">
              REQUIRED ENVIRONMENT VARIABLES
            </h4>
            <ul className="list-disc list-inside font-mono text-sm text-gray-600 space-y-1">
              {data.setup.required.map((req, i) => (
                <li key={i}>{req}</li>
              ))}
            </ul>
          </div>
        )}

        {data.setup?.required_roles && (
          <div className="bg-gray-50 p-4 mb-4">
            <h4 className="font-mono font-bold text-sm mb-2">REQUIRED ROLES</h4>
            <ul className="list-disc list-inside font-mono text-sm text-gray-600 space-y-1">
              {data.setup.required_roles.map((role, i) => (
                <li key={i}>{role}</li>
              ))}
            </ul>
          </div>
        )}

        {data.setup?.steps && (
          <div className="bg-gray-50 p-4 mb-4">
            <h4 className="font-mono font-bold text-sm mb-2">SETUP STEPS</h4>
            <ol className="list-decimal list-inside font-mono text-sm text-gray-600 space-y-1">
              {data.setup.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {data.setup?.documentation && (
          <a
            href={data.setup.documentation}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-4 py-2 bg-black text-white font-mono text-sm hover:bg-gray-800"
          >
            VIEW DOCUMENTATION →
          </a>
        )}
      </div>
    );
  }

  const totalMonthly = data.summary?.totalMonthly || 0;
  const byService = data.byService || [];
  const byProject = data.byProject || [];

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <>
      {/* Billing Period Note */}
      <div className="border-2 border-dashed border-gray-400 bg-gray-50 p-4 mb-6">
        <div className="flex items-start gap-2 text-gray-700">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span className="font-mono text-sm">
            Billing period: {data.summary?.billingPeriod.start} to{' '}
            {data.summary?.billingPeriod.end}. Data from BigQuery export (
            {data.billingAccount?.table}).
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <DollarSign className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Current Month</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            ${(data.summary?.totalMonthly || 0).toLocaleString()}
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">
            {data.summary?.currency || 'USD'}
          </div>
        </div>

        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <TrendingUp className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Daily Average</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            ${(data.summary?.totalDaily || 0).toFixed(2)}
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">per day</div>
        </div>

        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <FolderOpen className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Projects</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            {data.summary?.projectCount || 0}
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">
            active projects
          </div>
        </div>

        <div className="border-2 border-black p-6">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <Server className="w-5 h-5" />
            <span className="font-mono text-xs uppercase">Services</span>
          </div>
          <div className="text-3xl font-mono font-bold">
            {data.summary?.serviceCount || 0}
          </div>
          <div className="text-gray-600 font-mono text-sm mt-1">
            active services
          </div>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex border-2 border-black mb-4">
        <button
          onClick={() => setViewMode('service')}
          className={`flex-1 px-4 py-2 font-mono text-sm flex items-center justify-center gap-2 transition-colors ${
            viewMode === 'service'
              ? 'bg-black text-white'
              : 'bg-white text-black hover:bg-gray-100'
          }`}
        >
          <Cloud className="w-4 h-4" />
          BY SERVICE
        </button>
        <button
          onClick={() => setViewMode('project')}
          className={`flex-1 px-4 py-2 font-mono text-sm flex items-center justify-center gap-2 transition-colors border-l-2 border-black ${
            viewMode === 'project'
              ? 'bg-black text-white'
              : 'bg-white text-black hover:bg-gray-100'
          }`}
        >
          <FolderOpen className="w-4 h-4" />
          BY PROJECT
        </button>
      </div>

      {/* Breakdown */}
      <div className="border-2 border-black">
        <div className="bg-black text-white p-4">
          <h2 className="font-mono font-bold">
            {viewMode === 'service' ? 'SERVICE BREAKDOWN' : 'PROJECT BREAKDOWN'}
          </h2>
        </div>

        {viewMode === 'service' ? (
          <>
            {byService.map((service, idx) => {
              const percentage =
                totalMonthly > 0
                  ? (service.monthlyCost / totalMonthly) * 100
                  : 0;
              const isExpanded = expandedItems.has(`svc-${idx}`);

              return (
                <div
                  key={idx}
                  className="border-b border-gray-200 last:border-b-0"
                >
                  <button
                    onClick={() => toggleItem(`svc-${idx}`)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      <Cloud className="w-5 h-5" />
                      <span className="font-mono font-bold">
                        {service.service}
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
                          ${service.monthlyCost.toFixed(2)}
                        </span>
                        <span className="text-gray-500 text-sm ml-1">/mo</span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="bg-gray-50 border-t border-gray-200 p-4 pl-12">
                      <div className="grid grid-cols-2 gap-4 font-mono text-sm">
                        <div>
                          <span className="text-gray-500">Description:</span>
                          <p className="text-gray-800">
                            {service.description || 'N/A'}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500">Usage:</span>
                          <p className="text-gray-800">
                            {service.usageAmount.toLocaleString()}{' '}
                            {service.usageUnit}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <>
            {byProject.map((project, idx) => {
              const percentage =
                totalMonthly > 0
                  ? (project.monthlyCost / totalMonthly) * 100
                  : 0;
              const isExpanded = expandedItems.has(`proj-${idx}`);

              return (
                <div
                  key={idx}
                  className="border-b border-gray-200 last:border-b-0"
                >
                  <button
                    onClick={() => toggleItem(`proj-${idx}`)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      <FolderOpen className="w-5 h-5" />
                      <div className="text-left">
                        <span className="font-mono font-bold">
                          {project.projectName}
                        </span>
                        {project.projectId !== project.projectName && (
                          <span className="text-gray-500 text-sm ml-2">
                            ({project.projectId})
                          </span>
                        )}
                      </div>
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
                          ${project.monthlyCost.toFixed(2)}
                        </span>
                        <span className="text-gray-500 text-sm ml-1">/mo</span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && project.services.length > 0 && (
                    <div className="bg-gray-50 border-t border-gray-200">
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-xs font-mono text-gray-500 uppercase">
                            <th className="px-4 py-2 pl-12">Service</th>
                            <th className="px-4 py-2">Usage</th>
                            <th className="px-4 py-2 text-right">Monthly</th>
                          </tr>
                        </thead>
                        <tbody>
                          {project.services.map((svc, svcIdx) => (
                            <tr
                              key={svcIdx}
                              className="border-t border-gray-200 hover:bg-gray-100"
                            >
                              <td className="px-4 py-2 pl-12 font-mono text-sm">
                                {svc.service}
                              </td>
                              <td className="px-4 py-2 text-gray-600 text-sm">
                                {svc.usageAmount.toLocaleString()}{' '}
                                {svc.usageUnit}
                              </td>
                              <td className="px-4 py-2 text-right font-mono">
                                ${svc.monthlyCost.toFixed(2)}
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
          </>
        )}

        {((viewMode === 'service' && byService.length === 0) ||
          (viewMode === 'project' && byProject.length === 0)) && (
          <div className="p-8 text-center text-gray-500 font-mono">
            No billing data for current period
          </div>
        )}

        {/* Total */}
        <div className="bg-black text-white p-4 flex items-center justify-between">
          <span className="font-mono font-bold">TOTAL</span>
          <span className="font-mono font-bold text-xl">
            ${totalMonthly.toLocaleString()}/mo
          </span>
        </div>
      </div>

      {/* Dataset Info */}
      <div className="mt-6 text-gray-600 font-mono text-sm">
        <p>Dataset: {data.billingAccount?.dataset}</p>
        <p>Table: {data.billingAccount?.table}</p>
      </div>
    </>
  );
}
