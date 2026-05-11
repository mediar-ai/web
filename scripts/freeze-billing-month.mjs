#!/usr/bin/env node
/**
 * Freeze a past billing month into the static snapshot JSON.
 *
 * Usage:
 *   node scripts/freeze-billing-month.mjs <YYYY-MM> [--customer imperial-treasure] [--base http://localhost:3000]
 *
 * What it does:
 *   1. Calls /api/billing/usage on a running dev server
 *   2. Extracts the month entry for <YYYY-MM>
 *   3. Writes it into apps/web/src/data/billing-snapshots/<customer>.json
 *      under `frozenMonths.<YYYY-MM>` with frozenAt = now
 *
 * Refuses to freeze the current month. Idempotent: re-running overwrites.
 *
 * Auth: the API requires a Clerk session. Easiest path: copy your `__session` cookie from a
 * logged-in browser session and pass it via COOKIE env var:
 *   COOKIE='__session=...' node scripts/freeze-billing-month.mjs 2026-04
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { month: null, customer: 'imperial-treasure', base: 'http://localhost:3000' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--customer') args.customer = argv[++i];
    else if (a === '--base') args.base = argv[++i];
    else if (!a.startsWith('--')) args.month = a;
  }
  return args;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const { month, customer, base } = parseArgs(process.argv.slice(2));

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('Usage: node scripts/freeze-billing-month.mjs <YYYY-MM> [--customer imperial-treasure] [--base http://localhost:3000]');
    process.exit(1);
  }
  if (month === currentMonthKey()) {
    console.error(`Refusing to freeze the current month (${month}). Wait until it ends.`);
    process.exit(1);
  }

  const snapshotPath = resolve(REPO_ROOT, `apps/web/src/data/billing-snapshots/${customer}.json`);
  if (!existsSync(snapshotPath)) {
    console.error(`Snapshot file not found: ${snapshotPath}`);
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

  console.log(`Fetching live usage from ${base}/api/billing/usage...`);
  const headers = {};
  if (process.env.COOKIE) headers.cookie = process.env.COOKIE;
  const res = await fetch(`${base}/api/billing/usage`, { headers });
  if (!res.ok) {
    console.error(`API returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();

  const monthEntry = data.months.find(m => m.key === month);
  if (!monthEntry) {
    console.error(`Month ${month} not found in API response. Available: ${data.months.map(m => m.key).join(', ')}`);
    process.exit(1);
  }

  // Strip the `frozen`/`frozenAt` fields the API adds; we set our own frozenAt.
  delete monthEntry.frozen;
  delete monthEntry.frozenAt;
  monthEntry.frozenAt = new Date().toISOString();

  snapshot.frozenMonths = snapshot.frozenMonths || {};
  snapshot.frozenMonths[month] = monthEntry;

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');

  console.log(`Froze ${month} for ${customer}:`);
  console.log(`  workflows: ${monthEntry.workflowCount}`);
  console.log(`  total minutes: ${monthEntry.totalMinutes}`);
  console.log(`  total cost: $${monthEntry.totalCost.toFixed(2)}`);
  console.log(`  frozenAt: ${monthEntry.frozenAt}`);
  console.log(`Wrote ${snapshotPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
