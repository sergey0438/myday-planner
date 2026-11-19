import { describe, expect, it } from 'vitest';
import { parseCommand } from '@/nlp/parser';

// Thursday, 19 November 2026
const opts = { today: '2026-11-19', now: '10:00' };
const one = (text: string, o = opts) => {
  const r = parseCommand(text, o);
  expect(r).toHaveLength(1);
  return r[0];
};

describe('the master example (several tasks in one dictation)', () => {
  const text =
    'Завтра в девять утра мне нужно быть в областной больнице. Потом в одиннадцать тридцать встреча с коллегами. Вечером в семь заехать в магазин. В пятницу в десять утра записан к стоматологу. И каждую среду в шесть вечера у меня английский';
  for (const [label, input] of [
    ['with punctuation', text],
    ['without punctuation (as Safari often returns it)', text.toLowerCase().replace(/[.,]/g, '')],
  ]) {
    it(label, () => {
      const r = parseCommand(input, opts);
      expect(r.map((t) => [t.title, t.date, t.startTime])).toEqual([
        ['Быть в областной больнице', '2026-11-20', '09:00'],
        ['Встреча с коллегами', '2026-11-20', '11:30'],
        ['Заехать в магазин', '2026-11-20', '19:00'],
        ['К стоматологу', '2026-11-20', '10:00'],
        ['Английский', '2026-11-25', '18:00'],
      ]);
      expect(r[0].location).toBe('областной больнице');
      expect(r[4].recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [2] });
      expect(r[1].warnings).toContain('date_inherited');
    });
  }
});

describe('dates', () => {
  it.each([
    ['сегодня в 15:00 позвонить', '2026-11-19'],
    ['завтра купить хлеб', '2026-11-20'],
    ['послезавтра стрижка', '2026-11-21'],
    ['через три дня отчёт', '2026-11-22'],
    ['через неделю отпуск', '2026-11-26'],
    ['в понедельник созвон', '2026-11-23'],
    ['в следующую пятницу ужин', '2026-11-27'],
    ['в эту субботу уборка', '2026-11-21'],
    ['в четверг бассейн', '2026-11-26'], // today is Thursday -> next week
    ['25 ноября оплатить интернет', '2026-11-25'],
    ['10 декабря корпоратив', '2026-12-10'],
    ['двадцать пятого ноября встреча', '2026-11-25'],
    ['5 ноября годовщина', '2027-11-05'], // already passed this year
    ['в конце месяца заплатить налоги', '2026-11-30'],
    ['31.12 новый год', '2026-12-31'],
    ['післязавтра стрижка', '2026-11-21'],
    ["у п'ятницю тренування", '2026-11-20'],
    ['в наступний понеділок нарада', '2026-11-23'],
    ['10 грудня корпоратив', '2026-12-10'],
  ])('%s -> %s', (text, date) => {
    expect(one(text).date).toBe(date);
  });

  it('no date and no time goes to Inbox', () => {
    const t = one('купить хлеб и молоко');
    expect(t.date).toBeNull();
    expect(t.title).toBe('Купить хлеб и молоко');
    expect(t.warnings).toContain('no_date');
  });

  it('time without date means today and is flagged', () => {
    const t = one('в 18:00 спортзал');
    expect(t.date).toBe('2026-11-19');
    expect(t.warnings).toContain('date_assumed');
  });
});

describe('times', () => {
  it.each([
    ['завтра в девять утра врач', '09:00', null],
    ['завтра в половине десятого звонок', '09:30', null],
    ['завтра в 14:30 совещание', '14:30', null],
    ['завтра в 14.30 совещание', '14:30', null],
    ['завтра в полдень обед', '12:00', null],
    ['завтра в шесть вечера тренировка', '18:00', null],
    ['завтра с девяти до одиннадцати лекция', '09:00', '11:00'],
    ['завтра с 13:00 до 14:30 встреча', '13:00', '14:30'],
    ['завтра в 3 дня встреча', '15:00', null],
    ['завтра в 11 вечера фильм', '23:00', null],
    ['завтра без четверти десять такси', '09:45', null],
    ['завтра в 10 на 2 часа экзамен', '10:00', '12:00'],
    ["завтра о дев'ятій ранку зустріч", '09:00', null],
    ['завтра о пів на десяту дзвінок', '09:30', null],
    ['завтра о 18:00 англійська', '18:00', null],
    ["завтра з дев'ятої до одинадцятої лекція", '09:00', '11:00'],
    ['завтра опівдні обід', '12:00', null],
    ['завтра в одиннадцать тридцать встреча', '11:30', null],
  ])('%s -> %s', (text, start, end) => {
    const t = one(text);
    expect(t.startTime).toBe(start);
    expect(t.endTime).toBe(end);
  });

  it('does not invent time when none was said', () => {
    expect(one('завтра сходить в банк').startTime).toBeNull();
    expect(one('в пятницу забрать посылку').startTime).toBeNull();
  });

  it('flags ambiguous hours (am/pm) instead of guessing silently', () => {
    const t = one('завтра в шесть встреча');
    expect(t.startTime).toBe('18:00');
    expect(t.warnings).toContain('ampm_assumed');
  });

  it('flags past time today', () => {
    expect(one('сегодня в 8 утра зарядка').warnings).toContain('past');
  });
});

