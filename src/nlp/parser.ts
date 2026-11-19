// Local natural-language parser for Russian and Ukrainian planning phrases.
// Nothing leaves the device: the text is analysed with deterministic rules.

import type { Recurrence } from '@/lib/types';
import {
  addDays, addMonths, daysInMonth, endOfMonth, isValidYmd, minutesToTime, parseYmd,
  startOfWeek, weekdayMon0, ymd,
} from '@/lib/dates';
import { alignStart } from '@/lib/recurrence';
import { convertNumberTokens, isUkrainian } from './numbers';

export type ParseWarning =
  | 'ampm_assumed' // hour said without "утра/вечера" and could mean either
  | 'date_assumed' // time given but no date -> today
  | 'date_inherited' // date taken from the previous phrase
  | 'past' // the resulting date/time is already in the past
  | 'empty_title' // could not find what to do
  | 'no_date'; // no date at all -> goes to Inbox

export interface ParsedTask {
  title: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string;
  recurrence: Recurrence | null;
  categoryHint: string | null;
  warnings: ParseWarning[];
  /** 0..1 */
  confidence: number;
  source: string;
}

export interface ParseOptions {
  /** Today in the user's time zone, YYYY-MM-DD */
  today: string;
  /** Current time HH:mm in the user's time zone (used for "past" warnings) */
  now?: string;
}

// ---------------------------------------------------------------- dictionaries

const WEEKDAYS: { re: string; idx: number }[] = [
  { re: "понедельник(?:а|у|ом)?|понеділ(?:ок|ка|ку)", idx: 0 },
  { re: "вторник(?:а|у|ом)?|вівтор(?:ок|ка|ку)", idx: 1 },
  { re: "сред(?:а|у|е|ы|ой)|серед(?:а|у|и|і)", idx: 2 },
  { re: "четверг(?:а|у|ом)?|четвер(?:га|гу)?", idx: 3 },
  { re: "пятниц(?:а|у|е|ы|ей)|п'ятниц(?:я|ю|і|ею)", idx: 4 },
  { re: "суббот(?:а|у|е|ы|ой)|субот(?:а|у|и|і|ою)", idx: 5 },
  { re: "воскресень(?:е|я|ю|ем)|неділ(?:я|ю|і|ею)", idx: 6 },
];
const WEEKDAY_ANY = WEEKDAYS.map((w) => w.re).join('|');

const PLURAL_WEEKDAYS: { re: string; idx: number }[] = [
  { re: 'понедельникам|понеділках|понеділкам', idx: 0 },
  { re: 'вторникам|вівторках|вівторкам', idx: 1 },
  { re: 'средам|середах|середам', idx: 2 },
  { re: 'четвергам|четвергах', idx: 3 },
  { re: "пятницам|п'ятницях|п'ятницям", idx: 4 },
  { re: 'субботам|суботах|суботам', idx: 5 },
  { re: 'воскресеньям|неділях|неділям', idx: 6 },
];
const PLURAL_WEEKDAY_ANY = PLURAL_WEEKDAYS.map((w) => w.re).join('|');

const SHCHO_WEEKDAYS: { re: string; idx: number }[] = [
  { re: 'щопонеділка', idx: 0 }, { re: 'щовівторка', idx: 1 }, { re: 'щосереди', idx: 2 },
  { re: 'щочетверга', idx: 3 }, { re: "щоп'ятниці", idx: 4 }, { re: 'щосуботи', idx: 5 }, { re: 'щонеділі', idx: 6 },
];

const MONTHS: { re: string; m: number }[] = [
  { re: 'января|январь|січня|січень', m: 1 },
  { re: 'февраля|февраль|лютого|лютий', m: 2 },
  { re: 'марта|март|березня|березень', m: 3 },
  { re: 'апреля|апрель|квітня|квітень', m: 4 },
  { re: 'мая|май|травня|травень', m: 5 },
  { re: 'июня|июнь|червня|червень', m: 6 },
  { re: 'июля|июль|липня|липень', m: 7 },
  { re: 'августа|август|серпня|серпень', m: 8 },
  { re: 'сентября|сентябрь|вересня|вересень', m: 9 },
  { re: 'октября|октябрь|жовтня|жовтень', m: 10 },
  { re: 'ноября|ноябрь|листопада|листопад', m: 11 },
  { re: 'декабря|декабрь|грудня|грудень', m: 12 },
];
const MONTH_ANY = MONTHS.map((m) => m.re).join('|');

const PART_OF_DAY: { re: string; part: 'morning' | 'afternoon' | 'evening' | 'night' }[] = [
  { re: 'утра|утром|с утра|ранку|вранці|зранку|уранці|рано утром|рано вранці', part: 'morning' },
  { re: 'дня|днем|днём|вдень|удень|после обеда|після обіду|пополудні', part: 'afternoon' },
  { re: 'вечера|вечером|вечора|ввечері|увечері|под вечер|надвечір', part: 'evening' },
  { re: 'ночи|ночью|ночі|вночі|уночі', part: 'night' },
];

