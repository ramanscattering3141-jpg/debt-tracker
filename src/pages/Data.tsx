import { useRef, useState } from 'react';
import { Download, Upload, FileSpreadsheet, RotateCcw, FlaskConical } from 'lucide-react';
import { useApp, PageHeader } from '@/App';
import { Card, CardHeader, Button, Select, Field, Notice, Confirm } from '@/components/ui';
import { exportBackup, validateBackup, restoreBackup, toCSV, type ValidationResult } from '@/db/backup';
import { resetAll, loadSampleData, setSetting, CATEGORY_LABELS } from '@/db/actions';
import { saveFile, readFileText } from '@/lib/files';
import { date } from '@/lib/format';
import { TX_LABELS } from '@/components/TransactionSheet';

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'INR', 'JPY'];

export function DataPage() {
  const { data, summary, today } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ValidationResult | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const name = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';

  const backup = async () => {
    const b = await exportBackup();
    await saveFile(`debt-tracker-backup-${today}.json`, JSON.stringify(b, null, 2), 'application/json');
  };
  const exportAccounts = () =>
    saveFile(
      `accounts-${today}.csv`,
      toCSV(
        summary.views.map((v) => ({
          name: v.account.name,
          category: CATEGORY_LABELS[v.account.category],
          recorded_balance: v.state.recordedBalance.toFixed(2),
          estimated_balance: v.balance.toFixed(2),
          annual_rate_pct: v.rate,
          rate_type: v.account.rateType,
          interest_method: v.account.interest.method,
          accrual: v.account.interest.accrualBasis,
          periods_per_year: v.account.interest.periodsPerYear,
          day_count: v.account.interest.dayCount,
          minimum_payment: v.minimum.toFixed(2),
          minimum_method: v.minimumLabel,
          planned_payment: v.account.plannedPayment ?? '',
          frequency: v.account.frequency,
          due_day: v.account.dueDay,
          credit_limit: v.account.creditLimit ?? '',
          projected_payoff: v.projection.payoffDate ?? 'none',
        })),
      ),
      'text/csv',
    );
  const exportTxns = () =>
    saveFile(
      `transactions-${today}.csv`,
      toCSV(
        [...data.transactions]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((t) => ({ date: t.date, account: name(t.accountId), type: TX_LABELS[t.type], amount: t.amount.toFixed(2), affects_balance: t.affectsBalance ? 'yes' : 'no', description: t.description ?? '' })),
      ),
      'text/csv',
    );
  const exportSchedule = () => {
    const rows = summary.views.flatMap((v) =>
      v.projection.rows.map((r) => ({
        account: v.account.name,
        date: r.date,
        type: r.kind,
        payment: r.payment.toFixed(2),
        interest_estimate: r.interest.toFixed(2),
        principal: r.principal.toFixed(2),
        balance: r.balance.toFixed(2),
        required_minimum: r.minimum?.toFixed(2) ?? '',
      })),
    );
    saveFile(`repayment-schedule-${today}.csv`, toCSV(rows.sort((a, b) => a.date.localeCompare(b.date))), 'text/csv');
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const v = validateBackup(JSON.parse(await readFileText(f)));
      setPending(v);
    } catch {
      setPending({ ok: false, errors: ['The file could not be read as JSON.'] });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <PageHeader title="Backup & settings" back="more" />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card>
        <CardHeader title="Backup" subtitle="A full copy of everything as a JSON file. Keep it somewhere safe (Files, iCloud Drive)." />
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Button onClick={backup}>
            <Download size={16} /> Export backup
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Restore from backup
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Export to spreadsheet (CSV)" />
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Button variant="outline" onClick={exportAccounts}>
            <FileSpreadsheet size={16} /> Accounts
          </Button>
          <Button variant="outline" onClick={exportTxns}>
            <FileSpreadsheet size={16} /> Transactions
          </Button>
          <Button variant="outline" onClick={exportSchedule}>
            <FileSpreadsheet size={16} /> Repayment schedule
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Settings" />
        <div className="px-4 pb-4">
          <Field label="Currency" hint="Formatting only — amounts are not converted.">
            <Select value={String(data.settings.currency ?? 'CAD')} onChange={(e) => setSetting('currency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Sample data & reset" />
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Button variant="outline" onClick={() => setConfirmSample(true)}>
            <FlaskConical size={16} /> Load sample data
          </Button>
          <Button variant="outline" className="text-bad" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} /> Reset everything
          </Button>
        </div>
      </Card>

      <Confirm
        open={!!pending?.ok}
        onClose={() => setPending(null)}
        destructive
        title="Replace all data?"
        confirmLabel="Replace with backup"
        message={
          pending?.summary && (
            <>
              <p>
                This backup{pending.summary.exportedAt && ` from ${date(pending.summary.exportedAt.slice(0, 10))}`} has {pending.summary.accounts} accounts, {pending.summary.transactions} transactions,{' '}
                {pending.summary.rates} rate records and {pending.summary.scenarios} scenarios.
              </p>
              <p className="font-medium text-bad">Everything currently in the app will be permanently replaced. Export a backup of your current data first if you might need it.</p>
            </>
          )
        }
        onConfirm={async () => {
          if (pending?.data) {
            await restoreBackup(pending.data);
            setMsg({ tone: 'good', text: 'Backup restored.' });
          }
        }}
      />
      {pending && !pending.ok && (
        <Notice tone="bad">
          <div className="font-medium">This backup can’t be restored. Nothing was changed.</div>
          <ul className="mt-1 list-disc pl-4">
            {pending.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Notice>
      )}
      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        destructive
        title="Reset everything?"
        confirmLabel="Erase all data"
        message={<p>All accounts, transactions, rate history, payment records and scenarios will be permanently erased and the five default accounts recreated empty. This cannot be undone.</p>}
        onConfirm={async () => {
          await resetAll();
          setMsg({ tone: 'good', text: 'All data erased.' });
        }}
      />
      <Confirm
        open={confirmSample}
        onClose={() => setConfirmSample(false)}
        destructive
        title="Load sample data?"
        confirmLabel="Replace with sample data"
        message={<p>This erases your current data and loads fictional sample accounts for exploring the app. Export a backup first if you have real data.</p>}
        onConfirm={async () => {
          await loadSampleData();
          setMsg({ tone: 'good', text: 'Sample data loaded.' });
        }}
      />
    </div>
  );
}
