import type { Category, Task } from '@/lib/types';

export type TableName = 'tasks' | 'categories';

/** Row shape in Postgres (snake_case). */
export interface TaskRow {
  id: string;
  user_id?: string;
  title: string;
  description: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  category_id: string | null;
  priority: number;
  location: string;
  recurrence: unknown;
  subtasks: unknown;
  favorite: boolean;
  completed_at: string | null;
  done_dates: string[];
  skip_dates: string[];
  postponed_count: number;
  deleted: boolean;
  created_at: string;
  updated_at?: string;
  version?: number;
}

export interface CategoryRow {
  id: string;
  user_id?: string;
  name: string;
  color: string;
  icon: string;
  sort: number;
  builtin: string | null;
  deleted: boolean;
  created_at: string;
  updated_at?: string;
  version?: number;
}

export type AnyRow = TaskRow | CategoryRow;
export type Entity = Task | Category;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

export function taskToRow(t: Task): TaskRow {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    date: t.date,
    start_time: t.startTime,
    end_time: t.endTime,
    category_id: t.categoryId,
    priority: t.priority,
    location: t.location,
    recurrence: t.recurrence,
    subtasks: t.subtasks,
    favorite: t.favorite,
    completed_at: t.completedAt,
    done_dates: t.doneDates,
    skip_dates: t.skipDates,
    postponed_count: t.postponedCount,
    deleted: t.deleted,
    created_at: t.createdAt,
  };
}

export function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title ?? '',
    description: r.description ?? '',
    date: r.date,
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    categoryId: r.category_id,
    priority: (r.priority ?? 0) as Task['priority'],
    location: r.location ?? '',
    recurrence: (r.recurrence as Task['recurrence']) ?? null,
    subtasks: (r.subtasks as Task['subtasks']) ?? [],
    favorite: !!r.favorite,
    completedAt: r.completed_at,
    doneDates: r.done_dates ?? [],
    skipDates: r.skip_dates ?? [],
    postponedCount: r.postponed_count ?? 0,
    deleted: !!r.deleted,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    version: r.version ?? 0,
  };
}

export function categoryToRow(c: Category): CategoryRow {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
    sort: c.sort,
    builtin: c.builtin,
    deleted: c.deleted,
    created_at: c.createdAt,
  };
}

export function rowToCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    icon: r.icon ?? 'tag',
    sort: r.sort ?? 0,
    builtin: r.builtin,
    deleted: !!r.deleted,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    version: r.version ?? 0,
  };
}

export function toRow(table: TableName, e: Entity): AnyRow {
  return table === 'tasks' ? taskToRow(e as Task) : categoryToRow(e as Category);
}

export function fromRow(table: TableName, r: AnyRow): Entity {
  return table === 'tasks' ? rowToTask(r as TaskRow) : rowToCategory(r as CategoryRow);
}

/** Fields that can be edited by the user (used for 3-way merge). */
export const MERGE_FIELDS: Record<TableName, string[]> = {
  tasks: ['title', 'description', 'date', 'start_time', 'end_time', 'category_id', 'priority', 'location', 'recurrence', 'subtasks', 'favorite', 'completed_at', 'done_dates', 'skip_dates', 'postponed_count', 'deleted'],
  categories: ['name', 'color', 'icon', 'sort', 'builtin', 'deleted'],
};
/** Array fields merged as sets (both sides' additions/removals are kept). */
export const SET_FIELDS = new Set(['done_dates', 'skip_dates']);
