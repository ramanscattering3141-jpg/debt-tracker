import Decimal from 'decimal.js';
import {
  addMonths,
  dayOf,
  isLeapYear,
  monthIndex,
  monthsBetween,
  startOfYear,
  toDay,
  ymd,
} from './dates';
import type { EngineAccount } from './types';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const D = (x: Decimal.Value | null | undefined) => new Decimal(x ?? 0);
export const ZERO = new Decimal(0);
/** Balances at or below half a cent are treated as fully paid. */
export const EPS = new Decimal('0.005');

export interface SimState {
  principal: Decimal.Value;
  interestOwed?: Decimal.Value;
  feesOwed?: Decimal.Value;
  /** Interest already accrued in the current billing cycle (used by interest-only minimums). */
  cycleInterest?: Decimal.Value;
}

export interface PaymentSplit {
  applied: Decimal;
  toInterest: Decimal;
  toFees: Decimal;
  toPrincipal: Decimal;
}

/**
 * Event-driven simulator for a single account.
 * Balances are held as Decimal; interest is accrued exactly between events, splitting at
 * rate changes, compounding/accrual period boundaries and (for actual/actual) year boundaries.
 */
export class AccountSim {
  readonly acct: EngineAccount;
  day: number;
  /** Interest-bearing balance (includes capitalized interest for compound accounts). */
  principal: Decimal;
  /** Simple: unpaid interest (never earns interest). Compound: interest accrued but not yet capitalized. */
  interestOwed: Decimal;
  /** Unpaid fees that do not earn interest (simple accounts). Compound fees go straight to principal. */
  feesOwed: Decimal;
  cycleInterest: Decimal;
  totalInterest: Decimal = ZERO;
  accrualEnabled = true;
  private rateDays: { day: number; rate: Decimal }[];
  private readonly startDay: number;

  constructor(acct: EngineAccount, startISO: string, init: SimState) {
    this.acct = acct;
    this.day = toDay(startISO);
    this.startDay = this.day;
    this.principal = D(init.principal);
    this.interestOwed = D(init.interestOwed);
    this.feesOwed = D(init.feesOwed);
    this.cycleInterest = D(init.cycleInterest);
    this.rateDays = [...acct.rates]
      .map((r) => ({ day: toDay(r.effectiveDate), rate: D(r.rate).div(100) }))
      .sort((a, b) => a.day - b.day);
  }

  get isCompound() {
    return this.acct.interest.method === 'compound';
  }

  balance(): Decimal {
    return this.principal.plus(this.interestOwed).plus(this.feesOwed);
  }

  isPaidOff(): boolean {
    return this.balance().lte(EPS);
  }

  /** Annual rate (as a fraction) in effect on `day`. Before the first record, the first record applies. */
  rateAt(day: number): Decimal {
    if (this.rateDays.length === 0) return ZERO;
    let r = this.rateDays[0].rate;
    for (const p of this.rateDays) {
      if (p.day <= day) r = p.rate;
      else break;
    }
    return r;
  }

  lastRateChangeDay(): number {
    return this.rateDays.length ? this.rateDays[this.rateDays.length - 1].day : -Infinity;
  }

  private nextRateChangeAfter(day: number): number {
    for (const p of this.rateDays) if (p.day > day) return p.day;
    return Infinity;
  }

  private dayCountFor(day: number): Decimal {
    const dc = this.acct.interest.dayCount;
    if (dc === 'actual') return D(isLeapYear(ymd(day).y) ? 366 : 365);
    return D(dc);
  }

  private get n(): number {
    return Math.max(1, Math.round(this.acct.interest.periodsPerYear || 12));
  }

  /** Whether accrual is daily-continuous (no period boundaries matter for the amount). */
  private get isDailyBasis(): boolean {
    return this.acct.interest.accrualBasis === 'daily' || this.n >= 365;
  }

  private get usesBoundaries(): boolean {
    if (this.n >= 365) return false;
    return !this.isDailyBasis || this.isCompound;
  }

