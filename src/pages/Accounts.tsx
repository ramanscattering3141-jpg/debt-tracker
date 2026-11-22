import { useState } from 'react';
import { Plus, ChevronRight } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, Button, Badge, Sheet, Field, Input } from '@/components/ui';
import { createAccount, CATEGORY_LABELS } from '@/db/actions';
import { money, pct, date } from '@/lib/format';

export function Accounts() {
  const { summary, go } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="space-y-3">
      <PageHeader
        title="Accounts"
        subtitle={`${summary.views.length} accounts · ${money(summary.totalDebt)} owing`}
        action={
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add
          </Button>
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        {summary.views.map((v) => {
          const a = v.account;
          const used = a.creditLimit ? Math.min(1, Math.max(0, v.balance / a.creditLimit)) : null;
          return (
            <Card key={a.id} className="cursor-pointer p-4 hover:bg-muted/40" onClick={() => go(`account/${a.id}`)}>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 rounded-full shrink-0" style={{ background: a.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{a.name}</div>
                  <div className="text-xs text-subtle">
                    {CATEGORY_LABELS[a.category]} · {a.interest.method === 'simple' ? 'Simple' : 'Compound'} interest · {a.rateType}
                  </div>
                </div>
                <ChevronRight size={18} className="text-subtle" />
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-2xl font-bold tabular-nums">{money(v.balance)}</div>
                  <div className="text-xs text-subtle">
                    {pct(v.rate)} · min {money(v.minimum)} ({v.minimumLabel})
                  </div>
                </div>
                <div className="text-right text-xs">
                  {v.balance <= 0.005 ? (
                    <Badge tone="good">Paid off</Badge>
                  ) : v.projection.payoffDate ? (
                    <>
                      <div className="text-subtle">Payoff</div>
                      <div className="font-medium">{date(v.projection.payoffDate)}</div>
                    </>
                  ) : (
                    <Badge tone="bad">No payoff at current plan</Badge>
                  )}
                </div>
              </div>
              {used !== null && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${used * 100}%`, background: used > 0.8 ? 'var(--color-bad)' : a.color }} />
                  </div>
                  <div className="mt-1 text-[11px] text-subtle">
                    {money(Math.max(0, a.creditLimit! - v.balance))} available of {money(a.creditLimit)}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="New account"
        footer={
          <Button
            className="flex-1"
            disabled={!name.trim()}
            onClick={async () => {
              const id = await createAccount(name.trim());
              setAdding(false);
              setName('');
              go(`account/${id}/settings`);
            }}
          >
            Create & set up
          </Button>
        }
      >
        <Field label="Account name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car loan" />
        </Field>
      </Sheet>
    </div>
  );
}
