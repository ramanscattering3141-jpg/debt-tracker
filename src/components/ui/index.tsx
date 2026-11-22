/* Minimal shadcn/ui-style primitives (Tailwind, no runtime dependencies). */
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn, parseNum } from '@/lib/format';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon' }>(
  ({ className, variant = 'default', size = 'md', ...p }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none select-none',
        size === 'sm' && 'h-8 px-3.5 text-[13px]',
        size === 'md' && 'h-11 px-5 text-[15px]',
        size === 'icon' && 'h-9 w-9',
        variant === 'default' && 'bg-brand text-white hover:bg-brand-dark active:bg-brand-dark',
        variant === 'secondary' && 'bg-muted text-brand hover:bg-border',
        variant === 'outline' && 'border border-brand/40 text-brand bg-card hover:bg-muted',
        variant === 'ghost' && 'hover:bg-muted text-brand',
        variant === 'destructive' && 'bg-bad text-white hover:bg-bad/90',
        className,
      )}
      {...p}
    />
  ),
);

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl bg-card shadow-[0_1px_2px_rgba(60,40,110,0.06),0_2px_10px_rgba(60,40,110,0.05)]', className)} {...p}>
      {children}
    </div>
  );
}
export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-2', className)}>
      <div className="min-w-0">
        <h3 className="text-[16px] font-bold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-subtle mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-xl border border-border bg-card px-3 text-base sm:text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand',
      className,
    )}
    {...p}
  />
));

/** Numeric text field that keeps the user's typing and reports parsed numbers. */
export function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  className,
  allowEmpty = true,
  ...p
}: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  prefix?: string;
  suffix?: string;
  allowEmpty?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'>) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = parseNum(text);
    if (parsed !== (value ?? null)) setText(value === null || value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn('relative', className)}>
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle text-sm">{prefix}</span>}
      <Input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNum(e.target.value);
          if (n !== null || allowEmpty) onChange(n);
        }}
        className={cn(prefix && 'pl-7', suffix && 'pr-9')}
        {...p}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle text-sm">{suffix}</span>}
    </div>
  );
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-xl border border-border bg-card px-3 text-base sm:text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8',
        className,
      )}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...p}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[12px] font-semibold text-subtle">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-muted text-brand',
        tone === 'good' && 'bg-good/10 text-good',
        tone === 'bad' && 'bg-bad/10 text-bad',
        tone === 'warn' && 'bg-amber-500/10 text-amber-700',
        tone === 'info' && 'bg-brand/10 text-brand',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn('flex rounded-full bg-card p-1 shadow-[0_1px_2px_rgba(60,40,110,0.06)]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('flex-1 rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition-colors whitespace-nowrap', value === o.value ? 'bg-brand text-white' : 'text-subtle')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl sm:rounded-2xl bg-card sm:max-w-lg shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            className="flex-1"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink space-y-2">{message}</div>
    </Sheet>
  );
}

export function Stat({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad'; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[12px] text-subtle truncate">{label}</div>
      <div className={cn('mt-0.5 text-[17px] font-bold tabular-nums truncate', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="text-xs text-subtle truncate">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-subtle">{children}</div>;
}

export function Notice({ tone = 'warn', children, className }: { tone?: 'warn' | 'bad' | 'info' | 'good'; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl px-3 py-2.5 text-[13px] leading-snug',
        tone === 'warn' && 'bg-amber-500/10 text-amber-800',
        tone === 'bad' && 'bg-bad/10 text-bad',
        tone === 'info' && 'bg-brand/10 text-brand-dark',
        tone === 'good' && 'bg-good/10 text-good',
        className,
      )}
    >
      {children}
    </div>
  );
}