  private anchorDay(): number {
    return this.acct.repaymentStartDate ? toDay(this.acct.repaymentStartDate) : 0;
  }

  /** Smallest compounding/accrual period boundary strictly after `day`. */
  nextBoundaryAfter(day: number): number {
    const n = this.n;
    if (12 % n === 0) {
      const step = 12 / n;
      const anchorM = monthIndex(this.anchorDay());
      const { y, m } = ymd(day);
      for (let k = 0; k <= step + 1; k++) {
        const cand = dayOf(y, m + k, this.acct.dueDay);
        const mi = monthIndex(cand);
        if (cand > day && (((mi - anchorM) % step) + step) % step === 0) return cand;
      }
      return dayOf(y, m + step + 2, this.acct.dueDay);
    }
    const step = Math.max(1, Math.round(365 / n));
    const a = this.anchorDay();
    const k = Math.floor((day - a) / step) + 1;
    return a + k * step;
  }

  /** Largest boundary on or before `day`. */
  prevBoundaryOnOrBefore(day: number): number {
    const n = this.n;
    if (12 % n === 0) {
      const step = 12 / n;
      // walk back from the next boundary
      const next = this.nextBoundaryAfter(day);
      return addMonths(next, -step, this.acct.dueDay);
    }
    const step = Math.max(1, Math.round(365 / n));
    const a = this.anchorDay();
    return a + Math.floor((day - a) / step) * step;
  }

  private isBoundary(day: number): boolean {
    return this.nextBoundaryAfter(day - 1) === day;
  }

  /** Accrue interest from the current day up to (not including) `target`. */
  advanceTo(target: number): void {
    while (this.day < target) {
      let next = target;
      const rc = this.nextRateChangeAfter(this.day);
      if (rc < next) next = rc;
      if (this.isDailyBasis && this.acct.interest.dayCount === 'actual') {
        const ny = startOfYear(ymd(this.day).y + 1);
        if (ny < next) next = ny;
      }
      if (this.usesBoundaries) {
        const nb = this.nextBoundaryAfter(this.day);
        if (nb < next) next = nb;
      }
      if (this.accrualEnabled) this.accrue(this.day, next - this.day);
      this.day = next;
      if (this.isCompound && this.usesBoundaries && this.isBoundary(this.day)) this.capitalize();
    }
  }

  private accrue(start: number, days: number): void {
    if (days <= 0) return;
    const r = this.rateAt(start);
    if (r.isZero()) return;
    const base = Decimal.max(this.principal, ZERO);
    if (base.isZero() && this.interestOwed.lte(0)) return;
    let interest: Decimal;
    if (!this.isDailyBasis) {
      const pStart = this.prevBoundaryOnOrBefore(start);
      const pEnd = this.nextBoundaryAfter(start);
      interest = base.mul(r).div(this.n).mul(days).div(pEnd - pStart);
      this.interestOwed = this.interestOwed.plus(interest);
    } else {
      const dc = this.dayCountFor(start);
      if (this.isCompound && this.n >= 365) {
        // Daily compounding: interest is capitalized every day.
        const b = Decimal.max(this.principal.plus(this.interestOwed), ZERO);
        interest = b.mul(r.div(dc).plus(1).pow(days).minus(1));
        this.principal = this.principal.plus(this.interestOwed).plus(interest);
        this.interestOwed = ZERO;
      } else {
        interest = base.mul(r).mul(days).div(dc);
        this.interestOwed = this.interestOwed.plus(interest);
      }
    }
    this.cycleInterest = this.cycleInterest.plus(interest);
    this.totalInterest = this.totalInterest.plus(interest);
  }

  capitalize(): void {
    if (!this.isCompound) return;
    this.principal = this.principal.plus(this.interestOwed);
    this.interestOwed = ZERO;
  }

