'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useUser } from '@clerk/nextjs';
import { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import {
  FileText,
  Download,
  ChevronDown,
  ChevronRight,
  Calendar,
  Loader2,
} from 'lucide-react';

// Pricing: $0.50 per minute of execution
const RATE_PER_MINUTE = 0.5;

interface WorkflowUsage {
  id: number;
  name: string;
  executions: number;
  totalMinutes: number;
  cost: number;
}

interface MonthlyData {
  key: string;
  name: string;
  workflows: WorkflowUsage[];
  totalMinutes: number;
  totalCost: number;
}

interface UsageData {
  ratePerMinute: number;
  months: MonthlyData[];
}

interface Invoice {
  id: string;
  period: string;
  status: 'paid' | 'pending';
  dueDate: string;
  paidDate?: string;
  items: {
    description: string;
    quantity: number;
    unit: string;
    rate: number;
  }[];
}

function generateInvoicePDF(invoice: Invoice, action: 'download' | 'view') {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('MEDIAR', 20, 25);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Mediar AI Pte. Ltd.', 20, 35);
  doc.text('Singapore', 20, 40);

  // Invoice details
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', pageWidth - 20, 25, { align: 'right' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.id, pageWidth - 20, 35, { align: 'right' });
  doc.text(`Period: ${invoice.period}`, pageWidth - 20, 42, { align: 'right' });
  doc.text(
    `Due: ${new Date(invoice.dueDate).toLocaleDateString()}`,
    pageWidth - 20,
    49,
    { align: 'right' }
  );

  // Bill To
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', 20, 65);
  doc.setFont('helvetica', 'normal');
  doc.text('Imperial Treasure', 20, 72);

  // Line
  doc.setLineWidth(0.5);
  doc.line(20, 82, pageWidth - 20, 82);

  // Table header
  let y = 92;
  doc.setFont('helvetica', 'bold');
  doc.text('Description', 20, y);
  doc.text('Qty', 90, y);
  doc.text('Unit', 115, y);
  doc.text('Rate', 140, y);
  doc.text('Amount', pageWidth - 20, y, { align: 'right' });

  doc.line(20, y + 3, pageWidth - 20, y + 3);

  // Items
  doc.setFont('helvetica', 'normal');
  let subtotal = 0;
  invoice.items.forEach(item => {
    y += 10;
    const amount = item.quantity * item.rate;
    subtotal += amount;
    doc.text(item.description, 20, y);
    doc.text(item.quantity.toLocaleString(), 90, y);
    doc.text(item.unit, 115, y);
    doc.text(`$${item.rate.toFixed(2)}/min`, 140, y);
    doc.text(
      `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      pageWidth - 20,
      y,
      { align: 'right' }
    );
  });

  // Totals
  const formatCurrency = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  y += 20;
  doc.line(120, y - 5, pageWidth - 20, y - 5);
  doc.text('Subtotal:', 140, y);
  doc.text(formatCurrency(subtotal), pageWidth - 20, y, { align: 'right' });

  y += 8;
  doc.text('Tax (0%):', 140, y);
  doc.text('$0.00', pageWidth - 20, y, { align: 'right' });

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('Total:', 140, y);
  doc.text(formatCurrency(subtotal), pageWidth - 20, y, { align: 'right' });

  // Status
  y += 20;
  doc.setFont('helvetica', 'normal');
  if (invoice.status === 'paid' && invoice.paidDate) {
    doc.text(
      `Payment received: ${new Date(invoice.paidDate).toLocaleDateString()}`,
      20,
      y
    );
  } else {
    doc.text(`Status: ${invoice.status.toUpperCase()}`, 20, y);
  }

  // Footer
  doc.setFontSize(8);
  doc.text('Thank you for your business.', 20, 270);
  doc.text('Questions? Contact billing@mediar.ai', 20, 275);

  if (action === 'download') {
    doc.save(`${invoice.id}.pdf`);
  } else {
    window.open(doc.output('bloburl'), '_blank');
  }
}

function generateStatementPDF(monthData: MonthlyData) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('MEDIAR', 20, 25);

  doc.setFontSize(20);
  doc.text('STATEMENT', pageWidth - 20, 25, { align: 'right' });

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(monthData.name, pageWidth - 20, 35, { align: 'right' });

  // Customer
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('ACCOUNT', 20, 50);
  doc.setFont('helvetica', 'normal');
  doc.text('Imperial Treasure', 20, 57);

  // Summary
  doc.line(20, 67, pageWidth - 20, 67);

  let y = 80;
  doc.setFont('helvetica', 'bold');
  doc.text('Activity Summary', 20, y);

  y += 12;
  doc.setFont('helvetica', 'normal');

  const totalExecutions = monthData.workflows.reduce(
    (sum, wf) => sum + wf.executions,
    0
  );
  doc.text('Total Workflow Executions:', 20, y);
  doc.text(totalExecutions.toString(), pageWidth - 20, y, { align: 'right' });

  y += 8;
  const hours = monthData.totalMinutes / 60;
  doc.text('Total Execution Time:', 20, y);
  doc.text(`${hours.toFixed(1)}h`, pageWidth - 20, y, { align: 'right' });

  y += 8;
  doc.text('Active Workflows:', 20, y);
  doc.text(monthData.workflows.length.toString(), pageWidth - 20, y, {
    align: 'right',
  });

  y += 8;
  doc.text('Total Cost:', 20, y);
  doc.text(
    `$${monthData.totalCost.toFixed(2)}`,
    pageWidth - 20,
    y,
    { align: 'right' }
  );

  // Workflow breakdown
  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.text('Workflow Breakdown', 20, y);

  y += 10;
  doc.setFont('helvetica', 'normal');
  monthData.workflows.forEach(wf => {
    doc.text(`#${wf.id} ${wf.name}`, 20, y);
    y += 6;
    doc.text(
      `  ${wf.executions} executions, ${wf.totalMinutes.toFixed(1)} min, $${wf.cost.toFixed(2)}`,
      20,
      y
    );
    y += 8;
  });

  // Footer
  doc.setFontSize(8);
  doc.text('Generated by Mediar AI', 20, 275);

  doc.save(`Statement-${monthData.name.replace(' ', '-')}.pdf`);
}

export default function BillingPage() {
  const { user } = useUser();
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(
    new Set()
  );
  const [activeTab, setActiveTab] = useState<'usage' | 'invoices'>('usage');
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Private page - mediar only for now
  const isMediarAdmin = user?.emailAddresses?.some(e =>
    e.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

  useEffect(() => {
    if (!isMediarAdmin) return;

    async function fetchUsage() {
      try {
        const res = await fetch('/api/billing/usage');
        if (!res.ok) throw new Error('Failed to fetch usage data');
        const data = await res.json();
        setUsageData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchUsage();
  }, [isMediarAdmin]);

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

  const toggleMonth = (key: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleInvoice = (id: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Generate invoices from usage data
  const invoices: Invoice[] =
    usageData?.months.map((month, idx) => ({
      id: `INV-${month.key}-${String(idx + 1).padStart(3, '0')}`,
      period: month.name,
      status: idx === 0 ? 'pending' : 'paid',
      dueDate: new Date(
        parseInt(month.key.split('-')[0]),
        parseInt(month.key.split('-')[1]),
        15
      ).toISOString(),
      paidDate:
        idx > 0
          ? new Date(
              parseInt(month.key.split('-')[0]),
              parseInt(month.key.split('-')[1]),
              10
            ).toISOString()
          : undefined,
      items: [
        {
          description: 'Workflow Execution Time',
          quantity: Math.round(month.totalMinutes),
          unit: 'minutes',
          rate: RATE_PER_MINUTE,
        },
      ],
    })) || [];

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

        {loading && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        )}

        {error && (
          <div className="border-2 border-black p-4 bg-gray-50">
            <p className="font-mono text-sm text-gray-600">Error: {error}</p>
          </div>
        )}

        {!loading && !error && activeTab === 'usage' && (
          <div>
            {/* Customer Header */}
            <div className="border-2 border-black mb-6">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold">Imperial Treasure</h2>
              </div>
              <div className="p-4">
                <div className="font-mono text-sm text-gray-600">
                  Last 12 months of execution data (prod workflows only)
                </div>
              </div>
            </div>

            {/* Monthly Usage */}
            {usageData?.months.map(month => {
              const isExpanded = expandedMonths.has(month.key);
              return (
                <div key={month.key} className="border-2 border-black mb-4">
                  <div
                    className="bg-gray-50 px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleMonth(month.key)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      <span className="font-mono font-bold">{month.name}</span>
                    </div>
                    <div className="font-mono text-sm text-gray-600">
                      {month.workflows.reduce((s, w) => s + w.executions, 0)}{' '}
                      executions &middot; {month.totalMinutes.toFixed(1)} min
                    </div>
                  </div>

                  {isExpanded && (
                    <div>
                      <div className="bg-white px-4 py-2 border-t border-gray-200 grid grid-cols-5 gap-4 font-mono text-xs text-gray-600 uppercase">
                        <div>Workflow</div>
                        <div className="text-right">Executions</div>
                        <div className="text-right">Minutes</div>
                        <div className="text-right">Cost</div>
                        <div className="text-right">Status</div>
                      </div>

                      {month.workflows.map(wf => (
                        <div
                          key={wf.id}
                          className="grid grid-cols-5 gap-4 px-4 py-3 border-t border-gray-200"
                        >
                          <div className="font-mono text-sm">
                            <span className="text-gray-500">#{wf.id}</span>{' '}
                            {wf.name}
                          </div>
                          <div className="text-right font-mono text-sm">
                            {wf.executions}
                          </div>
                          <div className="text-right font-mono text-sm">
                            {wf.totalMinutes.toFixed(1)}
                          </div>
                          <div className="text-right font-mono text-sm">
                            ${wf.cost.toFixed(2)}
                          </div>
                          <div className="text-right">
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-mono uppercase bg-white border-2 border-black">
                              active
                            </span>
                          </div>
                        </div>
                      ))}

                      <div className="border-t border-gray-200 px-4 py-3 flex justify-between items-center bg-gray-50">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            generateStatementPDF(month);
                          }}
                          className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                        >
                          <Download className="w-3 h-3" />
                          STATEMENT PDF
                        </button>
                        <div className="font-mono text-sm font-bold">
                          Total: ${month.totalCost.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {usageData?.months.length === 0 && (
              <div className="border-2 border-black p-8 text-center">
                <p className="font-mono text-gray-600">
                  No execution data found
                </p>
              </div>
            )}

            <div className="mt-4 text-xs font-mono text-gray-500">
              Rate: ${RATE_PER_MINUTE}/minute of execution time
            </div>
          </div>
        )}

        {!loading && !error && activeTab === 'invoices' && (
          <div>
            <div className="border-2 border-black">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 grid grid-cols-4 gap-4 font-mono text-xs text-gray-600 uppercase">
                <div>Invoice</div>
                <div>Period</div>
                <div>Due Date</div>
                <div>Status</div>
              </div>

              {invoices.map(invoice => {
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
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              generateInvoicePDF(invoice, 'view');
                            }}
                            className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                          >
                            <FileText className="w-3 h-3" />
                            VIEW PDF
                          </button>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              generateInvoicePDF(invoice, 'download');
                            }}
                            className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                          >
                            <Download className="w-3 h-3" />
                            DOWNLOAD
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {invoices.length === 0 && (
                <div className="p-8 text-center">
                  <p className="font-mono text-gray-600">No invoices yet</p>
                </div>
              )}
            </div>

            {/* Statements */}
            {usageData && usageData.months.length > 0 && (
              <div className="mt-6 border-2 border-black">
                <div className="bg-black text-white p-4">
                  <h2 className="font-mono font-bold text-sm">STATEMENTS</h2>
                </div>
                <div className="divide-y divide-gray-200">
                  {usageData.months.map(month => (
                    <div
                      key={month.key}
                      className="flex items-center justify-between p-4 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="font-mono text-sm">{month.name}</span>
                      </div>
                      <button
                        onClick={() => generateStatementPDF(month)}
                        className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                      >
                        <Download className="w-3 h-3" />
                        PDF
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
