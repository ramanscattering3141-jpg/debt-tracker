import { db, uid, rateOn, type Account, type RateRecord, type Transaction, type Scenario } from './db';
import { addMonths, fromDay, toDay, todayISO, replayLedger } from '@/engine';

export const ACCOUNT_COLORS = ['#7457b8', '#3f8f9e', '#b392e6', '#d9895b', '#cc5f93', '#5a74c2', '#6aa874', '#8a8299'];

export const CATEGORY_LABELS: Record<Account['category'], string> = {
  loc: 'Line of credit',
  student_loan: 'Student loan',
  credit_card: 'Credit card',
  loan: 'Loan',
  other: 'Other',
};

/** Neutral starting templates. Rates/balances are blank; minimum formulas are NOT assumed for any lender. */
function defaultAccounts(): Account[] {
  const today = todayISO();
  const base = {
    openingBalance: 0,
    openingBalanceDate: today,
    rateType: 'variable' as const,
    frequency: 'monthly' as const,
    plannedPayment: null,
    creditLimit: null,
    openingDate: null,
    repaymentStartDate: null,
  };
  return [
    {
      ...base,
      id: uid(),
      name: 'Student Line of Credit',
      category: 'loc',
      interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: 'actual' },
      minPayment: { method: 'interestOnly' },
      dueDay: 15,
      creditLimit: 0,
      order: 0,
      color: ACCOUNT_COLORS[0],
    },
    {
      ...base,
      id: uid(),
      name: 'OSAP Federal Loan',
      category: 'student_loan',
      interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
      minPayment: { method: 'manual', amount: 0 },
      dueDay: 1,
      order: 1,
      color: ACCOUNT_COLORS[1],
    },
    {
      ...base,
      id: uid(),
      name: 'OSAP Ontario Provincial Loan',
      category: 'student_loan',
      interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
      minPayment: { method: 'manual', amount: 0 },
      dueDay: 1,
      order: 2,
      color: ACCOUNT_COLORS[2],
    },
    {
      ...base,
      id: uid(),
      name: 'MBNA Credit Card',
      category: 'credit_card',
      rateType: 'fixed',
      interest: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
      minPayment: { method: 'manual', amount: 0 },
      dueDay: 20,
      creditLimit: 0,
      order: 3,
      color: ACCOUNT_COLORS[3],
    },
    {
      ...base,
      id: uid(),
      name: 'TD Credit Card',
      category: 'credit_card',
      rateType: 'fixed',
      interest: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
      minPayment: { method: 'manual', amount: 0 },
      dueDay: 5,
      creditLimit: 0,
      order: 4,
      color: ACCOUNT_COLORS[4],
    },
  ];
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return (s?.value as T) ?? fallback;
}
export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export async function ensureInitialized() {
  const done = await db.settings.get('initialized');
  if (done) return;
  await db.transaction('rw', db.accounts, db.rates, db.settings, async () => {
    if ((await db.accounts.count()) === 0) {
      const accts = defaultAccounts();
      await db.accounts.bulkAdd(accts);
      const now = new Date().toISOString();
      await db.rates.bulkAdd(
        accts.map((a) => ({ id: uid(), accountId: a.id, previousRate: null, newRate: 0, effectiveDate: '2000-01-01', enteredAt: now, notes: 'Initial rate — edit me' })),
      );
    }
    await db.settings.put({ key: 'initialized', value: true });
    await db.settings.put({ key: 'currency', value: 'CAD' });
  });
}

// ---------- accounts ----------

export async function createAccount(name: string) {
  const count = await db.accounts.count();
  const a: Account = {
    id: uid(),
    name,
    category: 'other',
    openingBalance: 0,
    openingBalanceDate: todayISO(),
    interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
    rateType: 'fixed',
    minPayment: { method: 'manual', amount: 0 },
    dueDay: 1,
    frequency: 'monthly',
    plannedPayment: null,
    creditLimit: null,
    openingDate: null,
    repaymentStartDate: null,
    order: count,
    color: ACCOUNT_COLORS[count % ACCOUNT_COLORS.length],
  };
  await db.transaction('rw', db.accounts, db.rates, async () => {
    await db.accounts.add(a);
    await db.rates.add({ id: uid(), accountId: a.id, previousRate: null, newRate: 0, effectiveDate: '2000-01-01', enteredAt: new Date().toISOString() });
  });
  return a.id;
}

