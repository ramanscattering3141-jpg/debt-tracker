import Dexie, { type Table } from 'dexie';
import type {
  InterestConfig,
  MinPaymentConfig,
  PaymentFrequency,
  TransactionType,
  EngineAccount,
  RecurFrequency,
} from '@/engine';

export type AccountCategory = 'loc' | 'student_loan' | 'credit_card' | 'loan' | 'other';

export interface Account {
  id: string;
  name: string;
  category: AccountCategory;
  /** Balance as of `openingBalanceDate`. Later changes are recorded as transactions. */
  openingBalance: number;
  openingBalanceDate: string;
  interest: InterestConfig;
  rateType: 'fixed' | 'variable';
  minPayment: MinPaymentConfig;
  dueDay: number;
  frequency: PaymentFrequency;
  /** Planned payment per occurrence (per month / 2 weeks / week). null → pay the minimum. */
  plannedPayment: number | null;
  creditLimit: number | null;
  openingDate: string | null;
  repaymentStartDate: string | null;
  order: number;
  color: string;
  notes?: string;
  /** Reminder lead time in days; null/undefined → app default. */
  remindDaysBefore?: number | null;
}

export interface RateRecord {
  id: string;
  accountId: string;
  previousRate: number | null;
  newRate: number;
  effectiveDate: string;
  enteredAt: string;
  notes?: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  type: TransactionType;
  description?: string;
  affectsBalance: boolean;
  createdAt: number;
}

export interface PaymentRecord {
  id: string;
  /** Debt account ('' for a scheduled payment not tied to an account). */
  accountId: string;
  /** Set when this record marks an occurrence of a scheduled payment. */
  scheduleId?: string | null;
  dueDate: string;
  status: 'paid';
  paidDate: string;
  amount: number;
  transactionId?: string | null;
}

/** A manually-entered payment, one-off or recurring (e.g. an extra $100 to MBNA every payday). */
export interface Schedule {
  id: string;
  name: string;
  /** Debt account it pays, or null for a general bill reminder. */
  accountId: string | null;
  amount: number;
  frequency: RecurFrequency;
  startDate: string;
  endDate: string | null;
  /** Reminder lead time in days; null → app default. */
  remindDaysBefore: number | null;
  /** Add future occurrences to projections as extra payments on top of the planned payment. */
  includeInProjection: boolean;
  notes?: string;
  createdAt: number;
}

export interface ReminderSettings {
  enabled: boolean;
  defaultDays: number;
  /** Show the count of payments needing attention on the home-screen icon. */
  badge: boolean;
}
export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, defaultDays: 3, badge: true };

export interface ScenarioConfig {
  monthlyBudget: number;
  extraMonthly: number;
  strategy: 'avalanche' | 'snowball' | 'custom';
  customAllocations: Record<string, number>;
  /** Percentage-point rate change per account id ('all' applies to every account). */
  rateChanges: { accountId: string; delta: number; effectiveDate: string }[];
  oneTimePayments: { date: string; amount: number }[];
  payoffNow: string[];
  futureDraws: { accountId: string; date: string; amount: number }[];
}

export interface Scenario {
  id: string;
  name: string;
  config: ScenarioConfig;
  createdAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class DebtDB extends Dexie {
  accounts!: Table<Account, string>;
  rates!: Table<RateRecord, string>;
  transactions!: Table<Transaction, string>;
  payments!: Table<PaymentRecord, string>;
  scenarios!: Table<Scenario, string>;
  schedules!: Table<Schedule, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('personal-debt-tracker');
    this.version(1).stores({
      accounts: 'id, order',
      rates: 'id, accountId, effectiveDate',
      transactions: 'id, accountId, date, type',
      payments: 'id, accountId, dueDate, [accountId+dueDate]',
      scenarios: 'id, createdAt',
      settings: 'key',
    });
    this.version(2).stores({
      schedules: 'id, accountId, startDate',
      payments: 'id, accountId, dueDate, scheduleId, [accountId+dueDate]',
    });
  }
}

export const db = new DebtDB();

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Convert stored data into the pure engine representation. */
export function toEngine(a: Account, rates: RateRecord[]): EngineAccount {
  const mine = rates
    .filter((r) => r.accountId === a.id)
    .sort((x, y) => x.effectiveDate.localeCompare(y.effectiveDate) || x.enteredAt.localeCompare(y.enteredAt));
  return {
    id: a.id,
    name: a.name,
    interest: a.interest,
    rates: mine.map((r) => ({ effectiveDate: r.effectiveDate, rate: r.newRate })),
    minPayment: a.minPayment,
    dueDay: a.dueDay,
    frequency: a.frequency,
    plannedPayment: a.plannedPayment,
    repaymentStartDate: a.repaymentStartDate,
  };
}

/** Rate in effect on `date` (percent). */
export function rateOn(accountId: string, rates: RateRecord[], date: string): number {
  const mine = rates
    .filter((r) => r.accountId === accountId && r.effectiveDate <= date)
    .sort((x, y) => x.effectiveDate.localeCompare(y.effectiveDate) || x.enteredAt.localeCompare(y.enteredAt));
  if (mine.length) return mine[mine.length - 1].newRate;
  const any = rates.filter((r) => r.accountId === accountId).sort((x, y) => x.effectiveDate.localeCompare(y.effectiveDate));
  return any.length ? any[0].newRate : 0;
}