describe('recurrence', () => {
  it.each([
    ['каждый день в 7 утра пробежка', { freq: 'daily', interval: 1 }, '2026-11-19'],
    ['каждый понедельник в 10 планёрка', { freq: 'weekly', interval: 1, byWeekday: [0] }, '2026-11-23'],
    ['каждую среду в 18:00 английский', { freq: 'weekly', interval: 1, byWeekday: [2] }, '2026-11-25'],
    ['по рабочим дням в 8 утра зарядка', { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] }, '2026-11-19'],
    ['по будням в 9 стендап', { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] }, '2026-11-19'],
    ['каждые две недели в субботу уборка', { freq: 'weekly', interval: 2, byWeekday: [5] }, '2026-11-21'],
    ['каждый месяц оплатить квартиру', { freq: 'monthly', interval: 1 }, '2026-11-19'],
    ['по понедельникам и средам бассейн', { freq: 'weekly', interval: 1, byWeekday: [0, 2] }, '2026-11-23'],
    ['щосереди о 18:00 англійська', { freq: 'weekly', interval: 1, byWeekday: [2] }, '2026-11-25'],
    ['щодня о 7 ранку пробіжка', { freq: 'daily', interval: 1 }, '2026-11-19'],
    ['кожного понеділка нарада', { freq: 'weekly', interval: 1, byWeekday: [0] }, '2026-11-23'],
    ['по робочих днях о 9 стендап', { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] }, '2026-11-19'],
    ['кожні два тижні прибирання', { freq: 'weekly', interval: 2, byWeekday: [3] }, '2026-11-19'],
    ['щомісяця сплатити рахунки', { freq: 'monthly', interval: 1 }, '2026-11-19'],
  ])('%s', (text, rec, date) => {
    const t = one(text);
    expect(t.recurrence).toEqual(rec);
    expect(t.date).toBe(date);
  });
});

describe('splitting into several tasks', () => {
  it('сначала... потом... после этого... а ещё...', () => {
    const r = parseCommand('Сначала в 9 зарядка, потом в 10 завтрак, после этого в 11 почта, а ещё в 12 позвонить в банк', { today: '2026-11-19', now: '07:00' });
    expect(r.map((t) => [t.title, t.startTime])).toEqual([
      ['Зарядка', '09:00'], ['Завтрак', '10:00'], ['Почта', '11:00'], ['Позвонить в банк', '12:00'],
    ]);
    expect(r[3].location).toBe(''); // "позвонить в банк" is not a place
  });

  it('и в пятницу...', () => {
    const r = parseCommand('завтра в 10 стрижка и в пятницу в 12 обед с мамой', opts);
    expect(r.map((t) => [t.title, t.date, t.startTime])).toEqual([
      ['Стрижка', '2026-11-20', '10:00'],
      ['Обед с мамой', '2026-11-20', '12:00'],
    ]);
  });

  it('keeps "хлеб и молоко" as one task', () => {
    expect(parseCommand('завтра купить хлеб и молоко', opts)).toHaveLength(1);
  });

  it('date at the end of the phrase still belongs to the task', () => {
    const t = one('быть в больнице завтра в 9 утра');
    expect([t.title, t.date, t.startTime]).toEqual(['Быть в больнице', '2026-11-20', '09:00']);
  });

  it('Ukrainian dictation', () => {
    const r = parseCommand("Завтра о дев'ятій ранку зустріч з лікарем, а потім о пів на першу обід. У п'ятницю о шостій вечора англійська", opts);
    expect(r.map((t) => [t.title, t.date, t.startTime])).toEqual([
      ['Зустріч з лікарем', '2026-11-20', '09:00'],
      ['Обід', '2026-11-20', '12:30'],
      ['Англійська', '2026-11-20', '18:00'],
    ]);
  });

  it('empty input', () => {
    expect(parseCommand('   ', opts)).toEqual([]);
  });
});

describe('category hints', () => {
  it.each([
    ['завтра к стоматологу', 'health'],
    ['совещание с клиентом', 'work'],
    ['урок английского', 'study'],
    ['купить подарок', 'shopping'],
    ['оплатить коммуналку', 'finance'],
  ])('%s -> %s', (text, cat) => {
    expect(one(text).categoryHint).toBe(cat);
  });
});
