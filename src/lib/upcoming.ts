import { DEFAULT_REMINDERS, type PaymentRecord, type ReminderSettings, type Schedule } from '@/db/db';
import { addMonths, fromDay, monthlyDueDates, occurrences, reminderDay, toDay, buildICS, type CalendarEntry } from '@/engine';
import type { AppData, AccountView, Summary } from './compute';

/** One payment that is due: an account's regular due date or an occurrence of a scheduled payment. */
export interface UpcomingItem {
  key: string;
  kind: 'due' | 'scheduled';
  date: string;
  name: string;
  accountId: string | null;
  color: string;
  view?: AccountView;
  schedule?: Schedule;
  /** Required minimum (account due dates only). */
  minimum: number;
  /** Amount expected to be paid. */
  amount: number;
  remindDays: number;
  paid?: PaymentRecord;
}

export function reminderSettings(data: AppData): ReminderSettings {
  return { ...DEFAULT_REMINDERS, ...(data.settings.reminders as Partial<ReminderSettings> | undefined) };
}

export function accountRemindDays(view: AccountView, rs: ReminderSettings) {
  return view.account.remindDaysBefore ?? rs.defaultDays;
}

/** All payments due within [from, to], sorted by date. */
export function upcomingItems(summary: Summary, data: AppData, from: string, to: string, today: string): UpcomingItem[] {
  const rs = reminderSettings(data);
  const out: UpcomingItem[] = [];
  for (const v of summary.views) {
    const a = v.account;
    for (const iso of monthlyDueDates(a.dueDay, from, to)) {
      const paid = data.payments.find((p) => p.accountId === a.id && !p.scheduleId && p.dueDate === iso);
      if (v.balance <= 0.005 && !paid) continue;
      const row = v.projection.rows.find((r) => r.date === iso && r.minimum !== undefined);
      const minimum = row?.minimum ?? (iso >= today ? v.minimum : 0);
      const planned = a.payInFull
        ? v.projection.rows.find((r) => r.date === iso && r.kind === 'payment')?.payment ?? (iso >= today ? v.balance : minimum)
        : a.plannedPayment && a.plannedPayment > 0
          ? a.plannedPayment
          : minimum;
      out.push({ key: `due:${a.id}:${iso}`, kind: 'due', date: iso, name: a.name, accountId: a.id, color: a.color, view: v, minimum, amount: planned, remindDays: accountRemindDays(v, rs), paid });
    }
  }
  for (const s of data.schedules) {
    const v = s.accountId ? summary.views.find((x) => x.account.id === s.accountId) : undefined;
    for (const iso of occurrences(s, from, to)) {
      const paid = data.payments.find((p) => p.scheduleId === s.id && p.dueDate === iso);
      out.push({
        key: `sch:${s.id}:${iso}`,
        kind: 'scheduled',
        date: iso,
        name: s.name,
        accountId: s.accountId,
        color: v?.account.color ?? '#8a8299',
        view: v,
        schedule: s,
        minimum: 0,
        amount: s.amount,
        remindDays: s.remindDaysBefore ?? rs.defaultDays,
        paid,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Unpaid items whose reminder window has started (plus up to 7 days overdue). */
export function activeReminders(summary: Summary, data: AppData, today: string): UpcomingItem[] {
  const rs = reminderSettings(data);
  if (!rs.enabled) return [];
  const from = fromDay(toDay(today) - 7);
  const to = fromDay(toDay(today) + 60);
  return upcomingItems(summary, data, from, to, today).filter((i) => !i.paid && reminderDay(i.date, i.remindDays) <= today);
}

/** Calendar file with every account due date and scheduled payment, each with its reminder. */
export function remindersICS(summary: Summary, data: AppData, today: string): string {
  const rs = reminderSettings(data);
  const entries: CalendarEntry[] = [];
  for (const v of summary.views) {
    if (v.balance <= 0.005) continue;
    const a = v.account;
    const first = monthlyDueDates(a.dueDay, today, fromDay(addMonths(toDay(today), 2)))[0];
    entries.push({
      uid: `due-${a.id}@debt-tracker`,
      title: `${a.name} payment due`,
      description: `Minimum about $${v.minimum.toFixed(2)}${a.payInFull ? ', paying the full balance' : a.plannedPayment ? `, planned $${a.plannedPayment.toFixed(2)}` : ''} (as of ${today}). Check the app for current amounts.`,
      startDate: first,
      frequency: 'monthly',
      dayOfMonth: a.dueDay,
      remindDaysBefore: accountRemindDays(v, rs),
    });
  }
  for (const s of data.schedules) {
    if (s.endDate && s.endDate < today) continue;
    if (s.frequency === 'once' && s.startDate < today) continue;
    entries.push({
      uid: `sch-${s.id}@debt-tracker`,
      title: `${s.name}: $${s.amount.toFixed(2)}`,
      description: s.notes,
      startDate: s.startDate,
      frequency: s.frequency,
      endDate: s.endDate,
      remindDaysBefore: s.remindDaysBefore ?? rs.defaultDays,
    });
  }
  return buildICS(entries, 'Debt payments');
}
