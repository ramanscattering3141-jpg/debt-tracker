import { dayOf, fromDay, toDay, ymd, type ISODate } from './dates';

export type RecurFrequency = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Recurrence {
  frequency: RecurFrequency;
  startDate: ISODate;
  endDate?: ISODate | null;
}

/** All occurrence dates of a recurrence within [from, to] (inclusive). Monthly dates clamp to month end. */
export function occurrences(r: Recurrence, from: ISODate, to: ISODate, limit = 5000): ISODate[] {
  const start = toDay(r.startDate);
  const lo = Math.max(toDay(from), start);
  const hi = Math.min(toDay(to), r.endDate ? toDay(r.endDate) : Infinity);
  if (hi < lo) return [];
  const out: ISODate[] = [];
  if (r.frequency === 'once') return start >= lo && start <= hi ? [r.startDate] : [];
  if (r.frequency === 'weekly' || r.frequency === 'biweekly') {
    const step = r.frequency === 'weekly' ? 7 : 14;
    let d = start + Math.max(0, Math.ceil((lo - start) / step)) * step;
    for (; d <= hi && out.length < limit; d += step) out.push(fromDay(d));
    return out;
  }
  const stepMonths = r.frequency === 'monthly' ? 1 : r.frequency === 'quarterly' ? 3 : 12;
  const { d: dom } = ymd(start);
  const s = ymd(start);
  const lo_ = ymd(lo);
  let k = Math.max(0, Math.floor(((lo_.y - s.y) * 12 + (lo_.m - s.m)) / stepMonths) - 1);
  for (; out.length < limit; k++) {
    const d = dayOf(s.y, s.m + k * stepMonths, dom);
    if (d > hi) break;
    if (d >= lo) out.push(fromDay(d));
  }
  return out;
}

/** Monthly due dates for an account's due day within [from, to]. */
export function monthlyDueDates(dueDay: number, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const a = ymd(toDay(from));
  const hi = toDay(to);
  for (let k = 0; ; k++) {
    const d = dayOf(a.y, a.m + k, dueDay);
    if (d > hi) break;
    if (d >= toDay(from)) out.push(fromDay(d));
  }
  return out;
}

/** The day a reminder for `date` should appear. */
export function reminderDay(date: ISODate, daysBefore: number): ISODate {
  return fromDay(toDay(date) - Math.max(0, Math.round(daysBefore)));
}

// ---------------- iCalendar (.ics) export ----------------

export interface CalendarEntry {
  uid: string;
  title: string;
  description?: string;
  /** First occurrence. */
  startDate: ISODate;
  frequency: RecurFrequency;
  /** Day of month for monthly-type rules (defaults to the start date's day). */
  dayOfMonth?: number;
  endDate?: ISODate | null;
  /** Alert this many days before (0 = morning of). */
  remindDaysBefore: number;
}

const icsDate = (iso: ISODate) => iso.replace(/-/g, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line: string): string {
  // RFC 5545: lines longer than 75 octets are folded.
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

/** RRULE for a recurrence. Days 29–31 clamp to the last day of shorter months. */
export function rrule(e: Pick<CalendarEntry, 'frequency' | 'startDate' | 'dayOfMonth' | 'endDate'>): string | null {
  const until = e.endDate ? `;UNTIL=${icsDate(e.endDate)}T235959` : '';
  switch (e.frequency) {
    case 'once':
      return null;
    case 'weekly':
      return `FREQ=WEEKLY${until}`;
    case 'biweekly':
      return `FREQ=WEEKLY;INTERVAL=2${until}`;
    case 'yearly':
      return `FREQ=YEARLY${until}`;
    case 'monthly':
    case 'quarterly': {
      const dom = e.dayOfMonth ?? Number(e.startDate.slice(8, 10));
      const interval = e.frequency === 'quarterly' ? ';INTERVAL=3' : '';
      if (dom <= 28) return `FREQ=MONTHLY${interval};BYMONTHDAY=${dom}${until}`;
      const days = Array.from({ length: dom - 27 }, (_, i) => 28 + i).join(',');
      return `FREQ=MONTHLY${interval};BYMONTHDAY=${days};BYSETPOS=-1${until}`;
    }
  }
}

/** Build an .ics calendar. Events are at 9:00 local time with an alert N days before. */
export function buildICS(entries: CalendarEntry[], calName = 'Debt payments', stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Debt Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(calName)}`];
  for (const e of entries) {
    const d = icsDate(e.startDate);
    const rule = rrule(e);
    const days = Math.max(0, Math.round(e.remindDaysBefore));
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${d}T090000`,
      `DTEND:${d}T091500`,
      `SUMMARY:${icsText(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (rule) lines.push(`RRULE:${rule}`);
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(e.title)}`,
      `TRIGGER:${days === 0 ? '-PT0M' : `-P${days}D`}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

