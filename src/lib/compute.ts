import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, toEngine, rateOn, type Account, type RateRecord, type Transaction, type PaymentRecord, type Scenario, type ScenarioConfig, type Schedule } from '@/db/db';
import {
  currentState,
  projectAccount,
  monthlyEquivalent,
  simulatePlan,
  addMonths,
  fromDay,
  toDay,
  todayISO,
  replayLedger,
  monthIndex,
  dayOf,
  ymd,
  type CurrentState,
  type EngineAccount,
  type Projection,
  type PlanAccountInput,
  type PlanOptions,
  type MinPaymentConfig,
  type FutureEvent,
  occurrences,
} from '@/engine';

export interface AppData {
  accounts: Account[];
  rates: RateRecord[];
  transactions: Transaction[];
  payments: PaymentRecord[];
  scenarios: Scenario[];
  schedules: Schedule[];
  settings: Record<string, unknown>;
}

export function useAppData(): AppData | undefined {
  return useLiveQuery(async () => {
    const [accounts, rates, transactions, payments, scenarios, settingsArr, schedules] = await Promise.all([
      db.accounts.orderBy('order').toArray(),
      db.rates.toArray(),
      db.transactions.toArray(),
      db.payments.toArray(),
      db.scenarios.orderBy('createdAt').toArray(),
      db.settings.toArray(),
      db.schedules.toArray(),
    ]);
    const settings: Record<string, unknown> = {};
    for (const s of settingsArr) settings[s.key] = s.value;
    return { accounts, rates, transactions, payments, scenarios, schedules, settings };
  }, []);
}

export interface AccountView {
  account: Account;
  engine: EngineAccount;
  state: CurrentState;
  balance: number;
  rate: number;
  projection: Projection;
  minimum: number;
  minimumLabel: string;
  plannedMonthly: number;
  txns: Transaction[];
  /** Future occurrences of scheduled manual payments counted in projections. */
  extraPayments: FutureEvent[];
}

export const MIN_METHOD_LABELS: Record<MinPaymentConfig['method'], string> = {
  manual: 'Entered manually',
  fixed: 'Fixed amount',
  percentBalance: '% of balance',
  interestOnly: 'Interest only',
  interestPlusPercent: 'Interest + % of principal',
  amortized: 'Amortized',
  custom: 'Custom formula',
};

export function describeMin(m: MinPaymentConfig): string {
  switch (m.method) {
    case 'percentBalance':
      return `${m.percent ?? 0}% of balance`;
    case 'interestPlusPercent':
      return `Interest + ${m.percent ?? 0}% of principal`;
    case 'amortized':
      return `Amortized over ${m.termMonths ?? 0} months`;
    case 'custom':
      return `Custom: ${m.customFixed ? `$${m.customFixed} + ` : ''}${m.percent ?? 0}% of balance${m.customIncludeInterest ? ' + interest' : ''}`;
    default:
      return MIN_METHOD_LABELS[m.method];
  }
}

export function buildAccountView(a: Account, data: AppData, today: string): AccountView {
  const engine = toEngine(a, data.rates);
  const txns = data.transactions.filter((t) => t.accountId === a.id);
  const state = currentState(engine, a.openingBalance, a.openingBalanceDate, txns, today);
  const extras = scheduledExtraPayments(data.schedules, a.id, today);
  const projection = projectAccount(engine, state.sim, today, { events: extras });
  const planned = a.plannedPayment && a.plannedPayment > 0 ? monthlyEquivalent(a.plannedPayment, a.frequency) : projection.firstMinimum;
  let label = describeMin(a.minPayment);
  if (a.minPayment.floor) label += ` (min $${a.minPayment.floor})`;
  return {
    account: a,
    engine,
    state,
    balance: state.estimatedBalance,
    rate: rateOn(a.id, data.rates, today),
    projection,
    minimum: projection.firstMinimum,
    minimumLabel: label,
    plannedMonthly: planned,
    txns,
    extraPayments: extras,
  };
}

export interface Summary {
  views: AccountView[];
  totalDebt: number;
  recordedDebt: number;
  estimatedAccrued: number;
  totalMinimum: number;
  totalPlanned: number;
  monthlyInterest: number;
  principalRepaid: number;
  interestPaid: number;
  debtFreeDate: string | null;
  allAmortizing: boolean;
}

