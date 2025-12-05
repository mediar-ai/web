'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useUser } from '@clerk/nextjs';
import { useState } from 'react';
import {
  FileText,
  Download,
  ChevronDown,
  ChevronRight,
  Calendar,
  Clock,
  Server,
  Activity,
  Filter,
  Search,
  ArrowUpDown,
  MoreHorizontal,
  Eye,
  Printer,
} from 'lucide-react';

// Mock data - will be replaced with real API
const mockInvoices = [
  {
    id: 'INV-2024-001247',
    period: 'November 2024',
    periodStart: '2024-11-01',
    periodEnd: '2024-11-30',
    status: 'paid',
    dueDate: '2024-12-15',
    paidDate: '2024-12-10',
    items: [
      { sku: 'WKFL-EXEC-STD', description: 'Workflow Executions - Standard', quantity: 1247, unit: 'executions', rate: 0.02 },
      { sku: 'WKFL-EXEC-PRI', description: 'Workflow Executions - Priority', quantity: 89, unit: 'executions', rate: 0.05 },
      { sku: 'VM-HRS-WIN', description: 'Windows VM Hours', quantity: 342.5, unit: 'hours', rate: 0.12 },
      { sku: 'STRG-GB', description: 'Storage - Workflow Artifacts', quantity: 15.7, unit: 'GB', rate: 0.10 },
      { sku: 'API-CALLS', description: 'API Calls', quantity: 45230, unit: 'calls', rate: 0.0001 },
    ],
  },
  {
    id: 'INV-2024-001189',
    period: 'October 2024',
    periodStart: '2024-10-01',
    periodEnd: '2024-10-31',
    status: 'paid',
    dueDate: '2024-11-15',
    paidDate: '2024-11-12',
    items: [
      { sku: 'WKFL-EXEC-STD', description: 'Workflow Executions - Standard', quantity: 892, unit: 'executions', rate: 0.02 },
      { sku: 'VM-HRS-WIN', description: 'Windows VM Hours', quantity: 256.0, unit: 'hours', rate: 0.12 },
      { sku: 'STRG-GB', description: 'Storage - Workflow Artifacts', quantity: 12.3, unit: 'GB', rate: 0.10 },
    ],
  },
  {
    id: 'INV-2024-001102',
    period: 'September 2024',
    periodStart: '2024-09-01',
    periodEnd: '2024-09-30',
    status: 'paid',
    dueDate: '2024-10-15',
    paidDate: '2024-10-14',
    items: [
      { sku: 'WKFL-EXEC-STD', description: 'Workflow Executions - Standard', quantity: 456, unit: 'executions', rate: 0.02 },
      { sku: 'VM-HRS-WIN', description: 'Windows VM Hours', quantity: 128.0, unit: 'hours', rate: 0.12 },
    ],
  },
];

const mockUsageBreakdown = {
  currentPeriod: 'December 2024 (partial)',
  lastUpdated: '2024-12-05T13:00:00Z',
  categories: [
    {
      name: 'Compute',
      subcategories: [
        { name: 'VM Instance Hours', detail: 'Standard_D2s_v3', value: 89.5, unit: 'hours' },
        { name: 'VM Instance Hours', detail: 'Standard_D4s_v3', value: 12.0, unit: 'hours' },
      ],
    },
    {
      name: 'Workflow Execution',
      subcategories: [
        { name: 'Standard Executions', detail: 'Successful', value: 312, unit: 'executions' },
        { name: 'Standard Executions', detail: 'Failed', value: 7, unit: 'executions' },
        { name: 'Priority Executions', detail: 'Successful', value: 23, unit: 'executions' },
      ],
    },
    {
      name: 'Storage',
      subcategories: [
        { name: 'Workflow Artifacts', detail: 'Screenshots & Logs', value: 2.3, unit: 'GB' },
        { name: 'Workflow Definitions', detail: 'YAML Files', value: 0.01, unit: 'GB' },
      ],
    },
    {
      name: 'Network',
      subcategories: [
        { name: 'Data Transfer', detail: 'Egress', value: 1.2, unit: 'GB' },
        { name: 'API Requests', detail: 'External', value: 8934, unit: 'requests' },
      ],
    },
  ],
};

