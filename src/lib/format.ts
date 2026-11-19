import type { Lang, Recurrence } from './types';
import { locales, translate } from '@/i18n';
import { addDays, toUtc } from './dates';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(lang: Lang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = lang + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locales[lang], { ...opts, timeZone: 'UTC' });
    fmtCache.set(key, f);
  }
  return f;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function weekdayLong(lang: Lang, d: string) {
  return cap(fmt(lang, { weekday: 'long' }).format(toUtc(d)));
}
export function weekdayShort(lang: Lang, d: string) {
  return cap(fmt(lang, { weekday: 'short' }).format(toUtc(d)).replace('.', ''));
}
export function dayMonth(lang: Lang, d: string) {
  return fmt(lang, { day: 'numeric', month: 'long' }).format(toUtc(d));
}
export function monthYear(lang: Lang, d: string) {
  return cap(fmt(lang, { month: 'long', year: 'numeric' }).format(toUtc(d)));
}
export function fullDate(lang: Lang, d: string) {
  return fmt(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(toUtc(d));
}

/** "Сегодня", "Завтра", "Пт, 21 ноября" */
export function relativeDay(lang: Lang, d: string | null, today: string): string {
  if (!d) return translate(lang, 'noDate');
  if (d === today) return translate(lang, 'today');
  if (d === addDays(today, 1)) return translate(lang, 'tomorrow');
  if (d === addDays(today, -1)) return translate(lang, 'yesterday');
  const sameYear = d.slice(0, 4) === today.slice(0, 4);
  return `${weekdayShort(lang, d)}, ${sameYear ? dayMonth(lang, d) : fullDate(lang, d)}`;
}

export function timeRange(start: string | null, end: string | null): string {
  if (!start) return '';
  return end ? `${start}–${end}` : start;
}

export function recurrenceLabel(lang: Lang, r: Recurrence | null): string {
  if (!r) return translate(lang, 'repeatNone');
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  if (r.freq === 'daily') return r.interval > 1 ? `${t('every')} ${r.interval} ${lang === 'uk' ? 'дні' : 'дня'}` : t('repeatDaily');
  if (r.freq === 'weekly') {
    const days = r.byWeekday ?? [];
    if (days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d)) && r.interval === 1) return t('repeatWeekdays');
    // 2026-11-16 is a Monday
    const names = days.map((d) => weekdayShort(lang, addDays('2026-11-16', d))).join(', ');
    const base = r.interval === 2 ? t('repeatBiweekly') : r.interval > 2 ? `${t('every')} ${r.interval} ${lang === 'uk' ? 'тижні' : 'недели'}` : t('repeatWeekly');
    return names ? `${base}: ${names}` : base;
  }
  if (r.freq === 'monthly') return r.interval > 1 ? `${t('every')} ${r.interval} ${lang === 'uk' ? 'міс.' : 'мес.'}` : t('repeatMonthly');
  return t('repeatYearly');
}

export function greetingKey(minutes: number) {
  if (minutes < 5 * 60) return 'greetingNight' as const;
  if (minutes < 12 * 60) return 'greetingMorning' as const;
  if (minutes < 18 * 60) return 'greetingDay' as const;
  return 'greetingEvening' as const;
}
