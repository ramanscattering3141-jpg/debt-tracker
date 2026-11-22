import Decimal from 'decimal.js';
import { AccountSim, D, EPS, ZERO, type SimState } from './sim';
import { addMonths, fromDay, nextDueOnOrAfter, toDay, type ISODate } from './dates';
import type { EngineAccount, FutureEvent } from './types';

export interface ScheduleRow {
  date: ISODate;
  kind: 'payment' | 'extra' | 'borrow';
  payment: number;
  /** Interest accrued since the previous row (estimated). */
  interest: number;
  /** payment − interest (negative = balance grew). */
  principal: number;
  balance: number;
  /** Required monthly minimum for the cycle ending on this date (monthly due dates only). */
  minimum?: number;
}

export interface Projection {
  rows: ScheduleRow[];
  payoffDate: ISODate | null;
  /** False when the payment never repays the debt under these assumptions. */
  amortizing: boolean;
  reason?: 'payment-below-interest' | 'horizon';
  months: number | null;
  totalInterest: number;
  totalPaid: number;
  startBalance: number;
  /** A payment was below the required minimum in at least one cycle. */
  belowMinimum: boolean;
  /** Required minimum for the first upcoming cycle. */
  firstMinimum: number;
  /** Interest for the first upcoming cycle (estimate). */
  firstCycleInterest: number;
}

export interface ProjectOptions {
  /** Per-occurrence payment. null/undefined → pay the required minimum each month. */
  payment?: number | null;
  events?: FutureEvent[];
  horizonMonths?: number;
}

const occurrences = { monthly: 12, biweekly: 26, weekly: 52 } as const;

/**
 * Project one account forward from `startISO` using its planned payment (or the minimum).
 * Uses real calendar dates; interest accrues exactly between events.
 */
export function projectAccount(
  acct: EngineAccount,
  init: SimState,
  startISO: ISODate,
  opts: ProjectOptions = {},
): Projection {
  const sim = new AccountSim(acct, startISO, init);
  const start = sim.day;
  const horizonMonths = opts.horizonMonths ?? 600;
  const horizonDay = addMonths(start, horizonMonths);
  const startBalance = sim.balance().toNumber();
  // "Try a different payment" overrides pay-in-full.
  const inFull = !!acct.payInFull && opts.payment == null;
  if (inFull) sim.accrualEnabled = false;
  const planned = inFull ? null : opts.payment ?? acct.plannedPayment ?? null;
  const freq = planned != null && planned > 0 ? acct.frequency : 'monthly';
  const payAmount = planned != null && planned > 0 ? D(planned) : null;
  const events = [...(opts.events ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  // Only future borrowing can make a stagnant balance start moving again; extra payments don't block detection.
  const borrows = events.filter((e) => e.type === 'borrow');
  const lastEventDay = borrows.length ? toDay(borrows[borrows.length - 1].date) : -Infinity;
  let ei = 0;

  const rows: ScheduleRow[] = [];
  let nextMonthly = nextDueOnOrAfter(start + 1, acct.dueDay);
  let monthlyCount = 0;
  let nextPay = nextMonthly;
  const step = freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : 0;
  let lastInterestTotal = ZERO;
  let totalPaid = ZERO;
  let belowMinimum = false;
  let currentMin = ZERO;
  let firstMinimum: number | null = null;
  let firstCycleInterest = 0;
  let paidInMonth = ZERO;
  let stagnant = 0;
  let prevMonthBal = sim.balance();
  let payoffDay: number | null = sim.isPaidOff() ? start : null;
  let reason: Projection['reason'];

  const row = (day: number, kind: ScheduleRow['kind'], amount: Decimal, minimum?: Decimal) => {
    const interest = sim.totalInterest.minus(lastInterestTotal);
    lastInterestTotal = sim.totalInterest;
    rows.push({
      date: fromDay(day),
      kind,
      payment: amount.toNumber(),
      interest: interest.toNumber(),
      principal: amount.minus(interest).toNumber(),
      balance: sim.balance().toNumber(),
      minimum: minimum?.toNumber(),
    });
  };

  while (payoffDay === null) {
    const nextEvent = ei < events.length ? toDay(events[ei].date) : Infinity;
    const t = Math.min(nextMonthly, nextPay, nextEvent);
    if (t > horizonDay) {
      reason = 'horizon';
      break;
    }
    sim.advanceTo(t);

    while (ei < events.length && toDay(events[ei].date) === t) {
      const ev = events[ei++];
      if (ev.type === 'borrow') {
        sim.borrow(ev.amount);
        row(t, 'borrow', D(-ev.amount));
      } else {
        const s = sim.pay(ev.amount);
        totalPaid = totalPaid.plus(s.applied);
        paidInMonth = paidInMonth.plus(s.applied);
        row(t, 'extra', s.applied);
      }
    }

    let minThisRow: Decimal | undefined;
    if (t === nextMonthly) {
      // Check the previous month's payments covered its minimum (non-monthly frequencies).
      if (freq !== 'monthly' && monthlyCount > 0 && paidInMonth.plus(EPS).lt(currentMin)) belowMinimum = true;
      currentMin = sim.minimumDue(t);
      if (firstMinimum === null) {
        firstMinimum = currentMin.toNumber();
        firstCycleInterest = sim.cycleInterest.toNumber();
      }
      sim.closeCycle();
      minThisRow = currentMin;
      paidInMonth = ZERO;
      monthlyCount++;
      nextMonthly = addMonths(nextMonthly, 1, acct.dueDay);
    }

    if (t === nextPay) {
      const want = inFull ? sim.balance() : payAmount ?? currentMin;
      if (freq === 'monthly' && want.plus(EPS).lt(currentMin)) belowMinimum = true;
      const s = sim.pay(want);
      totalPaid = totalPaid.plus(s.applied);
      paidInMonth = paidInMonth.plus(s.applied);
      row(t, 'payment', s.applied, minThisRow);
      nextPay = step ? nextPay + step : nextMonthly;
    } else if (minThisRow && rows.length && rows[rows.length - 1].date === fromDay(t)) {
      rows[rows.length - 1].minimum = minThisRow.toNumber();
    }

    if (sim.isPaidOff()) {
      payoffDay = t;
      break;
    }

    if (minThisRow) {
      const bal = sim.balance();
      const settled = t > sim.lastRateChangeDay() && t > lastEventDay;
      if (bal.gte(prevMonthBal.minus(EPS)) && settled) stagnant++;
      else stagnant = 0;
      prevMonthBal = bal;
      if (stagnant >= 12) {
        reason = 'payment-below-interest';
        break;
      }
    }
  }

  return {
    rows,
    payoffDate: payoffDay !== null ? fromDay(payoffDay) : null,
    amortizing: payoffDay !== null,
    reason: payoffDay !== null ? undefined : reason,
    months: payoffDay !== null ? Math.max(0, monthsBetweenRounded(start, payoffDay)) : null,
    totalInterest: sim.totalInterest.toNumber(),
    totalPaid: totalPaid.toNumber(),
    startBalance,
    belowMinimum,
    firstMinimum: firstMinimum ?? 0,
    firstCycleInterest,
  };
}

function monthsBetweenRounded(a: number, b: number): number {
  return Math.ceil((b - a) / (365.25 / 12) - 1e-9);
}

/** Monthly-equivalent of a per-occurrence payment. */
export function monthlyEquivalent(amount: number, freq: EngineAccount['frequency']): number {
  return D(amount).mul(occurrences[freq]).div(12).toNumber();
}
