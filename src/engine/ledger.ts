import Decimal from 'decimal.js';
import { AccountSim, D, ZERO } from './sim';
import { addMonths, fromDay, nextDueOnOrAfter, prevDayOfMonthOnOrBefore, toDay, type ISODate } from './dates';
import type { EngineAccount, LedgerTransaction } from './types';

export interface LedgerPoint {
  date: ISODate;
  balance: number;
  principal: number;
  interestOwed: number;
  feesOwed: number;
}

export interface LedgerResult {
  /** Recorded balance (opening balance + recorded transactions; no estimated interest). */
  balance: Decimal;
  principal: Decimal;
  interestOwed: Decimal;
  feesOwed: Decimal;
  interestCharged: Decimal;
  feesCharged: Decimal;
  borrowed: Decimal;
  paid: Decimal;
  interestPaid: Decimal;
  feesPaid: Decimal;
  principalPaid: Decimal;
  /** Balance after each transaction date (end of day). */
  points: LedgerPoint[];
  /** Interest accrual for estimates starts here (later of opening date / last interest charge / last adjustment). */
  accrualStart: ISODate;
  /** Date of the latest recorded interest charge, if any. */
  lastInterestDate: ISODate | null;
}

export function sortTransactions<T extends LedgerTransaction>(txns: T[]): T[] {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/**
 * Replays the recorded history of an account. Only recorded transactions are used — no interest is
 * estimated here, so actual historical interest is never double-counted.
 */
export function replayLedger(
  openingBalance: number,
  openingDate: ISODate,
  txns: LedgerTransaction[],
  until?: ISODate,
): LedgerResult {
  let principal = D(openingBalance);
  let interestOwed = ZERO;
  let feesOwed = ZERO;
  let interestCharged = ZERO,
    feesCharged = ZERO,
    borrowed = ZERO,
    paid = ZERO,
    interestPaid = ZERO,
    feesPaid = ZERO,
    principalPaid = ZERO;
  let accrualStart = openingDate;
  let lastInterestDate: ISODate | null = null;
  const points: LedgerPoint[] = [];
  const push = (date: ISODate) => {
    const bal = principal.plus(interestOwed).plus(feesOwed);
    const pt = {
      date,
      balance: bal.toNumber(),
      principal: principal.toNumber(),
      interestOwed: interestOwed.toNumber(),
      feesOwed: feesOwed.toNumber(),
    };
    if (points.length && points[points.length - 1].date === date) points[points.length - 1] = pt;
    else points.push(pt);
  };
  push(openingDate);

  for (const t of sortTransactions(txns)) {
    if (until && t.date > until) break;
    if (t.date < openingDate) continue;
    const amt = D(t.amount);
    const affects = t.affectsBalance !== false;
    switch (t.type) {
      case 'payment': {
        let left = amt;
        const ti = Decimal.min(left, Decimal.max(interestOwed, ZERO));
        interestOwed = interestOwed.minus(ti);
        left = left.minus(ti);
        const tf = Decimal.min(left, Decimal.max(feesOwed, ZERO));
        feesOwed = feesOwed.minus(tf);
        left = left.minus(tf);
        principal = principal.minus(left);
        paid = paid.plus(amt);
        interestPaid = interestPaid.plus(ti);
        feesPaid = feesPaid.plus(tf);
        principalPaid = principalPaid.plus(left);
        break;
      }
      case 'interest':
        interestCharged = interestCharged.plus(amt);
        if (affects) interestOwed = interestOwed.plus(amt);
        else interestPaid = interestPaid.plus(amt); // charged and settled outside this ledger
        if (t.date > accrualStart) accrualStart = t.date;
        lastInterestDate = t.date;
        break;
      case 'fee':
        feesCharged = feesCharged.plus(amt);
        if (affects) feesOwed = feesOwed.plus(amt);
        else feesPaid = feesPaid.plus(amt);
        break;
      case 'borrow':
        borrowed = borrowed.plus(amt);
        principal = principal.plus(amt);
        break;
      case 'adjustment':
        principal = principal.plus(amt);
        if (t.date > accrualStart) accrualStart = t.date;
        break;
    }
    push(t.date);
  }

  return {
    balance: principal.plus(interestOwed).plus(feesOwed),
    principal,
    interestOwed,
    feesOwed,
    interestCharged,
    feesCharged,
    borrowed,
    paid,
    interestPaid,
    feesPaid,
    principalPaid,
    points,
    accrualStart,
    lastInterestDate,
  };
}

export interface CurrentState {
  recordedBalance: number;
  /** Estimated interest accrued since the last recorded interest charge / adjustment (not yet billed). */
  estimatedAccrued: number;
  estimatedBalance: number;
  /** Starting state for projections (as of `asOf`). */
  sim: { principal: Decimal; interestOwed: Decimal; feesOwed: Decimal; cycleInterest: Decimal };
  ledger: LedgerResult;
}

/**
 * Current position of an account as of `asOf`: recorded balance plus estimated (unbilled) interest.
 *
 * A balance entered (opening balance or adjustment) part-way through a billing cycle is treated as
 * the balance carried since the start of that cycle, so interest is estimated from the cycle start
 * rather than from the day it was typed in. A recorded interest charge is never re-estimated: the
 * estimate never starts before the latest one.
 */
export function currentState(
  acct: EngineAccount,
  openingBalance: number,
  openingDate: ISODate,
  txns: LedgerTransaction[],
  asOf: ISODate,
): CurrentState {
  const ledger = replayLedger(openingBalance, openingDate, txns, asOf);
  const atStart = replayLedger(openingBalance, openingDate, txns, ledger.accrualStart);
  const compound = acct.interest.method === 'compound';
  const anchorDay = toDay(ledger.accrualStart);
  let startDay = prevDayOfMonthOnOrBefore(anchorDay, acct.cycleStartDay || 1);
  if (ledger.lastInterestDate) startDay = Math.max(startDay, toDay(ledger.lastInterestDate));
  const sim = new AccountSim(acct, fromDay(startDay), {
    principal: compound ? atStart.balance : atStart.principal,
    interestOwed: compound ? 0 : atStart.interestOwed,
    feesOwed: compound ? 0 : atStart.feesOwed,
  });
  // Paid in full each month: the grace period applies, so no interest is estimated.
  if (acct.payInFull) sim.accrualEnabled = false;
  const endDay = toDay(asOf);
  // Due dates inside the estimate window close billing cycles (so cycleInterest = current cycle only).
  let due = nextDueOnOrAfter(startDay + 1, acct.dueDay);
  const closeDueThrough = (day: number) => {
    while (due <= day) {
      sim.advanceTo(due);
      sim.closeCycle();
      due = addMonths(due, 1, acct.dueDay);
    }
  };
  for (const t of sortTransactions(txns)) {
    if (t.date <= ledger.accrualStart || t.date > asOf) continue;
    const td = toDay(t.date);
    closeDueThrough(td - 1);
    sim.advanceTo(td);
    if (t.type === 'payment') sim.pay(t.amount);
    else if (t.type === 'borrow') sim.borrow(t.amount);
    else if (t.type === 'fee' && t.affectsBalance !== false) sim.addFee(t.amount);
  }
  if (endDay > startDay) {
    closeDueThrough(endDay - 1);
    sim.advanceTo(endDay);
  }
  const estimatedBalance = sim.balance();
  return {
    recordedBalance: ledger.balance.toNumber(),
    estimatedAccrued: sim.totalInterest.toNumber(),
    estimatedBalance: estimatedBalance.toNumber(),
    sim: {
      principal: sim.principal,
      interestOwed: sim.interestOwed,
      feesOwed: sim.feesOwed,
      cycleInterest: sim.cycleInterest,
    },
    ledger,
  };
}
