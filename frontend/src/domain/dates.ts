/**
 * Local-calendar date helpers (04 §4.4, §4.6.5, §4.9; decision §14.32: `occurred_at` is a
 * timezone-free calendar day). Every function here reads/writes local time via `Date`'s local
 * getters/setters — never `toISOString()`, which would shift the date across UTC.
 */
import type { IsoDate, IsoDateTime } from '@/api/types';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function toIsoDate(d: Date): IsoDate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today's calendar date in the local timezone. */
export function todayLocal(): IsoDate {
  return toIsoDate(new Date());
}

/** `'2026-08-14'` → `'2026-08'`. */
export function monthOf(iso: IsoDate): string {
  return iso.slice(0, 7);
}

export function currentMonth(): string {
  return monthOf(todayLocal());
}

/** `shiftMonth('2026-08', -1) === '2026-07'`; wraps across year boundaries either direction. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${ny}-${pad2(nm)}`;
}

/** Whether month `a` comes after month `b` (`'YYYY-MM'` strings compare lexicographically). */
export function isAfterMonth(a: string, b: string): boolean {
  return a > b;
}

/** Latest `occurred_at` the form allows: today + 1 day, a timezone tolerance (04 §4.6.5). */
export function maxAllowedDate(): IsoDate {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

/** Whether `s` is a real, syntactically valid `'YYYY-MM-DD'` calendar date. */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function daysAgo(n: number, today: Date = new Date()): IsoDate {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return toIsoDate(d);
}

/** First and last calendar day of `'YYYY-MM'`. */
export function monthRange(month: string): { from: IsoDate; to: IsoDate } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
  return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

/**
 * Quick date-range presets for the transaction list filter bar (04 §4.5). `this_month` /
 * `last_3_months` / `this_year` end at `today` (there can be no future transactions);
 * `last_month` is the full previous calendar month.
 */
export function dateRangePreset(
  name: 'this_month' | 'last_month' | 'last_3_months' | 'this_year',
  today: Date = new Date()
): { from: IsoDate; to: IsoDate } {
  const cur = monthOf(toIsoDate(today));
  switch (name) {
    case 'this_month':
      return { from: monthRange(cur).from, to: toIsoDate(today) };
    case 'last_month':
      return monthRange(shiftMonth(cur, -1));
    case 'last_3_months':
      return { from: monthRange(shiftMonth(cur, -2)).from, to: toIsoDate(today) };
    case 'this_year':
      return { from: `${today.getFullYear()}-01-01`, to: toIsoDate(today) };
  }
}

/** Seconds remaining until `isoDateTime` (clamped to 0 once it's past) — invite-code countdown
 *  (decision §2, §14.29: invites expire 10 minutes after issue). */
export function secondsUntil(isoDateTime: IsoDateTime, now: Date = new Date()): number {
  const target = new Date(isoDateTime);
  return Math.max(0, Math.round((target.getTime() - now.getTime()) / 1000));
}