export async function saveAccount(a: Account) {
  await db.accounts.put(a);
}

export async function deleteAccount(id: string) {
  await db.transaction('rw', [db.accounts, db.rates, db.transactions, db.payments], async () => {
    await db.accounts.delete(id);
    await db.rates.where('accountId').equals(id).delete();
    await db.transactions.where('accountId').equals(id).delete();
    await db.payments.where('accountId').equals(id).delete();
  });
}

/**
 * Set the account's balance as reported by the lender. With no history, this simply sets the opening
 * balance; otherwise a balance-adjustment transaction is recorded so history is preserved.
 */
export async function setReportedBalance(accountId: string, balance: number, date: string, note?: string) {
  const a = await db.accounts.get(accountId);
  if (!a) return;
  const txns = await db.transactions.where('accountId').equals(accountId).toArray();
  if (txns.length === 0) {
    await db.accounts.update(accountId, { openingBalance: balance, openingBalanceDate: date });
    return;
  }
  const recorded = replayLedger(a.openingBalance, a.openingBalanceDate, txns, date).balance.toNumber();
  const delta = Math.round((balance - recorded) * 100) / 100;
  if (delta === 0) return;
  await addTransaction({ accountId, date, amount: delta, type: 'adjustment', description: note ?? 'Reconciled to lender balance', affectsBalance: true });
}

// ---------- rates ----------

export async function changeRate(accountId: string, newRate: number, effectiveDate: string, notes?: string) {
  const rates = await db.rates.where('accountId').equals(accountId).toArray();
  const previousRate = rates.length ? rateOn(accountId, rates, effectiveDate) : null;
  await db.rates.add({ id: uid(), accountId, previousRate, newRate, effectiveDate, enteredAt: new Date().toISOString(), notes });
}

export async function updateRateRecord(r: RateRecord) {
  await db.rates.put(r);
}

export async function deleteRateRecord(id: string) {
  const r = await db.rates.get(id);
  if (!r) return;
  const count = await db.rates.where('accountId').equals(r.accountId).count();
  if (count <= 1) throw new Error('An account needs at least one rate record.');
  await db.rates.delete(id);
}

// ---------- transactions ----------

export async function addTransaction(t: Omit<Transaction, 'id' | 'createdAt'>) {
  const id = uid();
  await db.transactions.add({ ...t, id, createdAt: Date.now() });
  return id;
}
export async function updateTransaction(t: Transaction) {
  await db.transactions.put(t);
}
export async function deleteTransaction(id: string) {
  await db.transaction('rw', db.transactions, db.payments, async () => {
    await db.transactions.delete(id);
    const linked = await db.payments.filter((p) => p.transactionId === id).toArray();
    for (const p of linked) await db.payments.update(p.id, { transactionId: null });
  });
}

// ---------- payment calendar ----------

export async function markPaid(accountId: string, dueDate: string, amount: number, paidDate: string, recordTransaction: boolean) {
  let transactionId: string | null = null;
  if (recordTransaction && amount > 0) {
    transactionId = await addTransaction({ accountId, date: paidDate, amount, type: 'payment', description: `Payment for ${dueDate} due date`, affectsBalance: true });
  }
  await db.payments.add({ id: uid(), accountId, dueDate, status: 'paid', paidDate, amount, transactionId });
}

export async function unmarkPaid(id: string, removeTransaction: boolean) {
  const p = await db.payments.get(id);
  if (!p) return;
  await db.transaction('rw', db.payments, db.transactions, async () => {
    if (removeTransaction && p.transactionId) await db.transactions.delete(p.transactionId);
    await db.payments.delete(id);
  });
}

