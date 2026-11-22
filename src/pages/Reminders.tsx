import { useState } from 'react';
import { Plus, CalendarPlus, Repeat, Bell, Pencil } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, CardHeader, Button, Field, Input, NumberInput, Select, Sheet, Notice, Empty } from '@/components/ui';
import { saveSchedule, deleteSchedule, setSetting, saveAccount } from '@/db/actions';
import { uid, type Schedule, type ReminderSettings } from '@/db/db';
import { reminderSettings, remindersICS, upcomingItems } from '@/lib/upcoming';
import { canScheduleNotifications } from '@/lib/notify';
import { saveFile, isStandalone } from '@/lib/files';
import { money, date } from '@/lib/format';
import { fromDay, toDay, type RecurFrequency } from '@/engine';

export const FREQ_LABELS: Record<RecurFrequency, string> = {
  once: 'One time',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

const DAY_OPTIONS = [0, 1, 2, 3, 5, 7, 10, 14];
const shortLabel = (n: number) => (n === 0 ? 'same day' : `${n} day${n > 1 ? 's' : ''}`);
const dayLabel = (n: number) => (n === 0 ? 'On the day' : n === 1 ? '1 day before' : `${n} days before`);

export function Reminders() {
  const { data, summary, today } = useApp();
  const rs = reminderSettings(data);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const native = canScheduleNotifications();
  const setRs = (p: Partial<ReminderSettings>) => setSetting('reminders', { ...rs, ...p });
  const next = upcomingItems(summary, data, fromDay(toDay(today) + 1), fromDay(toDay(today) + 365), today);
  const nextFor = (id: string) => next.find((i) => i.schedule?.id === id)?.date;

  return (
    <div className="space-y-3">
      <PageHeader title="Reminders" subtitle="Get reminded before payments are due." back="calendar" />

      <Card>
        <CardHeader title="Payment reminders" />
        <div className="space-y-3 px-4 pb-4">
          <label className="flex items-center justify-between gap-3 text-[15px]">
            <span className="flex items-center gap-2 font-medium">
              <Bell size={17} className="text-brand" /> Reminders on
            </span>
            <input type="checkbox" className="h-5 w-5" checked={rs.enabled} onChange={(e) => setRs({ enabled: e.target.checked })} />
          </label>
          <Field label="Remind me (default for every payment)">
            <Select value={String(rs.defaultDays)} onChange={(e) => setRs({ defaultDays: Number(e.target.value) })}>
              {DAY_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {dayLabel(n)}
                </option>
              ))}
            </Select>
          </Field>
          {!native && (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Show count on the app icon
                <span className="block text-xs text-subtle">Home-screen app; updates when you open it.</span>
              </span>
              <input type="checkbox" className="h-5 w-5" checked={rs.badge} onChange={(e) => setRs({ badge: e.target.checked })} />
            </label>
          )}
          {native ? (
            <Notice tone="good">Notifications are scheduled on this iPhone and arrive at 9:00 am, even when the app is closed.</Notice>
          ) : (
            <Notice tone="info">
              Due payments appear under “Coming up” on the home screen. For alerts while the app is closed, add them to your iPhone Calendar below. It’s a one-time step;
              redo it only when you change due dates or scheduled payments.
            </Notice>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Per account" subtitle="Override the default for specific accounts." />
        <div className="divide-y divide-border">
          {summary.views.map((v) => (
            <div key={v.account.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: v.account.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{v.account.name}</div>
                <div className="text-xs text-subtle">Due on day {v.account.dueDay}</div>
              </div>
              <Select
                className="w-40 shrink-0"
                value={v.account.remindDaysBefore == null ? 'default' : String(v.account.remindDaysBefore)}
                onChange={(e) => saveAccount({ ...v.account, remindDaysBefore: e.target.value === 'default' ? null : Number(e.target.value) })}
              >
                <option value="default">Default · {shortLabel(rs.defaultDays)}</option>
                {DAY_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {dayLabel(n)}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </Card>

      {!native && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
              <CalendarPlus size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold">Add to iPhone Calendar</div>
              <p className="mt-0.5 text-[13px] text-subtle">
                Creates repeating events for every due date and scheduled payment, each with an alert {rs.defaultDays > 0 ? `${rs.defaultDays} day${rs.defaultDays > 1 ? 's' : ''} before` : 'on the day'} (or
                your per-payment setting). {isStandalone() ? 'Choose Calendar in the share sheet, then tap Add All.' : 'Open the file, then tap Add All.'}
              </p>
              <Button className="mt-3" onClick={() => saveFile('debt-payment-reminders.ics', remindersICS(summary, data, today), 'text/calendar')}>
                <CalendarPlus size={16} /> Add reminders to Calendar
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Scheduled payments"
          subtitle="One-off or recurring payments you make yourself, e.g. an extra $50 every payday."
          action={
            <Button
              size="sm"
              onClick={() =>
                setEditing({
                  id: uid(),
                  name: '',
                  accountId: data.accounts[0]?.id ?? null,
                  amount: 0,
                  frequency: 'monthly',
                  startDate: fromDay(toDay(today) + 1),
                  endDate: null,
                  remindDaysBefore: null,
                  includeInProjection: true,
                  createdAt: Date.now(),
                })
              }
            >
              <Plus size={16} /> Add
            </Button>
          }
        />
        {data.schedules.length === 0 && <Empty>No scheduled payments yet.</Empty>}
        <div className="divide-y divide-border">
          {data.schedules.map((s) => {
            const acct = data.accounts.find((a) => a.id === s.accountId);
            const nx = nextFor(s.id);
            return (
              <button key={s.id} onClick={() => setEditing(s)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${acct?.color ?? '#8a8299'}1f`, color: acct?.color ?? '#8a8299' }}>
                  <Repeat size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{s.name || 'Payment'}</div>
                  <div className="truncate text-xs text-subtle">
                    {FREQ_LABELS[s.frequency]} · {acct?.name ?? 'Not a tracked debt'}
                  </div>
                  <div className="text-xs text-subtle">{nx ? `Next ${date(nx)}` : 'No upcoming dates'}{s.includeInProjection && acct ? ' · in projections' : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-bold tabular-nums">{money(s.amount)}</div>
                  <Pencil size={13} className="ml-auto mt-1 text-subtle" />
                </div>
              </button>
            );
          })}
        </div>
      </Card>
      {editing && <ScheduleSheet schedule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ScheduleSheet({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const { data } = useApp();
  const rs = reminderSettings(data);
  const [s, setS] = useState<Schedule>(schedule);
  const [err, setErr] = useState('');
  const isNew = !data.schedules.some((x) => x.id === schedule.id);
  const set = (p: Partial<Schedule>) => setS((x) => ({ ...x, ...p }));
  const save = async () => {
    if (!s.accountId && !s.name.trim()) return setErr('Give this payment a name.');
    if (!(s.amount > 0)) return setErr('Enter an amount greater than zero.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.startDate)) return setErr('Enter a valid date.');
    if (s.endDate && s.endDate < s.startDate) return setErr('The end date is before the start date.');
    const acct = data.accounts.find((a) => a.id === s.accountId);
    await saveSchedule({ ...s, name: s.name.trim() || `Payment to ${acct?.name ?? 'account'}` });
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'New scheduled payment' : 'Scheduled payment'}
      footer={
        <>
          {!isNew && (
            <Button
              variant="outline"
              className="text-bad"
              onClick={async () => {
                if (confirm('Delete this scheduled payment? Past payments you recorded stay in your history.')) {
                  await deleteSchedule(s.id);
                  onClose();
                }
              }}
            >
              Delete
            </Button>
          )}
          <Button className="flex-1" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Pays toward">
          <Select value={s.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || null })}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value="">Something else (reminder only)</option>
          </Select>
        </Field>
        <Field label="Name" hint={s.accountId ? 'Optional' : undefined}>
          <Input value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Extra payday payment" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <NumberInput value={s.amount || null} onChange={(n) => set({ amount: n ?? 0 })} prefix="$" />
          </Field>
          <Field label="Repeats">
            <Select value={s.frequency} onChange={(e) => set({ frequency: e.target.value as RecurFrequency })}>
              {Object.entries(FREQ_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={s.frequency === 'once' ? 'Date' : 'First payment'}>
            <Input type="date" value={s.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </Field>
          {s.frequency !== 'once' && (
            <Field label="Ends (optional)">
              <Input type="date" value={s.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} />
            </Field>
          )}
        </div>
        <Field label="Remind me">
          <Select value={s.remindDaysBefore == null ? 'default' : String(s.remindDaysBefore)} onChange={(e) => set({ remindDaysBefore: e.target.value === 'default' ? null : Number(e.target.value) })}>
            <option value="default">Default · {shortLabel(rs.defaultDays)}</option>
            {DAY_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {dayLabel(n)}
              </option>
            ))}
          </Select>
        </Field>
        {s.accountId && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={s.includeInProjection} onChange={(e) => set({ includeInProjection: e.target.checked })} />
            <span>
              Include in payoff projections
              <span className="block text-xs text-subtle">Counted as an extra payment on top of the account’s planned payment.</span>
            </span>
          </label>
        )}
        <Field label="Notes (optional)">
          <Input value={s.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        {err && <Notice tone="bad">{err}</Notice>}
        {!isNew && <p className="text-xs text-subtle">Mark each payment as paid from the Calendar or the home screen.</p>}
      </div>
    </Sheet>
  );
}
