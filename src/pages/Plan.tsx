import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Download, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, CardHeader, Stat, Segmented, Field, Input, NumberInput, Select, Button, Notice, Badge, Sheet, Empty } from '@/components/ui';
import { BalanceArea, Lines } from '@/components/charts';
import { money, date, duration, cn } from '@/lib/format';
import { planInputs, runScenario, emptyScenario, monthsUntil, type PlanSettings, type Summary } from '@/lib/compute';
import { simulatePlan, type PlanResult, type Strategy } from '@/engine';
import { setSetting, saveScenario, deleteScenario } from '@/db/actions';
import { uid, type Scenario, type ScenarioConfig } from '@/db/db';
import { saveFile } from '@/lib/files';
import { toCSV } from '@/db/backup';

const STRATEGY_LABEL: Record<Strategy, string> = { avalanche: 'Avalanche', snowball: 'Snowball', custom: 'Custom', minimum: 'Minimums only' };
const STRATEGY_HINT: Record<string, string> = {
  avalanche: 'Minimums on everything; extra money goes to the highest interest rate first.',
  snowball: 'Minimums on everything; extra money goes to the smallest balance first.',
  custom: 'You choose how much each account gets (at least its minimum).',
};

function usePlanSettings(): [PlanSettings, (p: Partial<PlanSettings>) => void] {
  const { data, summary, today } = useApp();
  const stored = data.settings.plan as PlanSettings | undefined;
  const defaults: PlanSettings = {
    monthlyBudget: Math.ceil(Math.max(summary.totalPlanned, summary.totalMinimum)),
    extraMonthly: 0,
    oneTimeAmount: 0,
    oneTimeDate: today,
    strategy: 'avalanche',
    customAllocations: {},
  };
  const [s, setS] = useState<PlanSettings>({ ...defaults, ...stored });
  useEffect(() => {
    const t = setTimeout(() => setSetting('plan', s), 400);
    return () => clearTimeout(t);
  }, [s]);
  return [s, (p) => setS((x) => ({ ...x, ...p }))];
}

function runPlan(summary: Summary, s: PlanSettings, strategy: Strategy, today: string): PlanResult {
  return simulatePlan(planInputs(summary), {
    startDate: s.startDate && s.startDate >= today ? s.startDate : today,
    monthlyBudget: s.monthlyBudget,
    extraMonthly: s.extraMonthly,
    oneTimePayments: s.oneTimeAmount > 0 ? [{ date: s.oneTimeDate, amount: s.oneTimeAmount }] : [],
    strategy,
    customAllocations: s.customAllocations,
  });
}

export function Plan({ tab }: { tab: string }) {
  const { go } = useApp();
  const [settings, update] = usePlanSettings();
  return (
    <div className="space-y-3">
      <PageHeader title="Repayment plan" subtitle="Projections only — nothing here changes your account data." />
      <Segmented
        value={tab}
        onChange={(t) => go(`plan/${t}`)}
        options={[
          { value: 'debt-free', label: 'Debt-free' },
          { value: 'compare', label: 'Compare' },
          { value: 'scenarios', label: 'What if' },
        ]}
      />
      {tab === 'debt-free' && <DebtFree s={settings} update={update} />}
      {tab === 'compare' && <Compare s={settings} />}
      {tab === 'scenarios' && <Scenarios s={settings} />}
    </div>
  );
}

