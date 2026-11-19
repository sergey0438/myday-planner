export type Lang = 'ru' | 'uk';
export type Priority = 0 | 1 | 2 | 3; // 0 none, 1 low, 2 medium, 3 high

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface Recurrence {
  freq: RecurrenceFreq;
  interval: number; // every N units
  /** 0 = Monday ... 6 = Sunday; only for weekly */
  byWeekday?: number[];
  until?: string | null; // YYYY-MM-DD
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** Local calendar date YYYY-MM-DD in the user's time zone. null = Inbox. */
  date: string | null;
  /** HH:mm */
  startTime: string | null;
  endTime: string | null;
  categoryId: string | null;
  priority: Priority;
  location: string;
  recurrence: Recurrence | null;
  subtasks: Subtask[];
  favorite: boolean;
  /** ISO timestamp when completed (non-recurring tasks) */
  completedAt: string | null;
  /** Completed occurrences of a recurring task (YYYY-MM-DD) */
  doneDates: string[];
  /** Removed occurrences of a recurring task */
  skipDates: string[];
  postponedCount: number;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  /** Server version. 0 = never synced. */
  version: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort: number;
  /** built-in key for translation, e.g. 'work' */
  builtin: string | null;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type Theme = 'system' | 'light' | 'dark';
export interface Settings {
  lang: Lang;
  voiceLang: Lang;
  timeZone: string;
  weekStartsOn: 0 | 1;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'ru',
  voiceLang: 'ru',
  timeZone: 'Europe/Kyiv',
  weekStartsOn: 1,
  theme: 'system',
};

/** A concrete appearance of a task on a specific day (recurring tasks expand into many). */
export interface Occurrence {
  task: Task;
  date: string | null;
  done: boolean;
}
