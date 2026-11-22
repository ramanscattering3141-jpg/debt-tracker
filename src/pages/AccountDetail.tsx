import { useMemo, useState } from 'react';
import { Plus, Download, Pencil, Trash2 } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, CardHeader, Stat, Segmented, Button, Badge, Notice, Field, Input, NumberInput, Sheet, Empty } from '@/components/ui';
import { BalanceArea } from '@/components/charts';
import { TransactionSheet, TX_LABELS } from '@/components/TransactionSheet';
import { AccountSettings } from '@/pages/AccountSettings';
import { money, date, pct, duration, monthLabel } from '@/lib/format';
import { changeRate, updateRateRecord, deleteRateRecord } from '@/db/actions';
import { saveFile } from '@/lib/files';
import { toCSV } from '@/db/backup';
import { projectAccount, toDay, fromDay, type FutureEvent } from '@/engine';
import { monthsUntil, type AccountView } from '@/lib/compute';
import type { RateRecord, Transaction } from '@/db/db';

export function AccountDetail({ id, tab }: { id: string; tab: string }) {
  const { summary, go } = useApp();
  const view = summary.views.find((v) => v.account.id === id);
  if (!view) return <Empty>Account not found.</Empty>;
  return (
    <div className="space-y-3">
      <PageHeader title={view.account.name} subtitle={`${pct(view.rate)} · ${view.account.rateType} rate`} back="accounts" />
      <Segmented
        value={tab}
        onChange={(t) => go(`account/${id}/${t}`)}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'activity', label: 'Activity' },
          { value: 'rates', label: 'Rates' },
          { value: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'overview' && <Overview view={view} />}
      {tab === 'activity' && <Activity view={view} />}
      {tab === 'rates' && <Rates view={view} />}
      {tab === 'settings' && <AccountSettings view={view} />}
    </div>
  );
}