function PlanInputs({ s, update }: { s: PlanSettings; update: (p: Partial<PlanSettings>) => void }) {
  const { summary, today } = useApp();
  const owing = summary.views.filter((v) => v.balance > 0.005);
  const allocTotal = owing.reduce((t, v) => t + Math.max(s.customAllocations[v.account.id] ?? 0, v.minimum), 0);
  const budget = s.monthlyBudget + s.extraMonthly;
  return (
    <Card className="p-4 space-y-3">
      <Field label="Monthly debt budget (all payments, minimums included)">
        <NumberInput value={s.monthlyBudget} onChange={(n) => update({ monthlyBudget: n ?? 0 })} prefix="$" />
      </Field>
      <input
        type="range"
        min={Math.floor(summary.totalMinimum)}
        max={Math.max(5000, Math.ceil(s.monthlyBudget * 2))}
        step={25}
        value={s.monthlyBudget}
        onChange={(e) => update({ monthlyBudget: Number(e.target.value) })}
        className="w-full accent-brand"
      />
      <div className="flex justify-between text-xs text-subtle -mt-2">
        <span>Minimums {money(summary.totalMinimum)}</span>
        <span>Currently planned {money(summary.totalPlanned)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Extra recurring / month">
          <NumberInput value={s.extraMonthly} onChange={(n) => update({ extraMonthly: n ?? 0 })} prefix="$" />
        </Field>
        <Field label="Start date">
          <Input type="date" value={s.startDate ?? today} min={today} onChange={(e) => update({ startDate: e.target.value })} />
        </Field>
        <Field label="One-time extra payment">
          <NumberInput value={s.oneTimeAmount} onChange={(n) => update({ oneTimeAmount: n ?? 0 })} prefix="$" />
        </Field>
        <Field label="On date">
          <Input type="date" value={s.oneTimeDate} onChange={(e) => update({ oneTimeDate: e.target.value })} />
        </Field>
      </div>
      <Field label="Strategy" hint={STRATEGY_HINT[s.strategy]}>
        <Segmented
          value={s.strategy}
          onChange={(v) => update({ strategy: v })}
          options={[
            { value: 'avalanche', label: 'Avalanche' },
            { value: 'snowball', label: 'Snowball' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </Field>
      {s.strategy === 'custom' && (
        <div className="space-y-2">
          {owing.map((v) => (
            <div key={v.account.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{v.account.name}</div>
                <div className="text-[11px] text-subtle">min {money(v.minimum)}</div>
              </div>
              <NumberInput
                className="w-32"
                value={s.customAllocations[v.account.id] ?? null}
                placeholder={v.minimum.toFixed(2)}
                onChange={(n) => update({ customAllocations: { ...s.customAllocations, [v.account.id]: n ?? 0 } })}
                prefix="$"
              />
            </div>
          ))}
          <div className={cn('text-xs', allocTotal > budget ? 'text-bad' : 'text-subtle')}>
            Allocated {money(allocTotal)} of {money(budget)}
            {allocTotal > budget && ' — over budget. Allocations will be cut back to fit the budget.'}
            {allocTotal < budget - 0.005 && ` — ${money(budget - allocTotal)} unallocated (rolls to highest rate once accounts are paid off).`}
          </div>
        </div>
      )}
    </Card>
  );
}

function DebtFree({ s, update }: { s: PlanSettings; update: (p: Partial<PlanSettings>) => void }) {
  const { summary, today } = useApp();
  const ds = useDeferredValue(s);
  const result = useMemo(() => runPlan(summary, ds, ds.strategy, today), [summary, ds, today]);
  const start = ds.startDate && ds.startDate >= today ? ds.startDate : today;
  const series = summary.views.filter((v) => v.balance > 0.005).map((v) => ({ key: v.account.id, name: v.account.name, color: v.account.color }));
  const chart = result.periods.map((p) => ({ date: p.date, ...p.balances }));
  const exportCSV = () => {
    const accts = summary.views.filter((v) => v.balance > 0.005);
    const rows = result.periods.map((p) => {
      const r: Record<string, unknown> = { date: p.date, total_payment: p.totalPayment.toFixed(2), total_interest: p.totalInterest.toFixed(2), total_balance: p.totalBalance.toFixed(2) };
      for (const v of accts) {
        r[`${v.account.name} payment`] = (p.payments[v.account.id] ?? 0).toFixed(2);
        r[`${v.account.name} balance`] = (p.balances[v.account.id] ?? 0).toFixed(2);
      }
      return r;
    });
    saveFile(`repayment-plan-${ds.strategy}.csv`, toCSV(rows), 'text/csv');
  };
  return (
    <>
      <PlanInputs s={s} update={update} />
      <Card className="p-4">
        {result.minimumShortfall && <Notice tone="bad" className="mb-3">Your budget is below the total required minimum payments ({money(result.totalMinimumFirstMonth)}). Some accounts would be underpaid.</Notice>}
        {!result.amortizing && !result.minimumShortfall && <Notice tone="bad" className="mb-3">At this budget the debt never reaches zero — the payments don’t cover the interest.</Notice>}
        <div className="text-xs text-subtle">Estimated debt-free date</div>
        <div className={cn('text-[30px] font-bold leading-tight', result.amortizing ? 'text-good' : 'text-bad')}>{result.debtFreeDate ? date(result.debtFreeDate) : 'Never'}</div>
        <div className="text-sm text-subtle">{result.amortizing ? `${duration(monthsUntil(start, result.debtFreeDate))} from ${date(start)}` : '—'}</div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Future interest" value={result.amortizing ? money(result.totalInterest) : '—'} tone="bad" sub="Estimate" />
          <Stat label="Principal repaid" value={money(result.totalPrincipal)} />
          <Stat label="Total paid" value={result.amortizing ? money(result.totalPaid) : '—'} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Payoff order" action={<Button size="sm" variant="outline" onClick={exportCSV}><Download size={14} /> CSV</Button>} />
        <div className="divide-y divide-border">
          {[...result.accounts]
            .sort((a, b) => (a.payoffDate ?? '9999').localeCompare(b.payoffDate ?? '9999'))
            .map((r, i) => {
              const v = summary.views.find((x) => x.account.id === r.id)!;
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.account.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="text-xs text-subtle">
                      {money(r.startBalance)} · interest {money(r.totalInterest)}
                    </div>
                  </div>
                  <div className="text-right text-sm">{r.payoffDate ? date(r.payoffDate) : <Badge tone="bad">Never</Badge>}</div>
                </div>
              );
            })}
        </div>
      </Card>
      <Card>
        <CardHeader title="Balances over time" />
        <div className="px-2 pb-3">
          <BalanceArea data={chart} series={series} />
        </div>
      </Card>
    </>
  );
}

function Compare({ s }: { s: PlanSettings }) {
  const { summary, today } = useApp();
  const ds = useDeferredValue(s);
  const results = useMemo(() => {
    const strategies: Strategy[] = ['avalanche', 'snowball', 'custom', 'minimum'];
    return strategies.map((st) => ({ st, r: runPlan(summary, ds, st, today) }));
  }, [summary, ds, today]);
  const baseline = results.find((x) => x.st === 'minimum')!.r;
  const finite = results.filter((x) => x.st !== 'minimum' && x.r.amortizing);
  const best = finite.length ? finite.reduce((a, b) => (a.r.totalInterest <= b.r.totalInterest ? a : b)).st : null;
  const months = (r: PlanResult) => monthsUntil(today, r.debtFreeDate);
  return (
    <>
      <Card className="p-4 text-sm text-subtle">
        Same budget for every strategy: <span className="font-medium text-ink">{money(s.monthlyBudget + s.extraMonthly)}/month</span>
        {s.oneTimeAmount > 0 && <> plus a one-time {money(s.oneTimeAmount)}</>}. Savings are measured against paying only the minimums.
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {results.map(({ st, r }) => {
          const timeSaved = baseline.amortizing && r.amortizing ? (months(baseline) ?? 0) - (months(r) ?? 0) : null;
          return (
            <Card key={st} className={cn('p-4', best === st && 'ring-2 ring-good/50')}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">{STRATEGY_LABEL[st]}</div>
                {best === st && <Badge tone="good">Lowest interest</Badge>}
                {st === 'minimum' && <Badge>Baseline</Badge>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat label="Debt-free" value={r.debtFreeDate ? date(r.debtFreeDate) : 'Never'} tone={r.amortizing ? undefined : 'bad'} sub={r.amortizing ? duration(months(r)) : undefined} />
                <Stat label="Total interest" value={r.amortizing ? money(r.totalInterest) : '—'} />
                <Stat label="Total repaid" value={r.amortizing ? money(r.totalPaid) : '—'} />
                {st !== 'minimum' && (
                  <Stat
                    label="Saved vs minimums"
                    tone="good"
                    value={!r.amortizing ? '—' : baseline.amortizing ? money(baseline.totalInterest - r.totalInterest) : 'Pays off'}
                    sub={timeSaved !== null ? `${duration(timeSaved)} sooner` : r.amortizing && !baseline.amortizing ? 'Minimums alone never do' : undefined}
                  />
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {finite.length > 1 && (
        <Card className="p-4 text-sm">
          {(() => {
            const a = results.find((x) => x.st === 'avalanche')!.r;
            const sn = results.find((x) => x.st === 'snowball')!.r;
            if (!a.amortizing || !sn.amortizing) return null;
            const diff = sn.totalInterest - a.totalInterest;
            return (
              <>
                Avalanche {diff >= 0 ? 'saves' : 'costs'} <span className="font-semibold">{money(Math.abs(diff))}</span> in interest compared to snowball
                {(months(sn) ?? 0) !== (months(a) ?? 0) && <> and finishes {duration(Math.abs((months(sn) ?? 0) - (months(a) ?? 0)))} {(months(a) ?? 0) < (months(sn) ?? 0) ? 'sooner' : 'later'}</>}.
              </>
            );
          })()}
        </Card>
      )}
    </>
  );
}

// ---------------- scenarios ----------------

function Scenarios({ s }: { s: PlanSettings }) {
  const { data, summary, today } = useApp();
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const baseCfg: ScenarioConfig = { ...emptyScenario(s.monthlyBudget), extraMonthly: s.extraMonthly, strategy: s.strategy, customAllocations: s.customAllocations };
  const chosen = selected ?? data.scenarios.slice(0, 3).map((x) => x.id);
  const results = useMemo(() => {
    const base = { id: 'base', name: 'Current plan', r: runScenario(summary, baseCfg, today) };
    return [base, ...data.scenarios.filter((x) => chosen.includes(x.id)).map((x) => ({ id: x.id, name: x.name, r: runScenario(summary, x.config, today) }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, data.scenarios, chosen.join(), s, today]);
  const base = results[0].r;
  const colors = ['#7457b8', '#3f8f9e', '#d9895b', '#cc5f93', '#5a74c2', '#6aa874'];
  const chartData = useMemo(() => {
    const len = Math.min(240, Math.max(...results.map((x) => x.r.periods.length)));
    return Array.from({ length: len }, (_, i) => {
      const row: Record<string, unknown> = { date: results.find((x) => x.r.periods[i])?.r.periods[i].date };
      for (const x of results) row[x.id] = x.r.periods[i]?.totalBalance ?? 0;
      return row;
    });
  }, [results]);
  const months = (r: PlanResult) => monthsUntil(today, r.debtFreeDate);

  return (
    <>
      <Card>
        <CardHeader
          title="Scenarios"
          subtitle="Hypotheticals never touch your real accounts."
          action={
            <Button size="sm" onClick={() => setEditing({ id: uid(), name: 'New scenario', createdAt: Date.now(), config: baseCfg })}>
              <Plus size={16} /> New
            </Button>
          }
        />
        {data.scenarios.length === 0 && <Empty>Try “What if my LOC rate goes up 1%?” or “What if I pay $500 more each month?”</Empty>}
        <div className="divide-y divide-border">
          {data.scenarios.map((x) => (
            <div key={x.id} className="flex items-center gap-2 px-4 py-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={chosen.includes(x.id)}
                onChange={(e) => setSelected(e.target.checked ? [...chosen, x.id] : chosen.filter((c) => c !== x.id))}
              />
              <div className="min-w-0 flex-1 truncate text-sm">{x.name}</div>
              <Button variant="ghost" size="icon" onClick={() => setEditing(x)} aria-label="Edit">
                <Pencil size={15} />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => confirm(`Delete scenario “${x.name}”?`) && deleteScenario(x.id)}>
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Side by side" />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-y border-border text-xs text-subtle">
                <th className="sticky left-0 bg-card px-4 py-2 text-left font-medium"> </th>
                {results.map((x, i) => (
                  <th key={x.id} className="min-w-32 px-3 py-2 text-right font-medium">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colors[i % colors.length] }} />
                    {x.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { l: 'Debt-free', f: (r: PlanResult) => (r.debtFreeDate ? date(r.debtFreeDate) : 'Never') },
                { l: 'Time', f: (r: PlanResult) => (r.amortizing ? duration(months(r)) : '—') },
                { l: 'Total interest', f: (r: PlanResult) => (r.amortizing ? money(r.totalInterest) : '—') },
                { l: 'Total paid', f: (r: PlanResult) => (r.amortizing ? money(r.totalPaid) : '—') },
                {
                  l: 'Interest vs current',
                  f: (r: PlanResult) => (r.amortizing && base.amortizing ? money(r.totalInterest - base.totalInterest, { sign: true }) : '—'),
                  tone: (r: PlanResult) => (r.totalInterest < base.totalInterest - 0.005 ? 'text-good' : r.totalInterest > base.totalInterest + 0.005 ? 'text-bad' : ''),
                },
                {
                  l: 'Time vs current',
                  f: (r: PlanResult) => {
                    if (!r.amortizing || !base.amortizing) return '—';
                    const d = (months(r) ?? 0) - (months(base) ?? 0);
                    return d === 0 ? 'Same' : `${duration(Math.abs(d))} ${d < 0 ? 'sooner' : 'later'}`;
                  },
                  tone: (r: PlanResult) => ((months(r) ?? 0) < (months(base) ?? 0) ? 'text-good' : (months(r) ?? 0) > (months(base) ?? 0) ? 'text-bad' : ''),
                },
              ].map((row) => (
                <tr key={row.l} className="border-b border-border/60">
                  <td className="sticky left-0 bg-card px-4 py-2 text-subtle whitespace-nowrap">{row.l}</td>
                  {results.map((x) => (
                    <td key={x.id} className={cn('px-3 py-2 text-right whitespace-nowrap', row.tone?.(x.r))}>
                      {row.f(x.r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-2 py-3">
          <Lines data={chartData} series={results.map((x, i) => ({ key: x.id, name: x.name, color: colors[i % colors.length] }))} />
        </div>
      </Card>
      {editing && <ScenarioSheet scenario={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ScenarioSheet({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const { data, today } = useApp();
  const [name, setName] = useState(scenario.name);
  const [c, setC] = useState<ScenarioConfig>(scenario.config);
  const set = (p: Partial<ScenarioConfig>) => setC((x) => ({ ...x, ...p }));
  const accts = data.accounts;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Scenario"
      footer={
        <Button
          className="flex-1"
          onClick={async () => {
            await saveScenario({ ...scenario, name: name.trim() || 'Scenario', config: c });
            onClose();
          }}
        >
          Save scenario
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly budget">
            <NumberInput value={c.monthlyBudget} onChange={(n) => set({ monthlyBudget: n ?? 0 })} prefix="$" />
          </Field>
          <Field label="Extra per month">
            <NumberInput value={c.extraMonthly} onChange={(n) => set({ extraMonthly: n ?? 0 })} prefix="$" />
          </Field>
        </div>
        <Field label="Strategy">
          <Segmented value={c.strategy} onChange={(v) => set({ strategy: v })} options={[{ value: 'avalanche', label: 'Avalanche' }, { value: 'snowball', label: 'Snowball' }, { value: 'custom', label: 'Custom' }]} />
        </Field>

        <ListEditor
          title="Interest rate changes"
          addLabel="Add rate change"
          items={c.rateChanges}
          onChange={(rateChanges) => set({ rateChanges })}
          make={() => ({ accountId: accts[0]?.id ?? 'all', delta: 1, effectiveDate: today })}
          render={(r, upd) => (
            <>
              <Select value={r.accountId} onChange={(e) => upd({ accountId: e.target.value })}>
                <option value="all">All accounts</option>
                {accts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <div className="flex gap-2">
                <NumberInput className="w-28" value={r.delta} onChange={(n) => upd({ delta: n ?? 0 })} suffix="pts" />
                <Input type="date" value={r.effectiveDate} onChange={(e) => upd({ effectiveDate: e.target.value })} />
              </div>
            </>
          )}
        />
        <ListEditor
          title="One-time extra payments"
          addLabel="Add payment"
          items={c.oneTimePayments}
          onChange={(oneTimePayments) => set({ oneTimePayments })}
          make={() => ({ date: today, amount: 1000 })}
          render={(r, upd) => (
            <div className="flex gap-2">
              <NumberInput className="w-36" value={r.amount} onChange={(n) => upd({ amount: n ?? 0 })} prefix="$" />
              <Input type="date" value={r.date} onChange={(e) => upd({ date: e.target.value })} />
            </div>
          )}
        />
        <ListEditor
          title="Future withdrawals / new borrowing"
          addLabel="Add withdrawal"
          items={c.futureDraws}
          onChange={(futureDraws) => set({ futureDraws })}
          make={() => ({ accountId: accts[0]?.id ?? '', date: today, amount: 1000 })}
          render={(r, upd) => (
            <>
              <Select value={r.accountId} onChange={(e) => upd({ accountId: e.target.value })}>
                {accts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <div className="flex gap-2">
                <NumberInput className="w-36" value={r.amount} onChange={(n) => upd({ amount: n ?? 0 })} prefix="$" />
                <Input type="date" value={r.date} onChange={(e) => upd({ date: e.target.value })} />
              </div>
            </>
          )}
        />
        <div>
          <div className="mb-1 text-xs font-medium text-subtle">Pay off immediately (lump sum from outside the budget)</div>
          {accts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={c.payoffNow.includes(a.id)}
                onChange={(e) => set({ payoffNow: e.target.checked ? [...c.payoffNow, a.id] : c.payoffNow.filter((x) => x !== a.id) })}
              />
              {a.name}
            </label>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function ListEditor<T>({
  title,
  addLabel,
  items,
  onChange,
  make,
  render,
}: {
  title: string;
  addLabel: string;
  items: T[];
  onChange: (v: T[]) => void;
  make: () => T;
  render: (item: T, update: (p: Partial<T>) => void) => React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-subtle">{title}</div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
            <div className="flex-1 space-y-2">{render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}</div>
            <Button variant="ghost" size="icon" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => onChange([...items, make()])}>
          <Plus size={14} /> {addLabel}
        </Button>
      </div>
    </div>
  );
}
