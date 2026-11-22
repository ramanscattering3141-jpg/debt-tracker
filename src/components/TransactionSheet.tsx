import { useEffect, useState } from 'react';
import { Sheet, Button, Field, Input, NumberInput, Select, Notice } from '@/components/ui';
import { useApp } from '@/App';
import { addTransaction, updateTransaction, deleteTransaction } from '@/db/actions';
import type { Transaction } from '@/db/db';
import type { TransactionType } from '@/engine';
import { money } from '@/lib/format';

export const TX_LABELS: Record<TransactionType, string> = {
  payment: 'Payment',
  interest: 'Interest charge',
  borrow: 'New borrowing / withdrawal',
  fee: 'Fee',
  adjustment: 'Balance adjustment',
};

export function TransactionSheet({
  open,
  onClose,
  accountId,
  editing,
  defaultType = 'payment',
}: {
  open: boolean;
  onClose: () => void;
  accountId?: string;
  editing?: Transaction | null;
  defaultType?: TransactionType;
}) {
  const { data, summary, today } = useApp();
  const [acct, setAcct] = useState(accountId ?? data.accounts[0]?.id ?? '');
  const [type, setType] = useState<TransactionType>(defaultType);
  const [dt, setDt] = useState(today);
  const [amount, setAmount] = useState<number | null>(null);
  const [desc, setDesc] = useState('');
  const [affects, setAffects] = useState(true);
  const [adjMode, setAdjMode] = useState<'target' | 'delta'>('target');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setAcct(editing.accountId);
      setType(editing.type);
      setDt(editing.date);
      setAmount(editing.amount);
      setDesc(editing.description ?? '');
      setAffects(editing.affectsBalance);
      setAdjMode('delta');
    } else {
      setAcct(accountId ?? data.accounts[0]?.id ?? '');
      setType(defaultType);
      setDt(today);
      setAmount(null);
      setDesc('');
      setAffects(true);
      setAdjMode('target');
    }
  }, [open, editing, accountId, defaultType, data.accounts, today]);

  const view = summary.views.find((v) => v.account.id === acct);
  const recorded = view?.state.recordedBalance ?? 0;

  const save = async () => {
    if (!acct) return setError('Choose an account.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) return setError('Enter a valid date.');
    if (amount === null || !Number.isFinite(amount)) return setError('Enter an amount.');
    let amt = amount;
    if (type === 'adjustment' && adjMode === 'target' && !editing) amt = Math.round((amount - recorded) * 100) / 100;
    else if (type !== 'adjustment' && amt <= 0) return setError('Amount must be greater than zero.');
    if (type === 'adjustment' && amt === 0) return setError('The balance already matches — nothing to adjust.');
    const t = { accountId: acct, type, date: dt, amount: amt, description: desc.trim() || undefined, affectsBalance: type === 'interest' || type === 'fee' ? affects : true };
    if (editing) await updateTransaction({ ...editing, ...t });
    else await addTransaction(t);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Edit transaction' : 'Add transaction'}
      footer={
        <>
          {editing && (
            <Button
              variant="outline"
              className="text-bad"
              onClick={async () => {
                if (confirm('Delete this transaction? Balances will be recalculated.')) {
                  await deleteTransaction(editing.id);
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
        <Field label="Account">
          <Select value={acct} onChange={(e) => setAcct(e.target.value)} disabled={!!accountId && !editing}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
            {Object.entries(TX_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={dt} onChange={(e) => setDt(e.target.value)} />
        </Field>
        {type === 'adjustment' && !editing && (
          <div className="flex gap-2 text-sm">
            <Button size="sm" variant={adjMode === 'target' ? 'default' : 'outline'} onClick={() => setAdjMode('target')}>
              Set balance to
            </Button>
            <Button size="sm" variant={adjMode === 'delta' ? 'default' : 'outline'} onClick={() => setAdjMode('delta')}>
              Adjust by amount
            </Button>
          </div>
        )}
        <Field
          label={type === 'adjustment' ? (adjMode === 'target' && !editing ? 'Balance reported by lender' : 'Adjustment (+ increases, − decreases)') : 'Amount'}
          hint={type === 'adjustment' && adjMode === 'target' && !editing ? `App’s recorded balance: ${money(recorded)}` : undefined}
        >
          <NumberInput value={amount} onChange={setAmount} prefix="$" placeholder="0.00" />
        </Field>
        <Field label="Description (optional)">
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. March statement" />
        </Field>
        {(type === 'interest' || type === 'fee') && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={!affects} onChange={(e) => setAffects(!e.target.checked)} />
            <span>
              Record only — doesn’t change the balance
              <span className="block text-xs text-subtle">Use when this charge was already paid or is included elsewhere.</span>
            </span>
          </label>
        )}
        {type === 'interest' && (
          <Notice tone="info">Recording an actual interest charge resets the app’s interest estimate from this date, so interest is never counted twice.</Notice>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Sheet>
  );
}
