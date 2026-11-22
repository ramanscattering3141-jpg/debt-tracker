import { useEffect, useState } from 'react';
import { useApp } from '@/App';
import { Card, CardHeader, Field, Input, NumberInput, Select, Button, Notice, Confirm } from '@/components/ui';
import { saveAccount, setReportedBalance, deleteAccount, CATEGORY_LABELS, ACCOUNT_COLORS } from '@/db/actions';
import type { Account } from '@/db/db';
import type { AccountView } from '@/lib/compute';
import { MIN_METHOD_LABELS } from '@/lib/compute';
import type { InterestConfig, MinPaymentConfig } from '@/engine';
import { money } from '@/lib/format';

const PRESETS: { label: string; cfg: InterestConfig; hint: string }[] = [
  { label: 'Simple, daily', cfg: { method: 'simple', accrualBasis: 'daily', periodsPerYear: 12, dayCount: 'actual' }, hint: 'Lines of credit, most student loans' },
  { label: 'Daily, compounded monthly', cfg: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 12, dayCount: '365' }, hint: 'Most credit cards' },
  { label: 'Monthly (rate ÷ 12)', cfg: { method: 'compound', accrualBasis: 'periodic', periodsPerYear: 12, dayCount: '365' }, hint: 'Many installment loans' },
  { label: 'Daily compounding', cfg: { method: 'compound', accrualBasis: 'daily', periodsPerYear: 365, dayCount: '365' }, hint: '' },
];

const PERIODS = [
  { v: 365, l: 'Daily (365/yr)' },
  { v: 52, l: 'Weekly (52/yr)' },
  { v: 26, l: 'Biweekly (26/yr)' },
  { v: 12, l: 'Monthly (12/yr)' },
  { v: 4, l: 'Quarterly (4/yr)' },
  { v: 2, l: 'Semi-annually (2/yr)' },
  { v: 1, l: 'Annually (1/yr)' },
];

