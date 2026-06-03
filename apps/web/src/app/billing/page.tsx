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

// Pricing (pilot terms): $0.15/min, $500/min charge per deployed workflow.
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

// Customer billing identity. Supplied by the `/api/billing/usage` response
// (sourced from server env), never hardcoded here, so no customer-identifying
// data lives in this repository. The prepaid credit package (converted from the
// pilot fee, 1 credit = $1 of billable cost) draws down per monthly invoice.
interface ClientIdentity {
  name: string;
  legalName: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  country: string;
  attn: string;
  attnTitle: string;
  contractRef: string;
  prepaidCreditUsd: number;
}

const EMPTY_CLIENT: ClientIdentity = {
  name: '',
  legalName: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  country: '',
  attn: '',
  attnTitle: '',
  contractRef: '',
  prepaidCreditUsd: 0,
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
  client?: ClientIdentity;
  months: MonthlyData[];
}

// Short alphanumeric code derived from the customer name, used as an invoice
// suffix (e.g. "ExampleClient" -> "IT"). Falls back to "INV" when no name.
function clientCode(client: ClientIdentity): string {
  const initials = client.name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
  return initials || 'INV';
}

// Build a deterministic invoice number for a given billing month.
// Format: INV-YYYY-MM-<code> (one invoice per customer per month).
function invoiceNumberFor(monthKey: string, client: ClientIdentity): string {
  return `INV-${monthKey}-${clientCode(client)}`;
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

// Compute prepaid credit application for a single month, given all closed
// months ordered chronologically (oldest first). Returns the amount of credit
// applied to this month, the remaining balance carried forward, and the cash
// amount actually due (subtotal minus credit applied).
function computeCreditFor(
  monthKey: string,
  monthsAsc: MonthlyData[],
  prepaidCreditUsd: number
): { openingBalance: number; charged: number; creditApplied: number; closingBalance: number; cashDue: number } {
  let balance = prepaidCreditUsd;
  for (const m of monthsAsc) {
    const opening = balance;
    const charged = m.totalCost;
    const creditApplied = Math.min(opening, charged);
    const cashDue = charged - creditApplied;
    const closing = opening - creditApplied;
    if (m.key === monthKey) {
      return { openingBalance: opening, charged, creditApplied, closingBalance: closing, cashDue };
    }
    balance = closing;
  }
  return { openingBalance: 0, charged: 0, creditApplied: 0, closingBalance: 0, cashDue: 0 };
}

// Render a properly-formatted invoice for one month into an existing jsPDF doc
// at the current page. Used by both single-month export and the combined
// "Download all invoices" export.
function renderInvoiceOnPage(
  doc: jsPDF,
  monthData: MonthlyData,
  monthsAsc: MonthlyData[],
  client: ClientIdentity
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginL = 20;
  const marginR = pageWidth - 20;

  const invoiceNumber = invoiceNumberFor(monthData.key, client);
  const { issued, due } = invoiceDatesFor(monthData.key);
  const credit = computeCreditFor(monthData.key, monthsAsc, client.prepaidCreditUsd);

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

  // ===== Totals + prepaid credit application =====
  y += 5;
  doc.setLineWidth(0.4);
  doc.line(marginL + 90, y, marginR, y);
  y += 7;

  doc.setFontSize(9);
  doc.text('Subtotal', marginL + 90, y);
  doc.text(fmtCurrency(credit.charged), marginR, y, { align: 'right' });
  y += 6;

  doc.text('Tax (0%, services exported to Singapore)', marginL + 90, y);
  doc.text('$0.00', marginR, y, { align: 'right' });
  y += 6;

  doc.text('Less: prepaid credit balance applied', marginL + 90, y);
  doc.text(`-${fmtCurrency(credit.creditApplied)}`, marginR, y, { align: 'right' });
  y += 8;

  doc.line(marginL + 90, y - 2, marginR, y - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL DUE (USD)', marginL + 90, y + 4);
  doc.text(fmtCurrency(credit.cashDue), marginR, y + 4, { align: 'right' });
  y += 14;

  // ===== Account credit ledger =====
  doc.setLineWidth(0.4);
  doc.line(marginL, y, marginR, y);
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PREPAID CREDIT BALANCE', marginL, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Initial credit package per [contract reference]: ${fmtCurrency(PREPAID_CREDIT_BALANCE_USD)}`,
    marginL,
    y
  );
  y += 5;
  doc.text(`Opening balance this period:`, marginL, y);
  doc.text(fmtCurrency(credit.openingBalance), marginR, y, { align: 'right' });
  y += 5;
  doc.text(`Applied to this invoice:`, marginL, y);
  doc.text(`-${fmtCurrency(credit.creditApplied)}`, marginR, y, { align: 'right' });
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text(`Closing balance carried forward:`, marginL, y);
  doc.text(fmtCurrency(credit.closingBalance), marginR, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  // ===== Footer =====
  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text(
    'Reference the [contract reference] dated August 31, 2025 (ExampleClient × Mediar). All rights and obligations',
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
}

// Single-month invoice export (view in new tab or save).
function generateInvoicePDF(
  monthData: MonthlyData,
  monthsAsc: MonthlyData[],
  action: 'download' | 'view'
) {
  const doc = new jsPDF();
  renderInvoiceOnPage(doc, monthData, monthsAsc);
  const filename = `${invoiceNumberFor(monthData.key)}.pdf`;
  if (action === 'download') doc.save(filename);
  else window.open(doc.output('bloburl'), '_blank');
}

// Combined export: every closed month in one PDF (oldest → newest, one per page).
function generateAllInvoicesPDF(monthsAsc: MonthlyData[]) {
  if (monthsAsc.length === 0) return;
  const doc = new jsPDF();
  monthsAsc.forEach((m, idx) => {
    if (idx > 0) doc.addPage();
    renderInvoiceOnPage(doc, m, monthsAsc);
  });
  const first = monthsAsc[0].key;
  const last = monthsAsc[monthsAsc.length - 1].key;
  doc.save(`Invoices-ExampleClient-${first}-to-${last}.pdf`);
}

export default function BillingPage() {
  const { user, isLoaded: userLoaded } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
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

  // Hide the in-progress month from billing — only finished months are
  // invoiceable. The freeze cron runs on the 2nd of next month, after which
  // the previous month's snapshot becomes immutable and shows up here.
  // closedMonths comes from the API sorted desc (newest first); monthsAsc is
  // the same list reversed for credit-balance computation.
  const closedMonths: MonthlyData[] = (usageData?.months || []).filter(
    m => m.key !== CURRENT_MONTH_KEY
  );
  const monthsAsc: MonthlyData[] = [...closedMonths].reverse();

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6" />
            <h1 className="text-2xl font-mono font-bold">BILLING</h1>
          </div>
          {closedMonths.length > 0 && (
            <button
              onClick={() => generateAllInvoicesPDF(monthsAsc)}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white text-xs font-mono uppercase hover:bg-gray-800"
            >
              <Download className="w-3 h-3" />
              Download All Invoices
            </button>
          )}
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

        {!loading && !error && (
          <div>
            {/* Customer Header */}
            <div className="border-2 border-black mb-6">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold">ExampleClient</h2>
              </div>
              <div className="p-4">
                <div className="font-mono text-sm text-gray-600">
                  Successful executions only, billed since pilot start (
                  {usageData?.pilotStartDate || '2025-10-02'}).
                </div>
              </div>
            </div>

            {/* Monthly Usage — only finished months are shown */}
            {closedMonths.map(month => {
              const isExpanded = expandedMonths.has(month.key);
              const totalExec = month.workflows.reduce((s, w) => s + w.executions, 0);
              return (
                <div key={month.key} className="border-2 border-black mb-4">
                  <div className="bg-gray-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div
                      className="flex items-center gap-2 flex-wrap cursor-pointer hover:opacity-70"
                      onClick={() => toggleMonth(month.key)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      <span className="font-mono font-bold">{month.name}</span>
                      <span className="px-2 py-0.5 text-[10px] font-mono uppercase border border-black text-black">
                        {month.workflowCount} wf
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="font-mono text-sm text-gray-600 text-right">
                        {totalExec.toLocaleString()} executions &middot;{' '}
                        {month.totalMinutes.toFixed(1)} min
                      </div>
                      <button
                        onClick={() => generateInvoicePDF(month, monthsAsc, 'view')}
                        className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                      >
                        <FileText className="w-3 h-3" />
                        VIEW INVOICE
                      </button>
                      <button
                        onClick={() => generateInvoicePDF(month, monthsAsc, 'download')}
                        className="flex items-center gap-1 px-3 py-1 border border-black text-xs font-mono hover:bg-black hover:text-white"
                      >
                        <Download className="w-3 h-3" />
                        DOWNLOAD
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div>
                      <div className="bg-white px-4 py-2 border-t border-gray-200 grid grid-cols-3 gap-4 font-mono text-xs text-gray-600 uppercase">
                        <div>Workflow</div>
                        <div className="text-right">Executions</div>
                        <div className="text-right">Minutes</div>
                      </div>

                      {month.workflows.map(wf => (
                        <div
                          key={wf.id}
                          className="grid grid-cols-3 gap-4 px-4 py-3 border-t border-gray-200"
                        >
                          <div className="font-mono text-sm">
                            <span className="text-gray-500">#{wf.id}</span>{' '}
                            {wf.name}
                          </div>
                          <div className="text-right font-mono text-sm">
                            {wf.executions.toLocaleString()}
                          </div>
                          <div className="text-right font-mono text-sm">
                            {wf.totalMinutes.toFixed(1)}
                          </div>
                        </div>
                      ))}
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

            <div className="mt-4 text-xs font-mono text-gray-500">
              The current month is excluded until it ends; finished months
              appear here on the 2nd of the following month.
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
