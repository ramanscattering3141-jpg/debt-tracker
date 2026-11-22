import { db, type Account, type RateRecord, type Transaction, type PaymentRecord, type Scenario, type Setting, type Schedule } from './db';

export const BACKUP_FORMAT = 'personal-debt-tracker-backup';
export const BACKUP_VERSION = 2;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  accounts: Account[];
  rates: RateRecord[];
  transactions: Transaction[];
  payments: PaymentRecord[];
  scenarios: Scenario[];
  settings: Setting[];
  /** Added in version 2. */
  schedules?: Schedule[];
}

export async function exportBackup(): Promise<Backup> {
  const [accounts, rates, transactions, payments, scenarios, settings, schedules] = await Promise.all([
    db.accounts.toArray(),
    db.rates.toArray(),
    db.transactions.toArray(),
    db.payments.toArray(),
    db.scenarios.toArray(),
    db.settings.toArray(),
    db.schedules.toArray(),
  ]);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), accounts, rates, transactions, payments, scenarios, settings, schedules };
}

const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const TX_TYPES = ['payment', 'interest', 'borrow', 'fee', 'adjustment'];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  summary?: { accounts: number; transactions: number; rates: number; scenarios: number; exportedAt: string };
  data?: Backup;
}

/** Validate a parsed backup before anything is overwritten. */
export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const b = raw as Partial<Backup>;
  if (!b || typeof b !== 'object') return { ok: false, errors: ['File is not a JSON object.'] };
  if (b.format !== BACKUP_FORMAT) errors.push('This file is not a Debt Tracker backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) errors.push('Unsupported backup version.');
  for (const k of ['accounts', 'rates', 'transactions', 'payments', 'scenarios', 'settings'] as const)
    if (!Array.isArray(b[k])) errors.push(`Missing "${k}" list.`);
  if (errors.length) return { ok: false, errors };

  const ids = new Set<string>();
  b.accounts!.forEach((a, i) => {
    if (!a.id || typeof a.name !== 'string') errors.push(`Account #${i + 1}: missing id or name.`);
    if (!isNum(a.openingBalance)) errors.push(`Account "${a.name}": invalid balance.`);
    if (!isDate(a.openingBalanceDate)) errors.push(`Account "${a.name}": invalid balance date.`);
    if (!a.interest || !['simple', 'compound'].includes(a.interest.method)) errors.push(`Account "${a.name}": invalid interest settings.`);
    if (!a.minPayment?.method) errors.push(`Account "${a.name}": invalid minimum payment settings.`);
    if (!isNum(a.dueDay) || a.dueDay < 1 || a.dueDay > 31) errors.push(`Account "${a.name}": invalid due day.`);
    if (a.cycleStartDay != null && (!isNum(a.cycleStartDay) || a.cycleStartDay < 1 || a.cycleStartDay > 31)) errors.push(`Account "${a.name}": invalid billing cycle start day.`);
    ids.add(a.id);
  });
  b.transactions!.forEach((t, i) => {
    if (!ids.has(t.accountId)) errors.push(`Transaction #${i + 1}: unknown account.`);
    if (!isDate(t.date)) errors.push(`Transaction #${i + 1}: invalid date.`);
    if (!isNum(t.amount)) errors.push(`Transaction #${i + 1}: invalid amount.`);
    if (!TX_TYPES.includes(t.type)) errors.push(`Transaction #${i + 1}: invalid type.`);
  });
  b.rates!.forEach((r, i) => {
    if (!ids.has(r.accountId)) errors.push(`Rate record #${i + 1}: unknown account.`);
    if (!isNum(r.newRate) || r.newRate < 0) errors.push(`Rate record #${i + 1}: invalid rate.`);
    if (!isDate(r.effectiveDate)) errors.push(`Rate record #${i + 1}: invalid effective date.`);
  });
  for (const id of ids) if (!b.rates!.some((r) => r.accountId === id)) errors.push('Every account needs at least one rate record.');
  if (b.schedules !== undefined && !Array.isArray(b.schedules)) errors.push('Invalid "schedules" list.');
  (b.schedules ?? []).forEach((s, i) => {
    if (s.accountId && !ids.has(s.accountId)) errors.push(`Scheduled payment #${i + 1}: unknown account.`);
    if (!isDate(s.startDate)) errors.push(`Scheduled payment #${i + 1}: invalid start date.`);
    if (!isNum(s.amount)) errors.push(`Scheduled payment #${i + 1}: invalid amount.`);
  });

  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 20),
    summary: { accounts: b.accounts!.length, transactions: b.transactions!.length, rates: b.rates!.length, scenarios: b.scenarios!.length, exportedAt: b.exportedAt ?? '' },
    data: b as Backup,
  };
}

/** Replace ALL data with the backup. Call only after validation and user confirmation. */
export async function restoreBackup(b: Backup) {
  await db.transaction('rw', [db.accounts, db.rates, db.transactions, db.payments, db.scenarios, db.settings, db.schedules], async () => {
    await Promise.all([db.accounts.clear(), db.rates.clear(), db.transactions.clear(), db.payments.clear(), db.scenarios.clear(), db.settings.clear(), db.schedules.clear()]);
    await db.schedules.bulkAdd(b.schedules ?? []);
    await db.accounts.bulkAdd(b.accounts);
    await db.rates.bulkAdd(b.rates);
    await db.transactions.bulkAdd(b.transactions);
    await db.payments.bulkAdd(b.payments);
    await db.scenarios.bulkAdd(b.scenarios);
    await db.settings.bulkPut([...b.settings.filter((s) => s.key !== 'initialized'), { key: 'initialized', value: true }]);
  });
}

// ---------- CSV ----------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}