export function AccountSettings({ view }: { view: AccountView }) {
  const { today, go } = useApp();
  const [a, setA] = useState<Account>(view.account);
  const [bal, setBal] = useState<number | null>(null);
  const [balDate, setBalDate] = useState(today);
  const [saved, setSaved] = useState(false);
  const [del, setDel] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setA(view.account), [view.account]);

  const set = <K extends keyof Account>(k: K, v: Account[K]) => {
    setA((x) => ({ ...x, [k]: v }));
    setSaved(false);
  };
  const setI = (p: Partial<InterestConfig>) => set('interest', { ...a.interest, ...p });
  const setM = (p: Partial<MinPaymentConfig>) => set('minPayment', { ...a.minPayment, ...p });
  const customPeriods = !PERIODS.some((p) => p.v === a.interest.periodsPerYear);
  const m = a.minPayment;

  const save = async () => {
    if (!a.name.trim()) return setErr('Name is required.');
    if (a.dueDay < 1 || a.dueDay > 31) return setErr('Due day must be between 1 and 31.');
    if (!a.interest.periodsPerYear || a.interest.periodsPerYear < 1) return setErr('Periods per year must be at least 1.');
    if (m.method === 'amortized' && !(m.termMonths && m.termMonths > 0)) return setErr('Enter an amortization term.');
    setErr('');
    await saveAccount({ ...a, name: a.name.trim() });
    if (bal !== null) {
      await setReportedBalance(a.id, bal, balDate);
      setBal(null);
    }
    setSaved(true);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Balance" subtitle="Enter the balance from your lender. If history exists, an adjustment transaction is recorded." />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Current balance" hint={`App recorded: ${money(view.state.recordedBalance)}`}>
            <NumberInput value={bal} onChange={setBal} prefix="$" placeholder={view.state.recordedBalance.toFixed(2)} />
          </Field>
          <Field label="As of">
            <Input type="date" value={balDate} onChange={(e) => setBalDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Account" />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Name" className="col-span-2">
            <Input value={a.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Category">
            <Select value={a.category} onChange={(e) => set('category', e.target.value as Account['category'])}>
              {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rate type">
            <Select value={a.rateType} onChange={(e) => set('rateType', e.target.value as Account['rateType'])}>
              <option value="fixed">Fixed</option>
              <option value="variable">Variable</option>
            </Select>
          </Field>
          <Field label="Credit limit (optional)">
            <NumberInput value={a.creditLimit} onChange={(n) => set('creditLimit', n)} prefix="$" />
          </Field>
          <Field label="Colour">
            <div className="flex h-10 items-center gap-1.5">
              {ACCOUNT_COLORS.map((c) => (
                <button key={c} onClick={() => set('color', c)} className={`h-6 w-6 rounded-full ${a.color === c ? 'ring-2 ring-offset-2 ring-brand' : ''}`} style={{ background: c }} aria-label={c} />
              ))}
            </div>
          </Field>
          <Field label="Account opened (optional)">
            <Input type="date" value={a.openingDate ?? ''} onChange={(e) => set('openingDate', e.target.value || null)} />
          </Field>
          <Field label="Repayment starts (optional)" hint="Anchors amortized terms">
            <Input type="date" value={a.repaymentStartDate ?? ''} onChange={(e) => set('repaymentStartDate', e.target.value || null)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Interest calculation" subtitle={`Current rate ${view.rate}% — change it in the Rates tab (history is kept).`} />
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {PRESETS.map((p) => (
            <Button key={p.label} size="sm" variant="outline" title={p.hint} onClick={() => set('interest', p.cfg)}>
              {p.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Interest type" hint={a.interest.method === 'simple' ? 'Interest on principal only; unpaid interest doesn’t earn interest.' : 'Unpaid interest is added to the balance each period.'}>
            <Select value={a.interest.method} onChange={(e) => setI({ method: e.target.value as InterestConfig['method'] })}>
              <option value="simple">Simple</option>
              <option value="compound">Compound</option>
            </Select>
          </Field>
          <Field label="Accrual" hint={a.interest.accrualBasis === 'daily' ? 'Rate ÷ days-per-year × actual days' : 'Rate ÷ periods, each period'}>
            <Select value={a.interest.accrualBasis} onChange={(e) => setI({ accrualBasis: e.target.value as InterestConfig['accrualBasis'] })}>
              <option value="daily">Daily</option>
              <option value="periodic">Per period (e.g. monthly)</option>
            </Select>
          </Field>
          <Field label={a.interest.method === 'compound' ? 'Compounding periods' : 'Accrual period'} hint={a.interest.method === 'simple' && a.interest.accrualBasis === 'daily' ? 'Not used for simple daily interest' : undefined}>
            <Select
              value={customPeriods ? 'custom' : String(a.interest.periodsPerYear)}
              onChange={(e) => setI({ periodsPerYear: e.target.value === 'custom' ? 6 : Number(e.target.value) })}
            >
              {PERIODS.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.l}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </Select>
          </Field>
          {customPeriods ? (
            <Field label="Periods per year">
              <NumberInput value={a.interest.periodsPerYear} onChange={(n) => setI({ periodsPerYear: Math.max(1, Math.round(n ?? 1)) })} />
            </Field>
          ) : (
            <Field label="Days per year">
              <Select value={a.interest.dayCount} onChange={(e) => setI({ dayCount: e.target.value as InterestConfig['dayCount'] })}>
                <option value="actual">Actual (365 or 366)</option>
                <option value="365">365</option>
                <option value="366">366</option>
                <option value="365.25">365.25</option>
              </Select>
            </Field>
          )}
          <p className="col-span-2 text-xs text-subtle">
            {a.interest.method === 'compound' ? 'Interest is capitalized on the due day each period.' : 'Payments go to unpaid interest first, then principal.'}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Minimum payment" subtitle="If you don’t know your lender’s exact formula, choose “Entered manually” and copy it from your statement." />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Method" className="col-span-2">
            <Select value={m.method} onChange={(e) => setM({ method: e.target.value as MinPaymentConfig['method'] })}>
              {Object.entries(MIN_METHOD_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {(m.method === 'manual' || m.method === 'fixed') && (
            <Field label="Minimum amount">
              <NumberInput value={m.amount ?? null} onChange={(n) => setM({ amount: n ?? 0 })} prefix="$" />
            </Field>
          )}
          {(m.method === 'percentBalance' || m.method === 'interestPlusPercent' || m.method === 'custom') && (
            <Field label={m.method === 'interestPlusPercent' ? '% of principal' : '% of balance'}>
              <NumberInput value={m.percent ?? null} onChange={(n) => setM({ percent: n ?? 0 })} suffix="%" />
            </Field>
          )}
          {m.method === 'amortized' && (
            <Field label="Term (months)" hint="Recalculated on the remaining term">
              <NumberInput value={m.termMonths ?? null} onChange={(n) => setM({ termMonths: n ?? 0 })} />
            </Field>
          )}
          {m.method === 'custom' && (
            <>
              <Field label="Plus fixed amount">
                <NumberInput value={m.customFixed ?? null} onChange={(n) => setM({ customFixed: n ?? 0 })} prefix="$" />
              </Field>
              <Field label="Maximum (optional)">
                <NumberInput value={m.cap ?? null} onChange={(n) => setM({ cap: n ?? undefined })} prefix="$" />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={!!m.customIncludeInterest} onChange={(e) => setM({ customIncludeInterest: e.target.checked })} />
                Add the month’s interest
              </label>
            </>
          )}
          <Field label="Minimum dollar floor (optional)">
            <NumberInput value={m.floor ?? null} onChange={(n) => setM({ floor: n ?? undefined })} prefix="$" />
          </Field>
          {m.method === 'interestOnly' && <p className="col-span-2 text-xs text-subtle">Minimum = interest accrued during the month. Doesn’t reduce the principal.</p>}
          {m.method === 'manual' && (
            <div className="col-span-2 space-y-2">
              <div className="text-xs font-medium text-subtle">Future minimum changes (optional)</div>
              {(m.schedule ?? []).map((s, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    type="date"
                    value={s.effectiveDate}
                    onChange={(e) => setM({ schedule: m.schedule!.map((x, j) => (j === i ? { ...x, effectiveDate: e.target.value } : x)) })}
                  />
                  <NumberInput className="w-36 shrink-0" value={s.amount} onChange={(n) => setM({ schedule: m.schedule!.map((x, j) => (j === i ? { ...x, amount: n ?? 0 } : x)) })} prefix="$" />
                  <Button variant="ghost" onClick={() => setM({ schedule: m.schedule!.filter((_, j) => j !== i) })}>
                    ✕
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setM({ schedule: [...(m.schedule ?? []), { effectiveDate: today, amount: m.amount ?? 0 }] })}>
                Add change
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Payments" />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Due day of month">
            <NumberInput value={a.dueDay} onChange={(n) => set('dueDay', Math.min(31, Math.max(1, Math.round(n ?? 1))))} />
          </Field>
          <Field label="Payment frequency">
            <Select value={a.frequency} onChange={(e) => set('frequency', e.target.value as Account['frequency'])}>
              <option value="monthly">Monthly</option>
              <option value="biweekly">Biweekly</option>
              <option value="weekly">Weekly</option>
            </Select>
          </Field>
          <Field label={`Planned payment (per ${a.frequency === 'monthly' ? 'month' : a.frequency === 'weekly' ? 'week' : '2 weeks'})`} hint="Leave blank to pay the minimum" className="col-span-2">
            <NumberInput value={a.plannedPayment} onChange={(n) => set('plannedPayment', n)} prefix="$" />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Input value={a.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </Card>

      {err && <Notice tone="bad">{err}</Notice>}
      {saved && <Notice tone="good">Saved. Balances and projections updated.</Notice>}
      <div className="flex gap-2 pb-4">
        <Button variant="outline" className="text-bad" onClick={() => setDel(true)}>
          Delete account
        </Button>
        <Button className="flex-1" onClick={save}>
          Save changes
        </Button>
      </div>
      <Confirm
        open={del}
        onClose={() => setDel(false)}
        destructive
        title="Delete account?"
        confirmLabel="Delete permanently"
        message={<p>This permanently deletes “{a.name}” with all its transactions, rate history and payment records. This cannot be undone — export a backup first if unsure.</p>}
        onConfirm={async () => {
          await deleteAccount(a.id);
          go('accounts');
        }}
      />
    </div>
  );
}
