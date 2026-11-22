import { Capacitor } from '@capacitor/core';
import { fromDay, reminderDay, toDay } from '@/engine';
import { money, date } from './format';
import { reminderSettings, upcomingItems } from './upcoming';
import type { AppData, Summary } from './compute';

export const canScheduleNotifications = () => Capacitor.isNativePlatform();

/** Small stable numeric id for a reminder key. */
function idFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

/**
 * Native app only: (re)schedule on-device notifications for upcoming unpaid payments.
 * iOS allows 64 pending notifications, so the next 60 are scheduled; this re-runs whenever data changes.
 */
export async function syncNotifications(summary: Summary, data: AppData, today: string): Promise<'scheduled' | 'denied' | 'off' | 'web'> {
  if (!Capacitor.isNativePlatform()) return 'web';
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  const rs = reminderSettings(data);
  if (!rs.enabled) return 'off';
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return 'denied';

  const now = Date.now();
  const items = upcomingItems(summary, data, today, fromDay(toDay(today) + 120), today).filter((i) => !i.paid);
  const notifications = items
    .map((i) => {
      const day = reminderDay(i.date, i.remindDays);
      const [y, m, d] = day.split('-').map(Number);
      const at = new Date(y, m - 1, d, 9, 0, 0);
      const days = toDay(i.date) - toDay(day);
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      return {
        id: idFor(i.key),
        title: `${i.name}: payment due ${when}`,
        body: `${money(i.amount)} on ${date(i.date)}${i.minimum > 0 ? ` (minimum ${money(i.minimum)})` : ''}`,
        schedule: { at, allowWhileIdle: true },
      };
    })
    .filter((n) => n.schedule.at.getTime() > now + 30_000)
    .slice(0, 60);
  if (notifications.length) await LocalNotifications.schedule({ notifications });
  return 'scheduled';
}

/** Installed web app: show the number of payments needing attention on the home-screen icon. */
export async function updateBadge(count: number, enabled: boolean) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (!enabled || count === 0) await nav.clearAppBadge?.();
    else await nav.setAppBadge?.(count);
  } catch {
    /* unsupported */
  }
}
