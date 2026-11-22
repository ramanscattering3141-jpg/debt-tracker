import Decimal from 'decimal.js';
import { AccountSim, D, EPS, ZERO, type SimState } from './sim';
import { addMonths, fromDay, nextDueOnOrAfter, toDay, type ISODate } from './dates';
import type { EngineAccount, FutureEvent } from './types';

export type Strategy = 'avalanche' | 'snowball' | 'custom' | 'minimum';

export interface PlanAccountInput {
  account: EngineAccount;
  state: SimState;
  events?: FutureEvent[];
}

export interface PlanOptions {
  startDate: ISODate;
  /** Total monthly budget for all debt payments (minimums included). */
  monthlyBudget: number;
  /** Extra recurring amount added to the budget each month. */
  extraMonthly?: number;
  /** One-time extra payments added to the budget in the month they fall in. */
  oneTimePayments?: { date: ISODate; amount: number }[];
  strategy: Strategy;
  /** Custom strategy: desired monthly payment per account id (raised to the minimum if lower). */
  customAllocations?: Record<string, number>;
  /** Custom strategy: send money freed by paid-off accounts to the highest-rate remaining account. */
  customRollover?: boolean;
  /** Pay these accounts off in full on the start date (outside the budget). */
  payoffNow?: string[];
  horizonMonths?: number;
}

export interface PlanPeriod {
  date: ISODate;
  payments: Record<string, number>;
  interest: Record<string, number>;
  balances: Record<string, number>;
  totalBalance: number;
  totalPayment: number;
  totalInterest: number;
  unused: number;
  shortfall: boolean;
}

export interface PlanAccountResult {
  id: string;
  name: string;
  startBalance: number;
  payoffDate: ISODate | null;
  totalInterest: number;
  totalPaid: number;
}

export interface PlanResult {
  periods: PlanPeriod[];
  accounts: PlanAccountResult[];
  debtFreeDate: ISODate | null;
  amortizing: boolean;
  months: number | null;
  totalInterest: number;
  totalPaid: number;
  totalPrincipal: number;
  startBalance: number;
  /** Budget did not cover the total minimum payments in at least one month. */
  minimumShortfall: boolean;
  totalMinimumFirstMonth: number;
}

interface Slot {
  acct: EngineAccount;
  sim: AccountSim;
  events: FutureEvent[];
  ei: number;
  firstDue: number;
  payoff: number | null;
  paid: Decimal;
  startBalance: number;
  lastInterest: Decimal;
}