// Words that mark the beginning of a new task when they follow a comma or "и".
const MARKER_START =
  `(?:в|во|о|об|у|на|с|со|з|із|к|до|від|от|сегодня|сьогодні|завтра|послезавтра|післязавтра|через|каждый|каждую|каждое|каждые|кожен|кожну|кожного|кожної|кожні|кожний|ежедневно|щодня|щотижня|щомісяця|по|утром|вечером|днем|днём|ввечері|увечері|вранці|зранку|вдень|ночью|вночі|${WEEKDAY_ANY}|${SHCHO_WEEKDAYS.map((w) => w.re).join('|')}|\\d)`;

// Phrases that almost always start a new task even without punctuation (speech often has none).
const STRONG_START = `(?:(?:в|во|у)\\s(?:${WEEKDAY_ANY})|(?:в|во|у)\\s(?:следующ|наступн)\\S*\\s(?:${WEEKDAY_ANY})|завтра|послезавтра|післязавтра|сегодня|сьогодні|каждый|каждую|каждое|каждые|кожен|кожну|кожного|кожної|кожні|кожний|ежедневно|щодня|${SHCHO_WEEKDAYS.map((w) => w.re).join('|')}|по\\s(?:${PLURAL_WEEKDAY_ANY}|рабочим|будням|робочих)|утром|вечером|днем|днём|ночью|ввечері|увечері|вранці|зранку|вдень|вночі|через\\s\\S+\\s(?:день|дня|дней|дні|днів|неделю|недели|недель|тиждень|тижні|тижнів|месяц|месяца|місяць)|\\d{1,2}(?:ord)?\\s(?:${MONTH_ANY}))`;

const HARD_CONNECTORS = [
  'после этого', 'после чего', 'после того', 'а потом', 'и потом', 'а затем', 'и затем', 'а еще', 'и еще', 'а также', 'и также',
  'потом', 'затем', 'далее', 'кроме того',
  'після цього', 'після того', 'а потім', 'і потім', 'й потім', 'та потім', 'потім', 'а ще', 'і ще', 'й ще', 'а також', 'також', 'згодом', 'далі', 'крім того',
];

const FILLERS = [
  'мне нужно будет', 'мне надо будет', 'нужно будет', 'надо будет', 'мне нужно', 'мне надо', 'мне необходимо',
  'я должен', 'я должна', 'я хочу', 'хочу', 'нужно', 'надо', 'необходимо', 'не забыть', 'не забудь',
  'у меня будет', 'у меня есть', 'у меня', 'будет', 'я записан', 'я записана', 'записан', 'записана', 'запись',
  'мені потрібно буде', 'мені треба буде', 'треба буде', 'потрібно буде', 'мені треба', 'мені потрібно', 'мені необхідно',
  'я маю', 'маю', 'я хочу', 'хочу', 'треба', 'потрібно', 'необхідно', 'не забути', 'не забудь',
  'у мене буде', 'у мене є', 'у мене', 'в мене', 'буде', 'я записаний', 'я записана', 'записаний',
  'сначала', 'спочатку', 'и', 'а', 'і', 'й', 'та', 'еще', 'ще', 'тоже', 'теж', 'я', 'мне', 'мені', 'ну', 'так', 'вот', 'ось',
  'также', 'потом', 'потім', 'затем',
];

