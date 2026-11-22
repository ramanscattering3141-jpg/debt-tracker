import { describe, expect, it } from 'vitest';
import { occurrences, monthlyDueDates, reminderDay, rrule, buildICS } from './recurrence';

describe('recurring payment schedules', () => {
  it('monthly on the 31st clamps to month end', () => {
    expect(occurrences({ frequency: 'monthly', startDate: '2026-01-31' }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
  it('biweekly from a start date, windowed', () => {
    expect(occurrences({ frequency: 'biweekly', startDate: '2026-01-02' }, '2026-01-20', '2026-02-28')).toEqual(['2026-01-30', '2026-02-13', '2026-02-27']);
  });
  it('weekly respects the end date', () => {
    expect(occurrences({ frequency: 'weekly', startDate: '2026-03-01', endDate: '2026-03-20' }, '2026-01-01', '2026-12-31')).toEqual([
      '2026-03-01',
      '2026-03-08',
      '2026-03-15',
    ]);
  });
  it('quarterly and yearly', () => {
    expect(occurrences({ frequency: 'quarterly', startDate: '2026-01-15' }, '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
    expect(occurrences({ frequency: 'yearly', startDate: '2024-02-29' }, '2025-01-01', '2026-12-31')).toEqual(['2025-02-28', '2026-02-28']);
  });
  it('one-time payment only inside the window', () => {
    expect(occurrences({ frequency: 'once', startDate: '2026-05-05' }, '2026-05-01', '2026-05-31')).toEqual(['2026-05-05']);
    expect(occurrences({ frequency: 'once', startDate: '2026-05-05' }, '2026-06-01', '2026-06-30')).toEqual([]);
  });
  it('account due dates and reminder days', () => {
    expect(monthlyDueDates(30, '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-30']);
    expect(reminderDay('2026-03-02', 3)).toBe('2026-02-27');
  });
});

describe('calendar export', () => {
  it('builds clamped monthly rules', () => {
    expect(rrule({ frequency: 'monthly', startDate: '2026-01-15' })).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(rrule({ frequency: 'monthly', startDate: '2026-01-31', dayOfMonth: 31 })).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    expect(rrule({ frequency: 'biweekly', startDate: '2026-01-02', endDate: '2026-06-30' })).toBe('FREQ=WEEKLY;INTERVAL=2;UNTIL=20260630T235959');
  });
  it('writes events with alarms N days before', () => {
    const ics = buildICS([{ uid: 'a@debt', title: 'TD payment, due', startDate: '2026-12-05', frequency: 'monthly', remindDaysBefore: 3 }], 'Debts', new Date('2026-11-22T00:00:00Z'));
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART:20261205T090000');
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=5');
    expect(ics).toContain('TRIGGER:-P3D');
    expect(ics).toContain('SUMMARY:TD payment\\, due');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});
