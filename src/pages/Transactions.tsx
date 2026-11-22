import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, Button, Select } from '@/components/ui';
import { TransactionSheet, TX_LABELS } from '@/components/TransactionSheet';
import { TxnList } from '@/pages/AccountDetail';
import type { Transaction } from '@/db/db';

export function Transactions() {
  const { data } = useApp();
  const [acct, setAcct] = useState('all');
  const [type, setType] = useState('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const txns = data.transactions.filter((t) => (acct === 'all' || t.accountId === acct) && (type === 'all' || t.type === type));
  return (
    <div className="space-y-3">
      <PageHeader
        title="Transactions"
        back="more"
        action={
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus size={16} /> Add
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <Select value={acct} onChange={(e) => setAcct(e.target.value)}>
          <option value="all">All accounts</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {Object.entries(TX_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        <TxnList txns={txns} showAccount onEdit={(t) => { setEditing(t); setOpen(true); }} />
      </Card>
      <TransactionSheet open={open} onClose={() => setOpen(false)} editing={editing} accountId={acct !== 'all' ? acct : undefined} />
    </div>
  );
}
