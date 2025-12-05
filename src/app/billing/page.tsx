'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useUser } from '@clerk/nextjs';
import { useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  FileText,
  Download,
  ChevronDown,
  ChevronRight,
  Calendar,
} from 'lucide-react';

// ExampleClient production workflow data
const itWorkflowData = {
  customer: 'ExampleClient',
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
    paidDate: '2024-12-10',
    items: [
      { description: 'Workflow Executions', quantity: 42, rate: 2.0 },
      { description: 'VM Hours', quantity: 21, rate: 5.0 },
    ],
  },
  {
    id: 'INV-2024-IT-002',
    period: 'December 2024',
    status: 'pending',
    dueDate: '2025-01-15',
    items: [
      { description: 'Workflow Executions', quantity: 52, rate: 2.0 },
      { description: 'VM Hours', quantity: 25.6, rate: 5.0 },
    ],
  },
];

function generateInvoicePDF(
  invoice: (typeof mockInvoices)[0],
  action: 'download' | 'view'
) {
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
  doc.text(itWorkflowData.customer, 20, 72);

  // Line
  doc.setLineWidth(0.5);
  doc.line(20, 82, pageWidth - 20, 82);

  // Table header
  let y = 92;
  doc.setFont('helvetica', 'bold');
  doc.text('Description', 20, y);
  doc.text('Qty', 100, y);
  doc.text('Rate', 130, y);
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
    doc.text(item.quantity.toString(), 100, y);
    doc.text(`$${item.rate.toFixed(2)}`, 130, y);
    doc.text(`$${amount.toFixed(2)}`, pageWidth - 20, y, { align: 'right' });
  });

  // Totals
  y += 20;
  doc.line(120, y - 5, pageWidth - 20, y - 5);
  doc.text('Subtotal:', 130, y);
  doc.text(`$${subtotal.toFixed(2)}`, pageWidth - 20, y, { align: 'right' });

  y += 8;
  doc.text('Tax (0%):', 130, y);
  doc.text('$0.00', pageWidth - 20, y, { align: 'right' });

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('Total:', 130, y);
  doc.text(`$${subtotal.toFixed(2)}`, pageWidth - 20, y, { align: 'right' });

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

function generateStatementPDF(month: string) {
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
  doc.text(month, pageWidth - 20, 35, { align: 'right' });

  // Customer
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('ACCOUNT', 20, 50);
  doc.setFont('helvetica', 'normal');
  doc.text(itWorkflowData.customer, 20, 57);

  // Summary
  doc.line(20, 67, pageWidth - 20, 67);

  let y = 80;
  doc.setFont('helvetica', 'bold');
  doc.text('Activity Summary', 20, y);

  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.text('Total Workflow Executions:', 20, y);
  doc.text('52', pageWidth - 20, y, { align: 'right' });

  y += 8;
  doc.text('Total VM Hours:', 20, y);
  doc.text('25.6h', pageWidth - 20, y, { align: 'right' });

  y += 8;
  doc.text('Active Workflows:', 20, y);
  doc.text('2', pageWidth - 20, y, { align: 'right' });

  // Footer
  doc.setFontSize(8);
  doc.text('Generated by Mediar AI', 20, 275);

  doc.save(`Statement-${month.replace(' ', '-')}.pdf`);
}

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
                <h2 className="font-mono font-bold">
                  {itWorkflowData.customer}
                </h2>
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
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
