import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Category, Lang, Settings, Task } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { IdbLocal } from './db';
import { fromRow, type TableName } from './mapping';
import { SyncEngine, type Conflict, type SyncStatus } from '@/sync/engine';
import { SupabaseRemote, cloudConfigured, supabase } from '@/sync/supabase';
import { nowIso, uuid } from '@/lib/util';
import { addDays, nowInTz } from '@/lib/dates';
import { translate, type TKey } from '@/i18n';

export const BUILTIN_CATEGORIES: { key: string; color: string; icon: string; id: string }[] = [
  { key: 'work', color: '#4f7cff', icon: 'briefcase', id: '6d7f0c1e-0000-4000-8000-000000000001' },
  { key: 'personal', color: '#a855f7', icon: 'heart', id: '6d7f0c1e-0000-4000-8000-000000000002' },
  { key: 'health', color: '#f43f5e', icon: 'activity', id: '6d7f0c1e-0000-4000-8000-000000000003' },
  { key: 'study', color: '#f59e0b', icon: 'graduation-cap', id: '6d7f0c1e-0000-4000-8000-000000000004' },
  { key: 'shopping', color: '#10b981', icon: 'shopping-bag', id: '6d7f0c1e-0000-4000-8000-000000000005' },
  { key: 'finance', color: '#0ea5a4', icon: 'wallet', id: '6d7f0c1e-0000-4000-8000-000000000006' },
  { key: 'other', color: '#8e8e93', icon: 'circle', id: '6d7f0c1e-0000-4000-8000-000000000007' },
];

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface State {
  ready: boolean;
  tasks: Task[];
  categories: Category[];
  settings: Settings;
  session: Session | null;
  authChecked: boolean;
  syncStatus: SyncStatus;
  realtime: boolean;
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  conflicts: Conflict[];
  online: boolean;
  toasts: Toast[];
  version: number;
}

const SETTINGS_KEY = 'myday-settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

class AppStore {
  private local = new IdbLocal();
  private listeners = new Set<() => void>();
  private taskMap = new Map<string, Task>();
  private catMap = new Map<string, Category>();
  private unsubRealtime: (() => void) | null = null;
  private remote: SupabaseRemote | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSeq = 0;

  engine = new SyncEngine(this.local, null, (w) => this.onEngineChange(w));

  state: State = {
    ready: false,
    tasks: [],
    categories: [],
    settings: loadSettings(),
    session: null,
    authChecked: !cloudConfigured,
    syncStatus: cloudConfigured ? 'idle' : 'disabled',
    realtime: false,
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
    conflicts: [],
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    toasts: [],
    version: 0,
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(patch: Partial<State> = {}) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    for (const l of this.listeners) l();
  }

  t = (key: TKey) => translate(this.state.settings.lang, key);

  today(): string {
    return nowInTz(this.state.settings.timeZone).date;
  }

  // ------------------------------------------------------------ init

  async init() {
    const [tasks, cats, conflicts] = await Promise.all([
      this.local.allTasks(),
      this.local.allCategories(),
      this.local.getConflicts(),
    ]);
    tasks.forEach((t) => this.taskMap.set(t.id, t));
    cats.forEach((c) => this.catMap.set(c.id, c));
    if (cats.length === 0) await this.seedCategories();
    this.emit({ ready: true, conflicts });
    this.publish();
    await this.refreshPending();

    window.addEventListener('online', () => { this.emit({ online: true }); this.scheduleSync(0); });
    window.addEventListener('offline', () => this.emit({ online: false }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.scheduleSync(0);
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') this.scheduleSync(0);
    }, 60_000);

    const sb = supabase();
    if (sb) {
      const { data } = await sb.auth.getSession();
      this.onSession(data.session);
      sb.auth.onAuthStateChange((_e, session) => this.onSession(session));
    }
  }

  private async seedCategories() {
    const now = nowIso();
    for (const [i, b] of BUILTIN_CATEGORIES.entries()) {
      const c: Category = {
        id: b.id, name: translate(this.state.settings.lang, `cat_${b.key}` as TKey), color: b.color, icon: b.icon,
        sort: i, builtin: b.key, deleted: false, createdAt: now, updatedAt: now, version: 0,
      };
      this.catMap.set(c.id, c);
      await this.local.putEntity('categories', c);
      await this.engine.recordLocalChange('categories', c.id, undefined);
    }
  }

