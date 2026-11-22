import { useEffect, useState, createContext, useContext } from 'react';
import { Home, Wallet, Target, CalendarDays, MoreHorizontal, FlaskConical, ChevronLeft } from 'lucide-react';
import { cn, setCurrency } from '@/lib/format';
import { useAppData, useSummary, type AppData, type Summary } from '@/lib/compute';
import { ensureInitialized, resetAll } from '@/db/actions';
import { requestPersistentStorage } from '@/lib/files';
import { todayISO } from '@/engine';
import { Dashboard } from '@/pages/Dashboard';
import { Accounts } from '@/pages/Accounts';
import { AccountDetail } from '@/pages/AccountDetail';
import { Plan } from '@/pages/Plan';
import { Calendar } from '@/pages/Calendar';
import { More } from '@/pages/More';
import { Transactions } from '@/pages/Transactions';
import { History } from '@/pages/History';
import { DataPage } from '@/pages/Data';
import { Reminders } from '@/pages/Reminders';
import { activeReminders, reminderSettings } from '@/lib/upcoming';
import { syncNotifications, updateBadge } from '@/lib/notify';

export function useRoute(): [string[], (path: string) => void] {
  const get = () => (window.location.hash.replace(/^#\/?/, '') || 'home').split('/');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const h = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return [route, (p: string) => (window.location.hash = `#/${p}`)];
}

interface Ctx {
  data: AppData;
  summary: Summary;
  today: string;
  go: (path: string) => void;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

const NAV = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'accounts', label: 'Accounts', icon: Wallet },
  { key: 'plan', label: 'Plan', icon: Target },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'more', label: 'More', icon: MoreHorizontal },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [route, go] = useRoute();
  const today = todayISO();
  const data = useAppData();
  const summary = useSummary(data, today);

  useEffect(() => {
    ensureInitialized().then(() => setReady(true));
    requestPersistentStorage();
  }, []);
  useEffect(() => {
    if (data) setCurrency(String(data.settings.currency ?? 'CAD'));
  }, [data]);
  // Reminders: icon badge (installed web app) and on-device notifications (native app).
  useEffect(() => {
    if (!data || !summary) return;
    const t = setTimeout(() => {
      updateBadge(activeReminders(summary, data, today).length, reminderSettings(data).badge);
      syncNotifications(summary, data, today).catch(() => undefined);
    }, 800);
    return () => clearTimeout(t);
  }, [data, summary, today]);

  if (!ready || !data || !summary) return <div className="p-8 text-center text-subtle">Loading…</div>;

  const section = route[0];
  const activeNav = ['account'].includes(section) ? 'accounts' : ['transactions', 'history', 'data'].includes(section) ? 'more' : section === 'reminders' ? 'calendar' : section;
  let page;
  switch (section) {
    case 'accounts':
      page = <Accounts />;
      break;
    case 'account':
      page = <AccountDetail id={route[1]} tab={route[2] ?? 'overview'} />;
      break;
    case 'plan':
      page = <Plan tab={route[1] ?? 'debt-free'} />;
      break;
    case 'calendar':
      page = <Calendar />;
      break;
    case 'more':
      page = <More />;
      break;
    case 'transactions':
      page = <Transactions />;
      break;
    case 'history':
      page = <History />;
      break;
    case 'data':
      page = <DataPage />;
      break;
    case 'reminders':
      page = <Reminders />;
      break;
    default:
      page = <Dashboard />;
  }

  return (
    <AppCtx.Provider value={{ data, summary, today, go }}>
      <div className="min-h-dvh md:flex">
        {/* Desktop / iPad sidebar */}
        <aside className="hidden md:flex md:w-60 md:flex-col md:bg-card md:sticky md:top-0 md:h-dvh px-3 py-6 shadow-[1px_0_0_var(--color-border)]">
          <div className="px-3 mb-7 flex items-center gap-2 text-[17px] font-bold text-brand">
            <img src="./icon.svg" alt="" className="h-7 w-7" /> Debt Tracker
          </div>
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => go(n.key)}
              className={cn('flex items-center gap-3 rounded-full px-4 py-2.5 text-[15px] font-semibold mb-1', activeNav === n.key ? 'bg-brand/10 text-brand' : 'text-subtle hover:text-brand')}
            >
              <n.icon size={18} /> {n.label}
            </button>
          ))}
          <div className="mt-auto px-2 text-[11px] text-subtle">All data stays on this device.</div>
        </aside>

        <main className="flex-1 min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-10">
          <div className="mx-auto max-w-5xl px-4 md:px-8">{page}</div>
        </main>

        {/* iPhone tab bar */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card shadow-[0_-1px_0_var(--color-border),0_-4px_16px_rgba(60,40,110,0.06)] pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-5">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => go(n.key)}
                className={cn('flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-semibold', activeNav === n.key ? 'text-brand' : 'text-subtle')}
              >
                <n.icon size={22} strokeWidth={activeNav === n.key ? 2.2 : 1.8} />
                {n.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </AppCtx.Provider>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  back,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  back?: string;
  children?: React.ReactNode;
}) {
  const { go, data } = useApp();
  return (
    <div className="band -mx-4 md:-mx-8 md:mt-0 mb-4 px-4 md:px-8 pt-[calc(env(safe-area-inset-top)+14px)] md:pt-8 pb-5 text-white md:rounded-b-3xl">
      {back && (
        <button onClick={() => go(back)} className="mb-1 -ml-1 flex items-center text-[15px] font-medium text-white/85">
          <ChevronLeft size={20} /> Back
        </button>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-bold truncate">{title}</h1>
          {subtitle && <p className="text-[13px] text-white/80 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0 [&_button]:bg-white [&_button]:text-brand [&_button]:border-transparent">{action}</div>}
      </div>
      {children}
      {data.settings.sampleData === true && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-[12.5px] text-white">
          <FlaskConical size={15} className="shrink-0" />
          <span className="flex-1">Sample data — made-up numbers for trying the app, not real financial information.</span>
          <button className="font-semibold underline underline-offset-2" onClick={() => confirm('Remove all sample data and start with empty accounts?') && resetAll()}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
