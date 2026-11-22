import { useMemo, useState } from 'react';
import { useApp, PageHeader } from '@/App';
import { Card, CardHeader, Segmented, Input, Field, Stat } from '@/components/ui';
import { BalanceArea, Bars, Lines } from '@/components/charts';
import { historySeries } from '@/lib/compute';
import { replayLedger, addMonths, toDay, fromDay } from '@/engine';
import { money, date } from '@/lib/format';

type Range = '1m' | '3m' | '6m' | '1y' | 'all';

export function History() {
  const { data, today } = useApp();
  const [range, setRange] = useState<Range>('1y');
  const [snap, setSnap] = useState(fromDay(addMonths(toDay(today), -3)));
  const all = useMemo(() => historySeries(data, today), [data, today]);
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, all: 9999 }[range];
  const rows = all.slice(-Math.max(months + 1, 2));
  const series = data.accounts.map((a) => ({ key: a.id, name: a.name, color: a.color }));
  const totals = rows.reduce<{ interest: number; payments: number; principal: number }>(
    (t, r) => ({ interest: t.interest + Number(r.interest), payments: t.payments + Number(r.payments), principal: t.principal + Number(r.principalReduction) }),
    { interest: 0, payments: 0, principal: 0 },
  );
  const snapshot = useMemo(
    () =>
      data.accounts.map((a) => {
        const l = replayLedger(a.openingBalance, a.openingBalanceDate, data.transactions.filter((t) => t.accountId === a.id), snap);
        return { a, balance: a.openingBalanceDate <= snap ? l.balance.toNumber() : 0 };
      }),
    [data, snap],
  );

  return (
    <div className="space-y-3">
      <PageHeader title="History" subtitle="Actual recorded figures only — no estimates." back="more" />
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: '1m', label: '1M' },
          { value: '3m', label: '3M' },
          { value: '6m', label: '6M' },
          { value: '1y', label: '1Y' },
          { value: 'all', label: 'All' },
        ]}
      />
      <Card className="grid grid-cols-3 gap-3 p-4">
        <Stat label="Payments" value={money(totals.payments)} />
        <Stat label="Interest charged" value={money(totals.interest)} tone="bad" />
        <Stat label="Net principal reduction" value={money(totals.principal)} tone={totals.principal >= 0 ? 'good' : 'bad'} />
      </Card>
      <Card>
        <CardHeader title="Total debt (month end)" />
        <div className="px-2 pb-3">
          <BalanceArea data={rows} series={[{ key: 'total', name: 'Total debt', color: '#7a5fc0' }]} stacked={false} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Balance by account" />
        <div className="px-2 pb-3">
          <Lines data={rows} series={series} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Monthly payments, interest & principal reduction" />
        <div className="px-2 pb-3">
          <Bars
            data={rows}
            series={[
              { key: 'payments', name: 'Payments', color: '#7a5fc0' },
              { key: 'interest', name: 'Interest', color: '#c8364a' },
              { key: 'principalReduction', name: 'Principal reduction', color: '#1f8f55' },
            ]}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Snapshot" subtitle="Your recorded debt position on any date" />
        <div className="px-4 pb-2">
          <Field label="Date">
            <Input type="date" value={snap} max={today} onChange={(e) => setSnap(e.target.value)} />
          </Field>
        </div>
        <div className="divide-y divide-border">
          {snapshot.map(({ a, balance }) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
              <span className="flex-1 truncate">{a.name}</span>
              <span className="font-medium tabular-nums">{money(balance)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
            <span>Total on {date(snap)}</span>
            <span className="tabular-nums">{money(snapshot.reduce((s, x) => s + x.balance, 0))}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