  private onSession(session: Session | null) {
    const prevUser = this.state.session?.user.id;
    this.emit({ session, authChecked: true });
    if (session && session.user.id !== prevUser) {
      this.remote = new SupabaseRemote(supabase()!);
      this.engine.setRemote(this.remote);
      this.unsubRealtime?.();
      this.unsubRealtime = this.remote.subscribe(
        async (table, row) => {
          await this.engine.applyRemote(table, row);
        },
        (ok) => {
          this.emit({ realtime: ok });
          if (ok) this.scheduleSync(0);
        },
      );
      void this.pullSettings();
      this.scheduleSync(0);
    }
    if (!session) {
      this.unsubRealtime?.();
      this.unsubRealtime = null;
      this.remote = null;
      this.engine.setRemote(null);
      this.emit({ realtime: false });
    }
  }

  private async pullSettings() {
    try {
      const s = await this.remote?.loadSettings();
      if (s?.settings && Object.keys(s.settings).length) {
        const merged = { ...this.state.settings, ...(s.settings as Partial<Settings>) };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        this.emit({ settings: merged });
      } else {
        void this.remote?.saveSettings(this.state.settings as unknown as Record<string, unknown>);
      }
    } catch {
      /* offline: keep local settings */
    }
  }

  private async onEngineChange(w: { table?: TableName; status?: boolean }) {
    if (w.table) {
      if (w.table === 'tasks') {
        const all = await this.local.allTasks();
        this.taskMap = new Map(all.map((t) => [t.id, t]));
      } else {
        const all = await this.local.allCategories();
        this.catMap = new Map(all.map((c) => [c.id, c]));
      }
      const conflicts = await this.local.getConflicts();
      this.publish({ conflicts });
    }
    if (w.status) {
      this.emit({ syncStatus: this.engine.status, lastSyncedAt: this.engine.lastSyncedAt, lastError: this.engine.lastError });
      void this.refreshPending();
    }
  }

  private publish(extra: Partial<State> = {}) {
    const tasks = [...this.taskMap.values()].filter((t) => !t.deleted);
    const categories = [...this.catMap.values()].filter((c) => !c.deleted).sort((a, b) => a.sort - b.sort);
    this.emit({ tasks, categories, ...extra });
  }

  private async refreshPending() {
    this.emit({ pending: await this.engine.pendingCount() });
  }

