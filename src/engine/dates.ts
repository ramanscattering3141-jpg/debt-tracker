/**
 * Timezone-safe calendar date helpers.
 * All engine dates are ISO strings "YYYY-MM-DD" or integer "epoch days" (days since 1970-01-01, UTC).
 */
export type ISODate = string;

const MS_PER_DAY = 86_400_000;

export function toDay(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDay(day: number): ISODate {
  const dt = new Date(day * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function ymd(day: number): { y: number; m: number; d: number } {
  const dt = new Date(day * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

export function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Day for (year, month0, dayOfMonth) with day clamped to month length (e.g. due day 31 in Feb → 28/29). */
export function dayOf(y: number, m0: number, dom: number): number {
  // normalise month overflow
  const yy = y + Math.floor(m0 / 12);
  const mm = ((m0 % 12) + 12) % 12;
  const d = Math.min(dom, daysInMonth(yy, mm));
  return Math.round(Date.UTC(yy, mm, d) / MS_PER_DAY);
}

export function addMonths(day: number, n: number, dom?: number): number {
  const { y, m, d } = ymd(day);
  return dayOf(y, m + n, dom ?? d);
}

export function startOfYear(y: number): number {
  return Math.round(Date.UTC(y, 0, 1) / MS_PER_DAY);
}

export function monthIndex(day: number): number {
  const { y, m } = ymd(day);
  return y * 12 + m;
}

/** Whole calendar months between two days (b - a), counting by month index. */
export function monthsBetween(a: number, b: number): number {
  return monthIndex(b) - monthIndex(a);
}

/** First occurrence of `dueDay` on or after `day`. */
export function nextDueOnOrAfter(day: number, dueDay: number): number {
  const { y, m } = ymd(day);
  const cand = dayOf(y, m, dueDay);
  return cand >= day ? cand : dayOf(y, m + 1, dueDay);
}

/** Last occurrence of day-of-month `dom` on or before `day`. */
export function prevDayOfMonthOnOrBefore(day: number, dom: number): number {
  const { y, m } = ymd(day);
  const cand = dayOf(y, m, dom);
  return cand <= day ? cand : dayOf(y, m - 1, dom);
}

export function todayISO(): ISODate {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}