/** Simulate all accounts together, month by month, allocating a shared budget by strategy. */
export function simulatePlan(inputs: PlanAccountInput[], opts: PlanOptions): PlanResult {
  const start = toDay(opts.startDate);
  const horizon = opts.horizonMonths ?? 600;
  const slots: Slot[] = inputs.map((inp) => {
    const sim = new AccountSim(inp.account, opts.startDate, inp.state);
    return {
      acct: inp.account,
      sim,
      events: [...(inp.events ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
      ei: 0,
      firstDue: nextDueOnOrAfter(start + 1, inp.account.dueDay),
      payoff: sim.isPaidOff() ? start : null,
      paid: ZERO,
      startBalance: sim.balance().toNumber(),
      lastInterest: ZERO,
    };
  });
  const startBalance = slots.reduce((s, x) => s + x.startBalance, 0);
  let extraOutsideBudget = ZERO;

  for (const id of opts.payoffNow ?? []) {
    const s = slots.find((x) => x.acct.id === id);
    if (!s || s.payoff !== null) continue;
    const split = s.sim.pay(s.sim.balance());
    s.paid = s.paid.plus(split.applied);
    extraOutsideBudget = extraOutsideBudget.plus(split.applied);
    s.payoff = start;
  }

  const oneTimes = [...(opts.oneTimePayments ?? [])]
    .filter((o) => o.amount > 0)
    .map((o) => ({ day: toDay(o.date), amount: D(o.amount), used: false }));
  const lastEventDay = Math.max(
    -Infinity,
    ...slots.flatMap((s) => s.events.filter((e) => e.type === 'borrow').map((e) => toDay(e.date))),
    ...oneTimes.map((o) => o.day),
  );
  const lastRateDay = Math.max(-Infinity, ...slots.map((s) => s.sim.lastRateChangeDay()));

  const periods: PlanPeriod[] = [];
  let minimumShortfall = false;
  let totalMinimumFirstMonth = 0;
  let stagnant = 0;
  let prevTotal = D(startBalance);
  let amortizing = slots.every((s) => s.payoff !== null);
  const baseBudget = D(opts.monthlyBudget).plus(D(opts.extraMonthly));

  for (let k = 0; k < horizon && !amortizing; k++) {
    const pendingBorrow = (s: Slot) => s.events.slice(s.ei).some((e) => e.type === 'borrow');
    const active = slots.filter((s) => s.payoff === null || pendingBorrow(s));
    if (active.length === 0) {
      amortizing = true;
      break;
    }
    const dueDays = new Map<Slot, number>();
    let periodEnd = start;
    // 1. accrue each account to its due date this period, applying scheduled events on the way
    for (const s of slots) {
      const due = addMonths(s.firstDue, k, s.acct.dueDay);
      dueDays.set(s, due);
      if (due > periodEnd) periodEnd = due;
      while (s.ei < s.events.length && toDay(s.events[s.ei].date) <= due) {
        const ev = s.events[s.ei++];
        s.sim.advanceTo(Math.max(toDay(ev.date), s.sim.day));
        if (ev.type === 'borrow') {
          s.sim.borrow(ev.amount);
          s.payoff = null;
        } else {
          const sp = s.sim.pay(ev.amount);
          s.paid = s.paid.plus(sp.applied);
          extraOutsideBudget = extraOutsideBudget.plus(sp.applied);
        }
      }
      s.sim.advanceTo(due);
    }

    // 2. budget for this period
    let budget = baseBudget;
    for (const o of oneTimes) {
      if (!o.used && o.day <= periodEnd) {
        budget = budget.plus(o.amount);
        o.used = true;
      }
    }

    // 3. minimums
    const live = slots.filter((s) => !s.sim.isPaidOff());
    const mins = new Map<Slot, Decimal>();
    for (const s of live) mins.set(s, s.sim.minimumDue(dueDays.get(s)!));
    const totalMin = [...mins.values()].reduce((a, b) => a.plus(b), ZERO);
    if (k === 0) totalMinimumFirstMonth = totalMin.toNumber();
    const pay = new Map<Slot, Decimal>();
    let remaining = budget;
    const byRate = [...live].sort(
      (a, b) =>
        b.sim.effectiveAnnualRate(dueDays.get(b)!).cmp(a.sim.effectiveAnnualRate(dueDays.get(a)!)) ||
        a.sim.balance().cmp(b.sim.balance()),
    );
    let shortfall = false;
    if (opts.strategy === 'minimum') {
      for (const s of live) pay.set(s, mins.get(s)!);
      remaining = ZERO;
    } else if (totalMin.gt(budget)) {
      shortfall = true;
      minimumShortfall = true;
      for (const s of byRate) {
        const p = Decimal.min(mins.get(s)!, remaining);
        pay.set(s, p);
        remaining = remaining.minus(p);
      }
    } else {
      for (const s of live) pay.set(s, mins.get(s)!);
      remaining = budget.minus(totalMin);
    }

    // 4. extra allocation
    const room = (s: Slot) => Decimal.max(s.sim.balance().minus(pay.get(s) ?? ZERO), ZERO);
    const pour = (order: Slot[]) => {
      for (const s of order) {
        if (remaining.lte(0)) break;
        const add = Decimal.min(remaining, room(s));
        pay.set(s, (pay.get(s) ?? ZERO).plus(add));
        remaining = remaining.minus(add);
      }
    };
    if (!shortfall && opts.strategy !== 'minimum') {
      if (opts.strategy === 'avalanche') pour(byRate);
      else if (opts.strategy === 'snowball')
        pour(
          [...live].sort(
            (a, b) =>
              a.sim.balance().cmp(b.sim.balance()) ||
              b.sim.effectiveAnnualRate(dueDays.get(b)!).cmp(a.sim.effectiveAnnualRate(dueDays.get(a)!)),
          ),
        );
      else if (opts.strategy === 'custom') {
        const alloc = opts.customAllocations ?? {};
        for (const s of live) {
          const want = D(alloc[s.acct.id] ?? 0);
          const add = Decimal.min(Decimal.max(want.minus(pay.get(s)!), ZERO), room(s), remaining);
          pay.set(s, pay.get(s)!.plus(add));
          remaining = remaining.minus(add);
        }
        if (opts.customRollover !== false) {
          // Money budgeted for accounts that are already paid off rolls to the highest rate account.
          const freed = slots
            .filter((s) => s.sim.isPaidOff())
            .reduce((a, s) => a.plus(D(alloc[s.acct.id] ?? 0)), ZERO);
          const pool = Decimal.min(freed, remaining);
          const leftover = remaining.minus(pool);
          remaining = pool;
          pour(byRate);
          remaining = remaining.plus(leftover);
        }
      }
    }

    // 5. apply
    const period: PlanPeriod = {
      date: fromDay(periodEnd),
      payments: {},
      interest: {},
      balances: {},
      totalBalance: 0,
      totalPayment: 0,
      totalInterest: 0,
      unused: remaining.toNumber(),
      shortfall,
    };
    let totalBal = ZERO;
    for (const s of slots) {
      const due = dueDays.get(s)!;
      const p = pay.get(s) ?? ZERO;
      const split = s.sim.pay(p);
      s.paid = s.paid.plus(split.applied);
      s.sim.closeCycle();
      const intr = s.sim.totalInterest.minus(s.lastInterest);
      s.lastInterest = s.sim.totalInterest;
      if (s.payoff === null && s.sim.isPaidOff()) s.payoff = due;
      period.payments[s.acct.id] = split.applied.toNumber();
      period.interest[s.acct.id] = intr.toNumber();
      period.balances[s.acct.id] = Decimal.max(s.sim.balance(), ZERO).toNumber();
      period.totalPayment += split.applied.toNumber();
      period.totalInterest += intr.toNumber();
      totalBal = totalBal.plus(Decimal.max(s.sim.balance(), ZERO));
    }
    period.totalBalance = totalBal.toNumber();
    periods.push(period);

    if (slots.every((s) => s.payoff !== null && !pendingBorrow(s))) {
      amortizing = true;
      break;
    }
    const settled = periodEnd > lastEventDay && periodEnd > lastRateDay;
    if (totalBal.gte(prevTotal.minus(EPS)) && settled) stagnant++;
    else stagnant = 0;
    prevTotal = totalBal;
    if (stagnant >= 12) break;
  }

  const totalInterest = slots.reduce((a, s) => a.plus(s.sim.totalInterest), ZERO);
  const totalPaid = slots.reduce((a, s) => a.plus(s.paid), ZERO);
  const debtFreeDay = amortizing ? Math.max(start, ...slots.map((s) => s.payoff ?? start)) : null;
  return {
    periods,
    accounts: slots.map((s) => ({
      id: s.acct.id,
      name: s.acct.name,
      startBalance: s.startBalance,
      payoffDate: s.payoff !== null ? fromDay(s.payoff) : null,
      totalInterest: s.sim.totalInterest.toNumber(),
      totalPaid: s.paid.toNumber(),
    })),
    debtFreeDate: debtFreeDay !== null ? fromDay(debtFreeDay) : null,
    amortizing,
    months: amortizing ? periods.length : null,
    totalInterest: totalInterest.toNumber(),
    totalPaid: totalPaid.toNumber(),
    totalPrincipal: totalPaid.minus(totalInterest).toNumber(),
    startBalance,
    minimumShortfall,
    totalMinimumFirstMonth,
  };
}

/** Run avalanche, snowball, custom and minimum-only on the same inputs for comparison. */
export function compareStrategies(inputs: PlanAccountInput[], opts: Omit<PlanOptions, 'strategy'>) {
  const run = (strategy: Strategy) => simulatePlan(inputs, { ...opts, strategy });
  return {
    avalanche: run('avalanche'),
    snowball: run('snowball'),
    custom: run('custom'),
    minimum: run('minimum'),
  };
}