const CATEGORY_HINTS: { cat: string; re: RegExp }[] = [
  { cat: 'health', re: /больниц|лікарн|врач|лікар|стоматолог|доктор|аптек|поликлиник|полікліні|анализ|аналіз|массаж|масаж|спортзал|тренировк|тренуванн|йог|бассейн|басейн|терапевт|дантист|клиник|клінік/iu },
  { cat: 'study', re: /английск|англійськ|немецк|німецьк|курс|урок|лекци|лекці|учеб|навчанн|экзамен|іспит|школ|репетитор|домашн|книг|чита/iu },
  { cat: 'shopping', re: /магазин|купить|купити|супермаркет|рынок|ринок|покупк|продукт|аптеку|заказать|замовити/iu },
  { cat: 'finance', re: /банк|оплат|платеж|платіж|налог|податк|счет|рахун|кредит|зарплат|коммунал|комунал|страхов/iu },
  { cat: 'work', re: /встреч|совещан|работ|робот|офис|офіс|проект|клиент|клієнт|нарад|зустріч|созвон|дзвінок|отчет|звіт|колег|презентац|дедлайн|переговор|собеседован|співбесід/iu },
  { cat: 'personal', re: /мам|пап|семь|сім'|родител|батьк|друз|подруг|день рождени|день народженн|свидан|побачен|личн|особист|прогулк|прогулян/iu },
];

// ---------------------------------------------------------------- helpers

function re(src: string, flags = 'iu'): RegExp {
  // Words are separated by single spaces and the string is padded with spaces,
  // so "\s" before and a lookahead after act as word boundaries.
  return new RegExp(`\\s(?:${src})(?=\\s)`, flags);
}

interface Seg {
  s: string; // padded working string
}

function take(seg: Seg, pattern: RegExp): RegExpExecArray | null {
  const m = pattern.exec(seg.s);
  if (!m) return null;
  seg.s = seg.s.slice(0, m.index) + ' ' + seg.s.slice(m.index + m[0].length);
  seg.s = seg.s.replace(/\s+/g, ' ');
  if (!seg.s.startsWith(' ')) seg.s = ' ' + seg.s;
  if (!seg.s.endsWith(' ')) seg.s += ' ';
  return m;
}

function weekdayIndex(word: string): number {
  for (const w of WEEKDAYS) if (new RegExp(`^(?:${w.re})$`, 'iu').test(word)) return w.idx;
  return -1;
}

function monthIndex(word: string): number {
  for (const m of MONTHS) if (new RegExp(`^(?:${m.re})$`, 'iu').test(word)) return m.m;
  return -1;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function normalize(text: string): string {
  let t = text
    .replace(/[ёЁ]/g, (c) => (c === 'ё' ? 'е' : 'Е'))
    .replace(/[’ʼ`´]/g, "'")
    .replace(/[–—]/g, ' - ')
    .replace(/(\d{1,2})\s*-\s*(\d{1,2})/g, '$1 - $2');
  // separate punctuation (but keep "14:30", "14.30", "25.11.2026", "9-го")
  t = t.replace(/([,;!?()«»"])/g, ' $1 ');
  t = t.replace(/\.(?!\d)/g, ' . ');
  t = t.replace(/:(?!\d)/g, ' : ');
  t = t.replace(/\s+/g, ' ').trim();
  const uk = isUkrainian(t);
  const tokens = convertNumberTokens(t.split(' '), uk);
  return tokens.join(' ');
}

// ---------------------------------------------------------------- segmentation

function hasMarker(s: string): boolean {
  return detectTimeOrDate(` ${s} `);
}

function detectTimeOrDate(padded: string): boolean {
  return (
    re(`(?:в|во|о|об|к|у|на|с|со|з|із|від|от|до)\\s\\d{1,2}(?:[:.]\\d{2})?(?:ord)?`).test(padded) ||
    re(`сегодня|сьогодні|завтра|послезавтра|післязавтра|через\\s\\S+|${WEEKDAY_ANY}|${PLURAL_WEEKDAY_ANY}|${MONTH_ANY}|полдень|полночь|опівдні|опівночі|половин\\S*|пів`).test(padded) ||
    re(`каждый|каждую|каждое|каждые|кожен|кожну|кожного|кожної|кожні|кожний|ежедневно|щодня|щотижня|щомісяця|еженедельно|ежемесячно`).test(padded) ||
    re(PART_OF_DAY.map((p) => p.re).join('|')).test(padded) ||
    /\d{1,2}:\d{2}/.test(padded)
  );
}

function hasTitleWords(s: string): boolean {
  const seg: Seg = { s: ` ${s} ` };
  stripMarkers(seg);
  return contentWords(seg.s).length > 0;
}

function contentWords(s: string): string[] {
  const fillerSet = new Set(FILLERS.filter((f) => !f.includes(' ')));
  return s
    .split(' ')
    .filter((w) => w && !/^[,.;:!?()«»"-]+$/.test(w))
    .filter((w) => !fillerSet.has(w.toLowerCase()))
    .filter((w) => !/^(в|во|о|об|у|на|с|со|з|із|к|до|по|за|от|від)$/i.test(w));
}

export function splitSegments(normalized: string): string[] {
  // 1. sentence punctuation
  let parts = normalized.split(/\s[.!?;]\s|\s[.!?;]$|^[.!?;]\s/).map((p) => p.trim()).filter(Boolean);

  // 2. hard connectors
  const hard = new RegExp(`(?:^|\\s|,)\\s*(?:${HARD_CONNECTORS.join('|')})(?=\\s|$)`, 'giu');
  parts = parts.flatMap((p) => p.split(hard).map((x) => x.replace(/^[\s,]+|[\s,]+$/g, '')).filter(Boolean));

  // 3. soft split on commas / "и" when the next chunk starts with a date/time marker
  const result: string[] = [];
  for (const p of parts) {
    const soft = p.split(new RegExp(`\\s(?:(?:,\\s(?:и\\s|і\\s|й\\s|та\\s|а\\s)?|и\\s|і\\s|й\\s|та\\s)(?=${MARKER_START}(?:\\s|$))|(?=${STRONG_START}(?:\\s|$)))`, 'iu'));
    // merge: a chunk with only date/time goes forward; a chunk with only a title goes back
    const chunks = soft.map((c) => c.trim()).filter(Boolean);
    const merged: string[] = [];
    let carry = '';
    for (let i = 0; i < chunks.length; i++) {
      const c = (carry ? carry + ' ' : '') + chunks[i];
      carry = '';
      const title = hasTitleWords(c);
      const marker = hasMarker(c);
      if (!title && marker && i < chunks.length - 1) {
        carry = c;
        continue;
      }
      if (!title && marker && merged.length > 0) {
        merged[merged.length - 1] += ' ' + c;
        continue;
      }
      if (title && !marker && merged.length > 0) {
        merged[merged.length - 1] += ' ' + c;
        continue;
      }
      merged.push(c);
    }
    if (carry) {
      if (merged.length) merged[merged.length - 1] += ' ' + carry;
      else merged.push(carry);
    }
    result.push(...merged);
  }
  return result.filter((r) => r.replace(/[,.\s]/g, '').length > 0);
}

// ---------------------------------------------------------------- extraction

interface Extracted {
  date: string | null;
  dateExplicit: boolean;
  weekdayMentioned: number | null;
  start: number | null; // minutes
  end: number | null;
  ampmAssumed: boolean;
  part: 'morning' | 'afternoon' | 'evening' | 'night' | null;
  recurrence: Recurrence | null;
}

function stripMarkers(seg: Seg, today = '2000-01-03'): Extracted {
  const ex: Extracted = {
    date: null, dateExplicit: false, weekdayMentioned: null, start: null, end: null,
    ampmAssumed: false, part: null, recurrence: null,
  };
  extractRecurrence(seg, ex);
  extractDate(seg, ex, today);
  extractTime(seg, ex);
  return ex;
}

function extractRecurrence(seg: Seg, ex: Extracted) {
  let m: RegExpExecArray | null;
  const every = '(?:каждый|каждую|каждое|каждого|каждой|каждые|кожен|кожну|кожне|кожного|кожної|кожний|кожні|кожен)';

  // every N weeks / days / months
  if ((m = take(seg, re(`(?:${every}|раз\\sв|раз\\sна)\\s(\\d+)\\s(недели|недель|неделю|тижні|тижнів|тиждень)`)))) {
    ex.recurrence = { freq: 'weekly', interval: Number(m[1]) };
  } else if ((m = take(seg, re(`(?:${every}|раз\\sв|раз\\sна)\\s(\\d+)\\s(дня|дней|дні|днів)`)))) {
    ex.recurrence = { freq: 'daily', interval: Number(m[1]) };
  } else if ((m = take(seg, re(`(?:${every}|раз\\sв|раз\\sна)\\s(\\d+)\\s(месяца|месяцев|місяці|місяців)`)))) {
    ex.recurrence = { freq: 'monthly', interval: Number(m[1]) };
  } else if (take(seg, re(`через\\sнеделю\\sкаждую|${every}\\sвторую\\sнеделю|кожного\\sдругого\\sтижня`))) {
    ex.recurrence = { freq: 'weekly', interval: 2 };
  }
  if (ex.recurrence) return;

  // weekdays / workdays / weekends
  if (take(seg, re(`по\\sрабочим\\sдням|по\\sбудням|по\\sбудним\\sдням|в\\sбудни|в\\sбудние\\sдни|${every}\\sрабочий\\sдень|по\\sробочих\\sднях|по\\sробочим\\sдням|у\\sбудні|в\\sбудні|щобудня|${every}\\sробочий\\sдень|у\\sробочі\\sдні|в\\sробочі\\sдні`))) {
    ex.recurrence = { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] };
    return;
  }
  if (take(seg, re(`по\\sвыходным|${every}\\sвыходные|по\\sвихідних|щовихідних|${every}\\sвихідні`))) {
    ex.recurrence = { freq: 'weekly', interval: 1, byWeekday: [5, 6] };
    return;
  }
  // каждый понедельник (и среду)
  if ((m = take(seg, re(`${every}\\s(${WEEKDAY_ANY})(?:\\s(?:и|і|та|й|,)\\s(?:${every}\\s)?(${WEEKDAY_ANY}))?`)))) {
    const days = [weekdayIndex(m[1])];
    if (m[2]) days.push(weekdayIndex(m[2]));
    ex.recurrence = { freq: 'weekly', interval: 1, byWeekday: days.sort() };
    return;
  }
  // по понедельникам и средам
  if ((m = take(seg, re(`(?:по|в|у)\\s(${PLURAL_WEEKDAY_ANY})(?:\\s?(?:,|и|і|та|й)\\s(${PLURAL_WEEKDAY_ANY}))?(?:\\s?(?:,|и|і|та|й)\\s(${PLURAL_WEEKDAY_ANY}))?`)))) {
    const days = [m[1], m[2], m[3]].filter(Boolean).map((w) => {
      for (const p of PLURAL_WEEKDAYS) if (new RegExp(`^(?:${p.re})$`, 'iu').test(w)) return p.idx;
      return -1;
    }).filter((d) => d >= 0);
    ex.recurrence = { freq: 'weekly', interval: 1, byWeekday: days.sort() };
    return;
  }
  for (const w of SHCHO_WEEKDAYS) {
    if (take(seg, re(w.re))) {
      ex.recurrence = { freq: 'weekly', interval: 1, byWeekday: [w.idx] };
      return;
    }
  }
  // каждое 5 число
  if ((m = take(seg, re(`${every}\\s(\\d{1,2})(?:ord)?\\s(?:число|числа|числo)`)))) {
    ex.recurrence = { freq: 'monthly', interval: 1 };
    ex.date = '__day:' + m[1];
    return;
  }
  if (take(seg, re(`${every}\\sдень|ежедневно|щодня|щоденно|${every}\\sдня|каждодневно`))) {
    ex.recurrence = { freq: 'daily', interval: 1 };
    return;
  }
  if (take(seg, re(`${every}\\sнеделю|еженедельно|щотижня|раз\\sв\\sнеделю|раз\\sна\\sтиждень|${every}\\sтижня|${every}\\sтиждень`))) {
    ex.recurrence = { freq: 'weekly', interval: 1 };
    return;
  }
  if (take(seg, re(`${every}\\sмесяц|ежемесячно|щомісяця|раз\\sв\\sмесяц|раз\\sна\\sмісяць|${every}\\sмісяця|${every}\\sмісяць`))) {
    ex.recurrence = { freq: 'monthly', interval: 1 };
    return;
  }
  if (take(seg, re(`${every}\\sгод|ежегодно|щороку|раз\\sв\\sгод|раз\\sна\\sрік|${every}\\sроку|${every}\\sрік`))) {
    ex.recurrence = { freq: 'yearly', interval: 1 };
  }
}

function nextWeekday(today: string, idx: number, mode: 'nearest' | 'next' | 'this'): string {
  const cur = weekdayMon0(today);
  if (mode === 'next') {
    // the given weekday of the following calendar week (Mon-based)
    const nextMonday = addDays(today, 7 - cur);
    return addDays(nextMonday, idx);
  }
  let diff = (idx - cur + 7) % 7;
  if (diff === 0 && mode === 'nearest') diff = 7;
  return addDays(today, diff);
}

function resolveDayMonth(today: string, d: number, m: number, y?: number): string | null {
  const t = parseYmd(today);
  let year = y ?? t.y;
  if (year < 100) year += 2000;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(year, m)) return null;
  let date = ymd(year, m, d);
  if (!y && date < today) date = ymd(year + 1, m, Math.min(d, daysInMonth(year + 1, m)));
  return isValidYmd(date) ? date : null;
}

function extractDate(seg: Seg, ex: Extracted, today: string) {
  let m: RegExpExecArray | null;
  const set = (d: string | null) => {
    if (d && !ex.date) { ex.date = d; ex.dateExplicit = true; }
  };

  if (ex.date?.startsWith('__day:')) {
    const day = Number(ex.date.slice(6));
    ex.date = null;
    const t = parseYmd(today);
    let d = ymd(t.y, t.m, Math.min(day, daysInMonth(t.y, t.m)));
    if (d < today) d = addMonths(ymd(t.y, t.m, 1), 1).slice(0, 8) + String(Math.min(day, 28)).padStart(2, '0');
    set(d);
  }

  if (take(seg, re('послезавтра|післязавтра|після\\sзавтра'))) set(addDays(today, 2));
  if (take(seg, re('завтра(?:шний|шній)?(?:\\sдень)?'))) set(addDays(today, 1));
  if (take(seg, re('сегодня|сьогодні|нынче'))) set(today);

  // через N дней / неделю / месяц
  if ((m = take(seg, re('через\\s(\\d+|пару|пар[уи]|неделю|тиждень|месяц|місяць|год|рік)(?:\\s(день|дня|дней|дні|днів|неделю|недели|недель|тиждень|тижні|тижнів|месяц|месяца|месяцев|місяць|місяці|місяців))?')))) {
    const nRaw = m[1].toLowerCase();
    let n = /^\d+$/.test(nRaw) ? Number(nRaw) : nRaw.startsWith('пар') ? 2 : 1;
    let unit = (m[2] || nRaw).toLowerCase();
    if (/^\d+$/.test(unit) || unit.startsWith('пар')) unit = 'день';
    if (/^(день|дня|дней|дні|днів)$/.test(unit)) set(addDays(today, n));
    else if (/^(недел|тижд|тижн)/.test(unit)) set(addDays(today, n * 7));
    else if (/^(месяц|місяц)/.test(unit)) set(addMonths(today, n));
    else if (/^(год|рік)/.test(unit)) set(addMonths(today, n * 12));
    else n = 0;
  }

  // 25 ноября [2026]
  if ((m = take(seg, re(`(?:на\\s|до\\s)?(\\d{1,2})(?:ord)?\\s(${MONTH_ANY})(?:\\s(\\d{4})(?:\\sгода|\\sгод|\\sроку|\\sрік|\\sг)?)?`)))) {
    set(resolveDayMonth(today, Number(m[1]), monthIndex(m[2]), m[3] ? Number(m[3]) : undefined));
  }

  // 25.11 / 25.11.2026 (not preceded by a time preposition)
  if (!ex.date && (m = re(`(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?`).exec(seg.s))) {
    const before = seg.s.slice(0, m.index).trim().split(' ').pop() ?? '';
    const looksLikeTime = /^(в|во|о|об|к|с|со|з|із|до|от|від)$/i.test(before) && Number(m[2]) < 60 && !m[3];
    if (!looksLikeTime) {
      const d = resolveDayMonth(today, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
      if (d) { take(seg, re(`(?:на\\s)?${m[1]}\\.${m[2]}${m[3] ? '\\.' + m[3] : ''}`)); set(d); }
    }
  }

  // в конце месяца / в начале месяца / на выходных / в конце недели
  if (take(seg, re('в\\sконце\\sмесяца|в\\sкінці\\sмісяця|наприкінці\\sмісяця|под\\sконец\\sмесяца|в\\sпоследний\\sдень\\sмесяца|в\\sостанній\\sдень\\sмісяця'))) set(endOfMonth(today));
  if (take(seg, re('в\\sначале\\sследующего\\sмесяца|в\\sначале\\sмесяца|на\\sпочатку\\sмісяця|на\\sпочатку\\sнаступного\\sмісяця'))) set(addMonths(today.slice(0, 8) + '01', 1));
  if (take(seg, re('на\\sвыходных|на\\sвыходные|на\\sвихідних|на\\sвихідні'))) set(nextWeekday(today, 5, weekdayMon0(today) === 5 ? 'this' : 'nearest'));
  if (take(seg, re('в\\sконце\\sнедели|в\\sкінці\\sтижня|наприкінці\\sтижня'))) {
    const fri = addDays(startOfWeek(today, 1), 4);
    set(fri >= today ? fri : addDays(startOfWeek(today, 1), 6));
  }
  if (take(seg, re('на\\sследующей\\sнеделе|на\\sнаступному\\sтижні|наступного\\sтижня|на\\sнаступний\\sтиждень'))) set(addDays(startOfWeek(today, 1), 7));

  // weekday: "в следующую пятницу", "в эту среду", "в пятницу"
  if ((m = take(seg, re(`(?:(?:в|во|у|на|до|к|по)\\s)?(?:(следующ\\S*|наступн\\S*|эт\\S*|ц\\S*|ближайш\\S*|найближч\\S*)\\s)?(${WEEKDAY_ANY})`)))) {
    const idx = weekdayIndex(m[2]);
    ex.weekdayMentioned = idx;
    const mod = (m[1] || '').toLowerCase();
    const mode = /^(следующ|наступн)/.test(mod) ? 'next' : /^(эт|ц)/.test(mod) ? 'this' : 'nearest';
    if (ex.recurrence) {
      if (ex.recurrence.freq === 'weekly' && !ex.recurrence.byWeekday) ex.recurrence.byWeekday = [idx];
    } else {
      set(nextWeekday(today, idx, mode));
    }
  }

  // "5 числа" / "на 5ord"
  if ((m = take(seg, re('(?:на\\s)?(\\d{1,2})(?:ord)?\\sчисла|(?:на\\s)?(\\d{1,2})ord\\s(?:число)'))) ) {
    const day = Number(m[1] || m[2]);
    const t = parseYmd(today);
    if (day >= 1 && day <= 31) {
      let d = ymd(t.y, t.m, Math.min(day, daysInMonth(t.y, t.m)));
      if (d < today) {
        const nm = addMonths(ymd(t.y, t.m, 1), 1);
        const p = parseYmd(nm);
        d = ymd(p.y, p.m, Math.min(day, daysInMonth(p.y, p.m)));
      }
      set(d);
    }
  }
}

function applyPart(h: number, part: Extracted['part']): number {
  if (part === 'evening' && h < 12 && h >= 3) return h + 12;
  if (part === 'evening' && h === 12) return 0;
  if (part === 'afternoon' && h < 12 && h <= 7) return h + 12;
  if (part === 'night' && h === 12) return 0;
  if (part === 'morning' && h === 12) return 0;
  return h;
}

function extractTime(seg: Seg, ex: Extracted) {
  let m: RegExpExecArray | null;

  // part of day
  for (const p of PART_OF_DAY) {
    if (take(seg, re(`(?:в\\s|под\\s)?(?:${p.re})`))) { ex.part = p.part; break; }
  }

  const fix = (h: number, mm: number, spokenHourOnly: boolean): number | null => {
    if (h > 24 || mm > 59) return null;
    if (h === 24) h = 0;
    let hh = h;
    if (ex.part) hh = applyPart(h, ex.part);
    else if (spokenHourOnly && h >= 1 && h <= 6) { hh = h + 12; ex.ampmAssumed = true; }
    else if (spokenHourOnly && h === 7) ex.ampmAssumed = true;
    return hh * 60 + mm;
  };

  // noon / midnight
  if (take(seg, re('(?:в\\s)?полдень|опівдні|о\\sпівдні'))) { ex.start = 12 * 60; }
  else if (take(seg, re('(?:в\\s)?полночь|опівночі|о\\sпівночі'))) { ex.start = 0; }

  const T = '(\\d{1,2})(?:(?:[:.]|\\s)(\\d{2}))?(?:ord)?(?:\\s(?:час|часа|часов|годині|годину|година|години|годин))?';

  // range: с 9 до 11 / з 9:00 до 11:00 / 9-11
  if (ex.start === null && ((m = take(seg, re(`(?:с|со|з|із|від|от)\\s${T}\\s(?:до|по)\\s${T}`))) ||
      (m = take(seg, re(`(?:в|во|о|об)?\\s?${T}\\s-\\s${T}`))))) {
    const h1 = Number(m[1]), m1 = Number(m[2] || 0), h2 = Number(m[3]), m2 = Number(m[4] || 0);
    let s = fix(h1, m1, !m[2]);
    let e = fix(h2, m2, !m[4]);
    if (s !== null && e !== null) {
      if (e <= s && e + 720 < 1440 && !ex.part) e += 720; // "с 10 до 2" -> 14:00
      if (s !== null && e !== null && e > s) { ex.start = s; ex.end = e; }
      else { ex.start = s; }
    }
  }

  // half past: "в половине десятого", "о пів на десяту", "пол десятого"
  if (ex.start === null && (m = take(seg, re('(?:в\\s|о\\s)?(?:половин[аеуы]|пол|пів\\sна|пів)\\s(\\d{1,2})ord')))) {
    ex.start = fix(Number(m[1]) - 1 === 0 ? 12 : Number(m[1]) - 1, 30, true);
  }
  // quarter: "без четверти десять", "за чверть десята", "четверть десятого", "чверть на десяту"
  if (ex.start === null && (m = take(seg, re('(?:в\\s|о\\s)?(?:без\\sчетверти|за\\sчверть)\\s(\\d{1,2})(?:ord)?')))) {
    ex.start = fix(Number(m[1]) - 1 || 12, 45, true);
  }
  if (ex.start === null && (m = take(seg, re('(?:в\\s|о\\s)?(?:четверть|чверть\\sна|чверть)\\s(\\d{1,2})ord')))) {
    ex.start = fix(Number(m[1]) - 1 || 12, 15, true);
  }
  // "без 15 10" / "без 10 минут 9"
  if (ex.start === null && (m = take(seg, re('(?:в\\s|о\\s)?без\\s(\\d{1,2})(?:\\sминут|\\sхвилин)?\\s(\\d{1,2})(?:ord)?')))) {
    const mins = Number(m[1]);
    if (mins < 60) ex.start = fix(Number(m[2]) - 1 || 12, 60 - mins, true);
  }

  // explicit hh:mm
  if (ex.start === null && (m = take(seg, re('(?:(?:в|во|о|об|к|на|до|у|около|близько|приблизно)\\s)?(\\d{1,2})[:.](\\d{2})(?:\\sчас\\S*|\\sгод\\S*)?')))) {
    ex.start = fix(Number(m[1]), Number(m[2]), false);
  }
  // "в 11 30", "в 9 часов 15 минут"
  if (ex.start === null && (m = take(seg, re('(?:в|во|о|об|к|около|близько)\\s(\\d{1,2})(?:ord)?(?:\\s(?:час|часа|часов|годин|година|годині|години))?\\s(\\d{2}|\\d{1,2}\\s(?:минут|минуты|минуту|хвилин|хвилини|хвилину))(?:\\s(?:минут|хвилин))?')))) {
    const mins = Number(m[2].split(' ')[0]);
    if (mins < 60) ex.start = fix(Number(m[1]), mins, false);
  }
  // "в 9", "в 9 часов", "о 9ord" (о дев'ятій), "к 10"
  if (ex.start === null && (m = take(seg, re('(?:в|во|о|об|к|около|близько|на)\\s(\\d{1,2})(?:ord)?(?:\\s(?:час|часа|часов|годині|годину|годин|години))?(?!\\s(?:\\S+\\s)?(?:день|дня|дней|дні|днів|недел\\S*|тиж\\S*|месяц\\S*|місяц\\S*|минут\\S*|хвилин\\S*|раз\\S*|человек\\S*|людин\\S*|кг|км))')))) {
    ex.start = fix(Number(m[1]), 0, true);
  }
  // "9ord годині" without preposition
  if (ex.start === null && (m = take(seg, re('(\\d{1,2})(?:ord)?\\s(?:часов|часа|годині|годину)')))) {
    ex.start = fix(Number(m[1]), 0, true);
  }

  // duration: "на час", "на 2 часа", "на 30 минут", "на півгодини"
  if (ex.start !== null && ex.end === null) {
    if ((m = take(seg, re('(?:на|протягом|в\\sтечение)\\s(\\d+)?\\s?(час|часа|часов|годину|години|годин)')))) {
      ex.end = ex.start + (m[1] ? Number(m[1]) : 1) * 60;
    } else if ((m = take(seg, re('(?:на|протягом|в\\sтечение)\\s(\\d+)\\s(минут|минуты|хвилин|хвилини)')))) {
      ex.end = ex.start + Number(m[1]);
    } else if (take(seg, re('на\\sполчаса|на\\sпівгодини'))) {
      ex.end = ex.start + 30;
    } else if (take(seg, re('на\\sполтора\\sчаса|на\\sпівтори\\sгодини'))) {
      ex.end = ex.start + 90;
    }
    if (ex.end !== null && ex.end >= 1440) ex.end = 1439;
  }
}

const PLACE_STOP = /^(с|со|з|із|для|чтобы|щоб|по|за|к|до|и|і|й|та|а|или|або|после|після|потом|потім)$/i;
const COMM_VERBS = /(позвонить|звонить|написать|отправить|подзвонити|зателефонувати|написати|надіслати|відправити|перевести|переказати|заплатить|оплатить|сходить|поехать|поїхати|піти|пойти|съездить|з'їздити|сдать|здати)$/i;

function extractLocation(seg: Seg): string {
  const words = seg.s.trim().split(' ').filter(Boolean);
  for (let i = 0; i < words.length - 1; i++) {
    if (!/^(в|во|на|у)$/i.test(words[i])) continue;
    const prev = (words[i - 1] || '').toLowerCase();
    if (COMM_VERBS.test(prev) && /^(позвонить|звонить|написать|отправить|подзвонити|зателефонувати|написати|надіслати|відправити|перевести|переказати)$/.test(prev)) continue;
    const place: string[] = [];
    for (let j = i + 1; j < words.length && place.length < 5; j++) {
      const w = words[j];
      if (/^[,.;:!?()«»"]+$/.test(w)) break;
      if (PLACE_STOP.test(w)) break;
      place.push(w);
    }
    if (place.length === 0) continue;
    // ignore abstract phrases
    const joined = place.join(' ');
    if (/^(течени|течение|время|раз|итоге|целом|общем|принципе|любом|мене|меня|себе|себя|сам|кіно)/i.test(joined)) continue;
    return joined;
  }
  return '';
}

function cleanTitle(s: string): string {
  let t = ` ${s} `;
  // remove fillers, longest first, repeatedly at the start, and multiword ones anywhere
  const fillers = [...FILLERS].sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed) {
    changed = false;
    t = t.replace(/^\s*[,.;:!?-]+\s*/, ' ');
    for (const f of fillers) {
      const r = new RegExp(`^\\s${f.replace(/ /g, '\\s')}(?=\\s)`, 'iu');
      if (r.test(t)) { t = t.replace(r, ' '); changed = true; }
    }
  }
  for (const f of fillers.filter((x) => x.includes(' ') || x.length > 4)) {
    t = t.replace(new RegExp(`\\s${f.replace(/ /g, '\\s')}(?=\\s)`, 'giu'), ' ');
  }
  // dangling prepositions / punctuation at the end
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(/\s(?:в|во|о|об|у|на|с|со|з|к|до|и|і|й|та|а|,|\.|-|:)\s*$/iu, ' ');
  }
  t = t.replace(/\s([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[,.;:!?-]+\s*/, '').replace(/[,;:-]+$/, '').trim();
  // numbers converted from words stay digits; restore ordinals
  t = t.replace(/(\d+)ord/g, '$1-й');
  return capitalize(t);
}

function guessCategory(text: string): string | null {
  for (const h of CATEGORY_HINTS) if (h.re.test(text)) return h.cat;
  return null;
}

// ---------------------------------------------------------------- public API

export function parseCommand(text: string, opts: ParseOptions): ParsedTask[] {
  const { today } = opts;
  const normalized = normalize(text);
  if (!normalized.trim()) return [];
  const segments = splitSegments(normalized);
  const result: ParsedTask[] = [];
  let lastDate: string | null = null;

  for (const raw of segments) {
    const seg: Seg = { s: ` ${raw} ` };
    const ex: Extracted = {
      date: null, dateExplicit: false, weekdayMentioned: null, start: null, end: null,
      ampmAssumed: false, part: null, recurrence: null,
    };
    extractRecurrence(seg, ex);
    extractDate(seg, ex, today);
    extractTime(seg, ex);
    const location = extractLocation(seg);
    const title = cleanTitle(seg.s);
    const warnings: ParseWarning[] = [];

    let date = ex.date;
    if (ex.recurrence) {
      date = alignStart(ex.recurrence, date ?? today);
      if (ex.recurrence.freq === 'weekly' && !ex.recurrence.byWeekday && ex.weekdayMentioned === null) {
        ex.recurrence.byWeekday = [weekdayMon0(date)];
      }
    } else if (!date) {
      if (lastDate) {
        date = lastDate;
        warnings.push('date_inherited');
      } else if (ex.start !== null || ex.part) {
        date = today;
        warnings.push('date_assumed');
      } else {
        warnings.push('no_date');
      }
    }
    if (ex.dateExplicit && !ex.recurrence) lastDate = date;
    else if (!lastDate && date && !ex.recurrence) lastDate = date;

    if (ex.ampmAssumed) warnings.push('ampm_assumed');
    if (!title) warnings.push('empty_title');
    if (date && date < today && !ex.recurrence) warnings.push('past');
    if (date === today && ex.start !== null && opts.now && minutesToTime(ex.start) < opts.now && !ex.recurrence) warnings.push('past');

    // confidence: start from 1 and subtract for every doubt
    let confidence = 1;
    if (warnings.includes('ampm_assumed')) confidence -= 0.25;
    if (warnings.includes('date_assumed')) confidence -= 0.15;
    if (warnings.includes('empty_title')) confidence -= 0.5;
    if (warnings.includes('past')) confidence -= 0.2;
    if (warnings.includes('no_date')) confidence -= 0.1;
    if (title.split(' ').length > 9) confidence -= 0.15;

    result.push({
      title,
      date,
      startTime: ex.start !== null ? minutesToTime(ex.start) : null,
      endTime: ex.end !== null ? minutesToTime(ex.end) : null,
      location: location ? location.replace(/(\d+)ord/g, '$1-й') : '',
      recurrence: ex.recurrence,
      categoryHint: guessCategory(raw),
      warnings,
      confidence: Math.max(0, Math.round(confidence * 100) / 100),
      source: raw.replace(/(\d+)ord/g, '$1-й'),
    });
  }
  // drop totally empty results (e.g. a stray "потом")
  return result.filter((r) => r.title || r.startTime || r.date !== null && r.warnings.length === 0);
}