  scheduleSync(delay = 400) {
    if (!this.remote) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.engine.sync();
    }, delay);
  }

  syncNow() {
    return this.engine.sync();
  }

  // ------------------------------------------------------------ toasts

  toast(text: string, action?: Toast['action']) {
    const id = ++this.toastSeq;
    this.emit({ toasts: [...this.state.toasts, { id, text, action }] });
    setTimeout(() => this.dismissToast(id), action ? 5000 : 2600);
  }

  dismissToast(id: number) {
    this.emit({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    this.emit({ settings });
    void this.remote?.saveSettings(settings as unknown as Record<string, unknown>).catch(() => {});
  }

  setLang(lang: Lang) {
    this.updateSettings({ lang, voiceLang: lang });
    // rename untouched built-in categories
    for (const c of this.catMap.values()) {
      if (c.builtin) {
        const ruName = translate('ru', `cat_${c.builtin}` as TKey);
        const ukName = translate('uk', `cat_${c.builtin}` as TKey);
        if (c.name === ruName || c.name === ukName) {
          void this.saveCategory({ ...c, name: translate(lang, `cat_${c.builtin}` as TKey) });
        }
      }
    }
  }

  // ------------------------------------------------------------ tasks

  getTask(id: string) {
    return this.taskMap.get(id);
  }

  private async writeTask(next: Task) {
    const prev = this.taskMap.get(next.id);
    const t = { ...next, updatedAt: nowIso(), version: prev?.version ?? next.version ?? 0 };
    this.taskMap.set(t.id, t);
    this.publish();
    await this.local.putEntity('tasks', t);
    await this.engine.recordLocalChange('tasks', t.id, prev);
    await this.refreshPending();
    this.scheduleSync();
    return t;
  }

  newTask(partial: Partial<Task> = {}): Task {
    const now = nowIso();
    return {
      id: uuid(), title: '', description: '', date: null, startTime: null, endTime: null, categoryId: null,
      priority: 0, location: '', recurrence: null, subtasks: [], favorite: false, completedAt: null,
      doneDates: [], skipDates: [], postponedCount: 0, deleted: false, createdAt: now, updatedAt: now, version: 0,
      ...partial,
    };
  }

  async createTask(partial: Partial<Task>) {
    return this.writeTask(this.newTask(partial));
  }

  async saveTask(task: Task) {
    const prev = this.taskMap.get(task.id);
    let postponedCount = task.postponedCount;
    if (prev && prev.date && task.date && task.date > prev.date && !task.recurrence) postponedCount = prev.postponedCount + 1;
    return this.writeTask({ ...task, postponedCount });
  }

  async updateTask(id: string, patch: Partial<Task>) {
    const prev = this.taskMap.get(id);
    if (!prev) return;
    return this.saveTask({ ...prev, ...patch });
  }

  async toggleDone(task: Task, date: string | null) {
    const cur = this.taskMap.get(task.id) ?? task;
    if (cur.recurrence && date) {
      const has = cur.doneDates.includes(date);
      const doneDates = has ? cur.doneDates.filter((d) => d !== date) : [...cur.doneDates, date].sort();
      await this.writeTask({ ...cur, doneDates });
      return !has;
    }
    const completedAt = cur.completedAt ? null : nowIso();
    await this.writeTask({ ...cur, completedAt });
    return !!completedAt;
  }

  async toggleSubtask(taskId: string, subId: string) {
    const cur = this.taskMap.get(taskId);
    if (!cur) return;
    await this.writeTask({ ...cur, subtasks: cur.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) });
  }

  async toggleFavorite(taskId: string) {
    const cur = this.taskMap.get(taskId);
    if (!cur) return;
    await this.writeTask({ ...cur, favorite: !cur.favorite });
  }

  async deleteTask(taskId: string) {
    const cur = this.taskMap.get(taskId);
    if (!cur) return;
    await this.writeTask({ ...cur, deleted: true });
    this.toast(this.t('deleted'), { label: this.t('undo'), run: () => void this.writeTask({ ...cur, deleted: false }) });
  }

  async deleteOccurrence(taskId: string, date: string) {
    const cur = this.taskMap.get(taskId);
    if (!cur) return;
    await this.writeTask({ ...cur, skipDates: [...new Set([...cur.skipDates, date])].sort() });
    this.toast(this.t('deleted'), { label: this.t('undo'), run: () => void this.writeTask({ ...this.taskMap.get(taskId)!, skipDates: cur.skipDates }) });
  }

  async duplicateTask(taskId: string) {
    const cur = this.taskMap.get(taskId);
    if (!cur) return;
    const now = nowIso();
    const copy = this.newTask({
      ...cur, id: uuid(), completedAt: null, doneDates: [], skipDates: [], postponedCount: 0,
      subtasks: cur.subtasks.map((s) => ({ ...s, id: uuid(), done: false })), createdAt: now, version: 0,
    });
    await this.writeTask(copy);
    this.toast(this.t('duplicated'));
    return copy;
  }

  /** Move a task (or a single occurrence of a recurring one) to another date/time. */
  async moveTask(taskId: string, fromDate: string | null, toDate: string | null, startTime?: string | null) {
    const cur = this.taskMap.get(taskId);
    if (!cur) return;
    if (cur.recurrence && fromDate) {
      // detach this occurrence into its own task
      await this.writeTask({ ...cur, skipDates: [...new Set([...cur.skipDates, fromDate])].sort() });
      const done = cur.doneDates.includes(fromDate);
      const single = this.newTask({
        ...cur, id: uuid(), recurrence: null, date: toDate, doneDates: [], skipDates: [],
        startTime: startTime === undefined ? cur.startTime : startTime,
        endTime: startTime === undefined ? cur.endTime : shiftEnd(cur, startTime),
        completedAt: done ? nowIso() : null, postponedCount: toDate && toDate > fromDate ? 1 : 0, version: 0,
      });
      await this.writeTask(single);
    } else {
      const later = !!(cur.date && toDate && toDate > cur.date);
      await this.writeTask({
        ...cur, date: toDate,
        startTime: startTime === undefined ? cur.startTime : startTime,
        endTime: startTime === undefined ? cur.endTime : shiftEnd(cur, startTime),
        postponedCount: cur.postponedCount + (later ? 1 : 0),
      });
    }
  }

  async postpone(taskId: string, fromDate: string | null, days: number) {
    const base = fromDate ?? this.today();
    await this.moveTask(taskId, fromDate, addDays(base < this.today() ? this.today() : base, days));
    this.toast(this.t('postponed'));
  }

  // ------------------------------------------------------------ categories

  async saveCategory(c: Category) {
    const prev = this.catMap.get(c.id);
    const next = { ...c, updatedAt: nowIso(), version: prev?.version ?? c.version ?? 0 };
    this.catMap.set(next.id, next);
    this.publish();
    await this.local.putEntity('categories', next);
    await this.engine.recordLocalChange('categories', next.id, prev);
    await this.refreshPending();
    this.scheduleSync();
  }

  async createCategory(name: string, color: string) {
    const now = nowIso();
    await this.saveCategory({
      id: uuid(), name, color, icon: 'tag', sort: this.catMap.size, builtin: null, deleted: false,
      createdAt: now, updatedAt: now, version: 0,
    });
  }

  categoryName(c: Category | undefined | null): string {
    if (!c) return '';
    return c.name;
  }

  // ------------------------------------------------------------ conflicts

  async resolveConflict(c: Conflict, keep: 'mine' | 'theirs') {
    if (keep === 'mine') {
      const entity = fromRow(c.table, { ...c.local, version: c.server.version, updated_at: c.server.updated_at });
      if (c.table === 'tasks') {
        const prev = this.taskMap.get(c.entityId);
        await this.writeTask({ ...(entity as Task), version: prev?.version ?? (c.server.version ?? 0) });
      } else {
        await this.saveCategory(entity as Category);
      }
    }
    await this.local.deleteConflict(c.id);
    this.emit({ conflicts: await this.local.getConflicts() });
  }

  // ------------------------------------------------------------ backup

  exportData() {
    return {
      app: 'myday-planner',
      format: 1,
      exportedAt: nowIso(),
      settings: this.state.settings,
      categories: [...this.catMap.values()],
      tasks: [...this.taskMap.values()],
    };
  }

  async importData(data: unknown): Promise<number> {
    const d = data as { app?: string; tasks?: Task[]; categories?: Category[] };
    if (!d || d.app !== 'myday-planner' || !Array.isArray(d.tasks)) throw new Error('bad format');
    let n = 0;
    for (const c of d.categories ?? []) {
      if (!c?.id || !c.name) continue;
      const cur = this.catMap.get(c.id);
      if (!cur || cur.updatedAt < c.updatedAt) await this.saveCategory({ ...c, version: cur?.version ?? 0 });
    }
    for (const t of d.tasks) {
      if (!t?.id || typeof t.title !== 'string') continue;
      const cur = this.taskMap.get(t.id);
      if (cur && cur.updatedAt >= t.updatedAt) continue;
      const clean = this.newTask({ ...t, version: cur?.version ?? 0 });
      await this.writeTask(clean);
      n++;
    }
    return n;
  }

  async signOut(force = false) {
    if (!force && this.state.pending > 0) return false;
    await supabase()?.auth.signOut();
    await this.local.clearAll();
    this.taskMap.clear();
    this.catMap.clear();
    await this.seedCategories();
    this.publish({ conflicts: [], pending: 0 });
    return true;
  }
}

function shiftEnd(t: Task, newStart: string | null): string | null {
  if (!newStart || !t.startTime || !t.endTime) return newStart ? t.endTime && !t.startTime ? null : t.endTime : null;
  const [sh, sm] = t.startTime.split(':').map(Number);
  const [eh, em] = t.endTime.split(':').map(Number);
  const [nh, nm] = newStart.split(':').map(Number);
  const dur = eh * 60 + em - (sh * 60 + sm);
  const end = Math.min(nh * 60 + nm + dur, 23 * 60 + 59);
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export const store = new AppStore();

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.state), () => selector(store.state));
}

export function useT() {
  const lang = useStore((s) => s.settings.lang);
  return (key: TKey) => translate(lang, key);
}
