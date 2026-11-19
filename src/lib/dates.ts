// Calendar-date helpers working with plain 'YYYY-MM-DD' strings.
// All dates are "floating" local dates in the user's selected time zone.

export function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** Converts a date string to a UTC Date at noon (safe for day arithmetic). */
export function toUtc(s: string): Date {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function fromUtc(dt: Date): string {
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: string, n: number): string {
  const dt = toUtc(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(s: string, n: number): string {
  const { y, m, d } = parseYmd(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(s: string, n: number): string {
  return addMonths(s, n * 12);
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayMon0(s: string): number {
  return (toUtc(s).getUTCDay() + 6) % 7;
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86400000);
}

export function startOfWeek(s: string, weekStartsOn: 0 | 1): string {
  const wd = toUtc(s).getUTCDay(); // 0 = Sunday
  const offset = (wd - weekStartsOn + 7) % 7;
  return addDays(s, -offset);
}

export function startOfMonth(s: string): string {
  const { y, m } = parseYmd(s);
  return ymd(y, m, 1);
}

export function endOfMonth(s: string): string {
  const { y, m } = parseYmd(s);
  return ymd(y, m, daysInMonth(y, m));
}

export function rangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Current date & time in the given IANA time zone. */
export function nowInTz(timeZone: string, now: Date = new Date()): { date: string; time: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hh = get('hour') === '24' ? '00' : get('hour');
  const time = `${hh}:${get('minute')}`;
  return { date, time, minutes: Number(hh) * 60 + Number(get('minute')) };
}

export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseYmd(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
