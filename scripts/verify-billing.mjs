// Standalone verification of the new /api/billing/usage logic.
// Hits Supabase directly with the same queries and computes the response shape.
// Run: node scripts/verify-billing.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync('/tmp/mediar-env.txt', 'utf8')
    .split('\n')
    .filter(Boolean)
    .filter(l => !l.startsWith('#'))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx), l.slice(idx + 1).replace(/^"|"$/g, '')];
    })
);

const SUPABASE_URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = 'org_33DH72nPyAInVAh5t8TyIKVdYNw';
const RATE = 0.15;
const MIN_PER_WF = 500;
const PILOT_START = '2025-10-02';

function getBillableIds(monthKey, allProdIds) {
  if (monthKey >= '2026-04') {
    if (allProdIds.length >= 2) return allProdIds.slice(0, 2);
    if (allProdIds.length === 1) return [allProdIds[0], -1];
    return [];
  }
  return allProdIds.slice(0, 1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function get(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  return r.json();
}

const prod = await get(
  `deployed_workflows?select=id,name,tags,created_at,successful_runs&organization_id=eq.${ORG}&tags=cs.{prod}`
);
const ids = prod.map(w => w.id);
const names = Object.fromEntries(prod.map(w => [w.id, w.name]));

const all = [];
for (let page = 0; page < 100; page++) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/workflow_executions?workflow_id=in.(${ids.join(',')})&status=eq.completed&select=id,workflow_id,status,execution_duration_seconds,started_at&order=started_at.asc`,
    {
      headers: {
        ...headers,
        Range: `${page * 1000}-${(page + 1) * 1000 - 1}`,
        'Range-Unit': 'items',
      },
    }
  );
  const data = await r.json();
  if (!data.length) break;
  all.push(...data);
  if (data.length < 1000) break;
}
console.log(`Fetched ${all.length} completed executions across ${prod.length} prod workflow(s)`);

const monthly = {};
const actualCount = {};
const actualMin = {};
for (const e of all) {
  if (!e.started_at) continue;
  const d = new Date(e.started_at);
  const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  monthly[mk] ??= { workflows: {}, hasActual: true, hasEstimated: false };
  monthly[mk].hasActual = true;
  const wf = (monthly[mk].workflows[e.workflow_id] ??= {
    name: names[e.workflow_id],
    executions: 0,
    totalMinutes: 0,
    estimated: false,
  });
  const min = (e.execution_duration_seconds || 0) / 60;
  wf.executions++;
  wf.totalMinutes += min;
  actualCount[e.workflow_id] = (actualCount[e.workflow_id] || 0) + 1;
  actualMin[e.workflow_id] = (actualMin[e.workflow_id] || 0) + min;
}

for (const w of prod) {
  const counter = w.successful_runs || 0;
  const ac = actualCount[w.id] || 0;
  const missing = Math.max(0, counter - ac);
  if (!missing) continue;
  const avg = ac ? actualMin[w.id] / ac : 0;
  if (avg <= 0) continue;
  const missingMin = missing * avg;

  const start = new Date(w.created_at > PILOT_START ? w.created_at : PILOT_START);
  let earliest = null;
  for (const e of all) if (e.workflow_id === w.id) { earliest = new Date(e.started_at); break; }
  const end = earliest || new Date();
  if (end <= start) continue;
  const totalDays = Math.max(1, Math.floor((end - start) / 86400000));

  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur < end) {
    const mk = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const pe = monthEnd < end ? monthEnd : end;
    const days = Math.max(1, Math.floor((pe - cur) / 86400000));
    const r = Math.round(missing * days / totalDays);
    const m = missingMin * days / totalDays;
    if (r > 0 || m > 0) {
      monthly[mk] ??= { workflows: {}, hasActual: false, hasEstimated: true };
      monthly[mk].hasEstimated = true;
      const wf = (monthly[mk].workflows[w.id] ??= {
        name: names[w.id], executions: 0, totalMinutes: 0, estimated: true,
      });
      wf.estimated = true;
      wf.executions += r;
      wf.totalMinutes += m;
    }
    cur.setTime(pe.getTime());
  }
}

const allProdIds = prod.map(w => w.id);
const months = Object.entries(monthly).sort(([a],[b]) => a.localeCompare(b)).map(([mk, d]) => {
  const billableIds = getBillableIds(mk, allProdIds);
  const wfCount = billableIds.length;
  const minCharge = wfCount * MIN_PER_WF;
  const ws = billableIds.map(id => {
    const w = d.workflows[id];
    if (w) {
      const usage = Math.round(w.totalMinutes * RATE * 100) / 100;
      const billed = Math.max(usage, MIN_PER_WF);
      return { id, name: w.name, executions: w.executions,
        totalMinutes: Math.round(w.totalMinutes * 10) / 10,
        usageCost: usage, billedCost: Math.round(billed * 100) / 100,
        minimumApplied: billed > usage + 0.01, estimated: w.estimated };
    }
    return { id, name: id === -1 ? 'Deployed Workflow #2' : (names[id] || '?'),
      executions: 0, totalMinutes: 0, usageCost: 0, billedCost: MIN_PER_WF,
      minimumApplied: true, estimated: false };
  });
  const usage = ws.reduce((s,w) => s + w.usageCost, 0);
  const totalMin = ws.reduce((s,w) => s + w.totalMinutes, 0);
  const total = ws.reduce((s,w) => s + w.billedCost, 0);
  return {
    key: mk,
    estimated: d.hasEstimated && !d.hasActual,
    partiallyEstimated: d.hasEstimated && d.hasActual,
    workflowCount: wfCount,
    minimumCharge: minCharge,
    minimumApplied: ws.some(w => w.minimumApplied),
    totalMinutes: Math.round(totalMin * 10) / 10,
    usageCost: Math.round(usage * 100) / 100,
    totalCost: Math.round(total * 100) / 100,
  };
});

console.log('\nMonth      | wf | est?       | min applied? | minutes | usage   | total');
console.log('-----------+----+------------+--------------+---------+---------+-------');
let grandUsage = 0, grandTotal = 0;
for (const m of months) {
  const tag = m.estimated ? 'estimated' : m.partiallyEstimated ? 'partial   ' : 'actual    ';
  console.log(
    `${m.key}    | ${m.workflowCount}  | ${tag} | ${m.minimumApplied ? 'YES         ' : '-           '} | ${String(m.totalMinutes).padStart(7)} | $${m.usageCost.toFixed(2).padStart(7)} | $${m.totalCost.toFixed(2)}`
  );
  grandUsage += m.usageCost;
  grandTotal += m.totalCost;
}
console.log('-----------+----+------------+--------------+---------+---------+-------');
console.log(`TOTAL                                                             | $${grandUsage.toFixed(2)}  | $${grandTotal.toFixed(2)}`);
console.log(`\nUsage-only total: $${grandUsage.toFixed(2)}`);
console.log(`After minimums:   $${grandTotal.toFixed(2)}  (+$${(grandTotal - grandUsage).toFixed(2)} from minimum charges)`);
