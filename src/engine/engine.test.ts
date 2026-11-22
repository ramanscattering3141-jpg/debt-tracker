import { describe, expect, it } from 'vitest';
import {
  AccountSim,
  amortizedPayment,
  currentState,
  projectAccount,
  replayLedger,
  simulatePlan,
  toDay,
  type EngineAccount,
} from './index';

/** Helper to build an engine account with sensible defaults. */
function acct(p: Partial<EngineAccount> & { rate?: number }): EngineAccount {
  return {
    id: p.id ?? 'a',
    name: p.name ?? 'Test',
    interest: p.interest ?? { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
    rates: p.rates ?? [{ effectiveDate: '2000-01-01', rate: p.rate ?? 0 }],
    minPayment: p.minPayment ?? { method: 'fixed', amount: 0 },
    dueDay: p.dueDay ?? 1,
    frequency: p.frequency ?? 'monthly',
    plannedPayment: p.plannedPayment ?? null,
    repaymentStartDate: p.repaymentStartDate ?? null,
  };
}

const LOC = (extra: Partial<EngineAccount> = {}) =>
  acct({
    rate: 7,
    dueDay: 15,
    interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: 'actual' },
    minPayment: { method: 'interestOnly' },
    ...extra,
  });

describe('daily interest accrual', () => {
  it('simple daily interest = P × r × days / 365', () => {
    const sim = new AccountSim(acct({ rate: 7.2 }), '2025-01-01', { principal: 10000 });
    sim.advanceTo(toDay('2025-02-01'));
    // 10000 × 0.072 × 31 / 365
    expect(sim.totalInterest.toNumber()).toBeCloseTo(61.150684931, 8);
    // simple interest is not capitalized
    expect(sim.principal.toNumber()).toBe(10000);
    expect(sim.interestOwed.toNumber()).toBeCloseTo(61.150684931, 8);
  });

  it('actual/actual splits at the year boundary (365 vs 366 days)', () => {
    const a = acct({ rate: 5, interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: 'actual' } });
    const sim = new AccountSim(a, '2023-12-17', { principal: 10000 });
    sim.advanceTo(toDay('2024-01-16'));
    // 15 days in 2023 /365 + 15 days in 2024 (leap) /366
    expect(sim.totalInterest.toNumber()).toBeCloseTo(10000 * 0.05 * (15 / 365 + 15 / 366), 8);
  });

  it('365.25 day-count convention', () => {
    const a = acct({ rate: 6, interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365.25' } });
    const sim = new AccountSim(a, '2025-01-01', { principal: 1000 });
    sim.advanceTo(toDay('2025-01-31'));
    expect(sim.totalInterest.toNumber()).toBeCloseTo((1000 * 0.06 * 30) / 365.25, 9);
  });

  it('daily compounding (n = 365): P(1 + r/365)^365', () => {
    const a = acct({ rate: 12, interest: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 365, dayCount: '365' } });
    const sim = new AccountSim(a, '2025-01-01', { principal: 1000 });
    sim.advanceTo(toDay('2026-01-01'));
    expect(sim.balance().toNumber()).toBeCloseTo(1000 * Math.pow(1 + 0.12 / 365, 365), 6);
  });

  it('daily accrual compounded monthly capitalizes on the statement date', () => {
    const a = acct({ rate: 19.99, dueDay: 10, interest: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' } });
    const sim = new AccountSim(a, '2025-01-10', { principal: 1000 });
    sim.advanceTo(toDay('2025-02-10'));
    const i1 = (1000 * 0.1999 * 31) / 365;
    expect(sim.principal.toNumber()).toBeCloseTo(1000 + i1, 8); // capitalized
    sim.advanceTo(toDay('2025-03-10'));
    const i2 = ((1000 + i1) * 0.1999 * 28) / 365;
    expect(sim.balance().toNumber()).toBeCloseTo(1000 + i1 + i2, 8);
  });
});

describe('monthly (periodic) interest accrual', () => {
  it('compound monthly: P(1 + r/12)^12 regardless of month length', () => {
    const a = acct({ rate: 12, interest: { method: 'compound', accrualBasis: 'periodic', periodsPerYear: 12, dayCount: '365' } });
    const sim = new AccountSim(a, '2025-01-01', { principal: 1000 });
    sim.advanceTo(toDay('2026-01-01'));
    expect(sim.balance().toNumber()).toBeCloseTo(1000 * Math.pow(1.01, 12), 8);
  });

  it('simple monthly: r/12 per month on principal only', () => {
    const a = acct({ rate: 12, interest: { method: 'simple', accrualBasis: 'periodic', periodsPerYear: 12, dayCount: '365' } });
    const sim = new AccountSim(a, '2025-01-01', { principal: 1000 });
    sim.advanceTo(toDay('2026-01-01'));
    expect(sim.balance().toNumber()).toBeCloseTo(1120, 8);
  });

  it('quarterly compounding (n = 4)', () => {
    const a = acct({ rate: 8, interest: { method: 'compound', accrualBasis: 'periodic', periodsPerYear: 4, dayCount: '365' } });
    const sim = new AccountSim(a, '2025-01-01', { principal: 1000 });
    sim.advanceTo(toDay('2026-01-01'));
    expect(sim.balance().toNumber()).toBeCloseTo(1000 * Math.pow(1.02, 4), 8);
  });
});

describe('changing interest rates', () => {
  it('applies a new rate only from its effective date', () => {
    const a = acct({
      rates: [
        { effectiveDate: '2024-01-01', rate: 5 },
        { effectiveDate: '2025-03-01', rate: 6 },
      ],
    });
    const sim = new AccountSim(a, '2025-01-01', { principal: 10000 });
    sim.advanceTo(toDay('2025-04-01'));
    // 59 days @5% + 31 days @6%
    expect(sim.totalInterest.toNumber()).toBeCloseTo((10000 * (0.05 * 59 + 0.06 * 31)) / 365, 8);
  });

  it('a future rate increase raises projected interest', () => {
    const base = acct({ rate: 6, plannedPayment: 300, minPayment: { method: 'fixed', amount: 100 } });
    const up = acct({
      rates: [
        { effectiveDate: '2000-01-01', rate: 6 },
        { effectiveDate: '2026-01-01', rate: 9 },
      ],
      plannedPayment: 300,
      minPayment: { method: 'fixed', amount: 100 },
    });
    const p1 = projectAccount(base, { principal: 10000 }, '2025-06-01');
    const p2 = projectAccount(up, { principal: 10000 }, '2025-06-01');
    expect(p2.totalInterest).toBeGreaterThan(p1.totalInterest);
  });
});

describe('zero-interest debt', () => {
  it('repays exactly principal with no interest', () => {
    const p = projectAccount(acct({ rate: 0, plannedPayment: 100 }), { principal: 1200 }, '2025-01-01');
    expect(p.totalInterest).toBe(0);
    expect(p.totalPaid).toBeCloseTo(1200, 10);
    expect(p.rows.filter((r) => r.kind === 'payment')).toHaveLength(12);
    expect(p.payoffDate).toBe('2026-01-01');
  });
});

describe('monthly amortization', () => {
  it('level payment formula matches the textbook value', () => {
    // $10,000 at 12% over 12 months → $888.49
    expect(amortizedPayment(10000, 0.12, 12).toNumber()).toBeCloseTo(888.487886783, 6);
  });

  it('projection with the amortized payment pays off in exactly 12 payments', () => {
    const a = acct({
      rate: 12,
      interest: { method: 'compound', accrualBasis: 'periodic', periodsPerYear: 12, dayCount: '365' },
      plannedPayment: 888.487886783,
    });
    const p = projectAccount(a, { principal: 10000 }, '2025-01-01');
    expect(p.rows.filter((r) => r.kind === 'payment')).toHaveLength(12);
    expect(p.totalInterest).toBeCloseTo(888.487886783 * 12 - 10000, 4);
    expect(p.payoffDate).toBe('2026-01-01');
    // first payment: interest 100, principal 788.49
    expect(p.rows[0].interest).toBeCloseTo(100, 8);
    expect(p.rows[0].principal).toBeCloseTo(788.487886783, 6);
  });

  it('amortized minimum recalculates on remaining term', () => {
    const a = acct({
      rate: 6,
      interest: { method: 'compound', accrualBasis: 'periodic', periodsPerYear: 12, dayCount: '365' },
      minPayment: { method: 'amortized', termMonths: 120 },
      repaymentStartDate: '2025-01-01',
    });
    const p = projectAccount(a, { principal: 20000 }, '2025-01-01');
    expect(p.firstMinimum).toBeCloseTo(amortizedPayment(20000 * 1.005, 0.06, 119).toNumber(), 6);
    expect(p.amortizing).toBe(true);
    expect(p.months).toBeLessThanOrEqual(120);
  });
});

describe('interest-only payments (line of credit)', () => {
  it('minimum equals the month’s simple daily interest and never amortizes', () => {
    const p = projectAccount(LOC(), { principal: 20000 }, '2025-01-15');
    // Jan 15 → Feb 15 = 31 days
    expect(p.firstMinimum).toBeCloseTo((20000 * 0.07 * 31) / 365, 8);
    expect(p.amortizing).toBe(false);
    expect(p.reason).toBe('payment-below-interest');
    expect(p.payoffDate).toBeNull();
  });

  it('a further withdrawal raises the next minimum only from the draw date', () => {
    const p = projectAccount(LOC(), { principal: 20000 }, '2025-01-15', {
      events: [{ date: '2025-03-01', type: 'borrow', amount: 5000 }],
    });
    const mins = p.rows.filter((r) => r.minimum !== undefined).map((r) => r.minimum!);
    expect(mins[0]).toBeCloseTo((20000 * 0.07 * 31) / 365, 8); // Jan15–Feb15
    // Feb15–Mar15: 14 days on 20,000 then 14 days on 25,000
    expect(mins[1]).toBeCloseTo((20000 * 0.07 * 14 + 25000 * 0.07 * 14) / 365, 8);
    // Mar15–Apr15: 31 days on 25,000
    expect(mins[2]).toBeCloseTo((25000 * 0.07 * 31) / 365, 8);
  });

  it('interest is charged on principal withdrawn, not on unpaid interest', () => {
    const sim = new AccountSim(LOC(), '2025-01-15', { principal: 10000, interestOwed: 500 });
    sim.advanceTo(toDay('2025-02-15'));
    expect(sim.totalInterest.toNumber()).toBeCloseTo((10000 * 0.07 * 31) / 365, 8);
  });
});

describe('minimum payment methods', () => {
  const at = toDay('2025-02-01');
  const make = (minPayment: EngineAccount['minPayment'], principal = 5000) =>
    new AccountSim(acct({ rate: 0, minPayment }), '2025-01-01', { principal });

  it('manual / fixed', () => {
    expect(make({ method: 'manual', amount: 123.45 }).minimumDue(at).toNumber()).toBe(123.45);
    expect(make({ method: 'fixed', amount: 200 }).minimumDue(at).toNumber()).toBe(200);
  });
  it('percentage of balance with a dollar floor', () => {
    expect(make({ method: 'percentBalance', percent: 3, floor: 10 }).minimumDue(at).toNumber()).toBe(150);
    expect(make({ method: 'percentBalance', percent: 3, floor: 10 }, 200).minimumDue(at).toNumber()).toBe(10);
    // never more than the balance
    expect(make({ method: 'percentBalance', percent: 3, floor: 10 }, 5).minimumDue(at).toNumber()).toBe(5);
  });
  it('interest plus a percentage of principal', () => {
    const sim = new AccountSim(acct({ rate: 12, minPayment: { method: 'interestPlusPercent', percent: 1 } }), '2025-01-01', { principal: 3650 });
    sim.advanceTo(at);
    expect(sim.minimumDue(at).toNumber()).toBeCloseTo((3650 * 0.12 * 31) / 365 + 36.5, 8);
  });
  it('custom formula with min and max', () => {
    const cfg = { method: 'custom' as const, customFixed: 10, percent: 2, cap: 80, floor: 25 };
    expect(make(cfg, 1000).minimumDue(at).toNumber()).toBe(30);
    expect(make(cfg, 100).minimumDue(at).toNumber()).toBe(25);
    expect(make(cfg, 10000).minimumDue(at).toNumber()).toBe(80);
  });
  it('changing manual minimum requirements over time', () => {
    const sim = make({ method: 'manual', amount: 100, schedule: [{ effectiveDate: '2025-06-01', amount: 175 }] });
    expect(sim.minimumDue(toDay('2025-05-01')).toNumber()).toBe(100);
    expect(sim.minimumDue(toDay('2025-06-01')).toNumber()).toBe(175);
  });
  it('paid-off account has zero minimum', () => {
    expect(make({ method: 'fixed', amount: 50 }, 0).minimumDue(at).toNumber()).toBe(0);
  });
});

describe('extra and early payments', () => {
  const card = acct({
    rate: 19.99,
    dueDay: 5,
    interest: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
    plannedPayment: 200,
  });
  it('a one-time extra payment shortens payoff and saves interest', () => {
    const base = projectAccount(card, { principal: 5000 }, '2025-01-01');
    const extra = projectAccount(card, { principal: 5000 }, '2025-01-01', {
      events: [{ date: '2025-03-20', type: 'payment', amount: 2000 }],
    });
    expect(extra.months!).toBeLessThan(base.months!);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });
  it('early repayment: a payment above the balance is capped', () => {
    const p = projectAccount(acct({ rate: 0, plannedPayment: 500 }), { principal: 100 }, '2025-01-01');
    expect(p.totalPaid).toBe(100);
    expect(p.rows).toHaveLength(1);
  });
});

describe('payment frequencies', () => {
  it('weekly', () => {
    const p = projectAccount(acct({ rate: 0, frequency: 'weekly', plannedPayment: 100 }), { principal: 1000 }, '2025-01-01');
    expect(p.rows.filter((r) => r.kind === 'payment')).toHaveLength(10);
    expect(p.payoffDate).toBe('2025-04-05'); // Feb 1 + 9 weeks
  });
  it('biweekly', () => {
    const p = projectAccount(acct({ rate: 0, frequency: 'biweekly', plannedPayment: 250 }), { principal: 1000 }, '2025-01-01');
    expect(p.rows.filter((r) => r.kind === 'payment')).toHaveLength(4);
    expect(p.payoffDate).toBe('2025-03-15');
  });
  it('biweekly half-payments (26/yr) save interest vs. monthly', () => {
    const base = { rate: 10, interest: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' } } as const;
    const m = projectAccount(acct({ ...base, plannedPayment: 260 }), { principal: 10000 }, '2025-01-01');
    const b = projectAccount(acct({ ...base, frequency: 'biweekly', plannedPayment: 130 }), { principal: 10000 }, '2025-01-01');
    expect(b.totalInterest).toBeLessThan(m.totalInterest);
  });
});

describe('insufficient payments & fully paid accounts', () => {
  it('payment below accrued interest → no finite payoff', () => {
    const a = acct({
      rate: 20,
      interest: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' },
      plannedPayment: 50,
    });
    const p = projectAccount(a, { principal: 5000 }, '2025-01-01');
    expect(p.amortizing).toBe(false);
    expect(p.payoffDate).toBeNull();
    expect(p.rows[p.rows.length - 1].balance).toBeGreaterThan(5000);
  });
  it('planned payment below the required minimum is flagged', () => {
    const a = acct({ rate: 5, plannedPayment: 20, minPayment: { method: 'fixed', amount: 50 } });
    expect(projectAccount(a, { principal: 1000 }, '2025-01-01').belowMinimum).toBe(true);
  });
  it('fully paid account', () => {
    const p = projectAccount(acct({ rate: 10, plannedPayment: 100 }), { principal: 0 }, '2025-01-01');
    expect(p.payoffDate).toBe('2025-01-01');
    expect(p.rows).toHaveLength(0);
    expect(p.totalInterest).toBe(0);
  });
});

describe('avalanche and snowball', () => {
  const high = acct({
    id: 'high',
    rate: 20,
    interest: { method: 'compound', accrualBasis: 'periodic', periodsPerYear: 12, dayCount: '365' },
    minPayment: { method: 'fixed', amount: 25 },
  });
  const low = acct({
    id: 'low',
    rate: 5,
    interest: { method: 'compound', accrualBasis: 'periodic', periodsPerYear: 12, dayCount: '365' },
    minPayment: { method: 'fixed', amount: 25 },
  });
  const inputs = [
    { account: high, state: { principal: 2000 } },
    { account: low, state: { principal: 500 } },
  ];
  const opts = { startDate: '2025-01-01', monthlyBudget: 300 };

  it('avalanche sends extra money to the highest rate', () => {
    const r = simulatePlan(inputs, { ...opts, strategy: 'avalanche' });
    expect(r.periods[0].payments.high).toBeCloseTo(275, 8);
    expect(r.periods[0].payments.low).toBeCloseTo(25, 8);
  });
  it('snowball sends extra money to the smallest balance', () => {
    const r = simulatePlan(inputs, { ...opts, strategy: 'snowball' });
    expect(r.periods[0].payments.low).toBeCloseTo(275, 8);
    expect(r.periods[0].payments.high).toBeCloseTo(25, 8);
    expect(r.accounts.find((a) => a.id === 'low')!.payoffDate! < r.accounts.find((a) => a.id === 'high')!.payoffDate!).toBe(true);
  });
  it('avalanche costs less interest than snowball', () => {
    const a = simulatePlan(inputs, { ...opts, strategy: 'avalanche' });
    const s = simulatePlan(inputs, { ...opts, strategy: 'snowball' });
    expect(a.totalInterest).toBeLessThan(s.totalInterest);
    expect(a.amortizing && s.amortizing).toBe(true);
  });
  it('freed payments roll over (zero interest, exact months)', () => {
    const z1 = acct({ id: 'z1', rate: 0, minPayment: { method: 'fixed', amount: 50 } });
    const z2 = acct({ id: 'z2', rate: 0, minPayment: { method: 'fixed', amount: 50 } });
    const r = simulatePlan(
      [
        { account: z1, state: { principal: 600 } },
        { account: z2, state: { principal: 300 } },
      ],
      { ...opts, strategy: 'avalanche' },
    );
    expect(r.months).toBe(3);
    expect(r.totalPaid).toBeCloseTo(900, 10);
    expect(r.totalInterest).toBe(0);
  });
  it('custom allocation honours minimums and the budget', () => {
    const r = simulatePlan(inputs, { ...opts, strategy: 'custom', customAllocations: { high: 100, low: 10 } });
    expect(r.periods[0].payments.high).toBeCloseTo(100, 8);
    expect(r.periods[0].payments.low).toBeCloseTo(25, 8); // raised to minimum
  });
  it('budget below total minimums is flagged', () => {
    const r = simulatePlan(inputs, { ...opts, monthlyBudget: 30, strategy: 'avalanche', horizonMonths: 24 });
    expect(r.minimumShortfall).toBe(true);
  });
  it('pay-off-now scenario clears the account at the start date', () => {
    const r = simulatePlan(inputs, { ...opts, strategy: 'avalanche', payoffNow: ['low'] });
    expect(r.accounts.find((a) => a.id === 'low')!.payoffDate).toBe('2025-01-01');
  });
});

describe('ledger & current state', () => {
  it('replays transactions and splits payments into interest vs principal', () => {
    const l = replayLedger(1000, '2025-01-01', [
      { date: '2025-01-31', type: 'interest', amount: 5 },
      { date: '2025-02-05', type: 'payment', amount: 100 },
      { date: '2025-02-06', type: 'borrow', amount: 50 },
      { date: '2025-02-07', type: 'fee', amount: 2 },
      { date: '2025-02-08', type: 'adjustment', amount: -1 },
    ]);
    expect(l.interestPaid.toNumber()).toBe(5);
    expect(l.principalPaid.toNumber()).toBe(95);
    expect(l.balance.toNumber()).toBe(1000 + 5 - 100 + 50 + 2 - 1);
  });

  it('does not double count interest that is already recorded', () => {
    const a = acct({ rate: 10 });
    const txns = [
      { date: '2025-01-31', type: 'interest' as const, amount: 5 },
      { date: '2025-02-05', type: 'payment' as const, amount: 100 },
    ];
    const s = currentState(a, 1000, '2025-01-01', txns, '2025-02-10');
    expect(s.recordedBalance).toBe(905);
    // Estimate starts at the last recorded charge (Jan 31), never before it.
    // Jan 31–Feb 5: 5 days on 1000. The Feb 5 payment covers recorded + accrued interest first,
    // so principal becomes 1000 − (100 − 5 − i1). Then 5 more days on that principal.
    const i1 = (1000 * 0.1 * 5) / 365;
    const p2 = 1000 - (100 - 5 - i1);
    expect(s.estimatedAccrued).toBeCloseTo(i1 + (p2 * 0.1 * 5) / 365, 8);
    // Recording the interest charge moves the estimate start: no interest before Jan 31 is re-estimated.
    expect(s.ledger.accrualStart).toBe('2025-01-31');
  });
});

describe('interest-only minimum includes all unpaid simple interest', () => {
  it('unpaid interest from an earlier cycle is part of the next interest-only minimum', () => {
    const sim = new AccountSim(LOC(), '2025-01-15', { principal: 10000, interestOwed: 50 });
    sim.advanceTo(toDay('2025-02-15'));
    expect(sim.minimumDue(toDay('2025-02-15')).toNumber()).toBeCloseTo(50 + (10000 * 0.07 * 31) / 365, 8);
  });
});
