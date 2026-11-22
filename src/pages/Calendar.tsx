import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, BellRing, Repeat } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, Button, Badge } from '@/components/ui';
import { MarkPaidSheet } from '@/components/MarkPaidSheet';
import { money, date, cn } from '@/lib/format';
import { dayOf, fromDay, toDay, ymd, daysInMonth } from '@/engine';
import { upcomingItems, type UpcomingItem } from '@/lib/upcoming';

export function Calendar() {
  const { summary, data, today, go } = useApp();
  const t = ymd(toDay(today));
  const [ym, setYm] = useState({ y: t.y, m: t.m });
  const [sel, setSel] = useState<UpcomingItem | null>(null);
  const first = dayOf(ym.y, ym.m, 1);
  const nDays = daysInMonth(ym.y, ym.m);
  const items = useMemo(() => upcomingItems(summary, data, fromDay(first), fromDay(first + nDays - 1), today), [summary, data, first, nDays, today]);
  const lead = new Date(first * 86400000).getUTCDay();
  const monthName = new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(first * 86400000));
  const shift = (n: number) => setYm(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }));
  const current = sel ? items.find((i) => i.key === sel.key) ?? sel : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Payment calendar"
        subtitle="Mark payments as made. Nothing is marked automatically."
        action={
          <Button size="sm" onClick={() => go('reminders')}>
            <BellRing size={15} /> Reminders
          </Button>
        }
      />
      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={18} />
          </Button>
          <div className="font-bold">{monthName}</div>
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
            const day = items.filter((d) => d.date === iso);
            return (
              <div key={iso} className={cn('min-h-12 rounded-lg p-1 text-[11px]', iso === today ? 'bg-brand/10' : '')}>
                <div className={cn('text-right', iso === today ? 'font-bold text-brand' : 'text-subtle')}>{i + 1}</div>
                <div className="flex flex-wrap justify-center gap-0.5">
                  {day.map((d) => (
                    <button
                      key={d.key}
                      onClick={() => setSel(d)}
                      className={cn('h-2.5 w-2.5', d.kind === 'scheduled' ? 'rounded-[3px]' : 'rounded-full')}
                      style={{ background: d.paid ? 'var(--color-good)' : d.color }}
                      aria-label={d.name}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 px-1 text-[11px] text-subtle">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand" /> Account due date</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[2px] bg-brand" /> Scheduled payment</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-good" /> Paid</span>
        </div>
      </Card>
      <Card>
        <div className="divide-y divide-border">
          {items.length === 0 && <div className="p-6 text-center text-sm text-subtle">No payments due this month.</div>}
          {items.map((d) => <UpcomingRow key={d.key} item={d} onClick={() => setSel(d)} />)}
        </div>
      </Card>
      {current && <MarkPaidSheet item={current} onClose={() => setSel(null)} />}
    </div>
  );
}

export function UpcomingRow({ item: d, onClick }: { item: UpcomingItem; onClick: () => void }) {
  const { today } = useApp();
  const overdue = !d.paid && d.date < today;
  const daysAway = toDay(d.date) - toDay(today);
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted">
      <div className="w-11 shrink-0 text-center">
        <div className="text-[11px] uppercase text-subtle">{date(d.date).split(' ')[0]}</div>
        <div className="text-lg font-bold leading-none">{Number(d.date.slice(8))}</div>
      </div>
      <span className="h-8 w-1 rounded-full" style={{ background: d.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 truncate text-[15px] font-semibold">
          {d.kind === 'scheduled' && <Repeat size={13} className="shrink-0 text-subtle" />}
          <span className="truncate">{d.name}</span>
        </div>
        <div className="text-xs text-subtle">
          {d.minimum > 0 && <>Min {money(d.minimum)} · </>}
          {d.kind === 'due' ? 'Planned' : 'Amount'} {money(d.amount)}
        </div>
      </div>
      {d.paid ? (
        <Badge tone="good">Paid</Badge>
      ) : overdue ? (
        <Badge tone="bad">Not marked</Badge>
      ) : daysAway <= d.remindDays ? (
        <Badge tone="warn">{daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`}</Badge>
      ) : (
        <Badge>Upcoming</Badge>
      )}
    </button>
  );
}