export function useSummary(data: AppData | undefined, today = todayISO()): Summary | undefined {
  return useMemo(() => {
    if (!data) return undefined;
    const views = data.accounts.map((a) => buildAccountView(a, data, today));
    const owing = views.filter((v) => v.balance > 0.005);
    const allAmortizing = owing.every((v) => v.projection.amortizing);
    const sum = (f: (v: AccountView) => number) => views.reduce((s, v) => s + f(v), 0);
    return {
      views,
      totalDebt: sum((v) => Math.max(v.balance, 0)),
      recordedDebt: sum((v) => v.state.recordedBalance),
      estimatedAccrued: sum((v) => v.state.estimatedAccrued),
      totalMinimum: sum((v) => v.minimum),
      totalPlanned: sum((v) => (v.balance > 0.005 ? v.plannedMonthly : 0)),
      monthlyInterest: sum((v) => estimateMonthlyInterest(v)),
      principalRepaid: sum((v) => v.state.ledger.principalPaid.toNumber()),
      interestPaid: sum((v) => v.state.ledger.interestPaid.toNumber()),
      debtFreeDate: allAmortizing
        ? owing.reduce<string | null>((m, v) => (!m || (v.projection.payoffDate ?? '') > m ? v.projection.payoffDate : m), null) ?? today
        : null,
      allAmortizing,
    };
  }, [data, today]);
}

/** Interest on the current balance for a typical 30.4-day month at today's rate (estimate). */
function estimateMonthlyInterest(v: AccountView): number {
  if (v.balance <= 0) return 0;
  const r = v.rate / 100;
  const i = v.engine.interest;
  const base = i.method === 'simple' ? Math.max(v.state.sim.principal.toNumber(), 0) : v.balance;
  if (i.method === 'compound' && i.periodsPerYear >= 365) return base * (Math.pow(1 + r / 365, 365 / 12) - 1);
  return (base * r) / 12;
}

/** Month-end totals from per-account projections (for "projected debt reduction"). */
export function projectedSeries(views: AccountView[], today: string, maxMonths = 360) {
  const start = toDay(today);
  const out: { date: string; total: number; [k: string]: number | string }[] = [];
  const longest = Math.min(
    maxMonths,
    Math.max(12, ...views.map((v) => (v.projection.payoffDate ? Math.ceil((toDay(v.projection.payoffDate) - start) / 30.4) + 1 : 60))),
  );
  for (let m = 0; m <= longest; m++) {
    const end = fromDay(addMonths(start, m));
    const row: { date: string; total: number; [k: string]: number | string } = { date: end, total: 0 };
    for (const v of views) {
      let bal = v.balance;
      for (const r of v.projection.rows) {
        if (r.date <= end) bal = r.balance;
        else break;
      }
      if (v.projection.payoffDate && v.projection.payoffDate <= end) bal = 0;
      row[v.account.id] = Math.max(bal, 0);
      row.total += Math.max(bal, 0);
    }
    out.push(row);
  }
  return out;
}

/** Historical month-end balances + monthly flows from recorded transactions only (actuals). */
export function historySeries(data: AppData, today: string) {
  if (!data.accounts.length) return [];
  const startDay = Math.min(...data.accounts.map((a) => toDay(a.openingBalanceDate)), ...data.transactions.map((t) => toDay(t.date)));
  const endDay = toDay(today);
  const months: string[] = [];
  const first = ymd(startDay);
  for (let k = 0; ; k++) {
    const mStart = dayOf(first.y, first.m + k, 1);
    if (mStart > endDay) break;
    months.push(fromDay(mStart));
  }
  const ledgers = data.accounts.map((a) => ({
    a,
    l: replayLedger(a.openingBalance, a.openingBalanceDate, data.transactions.filter((t) => t.accountId === a.id), today),
  }));
  return months.map((m) => {
    const md = toDay(m);
    const mEnd = Math.min(addMonths(md, 1) - 1, endDay);
    const endIso = fromDay(mEnd);
    const row: Record<string, number | string> = { date: m, label: m.slice(0, 7) };
    let total = 0;
    for (const { a, l } of ledgers) {
      let bal = 0;
      if (a.openingBalanceDate <= endIso) {
        bal = l.points[0].balance;
        for (const p of l.points) if (p.date <= endIso) bal = p.balance;
      }
      row[a.id] = bal;
      total += bal;
    }
    const inMonth = data.transactions.filter((t) => monthIndex(toDay(t.date)) === monthIndex(md));
    const s = (type: string) => inMonth.filter((t) => t.type === type).reduce((x, t) => x + t.amount, 0);
    row.total = total;
    row.interest = s('interest');
    row.fees = s('fee');
    row.payments = s('payment');
    row.borrowed = s('borrow');
    row.principalReduction = s('payment') - s('interest') - s('fee');
    return row;
  });
}

