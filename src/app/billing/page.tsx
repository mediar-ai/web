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
} from 'lucide-react';

// Imperial Treasure production workflow data
const itWorkflowData = {
  customer: 'Imperial Treasure',
  period: 'December 2024',
  periodStart: '2024-12-01',
  periodEnd: '2024-12-05',
  workflows: [
    {
      id: 314,
      name: 'OneDrive to SAP B1 Journal Entry',
      executions: 47,
      vmHours: 23.5,
    },
    {
      id: 315,
      name: 'SAP B1 Daily Backup',
      executions: 5,
      vmHours: 2.1,
    },
  ],
};

const mockInvoices = [
  {
    id: 'INV-2024-IT-001',
    period: 'November 2024',
    status: 'paid',
    dueDate: '2024-12-15',
  },
  {
    id: 'INV-2024-IT-002',
    period: 'December 2024',
    status: 'pending',
    dueDate: '2025-01-15',
  },
];

export default function BillingPage() {
  const { user } = useUser();
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(
    new Set()
  );
  const [activeTab, setActiveTab] = useState<'usage' | 'invoices'>('usage');

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

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-6 h-6" />
          <h1 className="text-2xl font-mono font-bold">BILLING</h1>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-black mb-6">
          {(['usage', 'invoices'] as const).map(tab => (
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

        {activeTab === 'usage' && (
          <div>
            {/* Customer Header */}
            <div className="border-2 border-black mb-6">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold">{itWorkflowData.customer}</h2>
              </div>
              <div className="p-4">
                <div className="font-mono text-sm text-gray-600">
                  {itWorkflowData.period} (
                  {new Date(itWorkflowData.periodStart).toLocaleDateString()} -{' '}
                  {new Date(itWorkflowData.periodEnd).toLocaleDateString()})
                </div>
              </div>
            </div>

            {/* Workflow Usage */}
            <div className="border-2 border-black">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 grid grid-cols-4 gap-4 font-mono text-xs text-gray-600 uppercase">
                <div>Workflow</div>
                <div className="text-right">Executions</div>
                <div className="text-right">VM Hours</div>
                <div className="text-right">Status</div>
              </div>

              {itWorkflowData.workflows.map(wf => (
                <div
                  key={wf.id}
                  className="grid grid-cols-4 gap-4 px-4 py-3 border-b border-gray-200 last:border-b-0"
                >
                  <div className="font-mono text-sm">
                    <span className="text-gray-500">#{wf.id}</span> {wf.name}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {wf.executions}
                  </div>
                  <div className="text-right font-mono text-sm">
                    {wf.vmHours.toFixed(1)}h
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-2 py-0.5 text-xs font-mono uppercase bg-white border-2 border-black">
                      active
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 text-xs font-mono text-gray-500">
              Usage data updated periodically
            </div>
          </div>
        )}

        {activeTab === 'invoices' && (
          <div>
            <div className="border-2 border-black">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 grid grid-cols-4 gap-4 font-mono text-xs text-gray-600 uppercase">
                <div>Invoice</div>
                <div>Period</div>
                <div>Due Date</div>
                <div>Status</div>
              </div>

              {mockInvoices.map(invoice => {
                const isExpanded = expandedInvoices.has(invoice.id);

                return (
                  <div
                    key={invoice.id}
                    className="border-b border-gray-200 last:border-b-0"
                  >
                    <div
                      className="grid grid-cols-4 gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer items-center"
                      onClick={() => toggleInvoice(invoice.id)}
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <span className="font-mono text-sm">{invoice.id}</span>
                      </div>
                      <div className="font-mono text-sm text-gray-600">
                        {invoice.period}
                      </div>
                      <div className="font-mono text-sm text-gray-600">
                        {new Date(invoice.dueDate).toLocaleDateString()}
                      </div>
                      <div>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs font-mono uppercase ${
                            invoice.status === 'paid'
                              ? 'bg-white border-2 border-black'
                              : 'bg-gray-100 border-2 border-dashed border-gray-400'
                          }`}
                        >
                          {invoice.status}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-gray-50 border-t border-gray-200 p-4">
                        <div className="flex gap-2">
                          <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                            <FileText className="w-3 h-3" />
                            VIEW PDF
                          </button>
                          <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                            <Download className="w-3 h-3" />
                            DOWNLOAD
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Statements */}
            <div className="mt-6 border-2 border-black">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold text-sm">STATEMENTS</h2>
              </div>
              <div className="divide-y divide-gray-200">
                {['November 2024', 'October 2024'].map(month => (
                  <div
                    key={month}
                    className="flex items-center justify-between p-4 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className="font-mono text-sm">{month}</span>
                    </div>
                    <button className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white">
                      <Download className="w-3 h-3" />
                      PDF
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
