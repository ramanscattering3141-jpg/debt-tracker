import { ChevronRight, ListOrdered, LineChart, HardDrive, ShieldCheck } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card } from '@/components/ui';

export function More() {
  const { go, data } = useApp();
  const items = [
    { key: 'transactions', icon: ListOrdered, label: 'All transactions', sub: `${data.transactions.length} recorded` },
    { key: 'history', icon: LineChart, label: 'History', sub: 'Balances, interest and payments over time' },
    { key: 'data', icon: HardDrive, label: 'Backup, export & settings', sub: 'JSON backup, CSV export, currency, reset' },
  ];
  return (
    <div className="space-y-3">
      <PageHeader title="More" />
      <Card>
        <div className="divide-y divide-border">
          {items.map((i) => (
            <button key={i.key} onClick={() => go(i.key)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/60">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-brand">
                <i.icon size={18} />
              </span>
              <div className="flex-1">
                <div className="text-[15px] font-medium">{i.label}</div>
                <div className="text-xs text-subtle">{i.sub}</div>
              </div>
              <ChevronRight size={18} className="text-subtle" />
            </button>
          ))}
        </div>
      </Card>
      <Card className="flex gap-3 p-4 text-sm text-subtle">
        <ShieldCheck size={20} className="shrink-0 text-good" />
        <p>Everything is stored only on this device. No bank connections, no accounts, nothing sent anywhere. Export a backup regularly.</p>
      </Card>
    </div>
  );
}