// ---------- scenarios ----------

export async function saveScenario(s: Scenario) {
  await db.scenarios.put(s);
}
export async function deleteScenario(id: string) {
  await db.scenarios.delete(id);
}

// ---------- reset & sample data ----------

export async function resetAll() {
  await db.transaction('rw', [db.accounts, db.rates, db.transactions, db.payments, db.scenarios, db.settings], async () => {
    await Promise.all([db.accounts.clear(), db.rates.clear(), db.transactions.clear(), db.payments.clear(), db.scenarios.clear(), db.settings.clear()]);
  });
  await ensureInitialized();
}

/**
 * Loads clearly-labelled FAKE sample data for demonstration. Never real financial information.
 */
export async function loadSampleData() {
  await resetAll();
  const accts = (await db.accounts.orderBy('order').toArray()) as Account[];
  const [loc, fed, ont, mbna, td] = accts;
  const today = toDay(todayISO());
  const start = fromDay(addMonths(today, -9, 1));
  const d = (monthsAgo: number, dom: number) => fromDay(addMonths(today, -monthsAgo, dom));
  const now = new Date().toISOString();

  const upd: Partial<Record<string, Partial<Account>>> = {
    [loc.id]: { name: 'Student Line of Credit (SAMPLE)', openingBalance: 18000, openingBalanceDate: start, creditLimit: 40000, plannedPayment: 400, notes: 'Sample data — not real.' },
    [fed.id]: { name: 'OSAP Federal Loan (SAMPLE)', openingBalance: 14250, openingBalanceDate: start, minPayment: { method: 'manual', amount: 155 }, plannedPayment: 155, rateType: 'fixed', repaymentStartDate: start },
    [ont.id]: { name: 'OSAP Ontario Loan (SAMPLE)', openingBalance: 7600, openingBalanceDate: start, minPayment: { method: 'amortized', termMonths: 114 }, plannedPayment: 120, repaymentStartDate: start },
    [mbna.id]: { name: 'MBNA Credit Card (SAMPLE)', openingBalance: 3200, openingBalanceDate: start, creditLimit: 8000, minPayment: { method: 'custom', customFixed: 0, percent: 3, floor: 10, customIncludeInterest: false }, plannedPayment: 250 },
    [td.id]: { name: 'TD Credit Card (SAMPLE)', openingBalance: 1850, openingBalanceDate: start, creditLimit: 5000, minPayment: { method: 'interestPlusPercent', percent: 1, floor: 10 }, plannedPayment: 150 },
  };
  const rates: RateRecord[] = [
    { id: uid(), accountId: loc.id, previousRate: null, newRate: 7.45, effectiveDate: '2000-01-01', enteredAt: now, notes: 'Sample: prime + 1%' },
    { id: uid(), accountId: loc.id, previousRate: 7.45, newRate: 7.2, effectiveDate: d(4, 1), enteredAt: now, notes: 'Sample: prime decreased 0.25%' },
    { id: uid(), accountId: fed.id, previousRate: null, newRate: 0, effectiveDate: '2000-01-01', enteredAt: now, notes: 'Sample: interest-free' },
    { id: uid(), accountId: ont.id, previousRate: null, newRate: 6.45, effectiveDate: '2000-01-01', enteredAt: now, notes: 'Sample' },
    { id: uid(), accountId: ont.id, previousRate: 6.45, newRate: 6.2, effectiveDate: d(4, 1), enteredAt: now, notes: 'Sample: variable rate change' },
    { id: uid(), accountId: mbna.id, previousRate: null, newRate: 19.99, effectiveDate: '2000-01-01', enteredAt: now },
    { id: uid(), accountId: td.id, previousRate: null, newRate: 20.99, effectiveDate: '2000-01-01', enteredAt: now },
  ];
  const txns: Omit<Transaction, 'id' | 'createdAt'>[] = [];
  for (let m = 8; m >= 0; m--) {
    txns.push({ accountId: loc.id, date: d(m, 15), amount: +(18000 * 0.072 / 12 + (8 - m) * 1.5).toFixed(2), type: 'interest', description: 'Monthly interest (sample)', affectsBalance: true });
    txns.push({ accountId: loc.id, date: d(m, 15), amount: 400, type: 'payment', description: 'Sample payment', affectsBalance: true });
    txns.push({ accountId: fed.id, date: d(m, 1), amount: 155, type: 'payment', description: 'Sample payment', affectsBalance: true });
    txns.push({ accountId: ont.id, date: d(m, 1), amount: +(7600 * 0.063 / 12 - (8 - m) * 0.3).toFixed(2), type: 'interest', description: 'Sample interest', affectsBalance: true });
    txns.push({ accountId: ont.id, date: d(m, 1), amount: 120, type: 'payment', description: 'Sample payment', affectsBalance: true });
    txns.push({ accountId: mbna.id, date: d(m, 20), amount: +(3200 * 0.1999 / 12 - (8 - m) * 3).toFixed(2), type: 'interest', description: 'Statement interest (sample)', affectsBalance: true });
    txns.push({ accountId: mbna.id, date: d(m, 20), amount: 250, type: 'payment', description: 'Sample payment', affectsBalance: true });
    txns.push({ accountId: td.id, date: d(m, 5), amount: +(1850 * 0.2099 / 12 - (8 - m) * 1.2).toFixed(2), type: 'interest', description: 'Statement interest (sample)', affectsBalance: true });
    txns.push({ accountId: td.id, date: d(m, 5), amount: 150, type: 'payment', description: 'Sample payment', affectsBalance: true });
  }
  const todayIso = todayISO();
  for (let i = txns.length - 1; i >= 0; i--) if (txns[i].date > todayIso) txns.splice(i, 1);
  txns.push({ accountId: loc.id, date: d(5, 3), amount: 2500, type: 'borrow', description: 'Tuition withdrawal (sample)', affectsBalance: true });
  txns.push({ accountId: td.id, date: d(3, 12), amount: 420, type: 'borrow', description: 'Purchases (sample)', affectsBalance: true });
  txns.push({ accountId: mbna.id, date: d(6, 8), amount: 35, type: 'fee', description: 'Annual fee (sample)', affectsBalance: true });

  await db.transaction('rw', [db.accounts, db.rates, db.transactions, db.settings, db.scenarios], async () => {
    for (const a of accts) await db.accounts.update(a.id, upd[a.id] ?? {});
    await db.rates.clear();
    await db.rates.bulkAdd(rates);
    let c = Date.now();
    await db.transactions.bulkAdd(txns.map((t) => ({ ...t, id: uid(), createdAt: c++ })));
    await db.settings.put({ key: 'sampleData', value: true });
    await db.settings.put({ key: 'plan', value: { monthlyBudget: 1300, extraMonthly: 0, oneTimeAmount: 0, oneTimeDate: todayISO(), strategy: 'avalanche', customAllocations: {} } });
    await db.scenarios.bulkAdd([
      { id: uid(), name: 'LOC rate +1% (sample)', createdAt: Date.now(), config: { monthlyBudget: 1300, extraMonthly: 0, strategy: 'avalanche', customAllocations: {}, rateChanges: [{ accountId: loc.id, delta: 1, effectiveDate: todayISO() }], oneTimePayments: [], payoffNow: [], futureDraws: [] } },
      { id: uid(), name: 'Extra $500/month (sample)', createdAt: Date.now() + 1, config: { monthlyBudget: 1300, extraMonthly: 500, strategy: 'avalanche', customAllocations: {}, rateChanges: [], oneTimePayments: [], payoffNow: [], futureDraws: [] } },
      { id: uid(), name: 'Pay off MBNA now (sample)', createdAt: Date.now() + 2, config: { monthlyBudget: 1300, extraMonthly: 0, strategy: 'avalanche', customAllocations: {}, rateChanges: [], oneTimePayments: [], payoffNow: [mbna.id], futureDraws: [] } },
    ]);
  });
}
