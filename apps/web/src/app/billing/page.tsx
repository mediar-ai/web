'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useUser, useOrganization } from '@clerk/nextjs';
import { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import {
  FileText,
  Download,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';

// Pricing (Imperial Treasure pilot terms): $0.15/min, $500/min charge per deployed workflow.
// These are display-only fallbacks; the API is authoritative.
const RATE_PER_MINUTE = 0.15;
const MIN_PER_WORKFLOW = 500;

// Bill-from (NEW Mediar entity, post-March 2026 corporate transition).
// Old entity "Mediar, Inc." has been superseded by "Mediar.ai, Inc." per the
// Assignment and Assumption Agreement. All new invoices issue from Mediar.ai, Inc.
const BILL_FROM = {
  legalName: 'Mediar.ai, Inc.',
  addressLine1: '2 Marina Boulevard',
  addressLine2: 'San Francisco, CA 94123',
  country: 'United States',
  ein: '41-4867072',
  email: 'billing@mediar.ai',
};

// Bill-to per the Aug 31 2025 Product Order Form between Mediar (now assigned
// to Mediar.ai, Inc.) and Imperial Treasure Restaurant Group Pte Ltd.
const BILL_TO = {
  legalName: 'Imperial Treasure Restaurant Group Pte Ltd',
  addressLine1: '36 Sin Ming Lane',
  addressLine2: 'Midview City',
  country: 'Singapore',
  attn: 'Chai Leong Choi',
  attnTitle: 'IT Asst. Manager',
  email: 'leongchoi.chai@imperialtreasure.com',
};

// Compute current month key once at module load. Used to hide the in-progress
// month from the billing page until it's frozen on the 2nd of next month.
const CURRENT_MONTH_KEY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

interface WorkflowUsage {
  id: number;
  name: string;
  executions: number;
  totalMinutes: number;
  usageCost: number;
  billedCost: number;
  minimumApplied: boolean;
}

interface MonthlyData {
  key: string;
  name: string;
  workflowCount: number;
  minimumCharge: number;
  minimumApplied: boolean;
  workflows: WorkflowUsage[];
  totalMinutes: number;
  usageCost: number;
  totalCost: number;
  frozen?: boolean;
  frozenAt?: string;
}

interface UsageData {
  ratePerMinute: number;
  minPerWorkflow: number;
  pilotStartDate: string;
  months: MonthlyData[];
}

// Build a deterministic invoice number for a given billing month.
// Format: INV-YYYY-MM-IT (one invoice per customer per month).
function invoiceNumberFor(monthKey: string): string {
  return `INV-${monthKey}-IT`;
}

// Issue date = 1st of the month following the billing period (i.e. May 1 for
// the April invoice). Due date = NET 30 from issue date.
function invoiceDatesFor(monthKey: string): { issued: Date; due: Date } {
  const [y, m] = monthKey.split('-').map(Number);
  const issued = new Date(Date.UTC(y, m, 1)); // 1st of next month
  const due = new Date(issued);
  due.setUTCDate(due.getUTCDate() + 30);
  return { issued, due };
}

const fmtCurrency = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDateISO = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

// Render a properly-formatted invoice PDF for a single billing month.
// One invoice per month, addressed from Mediar.ai, Inc. to Imperial Treasure.
function generateInvoicePDF(
  monthData: MonthlyData,
  action: 'download' | 'view'
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginL = 20;
  const marginR = pageWidth - 20;

  const invoiceNumber = invoiceNumberFor(monthData.key);
  const { issued, due } = invoiceDatesFor(monthData.key);

  // ===== Header =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(BILL_FROM.legalName.toUpperCase(), marginL, 24);

  doc.setFontSize(28);
  doc.text('INVOICE', marginR, 24, { align: 'right' });

  // ===== From / Invoice meta =====
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(BILL_FROM.addressLine1, marginL, 32);
  doc.text(BILL_FROM.addressLine2, marginL, 37);
  doc.text(BILL_FROM.country, marginL, 42);
  doc.text(`EIN: ${BILL_FROM.ein}`, marginL, 47);

  doc.setFontSize(10);
  doc.text(invoiceNumber, marginR, 32, { align: 'right' });
  doc.setFontSize(9);
  doc.text(`Issued: ${fmtDateISO(issued)}`, marginR, 38, { align: 'right' });
  doc.text(`Due: ${fmtDateISO(due)} (NET 30)`, marginR, 43, { align: 'right' });
  doc.text(`Billing period: ${monthData.name}`, marginR, 48, { align: 'right' });

  // Divider
  doc.setLineWidth(0.4);
  doc.line(marginL, 55, marginR, 55);

  // ===== Bill To =====
  let y = 65;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('BILL TO', marginL, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(BILL_TO.legalName, marginL, y); y += 5;
  doc.setFontSize(9);
  doc.text(BILL_TO.addressLine1, marginL, y); y += 5;
  doc.text(BILL_TO.addressLine2, marginL, y); y += 5;
  doc.text(BILL_TO.country, marginL, y); y += 5;
  doc.text(`Attn: ${BILL_TO.attn}, ${BILL_TO.attnTitle}`, marginL, y); y += 5;
  doc.text(BILL_TO.email, marginL, y); y += 5;

  // ===== Line items table =====
  y = Math.max(y + 10, 110);
  doc.setLineWidth(0.4);
  doc.line(marginL, y, marginR, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('DESCRIPTION', marginL, y);
  doc.text('EXECUTIONS', marginL + 110, y, { align: 'right' });
  doc.text('MINUTES', marginL + 138, y, { align: 'right' });
  doc.text('AMOUNT', marginR, y, { align: 'right' });

  y += 3;
  doc.line(marginL, y, marginR, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  // One row per workflow
  monthData.workflows.forEach(wf => {
    doc.text(`Workflow execution: ${wf.name}`, marginL, y);
    doc.text(wf.executions.toLocaleString(), marginL + 110, y, { align: 'right' });
    doc.text(wf.totalMinutes.toFixed(1), marginL + 138, y, { align: 'right' });
    doc.text(fmtCurrency(wf.usageCost), marginR, y, { align: 'right' });
    y += 5;
    doc.setTextColor(120);
    doc.setFontSize(8);
    doc.text(
      `  Workflow #${wf.id} at ${fmtCurrency(RATE_PER_MINUTE)}/minute (completed runs only)`,
      marginL,
      y
    );
    doc.setFontSize(9);
    doc.setTextColor(0);
    y += 7;

    // Per-workflow minimum top-up line
    if (wf.minimumApplied) {
      const topUp = MIN_PER_WORKFLOW - wf.usageCost;
      doc.text(
        `Minimum monthly charge top-up: ${wf.name}`,
        marginL,
        y
      );
      doc.text('—', marginL + 110, y, { align: 'right' });
      doc.text('—', marginL + 138, y, { align: 'right' });
      doc.text(fmtCurrency(topUp), marginR, y, { align: 'right' });
      y += 5;
      doc.setTextColor(120);
      doc.setFontSize(8);
      doc.text(
        `  Pilot terms: ${fmtCurrency(MIN_PER_WORKFLOW)} minimum per deployed workflow per month`,
        marginL,
        y
      );
      doc.setFontSize(9);
      doc.setTextColor(0);
      y += 7;
    }
  });

  // ===== Totals =====
  y += 5;
  doc.setLineWidth(0.4);
  doc.line(marginL + 90, y, marginR, y);
  y += 7;

  doc.setFontSize(9);
  doc.text('Subtotal', marginL + 90, y);
  doc.text(fmtCurrency(monthData.totalCost), marginR, y, { align: 'right' });
  y += 6;

  doc.text('Tax (0%, services exported to Singapore)', marginL + 90, y);
  doc.text('$0.00', marginR, y, { align: 'right' });
  y += 8;

  doc.line(marginL + 90, y - 2, marginR, y - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL DUE (USD)', marginL + 90, y + 4);
  doc.text(fmtCurrency(monthData.totalCost), marginR, y + 4, { align: 'right' });

  // ===== Footer =====
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text(
    'Reference the Product Order Form dated August 31, 2025 (Imperial Treasure × Mediar). All rights and obligations',
    marginL,
    260
  );
  doc.text(
    `assigned to ${BILL_FROM.legalName} per the Assignment and Assumption Agreement effective March 14, 2026.`,
    marginL,
    265
  );
  doc.text(
    `Payment in USD, NET 30. Questions: ${BILL_FROM.email}.`,
    marginL,
    273
  );
  doc.setTextColor(0);

  const filename = `${invoiceNumber}.pdf`;
  if (action === 'download') doc.save(filename);
  else window.open(doc.output('bloburl'), '_blank');
}

export default function BillingPage() {
  const { user, isLoaded: userLoaded } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(
    new Set()
  );
  const [activeTab, setActiveTab] = useState<'usage' | 'invoices'>('usage');
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMediarAdmin = user?.emailAddresses?.some(e =>
    e.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

  useEffect(() => {
    // Wait for both user and org to load before deciding what to fetch
    if (!userLoaded || !orgLoaded) return;
    // Need either an active org or mediar admin status to see anything useful
    if (!organization && !isMediarAdmin) {
      setLoading(false);
      return;
    }

    async function fetchUsage() {
      try {
        const res = await fetch('/api/billing/usage');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to fetch usage data (${res.status})`);
        }
        const data = await res.json();
        setUsageData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchUsage();
  }, [userLoaded, orgLoaded, organization, isMediarAdmin]);

  if (userLoaded && orgLoaded && !organization && !isMediarAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center max-w-md">
            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h2 className="text-xl font-mono font-bold">BILLING</h2>
            <p className="text-gray-600 mt-2">
              Activate an organization to view billing.
            </p>
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

  const rate = usageData?.ratePerMinute ?? RATE_PER_MINUTE;
  const minPerWf = usageData?.minPerWorkflow ?? MIN_PER_WORKFLOW;

  // Hide the in-progress month from billing — only finished months are
  // invoiceable. The freeze cron runs on the 2nd of next month, after which
  // the previous month's snapshot becomes immutable and shows up here.
  const closedMonths: MonthlyData[] = (usageData?.months || []).filter(
    m => m.key !== CURRENT_MONTH_KEY
  );

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
              <div className="p-4 space-y-1">
                <div className="font-mono text-sm text-gray-600">
                  Successful executions only, billed since pilot start (
                  {usageData?.pilotStartDate || '2025-10-02'}).
                </div>
                <div className="font-mono text-xs text-gray-500">
                  Rate: ${rate.toFixed(2)}/minute &middot; Minimum: $
                  {minPerWf.toFixed(0)}/month per deployed workflow
                </div>
              </div>
            </div>

            {/* Monthly Usage — only finished months are shown */}
            {closedMonths.map(month => {
              const isExpanded = expandedMonths.has(month.key);
              return (
                <div key={month.key} className="border-2 border-black mb-4">
                  <div
                    className="bg-gray-50 px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleMonth(month.key)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      <span className="font-mono font-bold">{month.name}</span>
                      {month.minimumApplied && (
                        <span className="px-2 py-0.5 text-[10px] font-mono uppercase border border-black text-black">
                          min applied
                        </span>
                      )}
                      <span className="px-2 py-0.5 text-[10px] font-mono uppercase border border-black text-black">
                        {month.workflowCount} wf
                      </span>
                    </div>
                    <div className="font-mono text-sm text-gray-600 text-right">
                      <div>
                        {month.workflows.reduce(
                          (s, w) => s + w.executions,
                          0
                        )}{' '}
                        executions &middot; {month.totalMinutes.toFixed(1)} min
                      </div>
                      <div className="font-bold text-black">
                        ${month.totalCost.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div>
                      <div className="bg-white px-4 py-2 border-t border-gray-200 grid grid-cols-4 gap-4 font-mono text-xs text-gray-600 uppercase">
                        <div>Workflow</div>
                        <div className="text-right">Executions</div>
                        <div className="text-right">Minutes</div>
                        <div className="text-right">Cost</div>
                      </div>

                      {month.workflows.map(wf => (
                        <div
                          key={wf.id}
                          className="grid grid-cols-4 gap-4 px-4 py-3 border-t border-gray-200"
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
                            <div>${wf.billedCost.toFixed(2)}</div>
                            {wf.minimumApplied && (
                              <div className="text-[10px] text-gray-500">
                                usage ${wf.usageCost.toFixed(2)} (min)
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      <div className="border-t border-gray-200 px-4 py-3 bg-gray-50 space-y-1">
                        <div className="flex justify-between font-mono text-xs text-gray-600">
                          <span>Usage subtotal</span>
                          <span>${month.usageCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-mono text-xs text-gray-600">
                          <span>
                            Minimum ({month.workflowCount} x ${minPerWf})
                          </span>
                          <span>${month.minimumCharge.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-300 gap-2">
                          <div className="flex gap-2">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                generateInvoicePDF(month, 'view');
                              }}
                              className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                            >
                              <FileText className="w-3 h-3" />
                              VIEW INVOICE
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                generateInvoicePDF(month, 'download');
                              }}
                              className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                            >
                              <Download className="w-3 h-3" />
                              DOWNLOAD INVOICE
                            </button>
                          </div>
                          <div className="font-mono text-sm font-bold">
                            Total: ${month.totalCost.toFixed(2)}
                            {month.minimumApplied && (
                              <span className="ml-2 text-xs font-normal text-gray-500">
                                (min)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {closedMonths.length === 0 && (
              <div className="border-2 border-black p-8 text-center">
                <p className="font-mono text-gray-600">
                  No completed billing months yet. The current month appears
                  here once it ends.
                </p>
              </div>
            )}

            <div className="mt-4 text-xs font-mono text-gray-500 space-y-1">
              <div>
                Rate: ${rate.toFixed(2)}/minute of completed execution time.
              </div>
              <div>
                Minimum: ${minPerWf}/month per deployed workflow (whichever is
                higher).
              </div>
              <div>
                The current month is excluded until it ends; finished months
                appear here on the 2nd of the following month.
              </div>
            </div>
          </div>
        )}

        {!loading && !error && activeTab === 'invoices' && (
          <div>
            <div className="border-2 border-black mb-4">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 grid grid-cols-12 gap-4 font-mono text-xs text-gray-600 uppercase">
                <div className="col-span-3">Invoice</div>
                <div className="col-span-3">Period</div>
                <div className="col-span-2">Issued</div>
                <div className="col-span-2">Due</div>
                <div className="col-span-2 text-right">Total</div>
              </div>

              {closedMonths.map(month => {
                const id = invoiceNumberFor(month.key);
                const { issued, due } = invoiceDatesFor(month.key);
                const isExpanded = expandedInvoices.has(id);

                return (
                  <div
                    key={id}
                    className="border-b border-gray-200 last:border-b-0"
                  >
                    <div
                      className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer items-center"
                      onClick={() => toggleInvoice(id)}
                    >
                      <div className="col-span-3 flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <span className="font-mono text-sm">{id}</span>
                      </div>
                      <div className="col-span-3 font-mono text-sm text-gray-600">
                        {month.name}
                      </div>
                      <div className="col-span-2 font-mono text-sm text-gray-600">
                        {fmtDateISO(issued)}
                      </div>
                      <div className="col-span-2 font-mono text-sm text-gray-600">
                        {fmtDateISO(due)}
                      </div>
                      <div className="col-span-2 text-right font-mono text-sm font-bold">
                        ${month.totalCost.toFixed(2)}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-gray-50 border-t border-gray-200 p-4 flex gap-2">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            generateInvoicePDF(month, 'view');
                          }}
                          className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                        >
                          <FileText className="w-3 h-3" />
                          VIEW INVOICE
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            generateInvoicePDF(month, 'download');
                          }}
                          className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                        >
                          <Download className="w-3 h-3" />
                          DOWNLOAD
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {closedMonths.length === 0 && (
                <div className="p-8 text-center">
                  <p className="font-mono text-gray-600">No invoices yet</p>
                </div>
              )}
            </div>

            <div className="text-xs font-mono text-gray-500 space-y-1">
              <div>
                Issued by {BILL_FROM.legalName}, {BILL_FROM.addressLine1},{' '}
                {BILL_FROM.addressLine2}, {BILL_FROM.country} (EIN {BILL_FROM.ein}).
              </div>
              <div>
                Per the Aug 31 2025 Product Order Form (assigned to{' '}
                {BILL_FROM.legalName} on Mar 14 2026). NET 30, USD.
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