export default function BillingPage() {
  const { user } = useUser();
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'invoices' | 'usage' | 'statements'>('invoices');
  const [searchQuery, setSearchQuery] = useState('');

  // Private page - mediar only for now
  const isMediarAdmin = user?.emailAddresses?.some(e =>
    e.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

  if (!isMediarAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h2 className="text-xl font-mono font-bold">BILLING</h2>
            <p className="text-gray-600 mt-2">Coming soon</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const toggleInvoice = (id: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const calculateInvoiceTotal = (items: typeof mockInvoices[0]['items']) => {
    return items.reduce((sum, item) => sum + item.quantity * item.rate, 0);
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FileText className="w-7 h-7" />
            <div>
              <h1 className="text-2xl font-mono font-bold">BILLING & USAGE</h1>
              <p className="text-gray-600 text-sm">
                View invoices, statements, and usage details
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-black mb-6">
          {(['invoices', 'usage', 'statements'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-mono text-sm uppercase transition-colors ${
                activeTab === tab
                  ? 'bg-black text-white'
                  : 'bg-white text-black hover:bg-gray-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'invoices' && (
          <div>
            {/* Filters Bar */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search invoices..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <button className="flex items-center gap-2 px-4 py-2 border-2 border-black font-mono text-sm hover:bg-gray-100">
                <Filter className="w-4 h-4" />
                FILTER
              </button>
              <button className="flex items-center gap-2 px-4 py-2 border-2 border-black font-mono text-sm hover:bg-gray-100">
                <ArrowUpDown className="w-4 h-4" />
                SORT
              </button>
            </div>

            {/* Invoices List */}
            <div className="border-2 border-black">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 grid grid-cols-12 gap-4 font-mono text-xs text-gray-600 uppercase">
                <div className="col-span-1"></div>
                <div className="col-span-2">Invoice</div>
                <div className="col-span-2">Period</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Due Date</div>
                <div className="col-span-2">Amount</div>
                <div className="col-span-1"></div>
              </div>

              {mockInvoices.map(invoice => {
                const isExpanded = expandedInvoices.has(invoice.id);
                const total = calculateInvoiceTotal(invoice.items);

                return (
                  <div key={invoice.id} className="border-b border-gray-200 last:border-b-0">
                    <div
                      className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer items-center"
                      onClick={() => toggleInvoice(invoice.id)}
                    >
                      <div className="col-span-1">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>
                      <div className="col-span-2 font-mono text-sm font-bold">
                        {invoice.id}
                      </div>
                      <div className="col-span-2 font-mono text-sm text-gray-600">
                        {invoice.period}
                      </div>
                      <div className="col-span-2">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-mono uppercase ${
                          invoice.status === 'paid'
                            ? 'bg-white border-2 border-black'
                            : 'bg-gray-100 border-2 border-dashed border-gray-400'
                        }`}>
                          {invoice.status}
                        </span>
                      </div>
                      <div className="col-span-2 font-mono text-sm text-gray-600">
                        {new Date(invoice.dueDate).toLocaleDateString()}
                      </div>
                      <div className="col-span-2 font-mono text-sm">
                        {/* Intentionally not showing total prominently */}
                        <span className="text-gray-500">See details</span>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                          }}
                          className="p-1 hover:bg-gray-200 rounded"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-gray-50 border-t border-gray-200 p-4">
                        {/* Invoice Header */}
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="font-mono text-xs text-gray-500 uppercase mb-1">
                              Billing Period
                            </div>
                            <div className="font-mono text-sm">
                              {new Date(invoice.periodStart).toLocaleDateString()} - {new Date(invoice.periodEnd).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                              <Eye className="w-3 h-3" />
                              VIEW PDF
                            </button>
                            <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                              <Download className="w-3 h-3" />
                              DOWNLOAD
                            </button>
                            <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                              <Printer className="w-3 h-3" />
                              PRINT
                            </button>
                          </div>
                        </div>

                        {/* Line Items Table */}
                        <table className="w-full mb-4">
                          <thead>
                            <tr className="text-left text-xs font-mono text-gray-500 uppercase border-b border-gray-300">
                              <th className="py-2">SKU</th>
                              <th className="py-2">Description</th>
                              <th className="py-2 text-right">Quantity</th>
                              <th className="py-2 text-right">Unit</th>
                              <th className="py-2 text-right">Rate</th>
                              <th className="py-2 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoice.items.map((item, idx) => (
                              <tr key={idx} className="border-b border-gray-200 text-sm font-mono">
                                <td className="py-2 text-gray-500">{item.sku}</td>
                                <td className="py-2">{item.description}</td>
                                <td className="py-2 text-right">{item.quantity.toLocaleString()}</td>
                                <td className="py-2 text-right text-gray-500">{item.unit}</td>
                                <td className="py-2 text-right">${item.rate.toFixed(4)}</td>
                                <td className="py-2 text-right">${(item.quantity * item.rate).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Totals - buried at bottom */}
                        <div className="border-t border-gray-300 pt-3">
                          <div className="flex justify-end">
                            <div className="w-64">
                              <div className="flex justify-between text-sm font-mono py-1">
                                <span className="text-gray-500">Subtotal</span>
                                <span>${total.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-sm font-mono py-1">
                                <span className="text-gray-500">Tax (0%)</span>
                                <span>$0.00</span>
                              </div>
                              <div className="flex justify-between text-sm font-mono py-1">
                                <span className="text-gray-500">Credits Applied</span>
                                <span>-$0.00</span>
                              </div>
                              <div className="flex justify-between font-mono py-1 border-t border-gray-300 mt-1 pt-1">
                                <span className="font-bold">Total</span>
                                <span className="font-bold">${total.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Payment Info */}
                        {invoice.paidDate && (
                          <div className="mt-4 text-xs font-mono text-gray-500">
                            Payment received on {new Date(invoice.paidDate).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination placeholder */}
            <div className="flex justify-between items-center mt-4 text-sm font-mono text-gray-600">
              <span>Showing 1-3 of 3 invoices</span>
              <div className="flex gap-2">
                <button disabled className="px-3 py-1 border border-gray-300 text-gray-400">
                  Previous
                </button>
                <button disabled className="px-3 py-1 border border-gray-300 text-gray-400">
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'usage' && (
          <div>
            {/* Current Period Info */}
            <div className="border-2 border-dashed border-gray-400 bg-gray-50 p-4 mb-6">
              <div className="flex items-center gap-2 text-gray-700">
                <Clock className="w-4 h-4" />
                <span className="font-mono text-sm">
                  {mockUsageBreakdown.currentPeriod} | Last updated: {new Date(mockUsageBreakdown.lastUpdated).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Usage Categories - Azure style expandable */}
            <div className="border-2 border-black">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold">USAGE BY CATEGORY</h2>
              </div>

              {mockUsageBreakdown.categories.map(category => {
                const isExpanded = expandedCategories.has(category.name);

                return (
                  <div key={category.name} className="border-b border-gray-200 last:border-b-0">
                    <button
                      onClick={() => toggleCategory(category.name)}
                      className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        {category.name === 'Compute' && <Server className="w-5 h-5" />}
                        {category.name === 'Workflow Execution' && <Activity className="w-5 h-5" />}
                        {category.name === 'Storage' && <FileText className="w-5 h-5" />}
                        {category.name === 'Network' && <Activity className="w-5 h-5" />}
                        <span className="font-mono font-bold">{category.name}</span>
                        <span className="text-gray-500 text-sm">
                          ({category.subcategories.length} items)
                        </span>
                      </div>
                      <span className="font-mono text-gray-500 text-sm">
                        View breakdown
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="bg-gray-50 border-t border-gray-200">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left text-xs font-mono text-gray-500 uppercase">
                              <th className="px-4 py-2 pl-12">Meter</th>
                              <th className="px-4 py-2">Details</th>
                              <th className="px-4 py-2 text-right">Usage</th>
                              <th className="px-4 py-2 text-right">Unit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {category.subcategories.map((sub, idx) => (
                              <tr key={idx} className="border-t border-gray-200 hover:bg-gray-100">
                                <td className="px-4 py-2 pl-12 font-mono text-sm">{sub.name}</td>
                                <td className="px-4 py-2 text-gray-600 text-sm">{sub.detail}</td>
                                <td className="px-4 py-2 text-right font-mono text-sm">
                                  {sub.value.toLocaleString()}
                                </td>
                                <td className="px-4 py-2 text-right text-gray-500 text-sm">
                                  {sub.unit}
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
            </div>

            <div className="mt-4 text-xs font-mono text-gray-500">
              Usage data is updated periodically and may not reflect real-time consumption.
            </div>
          </div>
        )}

        {activeTab === 'statements' && (
          <div>
            {/* Statement downloads */}
            <div className="border-2 border-black">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold">MONTHLY STATEMENTS</h2>
              </div>

              <div className="divide-y divide-gray-200">
                {['November 2024', 'October 2024', 'September 2024', 'August 2024'].map(month => (
                  <div key={month} className="flex items-center justify-between p-4 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-5 h-5 text-gray-400" />
                      <span className="font-mono">{month}</span>
                    </div>
                    <div className="flex gap-2">
                      <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                        <FileText className="w-3 h-3" />
                        PDF
                      </button>
                      <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                        <Download className="w-3 h-3" />
                        CSV
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 border-2 border-dashed border-gray-400 p-4">
              <h3 className="font-mono font-bold text-sm mb-2">NEED HELP?</h3>
              <p className="text-gray-600 text-sm font-mono">
                For billing inquiries, contact billing@mediar.ai
              </p>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