  /** Apply a payment: unpaid interest first, then fees, then principal. Capped at the balance. */
  pay(amount: Decimal.Value): PaymentSplit {
    let left = Decimal.min(D(amount), Decimal.max(this.balance(), ZERO));
    if (left.lte(0)) return { applied: ZERO, toInterest: ZERO, toFees: ZERO, toPrincipal: ZERO };
    const applied = left;
    const toInterest = Decimal.min(left, Decimal.max(this.interestOwed, ZERO));
    this.interestOwed = this.interestOwed.minus(toInterest);
    left = left.minus(toInterest);
    const toFees = Decimal.min(left, Decimal.max(this.feesOwed, ZERO));
    this.feesOwed = this.feesOwed.minus(toFees);
    left = left.minus(toFees);
    this.principal = this.principal.minus(left);
    return { applied, toInterest, toFees, toPrincipal: left };
  }

  borrow(amount: Decimal.Value): void {
    this.principal = this.principal.plus(D(amount));
  }

  addFee(amount: Decimal.Value): void {
    if (this.isCompound) this.principal = this.principal.plus(D(amount));
    else this.feesOwed = this.feesOwed.plus(D(amount));
  }

  closeCycle(): void {
    this.cycleInterest = ZERO;
  }

  /** Effective annual rate (fraction) on `day` — used to rank accounts for the avalanche strategy. */
  effectiveAnnualRate(day: number): Decimal {
    const r = this.rateAt(day);
    if (!this.isCompound) return r;
    const n = this.n >= 365 ? 365 : this.n;
    return r.div(n).plus(1).pow(n).minus(1);
  }

  /** Required minimum payment for the cycle ending on `day`, per the account's configured method. */
  minimumDue(day: number): Decimal {
    const bal = this.balance();
    if (bal.lte(EPS)) return ZERO;
    const cfg = this.acct.minPayment;
    const pct = D(cfg.percent).div(100);
    // Interest due: simple accounts owe all unpaid interest (incl. earlier cycles); compound accounts
    // have earlier interest capitalized into principal, so only this cycle's interest is "interest due".
    const interestDue = this.isCompound ? this.cycleInterest : Decimal.max(this.interestOwed, ZERO);
    let base: Decimal;
    switch (cfg.method) {
      case 'manual': {
        let amt = D(cfg.amount);
        const sched = [...(cfg.schedule ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
        for (const s of sched) if (toDay(s.effectiveDate) <= day) amt = D(s.amount);
        base = amt;
        break;
      }
      case 'fixed':
        base = D(cfg.amount);
        break;
      case 'percentBalance':
        base = bal.mul(pct);
        break;
      case 'interestOnly':
        base = interestDue;
        break;
      case 'interestPlusPercent':
        base = interestDue.plus(Decimal.max(this.principal, ZERO).mul(pct));
        break;
      case 'amortized': {
        const term = Math.max(1, Math.round(cfg.termMonths || 120));
        const anchor = this.acct.repaymentStartDate ? toDay(this.acct.repaymentStartDate) : this.startDay;
        const remaining = Math.max(1, term - Math.max(0, monthsBetween(anchor, day)));
        base = amortizedPayment(bal, this.rateAt(day), remaining);
        break;
      }
      case 'custom': {
        base = D(cfg.customFixed).plus(bal.mul(pct));
        if (cfg.customIncludeInterest) base = base.plus(interestDue);
        break;
      }
      default:
        base = ZERO;
    }
    if (cfg.floor) base = Decimal.max(base, D(cfg.floor));
    if (cfg.cap && cfg.method === 'custom') base = Decimal.min(base, D(cfg.cap));
    return Decimal.min(Decimal.max(base, ZERO), bal);
  }
}

/** Level monthly payment that repays `balance` over `months` at annual rate `annual` (fraction), compounded monthly. */
export function amortizedPayment(balance: Decimal.Value, annual: Decimal.Value, months: number): Decimal {
  const P = D(balance);
  const r = D(annual).div(12);
  if (months <= 0) return P;
  if (r.isZero()) return P.div(months);
  return P.mul(r).div(D(1).minus(r.plus(1).pow(-months)));
}