// ---------- plans & scenarios ----------

export interface PlanSettings {
  monthlyBudget: number;
  extraMonthly: number;
  oneTimeAmount: number;
  oneTimeDate: string;
  strategy: 'avalanche' | 'snowball' | 'custom';
  customAllocations: Record<string, number>;
  startDate?: string;
}

export function planInputs(summary: Summary, config?: Partial<ScenarioConfig>): PlanAccountInput[] {
  return summary.views
    .filter((v) => v.balance > 0.005 || (config?.futureDraws ?? []).some((d) => d.accountId === v.account.id))
    .map((v) => {
      let engine = v.engine;
      const changes = (config?.rateChanges ?? []).filter((c) => c.accountId === v.account.id || c.accountId === 'all');
      for (const c of changes) engine = applyRateDelta(engine, c.delta, c.effectiveDate);
      return {
        account: engine,
        state: v.state.sim,
        events: [
          ...(config?.futureDraws ?? [])
            .filter((d) => d.accountId === v.account.id)
            .map((d) => ({ date: d.date, type: 'borrow' as const, amount: d.amount })),
          ...v.extraPayments,
        ],
      };
    });
}

/** Add `delta` percentage points to every rate in effect on/after `from`. Never mutates stored data. */
export function applyRateDelta(e: EngineAccount, delta: number, from: string): EngineAccount {
  const rateAtFrom = [...e.rates].filter((r) => r.effectiveDate <= from).pop()?.rate ?? e.rates[0]?.rate ?? 0;
  const later = e.rates.filter((r) => r.effectiveDate > from).map((r) => ({ ...r, rate: Math.max(0, r.rate + delta) }));
  const before = e.rates.filter((r) => r.effectiveDate <= from);
  return { ...e, rates: [...before, { effectiveDate: from, rate: Math.max(0, rateAtFrom + delta) }, ...later] };
}

export function runScenario(summary: Summary, cfg: ScenarioConfig, startDate: string) {
  const opts: PlanOptions = {
    startDate,
    monthlyBudget: cfg.monthlyBudget,
    extraMonthly: cfg.extraMonthly,
    oneTimePayments: cfg.oneTimePayments,
    strategy: cfg.strategy,
    customAllocations: cfg.customAllocations,
    payoffNow: cfg.payoffNow,
  };
  return simulatePlan(planInputs(summary, cfg), opts);
}

export function emptyScenario(budget: number): ScenarioConfig {
  return { monthlyBudget: budget, extraMonthly: 0, strategy: 'avalanche', customAllocations: {}, rateChanges: [], oneTimePayments: [], payoffNow: [], futureDraws: [] };
}

export function monthsUntil(from: string, to: string | null): number | null {
  if (!to) return null;
  return Math.max(0, Math.round((toDay(to) - toDay(from)) / (365.25 / 12)));
}

/** Future occurrences (after today, next 30 years) of scheduled payments that count toward projections. */
export function scheduledExtraPayments(schedules: Schedule[], accountId: string, today: string): FutureEvent[] {
  const until = fromDay(addMonths(toDay(today), 360));
  const tomorrow = fromDay(toDay(today) + 1);
  return schedules
    .filter((s) => s.accountId === accountId && s.includeInProjection && s.amount > 0)
    .flatMap((s) => occurrences(s, tomorrow, until).map((d) => ({ date: d, type: 'payment' as const, amount: s.amount })))
    .sort((a, b) => a.date.localeCompare(b.date));
}
