import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let currency = 'CAD';
export function setCurrency(c: string) {
  currency = c || 'CAD';
}
export function getCurrency() {
  return currency;
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-CA', opts);
    fmtCache.set(key, f);
  }
  return f;
}

/** Currency, rounded to cents for display only. */
export function money(n: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = Math.abs(n) < 0.005 ? 0 : n;
  if (opts.compact && Math.abs(v) >= 10000)
    return nf(`c-${currency}`, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const s = nf(`m-${currency}`, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return opts.sign && v > 0 ? `+${s}` : s;
}

export function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits).replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m))}%`;
}

const dateFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('en-CA', { year: '2-digit', month: 'short', timeZone: 'UTC' });

function parse(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d || 1));
}
/** Canadian date, e.g. "Nov 21, 2026". */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFmt.format(parse(iso));
}
export function monthLabel(iso: string): string {
  return monthFmt.format(parse(iso));
}
export function monthTick(iso: string): string {
  return monthShort.format(parse(iso));
}

export function duration(months: number | null | undefined): string {
  if (months === null || months === undefined) return '—';
  if (months <= 0) return 'Now';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} yr${y > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} mo${m > 1 ? 's' : ''}`);
  return parts.join(' ');
}

/** Parse a user-typed number ("1,234.50", "$20") → number | null. */
export function parseNum(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
