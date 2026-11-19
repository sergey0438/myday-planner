import type { Occurrence, Recurrence, Task } from './types';
import { addDays, diffDays, parseYmd, rangeDays, weekdayMon0, daysInMonth } from './dates';

/** Does a recurring rule starting at `start` produce an occurrence on `date`? */
export function ruleOccursOn(rule: Recurrence, start: string, date: string): boolean {
  if (date < start) return false;
  if (rule.until && date > rule.until) return false;
  const interval = Math.max(1, rule.interval || 1);
  switch (rule.freq) {
    case 'daily':
      return diffDays(date, start) % interval === 0;
    case 'weekly': {
      const days = rule.byWeekday && rule.byWeekday.length ? rule.byWeekday : [weekdayMon0(start)];
      if (!days.includes(weekdayMon0(date))) return false;
      // week index relative to the week (Mon-based) containing start
      const startWeek = addDays(start, -weekdayMon0(start));
      const dateWeek = addDays(date, -weekdayMon0(date));
      const weeks = Math.round(diffDays(dateWeek, startWeek) / 7);
      return weeks % interval === 0;
    }
    case 'monthly': {
      const s = parseYmd(start);
      const d = parseYmd(date);
      const months = (d.y - s.y) * 12 + (d.m - s.m);
      if (months % interval !== 0) return false;
      const target = Math.min(s.d, daysInMonth(d.y, d.m));
      return d.d === target;
    }
    case 'yearly': {
      const s = parseYmd(start);
      const d = parseYmd(date);
      if ((d.y - s.y) % interval !== 0) return false;
      return d.m === s.m && d.d === Math.min(s.d, daysInMonth(d.y, d.m));
    }
  }
}

export function taskOccursOn(task: Task, date: string): boolean {
  if (task.deleted || !task.date) return false;
  if (!task.recurrence) return task.date === date;
  if (task.skipDates.includes(date)) return false;
  return ruleOccursOn(task.recurrence, task.date, date);
}

export function isDoneOn(task: Task, date: string | null): boolean {
  if (task.recurrence) return date ? task.doneDates.includes(date) : false;
  return !!task.completedAt;
}

export function occurrencesOn(tasks: Task[], date: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const t of tasks) {
    if (taskOccursOn(t, date)) out.push({ task: t, date, done: isDoneOn(t, date) });
  }
  return sortOccurrences(out);
}

export function occurrencesInRange(tasks: Task[], from: string, to: string): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const d of rangeDays(from, to)) map.set(d, occurrencesOn(tasks, d));
  return map;
}

export function sortOccurrences(list: Occurrence[]): Occurrence[] {
  return list.sort((a, b) => {
    const ta = a.task.startTime ?? '99:99';
    const tb = b.task.startTime ?? '99:99';
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.task.priority !== b.task.priority) return b.task.priority - a.task.priority;
    return a.task.createdAt < b.task.createdAt ? -1 : 1;
  });
}

/** First occurrence date >= from (search up to ~2 years). */
export function nextOccurrence(task: Task, from: string): string | null {
  if (!task.date) return null;
  if (!task.recurrence) return task.date >= from ? task.date : null;
  let d = from < task.date ? task.date : from;
  for (let i = 0; i < 800; i++) {
    if (taskOccursOn(task, d)) return d;
    d = addDays(d, 1);
  }
  return null;
}

/** Given a rule and a reference date, find the first date >= ref that matches the rule's weekdays. */
export function alignStart(rule: Recurrence, ref: string): string {
  if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(ref, i);
      if (rule.byWeekday.includes(weekdayMon0(d))) return d;
    }
  }
  return ref;
}
