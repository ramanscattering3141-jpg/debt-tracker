import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, Button, Badge, Sheet, Field, Input, NumberInput, Notice } from '@/components/ui';
import { money, date, cn } from '@/lib/format';
import { dayOf, fromDay, toDay, ymd, daysInMonth } from '@/engine';
import { markPaid, unmarkPaid } from '@/db/actions';
import type { PaymentRecord } from '@/db/db';
import type { AccountView } from '@/lib/compute';

interface Due {
  view: AccountView;
  date: string;
  minimum: number;
  planned: number;
  paid?: PaymentRecord;
}

export function Calendar() {
  const { summary, data, today } = useApp();
  const t = ymd(toDay(today));
  const [ym, setYm] = useState({ y: t.y, m: t.m });
  const [sel, setSel] = useState<Due | null>(null);

  const dues = useMemo(() => {
    const out: Due[] = [];
    const first = dayOf(ym.y, ym.m, 1);
    const last = dayOf(ym.y, ym.m, daysInMonth(ym.y, ym.m));
    for (const v of summary.views) {
      const a = v.account;
      const dates: number[] = [];
      const monthlyDue = dayOf(ym.y, ym.m, a.dueDay);
      if (a.frequency === 'monthly' || !a.plannedPayment) dates.push(monthlyDue);
      else {
        const step = a.frequency === 'weekly' ? 7 : 14;
        // anchor: first projected payment date
        const anchorRow = v.projection.rows.find((r) => r.kind === 'payment');
        let d = anchorRow ? toDay(anchorRow.date) : monthlyDue;
        while (d > first) d -= step;
        for (; d <= last; d += step) if (d >= first) dates.push(d);
      }
      for (const d of dates) {
        const iso = fromDay(d);
        const projRow = v.projection.rows.find((r) => r.date === iso && r.kind === 'payment');
        const minRow = [...v.projection.rows].filter((r) => r.minimum !== undefined && r.date <= fromDay(dayOf(ym.y, ym.m + 1, a.dueDay))).pop();
        const minimum = a.frequency === 'monthly' || !a.plannedPayment ? projRow?.minimum ?? (iso < today ? 0 : minRow?.minimum ?? v.minimum) : 0;
        const planned = projRow?.payment ?? (a.plannedPayment ?? minimum);
        const paid = data.payments.find((p) => p.accountId === a.id && p.dueDate === iso);
        if (v.balance <= 0.005 && !paid && iso >= today) continue;
        out.push({ view: v, date: iso, minimum, planned, paid });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [summary, data.payments, ym, today]);

  const first = dayOf(ym.y, ym.m, 1);
  const lead = new Date(first * 86400000).getUTCDay();
  const nDays = daysInMonth(ym.y, ym.m);
  const monthName = new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(first * 86400000));
  const shift = (n: number) => setYm(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }));

  return (
    <div className="space-y-3">
      <PageHeader title="Payment calendar" subtitle="Mark payments as made — nothing is marked automatically." />
      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={18} />
          </Button>
          <div className="font-semibold">{monthName}</div>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight size={18} />
          </Button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-subtle">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: lead }).map((_, i) => (
            <div key={`l${i}`} />
          ))}
          {Array.from({ length: nDays }).map((_, i) => {
            const iso = fromDay(first + i);
            const items = dues.filter((d) => d.date === iso);
            return (
              <div key={iso} className={cn('min-h-12 rounded-md p-1 text-[11px]', iso === today ? 'bg-brand/10' : '')}>
                <div className={cn('text-right', iso === today ? 'font-bold text-brand' : 'text-subtle')}>{i + 1}</div>
                <div className="flex flex-wrap justify-center gap-0.5">
                  {items.map((d) => (
                    <button key={d.view.account.id} onClick={() => setSel(d)} className="h-2.5 w-2.5 rounded-full" style={{ background: d.paid ? 'var(--color-good)' : d.view.account.color }} aria-label={d.view.account.name} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <div className="divide-y divide-border">
          {dues.length === 0 && <div className="p-6 text-center text-sm text-subtle">No payments due this month.</div>}
          {dues.map((d) => {
            const overdue = !d.paid && d.date < today;
            return (
              <button key={d.view.account.id + d.date} onClick={() => setSel(d)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60">
                <div className="w-11 shrink-0 text-center">
                  <div className="text-[11px] uppercase text-subtle">{date(d.date).split(' ')[0]}</div>
                  <div className="text-lg font-bold leading-none">{Number(d.date.slice(8))}</div>
                </div>
                <span className="h-8 w-1 rounded-full" style={{ background: d.view.account.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{d.view.account.name}</div>
                  <div className="text-xs text-subtle">
                    {d.minimum > 0 && <>Min {money(d.minimum)} · </>}Planned {money(d.planned)}
                  </div>
                </div>
                {d.paid ? <Badge tone="good">Paid {money(d.paid.amount)}</Badge> : overdue ? <Badge tone="bad">Not marked</Badge> : <Badge>Upcoming</Badge>}
              </button>
            );
          })}
        </div>
      </Card>
      {sel && <MarkSheet due={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function MarkSheet({ due, onClose }: { due: Due; onClose: () => void }) {
  const { today } = useApp();
  const [amount, setAmount] = useState<number | null>(Math.round(due.planned * 100) / 100);
  const [paidDate, setPaidDate] = useState(due.date < today ? due.date : today);
  const [record, setRecord] = useState(true);
  return (
    <Sheet
      open
      onClose={onClose}
      title={due.view.account.name}
      footer={
        due.paid ? (
          <>
            <Button variant="outline" className="flex-1" onClick={async () => { await unmarkPaid(due.paid!.id, false); onClose(); }}>
              Unmark
            </Button>
            {due.paid.transactionId && (
              <Button variant="outline" className="flex-1 text-bad" onClick={async () => { await unmarkPaid(due.paid!.id, true); onClose(); }}>
                Unmark & delete payment
              </Button>
            )}
          </>
        ) : (
          <Button className="flex-1" onClick={async () => { await markPaid(due.view.account.id, due.date, amount ?? 0, paidDate, record); onClose(); }}>
            <Check size={16} /> Mark as paid
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-subtle">Due</div>
            <div className="font-medium">{date(due.date)}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">Minimum</div>
            <div className="font-medium">{money(due.minimum)}</div>
          </div>
          <div>
            <div className="text-xs text-subtle">Planned</div>
            <div className="font-medium">{money(due.planned)}</div>
          </div>
        </div>
        {due.paid ? (
          <Notice tone="good">
            Marked paid on {date(due.paid.paidDate)} — {money(due.paid.amount)}
            {due.paid.transactionId ? ' (payment transaction recorded)' : ''}.
          </Notice>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount paid">
                <NumberInput value={amount} onChange={setAmount} prefix="$" />
              </Field>
              <Field label="Date paid">
                <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={record} onChange={(e) => setRecord(e.target.checked)} />
              <span>
                Also record a payment transaction
                <span className="block text-xs text-subtle">Reduces the balance. Leave unchecked if you already entered it.</span>
              </span>
            </label>
          </>
        )}
      </div>
    </Sheet>
  );
}
