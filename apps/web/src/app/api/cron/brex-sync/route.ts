/**
 * Brex to PostHog Sync - Vercel Cron Job
 * Fetches Brex financial data and sends to PostHog daily
 * Migrated from Modal scheduled function on 2026-01-05
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BREX_API_BASE = 'https://platform.brexapis.com/v2';

interface BrexAccount {
  id: string;
  name: string;
  status: string;
  primary: boolean;
  current_balance: {
    amount: number;
    currency: string;
  };
}

interface BrexTransaction {
  id: string;
  posted_at_date: string;
  type?: string;
  amount: {
    amount: number;
    currency: string;
  };
}

interface PostHogEvent {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

async function fetchBrexApi<T>(endpoint: string, brexToken: string): Promise<T | null> {
  try {
    const response = await fetch(`${BREX_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${brexToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[Brex Sync] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`[Brex Sync] Fetch error for ${endpoint}:`, error);
    return null;
  }
}

async function getCashAccounts(brexToken: string): Promise<BrexAccount[]> {
  const data = await fetchBrexApi<{ items: BrexAccount[] }>('/accounts/cash', brexToken);
  return data?.items || [];
}

async function getAccountTransactions(accountId: string, brexToken: string): Promise<BrexTransaction[]> {
  const data = await fetchBrexApi<{ items: BrexTransaction[] }>(`/transactions/cash/${accountId}`, brexToken);
  return data?.items || [];
}

interface CardTransactionsResponse {
  items: BrexTransaction[];
  next_cursor?: string;
}

async function getCardTransactions(brexToken: string): Promise<BrexTransaction[]> {
  const allTransactions: BrexTransaction[] = [];
  let nextUrl: string | null = '/transactions/card/primary';

  while (nextUrl) {
    const response: CardTransactionsResponse | null = await fetchBrexApi<CardTransactionsResponse>(nextUrl, brexToken);
    if (!response) break;

    allTransactions.push(...(response.items || []));

    if (response.next_cursor) {
      nextUrl = `/transactions/card/primary?cursor=${response.next_cursor}`;
    } else {
      nextUrl = null;
    }
  }

  return allTransactions;
}

function calculateTotalBalance(accounts: BrexAccount[]): number {
  const totalCents = accounts.reduce((sum, acc) => sum + (acc.current_balance?.amount || 0), 0);
  return totalCents / 100;
}

function filterLast7DaysTransactions(transactions: BrexTransaction[]): BrexTransaction[] {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return transactions.filter((txn) => {
    if (!txn.posted_at_date) return false;
    const postedDate = new Date(txn.posted_at_date);
    return postedDate >= sevenDaysAgo;
  });
}

function calculateTransactionTotal(transactions: BrexTransaction[]): number {
  const totalCents = transactions.reduce((sum, txn) => sum + (txn.amount?.amount || 0), 0);
  return totalCents / 100;
}

async function sendToPostHog(
  eventName: string,
  properties: Record<string, unknown>,
  posthogKey: string,
  posthogHost: string,
  distinctId: string
): Promise<boolean> {
  const payload: PostHogEvent = {
    api_key: posthogKey,
    event: eventName,
    distinct_id: distinctId,
    properties,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(`${posthogHost}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[Brex Sync] PostHog error: ${response.status}`);
      return false;
    }

    console.log(`[Brex Sync] Sent '${eventName}' to PostHog`);
    return true;
  } catch (error) {
    console.error(`[Brex Sync] PostHog send error:`, error);
    return false;
  }
}

export async function GET(request: Request) {
  const startTime = Date.now();
  console.log(`[Brex Sync] Starting sync at ${new Date().toISOString()}`);

  // Security: Check if request is from Vercel Cron or has valid auth
  const userAgent = request.headers.get('user-agent') || '';
  const isVercelCron = userAgent.includes('vercel-cron');

  if (!isVercelCron) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('[Brex Sync] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Get credentials
  const brexToken = process.env.BREX_API_TOKEN;
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';
  const distinctId = process.env.POSTHOG_DISTINCT_ID || 'brex-integration';

  if (!brexToken || !posthogKey) {
    console.error('[Brex Sync] Missing BREX_API_TOKEN or POSTHOG_KEY');
    return NextResponse.json({ error: 'Missing credentials' }, { status: 500 });
  }

  try {
    // Fetch all cash accounts
    console.log('[Brex Sync] Fetching cash accounts...');
    const accounts = await getCashAccounts(brexToken);

    if (accounts.length === 0) {
      console.log('[Brex Sync] No accounts found');
      return NextResponse.json({ error: 'No accounts found' }, { status: 404 });
    }

    console.log(`[Brex Sync] Found ${accounts.length} account(s)`);

    // Calculate total balance
    const totalBalance = calculateTotalBalance(accounts);
    console.log(`[Brex Sync] Total Balance: $${totalBalance.toLocaleString()}`);

    // Fetch cash transactions
    console.log('[Brex Sync] Fetching cash transactions...');
    const allCashTransactions7d: BrexTransaction[] = [];

    for (const account of accounts) {
      const transactions = await getAccountTransactions(account.id, brexToken);
      const transactions7d = filterLast7DaysTransactions(transactions);
      allCashTransactions7d.push(...transactions7d);
    }

    console.log(`[Brex Sync] Found ${allCashTransactions7d.length} cash transaction(s) in last 7 days`);

    // Fetch card transactions
    console.log('[Brex Sync] Fetching card transactions...');
    const allCardTransactions = await getCardTransactions(brexToken);
    const cardTransactions7dRaw = filterLast7DaysTransactions(allCardTransactions);

    // Filter out COLLECTION type (internal transfers/balance repayments)
    const cardTransactions7d = cardTransactions7dRaw.filter((t) => t.type !== 'COLLECTION');
    const collectionsFiltered = cardTransactions7dRaw.length - cardTransactions7d.length;

    console.log(`[Brex Sync] Found ${cardTransactions7d.length} card transaction(s) in last 7 days`);
    if (collectionsFiltered > 0) {
      console.log(`[Brex Sync] Filtered out ${collectionsFiltered} COLLECTION transaction(s)`);
    }

    // Combine all transactions
    const allTransactions7d = [...allCashTransactions7d, ...cardTransactions7d];
    console.log(`[Brex Sync] Total combined transactions: ${allTransactions7d.length}`);

    // Calculate metrics
    const cashIncomeTxns = allCashTransactions7d.filter((t) => (t.amount?.amount || 0) > 0);
    const cashExpenseTxns = allCashTransactions7d.filter((t) => (t.amount?.amount || 0) < 0);

    const totalCashIncome = calculateTransactionTotal(cashIncomeTxns);
    const totalCashExpenses = Math.abs(calculateTransactionTotal(cashExpenseTxns));
    const totalCardNet = calculateTransactionTotal(cardTransactions7d);
    const totalExpenses = totalCashExpenses + Math.abs(totalCardNet);

    console.log(`[Brex Sync] Metrics:`);
    console.log(`  Cash Income: $${totalCashIncome.toLocaleString()}`);
    console.log(`  Cash Expenses: $${totalCashExpenses.toLocaleString()}`);
    console.log(`  Card Net: $${totalCardNet.toLocaleString()}`);
    console.log(`  Total Expenses: $${totalExpenses.toLocaleString()}`);

    // Send to PostHog
    console.log('[Brex Sync] Sending to PostHog...');

    // Event 1: Account Balance
    await sendToPostHog(
      'brex_account_balance',
      {
        total_balance_usd: totalBalance,
        accounts: accounts.map((acc) => ({
          name: acc.name,
          balance_usd: (acc.current_balance?.amount || 0) / 100,
          status: acc.status,
          primary: acc.primary,
        })),
      },
      posthogKey,
      posthogHost,
      distinctId
    );

    // Event 2: 7-Day Financial Summary
    await sendToPostHog(
      'brex_7_day_summary',
      {
        total_transactions: allTransactions7d.length,
        cash_income_usd: totalCashIncome,
        cash_income_count: cashIncomeTxns.length,
        cash_expenses_usd: totalCashExpenses,
        cash_expenses_count: cashExpenseTxns.length,
        card_net_usd: totalCardNet,
        card_transaction_count: cardTransactions7d.length,
        total_expenses_usd: totalExpenses,
        net_amount_usd: totalCashIncome - totalExpenses,
      },
      posthogKey,
      posthogHost,
      distinctId
    );

    // Event 3: Daily metrics (for trending)
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - i);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      const dailyCash = allCashTransactions7d.filter((t) => t.posted_at_date === targetDateStr);
      const dailyCard = cardTransactions7d.filter((t) => t.posted_at_date === targetDateStr);

      const dailyIncome = calculateTransactionTotal(dailyCash.filter((t) => (t.amount?.amount || 0) > 0));
      const dailyCashExp = Math.abs(calculateTransactionTotal(dailyCash.filter((t) => (t.amount?.amount || 0) < 0)));
      const dailyCardNet = calculateTransactionTotal(dailyCard);

      await sendToPostHog(
        'brex_daily_metrics',
        {
          date: targetDateStr,
          cash_income_usd: dailyIncome,
          cash_expenses_usd: dailyCashExp,
          card_net_usd: dailyCardNet,
          total_expenses_usd: dailyCashExp + Math.abs(dailyCardNet),
          transaction_count: dailyCash.length + dailyCard.length,
        },
        posthogKey,
        posthogHost,
        distinctId
      );
    }

    const duration = Date.now() - startTime;
    console.log(`[Brex Sync] Completed in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: 'Brex sync completed',
      stats: {
        accounts: accounts.length,
        totalBalance,
        transactions7d: allTransactions7d.length,
        cashIncome: totalCashIncome,
        totalExpenses,
        durationMs: duration,
      },
    });
  } catch (error) {
    console.error('[Brex Sync] Error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
