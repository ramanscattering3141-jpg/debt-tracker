import { useState } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '@/App';
import { Sheet, Button, Field, Input, NumberInput, Notice } from '@/components/ui';
import { markPaid, unmarkPaid } from '@/db/actions';
import { money, date } from '@/lib/format';
import type { UpcomingItem } from '@/lib/upcoming';

export function MarkPaidSheet({ item, onClose }: { item: UpcomingItem; onClose: () => void }) {
  const { today } = useApp();
  const [amount, setAmount] = useState<number | null>(Math.round(item.amount * 100) / 100);
  const [paidDate, setPaidDate] = useState(item.date < today ? item.date : today);
  const [record, setRecord] = useState(!!item.accountId);
  const paid = item.paid;
  return (
    <Sheet
      open
      onClose={onClose}
      title={item.name}
      footer={
        paid ? (
          <>
            <Button variant="outline" className="flex-1" onClick={async () => { await unmarkPaid(paid.id, false); onClose(); }}>
              Unmark
            </Button>
            {paid.transactionId && (
              <Button variant="outline" className="flex-1 text-bad" onClick={async () => { await unmarkPaid(paid.id, true); onClose(); }}>
                Unmark & delete payment
              </Button>
            )}
          </>
        ) : (
          <Button
            className="flex-1"
            onClick={async () => {
              await markPaid(item.accountId ?? '', item.date, amount ?? 0, paidDate, record, item.schedule?.id ?? null, item.schedule?.name);
              onClose();
            }}
          >
            <Check size={16} /> Mark as paid
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-subtle">Due</div>
            <div className="font-semibold">{date(item.date)}</div>
          </div>
          {item.kind === 'due' ? (
            <div>
              <div className="text-xs text-subtle">Minimum</div>
              <div className="font-semibold">{money(item.minimum)}</div>
            </div>
          ) : (
            <div>
              <div className="text-xs text-subtle">Pays</div>
              <div className="truncate font-semibold">{item.view?.account.name ?? 'Not a tracked debt'}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-subtle">{item.kind === 'due' ? 'Planned' : 'Amount'}</div>
            <div className="font-semibold">{money(item.amount)}</div>
          </div>
        </div>
        {paid ? (
          <Notice tone="good">
            Marked paid on {date(paid.paidDate)}: {money(paid.amount)}
            {paid.transactionId ? ' (payment transaction recorded)' : ''}.
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
            {item.accountId && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={record} onChange={(e) => setRecord(e.target.checked)} />
                <span>
                  Also record a payment transaction
                  <span className="block text-xs text-subtle">Reduces the balance. Leave unchecked if you already entered it.</span>
                </span>
              </label>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