function Overview({ view }: { view: AccountView }) {
  const { today } = useApp();
  const a = view.account;
  const [tryPayment, setTryPayment] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const proj = useMemo(
    () => (tryPayment && tryPayment > 0 ? projectAccount(view.engine, view.state.sim, today, { payment: tryPayment }) : view.projection),
    [tryPayment, view, today],
  );
  const months = monthsUntil(today, proj.payoffDate);
  const chart = useMemo(() => {
    const pts = [{ date: today, balance: view.balance }];
    let lastMonth = today.slice(0, 7);
    for (const r of proj.rows) {
      if (r.date.slice(0, 7) !== lastMonth) {
        pts.push({ date: r.date, balance: r.balance });
        lastMonth = r.date.slice(0, 7);
      } else pts[pts.length - 1] = { date: r.date, balance: r.balance };
      if (pts.length > 400) break;
    }
    return pts;
  }, [proj, view.balance, today]);

  const exportSchedule = () =>
    saveFile(
      `${a.name.replace(/[^\w]+/g, '-')}-schedule.csv`,
      toCSV(
        proj.rows.map((r) => ({
          date: r.date,
          type: r.kind,
          payment: r.payment.toFixed(2),
          interest: r.interest.toFixed(2),
          principal: r.principal.toFixed(2),
          balance: r.balance.toFixed(2),
          required_minimum: r.minimum?.toFixed(2) ?? '',
        })),
      ),
      'text/csv',
    );

  return (
    <>
      <Card className="p-4">
        <div className="text-xs text-subtle">Current balance (estimated)</div>
        <div className="text-[32px] font-bold tabular-nums leading-tight">{money(view.balance)}</div>
        <div className="text-xs text-subtle">
          Recorded {money(view.state.recordedBalance)}
          {view.state.estimatedAccrued > 0.005 && <> + ≈ {money(view.state.estimatedAccrued)} interest accrued since {date(view.state.ledger.accrualStart)} (estimate)</>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Interest rate" value={pct(view.rate)} sub={a.interest.method === 'simple' ? 'Simple interest' : `Compounded ${periodName(a.interest.periodsPerYear)}`} />
          <Stat label="Required minimum" value={money(view.minimum)} sub={view.minimumLabel} />
          {a.payInFull ? (
            <Stat label="Planned payment" value={money(view.balance)} sub="Full balance, monthly" />
          ) : (
            <Stat label="Planned payment" value={money(a.plannedPayment ?? view.minimum)} sub={a.plannedPayment ? `${a.frequency}` : 'Using minimum'} />
          )}
          <Stat label="Next due" value={date(view.projection.rows.find((r) => r.minimum !== undefined)?.date ?? null)} sub={`Due on day ${a.dueDay}`} />
          {a.creditLimit ? <Stat label="Available credit" value={money(Math.max(0, a.creditLimit - view.balance))} sub={`Limit ${money(a.creditLimit)}`} /> : null}
          <Stat label="Interest paid to date" value={money(view.state.ledger.interestPaid.toNumber())} />
          <Stat label="Principal repaid to date" value={money(view.state.ledger.principalPaid.toNumber())} tone="good" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Repayment projection" subtitle="Estimated future interest — uses real calendar dates and scheduled rate changes" />
        <div className="px-4 pb-2">
          <Field label="Try a different payment (per occurrence)" hint="Doesn’t change your saved plan.">
            <NumberInput value={tryPayment} onChange={setTryPayment} prefix="$" placeholder={a.payInFull ? view.balance.toFixed(2) : String(a.plannedPayment ?? view.minimum.toFixed(2))} />
          </Field>
        </div>
        {view.balance <= 0.005 ? (
          <div className="px-4 pb-4">
            <Notice tone="good">This account is paid off.</Notice>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
              <Stat label="Payoff date" value={proj.payoffDate ? date(proj.payoffDate) : 'Never'} tone={proj.payoffDate ? 'good' : 'bad'} sub={proj.payoffDate ? duration(months) : undefined} />
              <Stat label="Future interest" value={proj.amortizing ? money(proj.totalInterest) : '—'} sub="Estimate" />
              <Stat label="Total to repay" value={proj.amortizing ? money(proj.totalPaid) : '—'} />
              <Stat label="Payments" value={proj.amortizing ? proj.rows.filter((r) => r.kind === 'payment').length : '—'} />
            </div>
            <div className="px-4 pb-3 space-y-2">
              {!proj.amortizing && (
                <Notice tone="bad">
                  {proj.reason === 'horizon'
                    ? 'Not repaid within 50 years at this payment.'
                    : 'This payment doesn’t cover the accruing interest, so the debt isn’t being paid down. There is no payoff date under these assumptions.'}
                  {view.projection.firstCycleInterest > 0 && <> This cycle’s interest is about {money(view.projection.firstCycleInterest)}.</>}
                </Notice>
              )}
              {proj.belowMinimum && <Notice tone="warn">The payment is below the required minimum in at least one month.</Notice>}
            </div>
            <div className="px-2">
              <BalanceArea data={chart} series={[{ key: 'balance', name: 'Balance', color: a.color }]} stacked={false} height={170} />
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-xs text-subtle">
                  <tr className="border-y border-border">
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-2 py-2 text-right font-medium">Payment</th>
                    <th className="px-2 py-2 text-right font-medium">Interest</th>
                    <th className="px-2 py-2 text-right font-medium">Principal</th>
                    <th className="px-4 py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? proj.rows : proj.rows.slice(0, 12)).map((r, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="px-4 py-1.5 whitespace-nowrap">
                        {date(r.date)}
                        {r.kind !== 'payment' && <Badge className="ml-1">{r.kind === 'borrow' ? 'draw' : 'extra'}</Badge>}
                      </td>
                      <td className="px-2 py-1.5 text-right">{money(r.payment)}</td>
                      <td className="px-2 py-1.5 text-right text-bad">{money(r.interest)}</td>
                      <td className={`px-2 py-1.5 text-right ${r.principal < 0 ? 'text-bad' : 'text-good'}`}>{money(r.principal)}</td>
                      <td className="px-4 py-1.5 text-right">{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 p-3">
              {proj.rows.length > 12 && (
                <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show less' : `Show all ${proj.rows.length}`}
                </Button>
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={exportSchedule}>
                <Download size={14} /> Export schedule
              </Button>
            </div>
          </>
        )}
      </Card>

      <WithdrawalPlanner view={view} />
    </>
  );
}

function periodName(n: number) {
  return ({ 365: 'daily', 52: 'weekly', 26: 'biweekly', 12: 'monthly', 4: 'quarterly', 2: 'semi-annually', 1: 'annually' } as Record<number, string>)[n] ?? `${n}×/year`;
}

/** "What if I withdraw more?" — balances and minimum payments month by month with a further draw. */
function WithdrawalPlanner({ view }: { view: AccountView }) {
  const { today } = useApp();
  const a = view.account;
  const [amount, setAmount] = useState<number | null>(a.category === 'loc' ? 2000 : null);
  const [dt, setDt] = useState(fromDay(toDay(today) + 10));
  const [minOnly, setMinOnly] = useState(true);
  const months = 12;
  const rows = useMemo(() => {
    const events: FutureEvent[] = amount && amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dt) ? [{ date: dt, type: 'borrow', amount }] : [];
    const opts = { horizonMonths: months + 1 };
    const engine = minOnly ? { ...view.engine, plannedPayment: null, payInFull: false } : view.engine;
    const base = projectAccount(engine, view.state.sim, today, opts);
    const draw = projectAccount(engine, view.state.sim, today, { ...opts, events });
    const mins = (p: typeof base) => p.rows.filter((r) => r.minimum !== undefined);
    const b = mins(base);
    const d = mins(draw);
    return d.slice(0, months).map((r, i) => ({ date: r.date, before: b[i]?.minimum ?? 0, after: r.minimum ?? 0, balance: r.balance, beforeBal: b[i]?.balance ?? 0 }));
  }, [amount, dt, minOnly, view, today]);
  const newBalance = view.balance + (amount ?? 0);
  return (
    <Card>
      <CardHeader
        title={a.category === 'loc' ? 'Withdraw more from this line of credit?' : 'What if I borrow more?'}
        subtitle={a.interest.method === 'simple' ? 'Interest accrues daily on the amount withdrawn, from the withdrawal date.' : 'Shows how a new charge changes balances and minimums.'}
      />
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Withdrawal amount">
          <NumberInput value={amount} onChange={setAmount} prefix="$" placeholder="0.00" />
        </Field>
        <Field label="Withdrawal date">
          <Input type="date" value={dt} onChange={(e) => setDt(e.target.value)} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={minOnly} onChange={(e) => setMinOnly(e.target.checked)} />
          Assume only minimum payments are made
        </label>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pb-3 sm:grid-cols-3">
        <Stat label="Balance after withdrawal" value={money(newBalance)} />
        {a.creditLimit ? (
          <Stat label="Credit left" value={money(a.creditLimit - newBalance)} tone={a.creditLimit - newBalance < 0 ? 'bad' : undefined} sub={a.creditLimit - newBalance < 0 ? 'Over limit' : undefined} />
        ) : null}
        <Stat
          label="Full-month minimum after"
          value={money(rows[2]?.after ?? rows[rows.length - 1]?.after ?? 0)}
          sub={`was ${money(rows[2]?.before ?? 0)}`}
          tone="bad"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-xs text-subtle">
            <tr className="border-y border-border">
              <th className="px-4 py-2 text-left font-medium">Due</th>
              <th className="px-2 py-2 text-right font-medium">Min now</th>
              <th className="px-2 py-2 text-right font-medium">Min with draw</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-b border-border/60">
                <td className="px-4 py-1.5 whitespace-nowrap">{monthLabel(r.date)}</td>
                <td className="px-2 py-1.5 text-right">{money(r.before)}</td>
                <td className={`px-2 py-1.5 text-right ${r.after > r.before + 0.005 ? 'text-bad font-medium' : ''}`}>{money(r.after)}</td>
                <td className="px-4 py-1.5 text-right">{money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-subtle">
        Estimates. The month of the withdrawal is prorated by days. Minimums follow this account’s method ({view.minimumLabel}).
      </p>
    </Card>
  );
}

export function TxnList({ txns, showAccount, onEdit }: { txns: Transaction[]; showAccount?: boolean; onEdit: (t: Transaction) => void }) {
  const { data } = useApp();
  const name = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  if (!sorted.length) return <Empty>No transactions yet.</Empty>;
  return (
    <div className="divide-y divide-border">
      {sorted.map((t) => {
        const reduces = t.type === 'payment' || (t.type === 'adjustment' && t.amount < 0);
        return (
          <button key={t.id} onClick={() => onEdit(t)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[14px] font-medium">
                {TX_LABELS[t.type]}
                {!t.affectsBalance && <Badge>record only</Badge>}
              </div>
              <div className="truncate text-xs text-subtle">
                {date(t.date)}
                {showAccount && ` · ${name(t.accountId)}`}
                {t.description && ` · ${t.description}`}
              </div>
            </div>
            <div className={`text-[14px] font-semibold tabular-nums ${reduces ? 'text-good' : 'text-bad'}`}>
              {reduces ? '−' : '+'}
              {money(Math.abs(t.amount))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Activity({ view }: { view: AccountView }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  return (
    <Card>
      <CardHeader
        title="Transactions"
        subtitle={`Opening balance ${money(view.account.openingBalance)} on ${date(view.account.openingBalanceDate)}`}
        action={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> Add
          </Button>
        }
      />
      <TxnList
        txns={view.txns}
        onEdit={(t) => {
          setEditing(t);
          setOpen(true);
        }}
      />
      <TransactionSheet open={open} onClose={() => setOpen(false)} accountId={view.account.id} editing={editing} />
    </Card>
  );
}

function Rates({ view }: { view: AccountView }) {
  const { data, today } = useApp();
  const records = data.rates.filter((r) => r.accountId === view.account.id).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.enteredAt.localeCompare(a.enteredAt));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RateRecord | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [eff, setEff] = useState(today);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const start = (r: RateRecord | null) => {
    setEditing(r);
    setRate(r ? r.newRate : view.rate);
    setEff(r ? r.effectiveDate : today);
    setNotes(r?.notes ?? '');
    setErr('');
    setOpen(true);
  };
  const save = async () => {
    if (rate === null || rate < 0 || rate > 100) return setErr('Enter a rate between 0 and 100.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) return setErr('Enter a valid effective date.');
    if (editing) await updateRateRecord({ ...editing, newRate: rate, effectiveDate: eff, notes: notes || undefined });
    else await changeRate(view.account.id, rate, eff, notes || undefined);
    setOpen(false);
  };
  return (
    <Card>
      <CardHeader
        title="Interest rate history"
        subtitle="Each rate applies from its effective date. Past interest stays as calculated."
        action={
          <Button size="sm" onClick={() => start(null)}>
            <Plus size={16} /> Change rate
          </Button>
        }
      />
      <div className="divide-y divide-border">
        {records.map((r, i) => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium tabular-nums">
                {r.previousRate !== null && <span className="text-subtle">{pct(r.previousRate)} → </span>}
                {pct(r.newRate)}
                {i === 0 && r.effectiveDate > today && <Badge tone="info" className="ml-2">Scheduled</Badge>}
              </div>
              <div className="text-xs text-subtle">
                Effective {r.effectiveDate <= '2000-01-01' ? 'from the start' : date(r.effectiveDate)} · entered {date(r.enteredAt.slice(0, 10))}
                {r.notes && ` · ${r.notes}`}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => start(r)} aria-label="Edit">
              <Pencil size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete"
              disabled={records.length <= 1}
              onClick={async () => {
                if (confirm('Delete this rate record? Projections will be recalculated.')) await deleteRateRecord(r.id);
              }}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit rate record' : 'Change interest rate'}
        footer={
          <Button className="flex-1" onClick={save}>
            Save
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="New annual interest rate">
            <NumberInput value={rate} onChange={setRate} suffix="%" />
          </Field>
          <Field label="Effective date" hint="Can be in the past or future. The previous rate is preserved.">
            <Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Prime rate change" />
          </Field>
          {err && <Notice tone="bad">{err}</Notice>}
        </div>
      </Sheet>
    </Card>
  );
}
