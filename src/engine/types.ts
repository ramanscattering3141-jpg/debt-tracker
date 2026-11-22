import type { ISODate } from './dates';

/** How many days make up a year when converting an annual rate into a daily rate. */
export type DayCount = 'actual' | '365' | '366' | '365.25';

/**
 * Interest model.
 *  - method 'simple': interest is charged on principal only. Unpaid interest is tracked separately
 *    and never earns interest itself (typical student line of credit / government student loan).
 *  - method 'compound': unpaid interest is added to the balance at each compounding period and then
 *    earns interest (typical credit card).
 *  - accrualBasis 'daily': rate ÷ day-count × actual days elapsed.
 *  - accrualBasis 'periodic': rate ÷ periodsPerYear per period (e.g. APR/12 each month regardless of days).
 *  - periodsPerYear: compounding frequency (compound) or accrual period (simple + periodic).
 *    365 = daily, 52 = weekly, 26 = biweekly, 12 = monthly, 4 = quarterly, 2 = semi-annual, 1 = annual.
 */
export interface InterestConfig {
  method: 'simple' | 'compound';
  accrualBasis: 'daily' | 'periodic';
  periodsPerYear: number;
  dayCount: DayCount;
}

export type MinPaymentMethod =
  | 'manual'
  | 'fixed'
  | 'percentBalance'
  | 'interestOnly'
  | 'interestPlusPercent'
  | 'amortized'
  | 'custom';

export interface MinPaymentConfig {
  method: MinPaymentMethod;
  /** Manual or fixed amount. */
  amount?: number;
  /** Percentage (e.g. 3 for 3%) — of balance (percentBalance, custom) or principal (interestPlusPercent). */
  percent?: number;
  /** Amortization term in months (amortized). */
  termMonths?: number;
  /** Minimum dollar floor applied to any method. */
  floor?: number;
  /** Optional maximum (custom). */
  cap?: number;
  /** Custom formula: fixed component. */
  customFixed?: number;
  /** Custom formula: add the cycle's interest. */
  customIncludeInterest?: boolean;
  /** Future changes to a manually-entered minimum. */
  schedule?: { effectiveDate: ISODate; amount: number }[];
}

export type PaymentFrequency = 'monthly' | 'biweekly' | 'weekly';

export interface RatePoint {
  effectiveDate: ISODate;
  /** Annual rate in percent, e.g. 7.2 */
  rate: number;
}

/** Everything the engine needs to know about one account. Pure data — no DB or UI concerns. */
export interface EngineAccount {
  id: string;
  name: string;
  interest: InterestConfig;
  rates: RatePoint[];
  minPayment: MinPaymentConfig;
  /** Day of month the payment is due (1–31, clamped to month length). */
  dueDay: number;
  frequency: PaymentFrequency;
  /** Planned payment per payment occurrence (per month / per 2 weeks / per week). */
  plannedPayment?: number | null;
  /** Anchor for amortized-minimum term and quarterly/annual compounding. */
  repaymentStartDate?: ISODate | null;
}

export interface FutureEvent {
  date: ISODate;
  type: 'payment' | 'borrow';
  amount: number;
}

export type TransactionType = 'payment' | 'interest' | 'borrow' | 'fee' | 'adjustment';

export interface LedgerTransaction {
  id?: string;
  date: ISODate;
  amount: number;
  type: TransactionType;
  /** Interest/fee recorded for reference only (does not change the balance). Defaults to true. */
  affectsBalance?: boolean;
  createdAt?: number;
}
