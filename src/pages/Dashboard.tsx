import { useMemo, useState } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, CardHeader, Stat, Notice } from '@/components/ui';
import { InstallHint } from '@/components/InstallHint';
import { MarkPaidSheet } from '@/components/MarkPaidSheet';
import { UpcomingRow } from '@/pages/Calendar';
import { activeReminders, type UpcomingItem } from '@/lib/upcoming';
import { BalanceArea, Donut, Bars } from '@/components/charts';
import { money, date, pct, duration } from '@/lib/format';
import { projectedSeries, historySeries, monthsUntil } from '@/lib/compute';

export function Dashboard() {
  const { summary, data, today, go } = useApp();
  const views = summary.views;
  const projected = useMemo(() => projectedSeries(views, today), [views, today]);
  const history = useMemo(() => historySeries(data, today), [data, today]);
  const historyWithCum = useMemo(() => {
    let p = 0;
    let i = 0;
    return history.map((h) => {
      p += Math.max(0, Number(h.payments) - Number(h.interest) - Number(h.fees));
      i += Number(h.interest);
      return { date: h.date, principal: Number(h.payments) - Number(h.interest) - Number(h.fees), interest: Number(h.interest), cumPrincipal: p, cumInterest: i };
    });
  }, [history]);
  const series = views.map((v) => ({ key: v.account.id, name: v.account.name, color: v.account.color }));
  const owing = views.filter((v) => v.balance > 0.005);
  const nonAmortizing = owing.filter((v) => !v.projection.amortizing);
  const debtFreeMonths = monthsUntil(today, summary.debtFreeDate);
  const groupDefs: { label: string; cats: string[] }[] = [
    { label: 'Lines of credit', cats: ['loc'] },
    { label: 'Student loans', cats: ['student_loan'] },
    { label: 'Credit cards', cats: ['credit_card'] },
    { label: 'Other loans', cats: ['loan', 'other'] },
  ];
  const groups = groupDefs
    .map((g) => {
      const vs = views.filter((v) => g.cats.includes(v.account.category));
      return { label: g.label, views: vs, total: vs.reduce((t, v) => t + Math.max(0, v.balance), 0) };
    })
    .filter((g) => g.views.length);
  const combined = [...history.map((h) => ({ date: String(h.date), actual: Number(h.total) })), ...projected.slice(1).map((p) => ({ date: p.date, projected: p.total }))];
  if (history.length && projected.length) Object.assign(combined[history.length - 1], { projected: summary.totalDebt });

  return (
    <div className="space-y-3 pb-2">
      <PageHeader title="My debts" subtitle={date(today)}>
        <div className="mt-4">
          <div className="text-[13px] text-white/80">Total owing</div>
          <div className="text-[38px] font-bold tabular-nums leading-tight tracking-tight">{money(summary.totalDebt)}</div>
          {summary.estimatedAccrued > 0.005 && (
            <div className="text-[12px] text-white/75">Includes ≈ {money(summary.estimatedAccrued)} estimated interest since your last recorded statements</div>
          )}
        </div>
      </PageHeader>

      <InstallHint />
      <ComingUp />

      <Card className="-mt-1 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          <Stat label="Monthly minimums" value={money(summary.totalMinimum)} />
          <Stat label="Planned monthly" value={money(summary.totalPlanned)} />
          <Stat label="Est. monthly interest" value={money(summary.monthlyInterest)} tone={summary.monthlyInterest > 0 ? 'bad' : undefined} />
          <Stat
            label="Debt-free date"
            value={summary.debtFreeDate ? date(summary.debtFreeDate) : 'Not on track'}
            sub={summary.debtFreeDate ? duration(debtFreeMonths) : 'Payments don’t cover interest'}
            tone={summary.debtFreeDate ? 'good' : 'bad'}
          />
          <Stat label="Principal repaid" value={money(summary.principalRepaid)} tone="good" sub="To date" />
          <Stat label="Interest paid" value={money(summary.interestPaid)} sub="To date" />
        </div>
      </Card>

      {nonAmortizing.length > 0 && (
        <Notice tone="bad">
          <div className="flex gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {nonAmortizing.map((v) => v.account.name).join(', ')}: the planned payment doesn’t reduce the balance, so there’s no payoff date yet. Set a planned
              payment above the monthly interest.
            </span>
          </div>
        </Notice>
      )}

      {groups.map((g) => (
        <section key={g.label}>
          <div className="mb-1.5 mt-5 flex items-baseline justify-between px-1">
            <h2 className="text-[17px] font-bold">{g.label}</h2>
            <span className="text-[13px] font-semibold tabular-nums text-subtle">{money(g.total)}</span>
          </div>
          <Card>
            <div className="divide-y divide-border">
              {g.views.map((v) => (
                <button key={v.account.id} onClick={() => go(`account/${v.account.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-brand">{v.account.name}</div>
                    <div className="mt-0.5 text-[12.5px] text-subtle">
                      {pct(v.rate)} · min {money(v.minimum)} ·{' '}
                      {v.balance <= 0.005 ? 'paid off' : v.projection.payoffDate ? `payoff ${date(v.projection.payoffDate)}` : <span className="text-bad">no payoff yet</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[16px] font-bold tabular-nums">{money(v.balance)}</div>
                    {v.account.creditLimit ? <div className="text-[11.5px] text-subtle">{money(Math.max(0, v.account.creditLimit - v.balance))} available</div> : null}
                  </div>
                  <ChevronRight size={18} className="text-lilac shrink-0" />
                </button>
              ))}
            </div>
          </Card>
        </section>
      ))}

      <h2 className="mb-1.5 mt-5 px-1 text-[17px] font-bold">Insights</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader title="Total debt over time" subtitle="Recorded history (solid) and projection at planned payments" />
          <div className="px-2 pb-3">
            <BalanceArea
              data={combined}
              stacked={false}
              series={[
                { key: 'actual', name: 'Recorded', color: '#7457b8' },
                { key: 'projected', name: 'Projected', color: '#1f8f55' },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Debt by account" />
          <div className="flex items-center gap-2 px-4 pb-4">
            <div className="w-40 shrink-0">
              <Donut data={owing.map((v) => ({ name: v.account.name, value: v.balance, color: v.account.color }))} />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {owing.map((v) => (
                <div key={v.account.id} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: v.account.color }} />
                  <span className="truncate flex-1 text-subtle">{v.account.name}</span>
                  <span className="tabular-nums">{summary.totalDebt ? ((v.balance / summary.totalDebt) * 100).toFixed(0) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Principal vs interest paid" subtitle="Monthly, from recorded transactions" />
          <div className="px-2 pb-3">
            <Bars
              data={historyWithCum.slice(-12)}
              stacked
              series={[
                { key: 'principal', name: 'Principal', color: '#1f8f55' },
                { key: 'interest', name: 'Interest', color: '#c8364a' },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Projected debt reduction" subtitle="By account, at planned payments (estimate)" />
          <div className="px-2 pb-3">
            <BalanceArea data={projected} series={series} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Payments whose reminder window has started and that aren't marked paid yet. */
function ComingUp() {
  const { summary, data, today, go } = useApp();
  const [sel, setSel] = useState<UpcomingItem | null>(null);
  const items = useMemo(() => activeReminders(summary, data, today), [summary, data, today]);
  if (!items.length) return null;
  const current = sel ? items.find((i) => i.key === sel.key) ?? sel : null;
  return (
    <Card>
      <CardHeader title="Coming up" subtitle="Tap a payment once it’s made" action={<button className="text-sm font-semibold text-brand" onClick={() => go('calendar')}>Calendar ›</button>} />
      <div className="divide-y divide-border">
        {items.slice(0, 6).map((i) => (
          <UpcomingRow key={i.key} item={i} onClick={() => setSel(i)} />
        ))}
      </div>
      {current && <MarkPaidSheet item={current} onClose={() => setSel(null)} />}
    </Card>
  );
}
