// Offline-first sync engine.
//
// * Every local change is written to the local database first and recorded in an outbox.
// * push() sends the outbox using optimistic concurrency (row version must match).
// * If the server row changed in the meantime, a 3-way merge is attempted using the
//   snapshot the change was based on. Non-overlapping edits are merged automatically;
//   overlapping edits become a visible Conflict that the user resolves. Nothing is
//   overwritten silently.
// * pull() and realtime events bring remote changes in.

import {
  fromRow, MERGE_FIELDS, SET_FIELDS, toRow,
  type AnyRow, type Entity, type TableName,
} from '@/data/mapping';
import { deepEqual, uuid } from '@/lib/util';

export interface OutboxItem {
  key: string; // `${table}:${id}`
  table: TableName;
  id: string;
  /** Server row the local change was based on (null = created locally). */
  base: AnyRow | null;
  queuedAt: number;
}

export interface Conflict {
  id: string;
  table: TableName;
  entityId: string;
  local: AnyRow;
  server: AnyRow;
  fields: string[];
  createdAt: string;
}

export interface LocalAdapter {
  getEntity(table: TableName, id: string): Promise<Entity | undefined>;
  putEntity(table: TableName, e: Entity): Promise<void>;
  getOutbox(): Promise<OutboxItem[]>;
  getOutboxItem(key: string): Promise<OutboxItem | undefined>;
  putOutbox(item: OutboxItem): Promise<void>;
  deleteOutbox(key: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  addConflict(c: Conflict): Promise<void>;
}

export interface InsertResult { row?: AnyRow; duplicate?: boolean }

export interface Remote {
  fetchSince(table: TableName, since: string | null): Promise<AnyRow[]>;
  fetchOne(table: TableName, id: string): Promise<AnyRow | null>;
  insert(table: TableName, row: AnyRow): Promise<InsertResult>;
  /** Update only if the server row still has `version`. Returns the new row or null. */
  updateIfVersion(table: TableName, row: AnyRow, version: number): Promise<AnyRow | null>;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';

const TABLES: TableName[] = ['categories', 'tasks'];

export interface MergeResult {
  merged: AnyRow;
  conflicts: string[];
}

/** 3-way merge of a row. `base` is what the local edit started from. */
export function merge3(table: TableName, base: AnyRow | null, local: AnyRow, server: AnyRow): MergeResult {
  const merged: Record<string, unknown> = { ...server };
  const conflicts: string[] = [];
  const b = (base ?? {}) as Record<string, unknown>;
  const l = local as unknown as Record<string, unknown>;
  const s = server as unknown as Record<string, unknown>;
  for (const f of MERGE_FIELDS[table]) {
    const lv = l[f];
    const sv = s[f];
    const bv = base ? b[f] : undefined;
    if (deepEqual(lv, sv)) continue;
    const localChanged = !base || !deepEqual(lv, bv);
    const serverChanged = !!base && !deepEqual(sv, bv);
    if (SET_FIELDS.has(f) && base) {
      const bs = new Set((bv as string[]) ?? []);
      const ls = new Set((lv as string[]) ?? []);
      const out = new Set((sv as string[]) ?? []);
      for (const x of ls) if (!bs.has(x)) out.add(x);
      for (const x of bs) if (!ls.has(x)) out.delete(x);
      merged[f] = [...out].sort();
      continue;
    }
    if (localChanged && !serverChanged) {
      merged[f] = lv;
    } else if (localChanged && serverChanged) {
      conflicts.push(f);
    }
    // only server changed -> keep server value
  }
  return { merged: merged as unknown as AnyRow, conflicts };
}

export class SyncEngine {
  status: SyncStatus = 'idle';
  lastError: string | null = null;
  lastSyncedAt: string | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private local: LocalAdapter,
    private remote: Remote | null,
    private onChange: (what: { table?: TableName; status?: boolean }) => void = () => {},
  ) {
    if (!remote) this.status = 'disabled';
  }

  setRemote(remote: Remote | null) {
    this.remote = remote;
    this.status = remote ? 'idle' : 'disabled';
    this.onChange({ status: true });
  }

  /** Must be called after the local entity has been saved. `previous` is the entity before the change. */
  async recordLocalChange(table: TableName, id: string, previous: Entity | undefined) {
    const key = `${table}:${id}`;
    const existing = await this.local.getOutboxItem(key);
    if (existing) {
      existing.queuedAt = Date.now();
      await this.local.putOutbox(existing);
      return;
    }
    const base = previous && previous.version > 0 ? { ...toRow(table, previous), version: previous.version, updated_at: previous.updatedAt } : null;
    await this.local.putOutbox({ key, table, id, base, queuedAt: Date.now() });
  }

  async pendingCount(): Promise<number> {
    return (await this.local.getOutbox()).length;
  }

  sync(): Promise<void> {
    if (!this.remote) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          this.setStatus('syncing');
          await this.push();
          await this.pull();
        } while (this.again);
        this.lastError = null;
        this.lastSyncedAt = new Date().toISOString();
        this.setStatus('idle');
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        this.setStatus(offline || isNetworkError(e) ? 'offline' : 'error');
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
    this.onChange({ status: true });
  }

  async push() {
    const remote = this.remote;
    if (!remote) return;
    const items = (await this.local.getOutbox()).sort((a, b) => {
      // categories before tasks (tasks reference categories)
      if (a.table !== b.table) return a.table === 'categories' ? -1 : 1;
      return a.queuedAt - b.queuedAt;
    });
    for (const item of items) {
      await this.pushItem(remote, item, 0);
    }
  }

  private async pushItem(remote: Remote, item: OutboxItem, depth: number): Promise<void> {
    const local = await this.local.getEntity(item.table, item.id);
    if (!local) {
      await this.local.deleteOutbox(item.key);
      return;
    }
    const sentStamp = local.updatedAt;
    const row = toRow(item.table, local);
    const baseVersion = item.base?.version ?? 0;
    let serverRow: AnyRow | null = null;

    if (baseVersion === 0) {
      const res = await remote.insert(item.table, row);
      if (res.row) return this.acceptServer(item, res.row, sentStamp);
      serverRow = await remote.fetchOne(item.table, item.id);
    } else {
      const updated = await remote.updateIfVersion(item.table, row, baseVersion);
      if (updated) return this.acceptServer(item, updated, sentStamp);
      serverRow = await remote.fetchOne(item.table, item.id);
      if (!serverRow) {
        const res = await remote.insert(item.table, row);
        if (res.row) return this.acceptServer(item, res.row, sentStamp);
        serverRow = await remote.fetchOne(item.table, item.id);
      }
    }
    if (!serverRow) throw new Error('Не удалось сохранить изменение на сервере');

    // Someone else changed this row: merge.
    const { merged, conflicts } = merge3(item.table, item.base, row, serverRow);
    if (conflicts.length === 0) {
      const sameAsServer = MERGE_FIELDS[item.table].every((f) =>
        deepEqual((merged as unknown as Record<string, unknown>)[f], (serverRow as unknown as Record<string, unknown>)[f]));
      if (sameAsServer) return this.acceptServer(item, serverRow, sentStamp);
      // write merged locally and push again on top of the server version
      const mergedEntity = fromRow(item.table, { ...merged, version: serverRow.version, updated_at: new Date().toISOString() } as AnyRow);
      await this.local.putEntity(item.table, mergedEntity);
      const next: OutboxItem = { ...item, base: serverRow };
      await this.local.putOutbox(next);
      this.onChange({ table: item.table });
      if (depth < 3) return this.pushItem(remote, next, depth + 1);
      return;
    }
    // Real conflict: show the server version, keep the local version for the user to choose.
    await this.local.addConflict({
      id: uuid(), table: item.table, entityId: item.id, local: row, server: serverRow,
      fields: conflicts, createdAt: new Date().toISOString(),
    });
    await this.local.putEntity(item.table, fromRow(item.table, serverRow));
    await this.local.deleteOutbox(item.key);
    this.onChange({ table: item.table });
  }

  private async acceptServer(item: OutboxItem, serverRow: AnyRow, sentStamp: string) {
    const current = await this.local.getEntity(item.table, item.id);
    if (current && current.updatedAt !== sentStamp) {
      // edited again while the request was in flight: keep local data, rebase on the new version
      await this.local.putEntity(item.table, { ...current, version: serverRow.version ?? current.version });
      await this.local.putOutbox({ ...item, base: serverRow, queuedAt: Date.now() });
      this.again = true;
    } else {
      await this.local.putEntity(item.table, fromRow(item.table, serverRow));
      await this.local.deleteOutbox(item.key);
    }
    this.onChange({ table: item.table });
  }

  async pull() {
    const remote = this.remote;
    if (!remote) return;
    for (const table of TABLES) {
      const since = await this.local.getMeta<string>(`pulled:${table}`);
      // re-read a small window to cover transactions that committed late
      const sinceWithMargin = since ? new Date(new Date(since).getTime() - 120_000).toISOString() : null;
      const rows = await remote.fetchSince(table, sinceWithMargin);
      let max = since ?? null;
      let changed = false;
      for (const r of rows) {
        if (await this.applyRemote(table, r, false)) changed = true;
        if (r.updated_at && (!max || r.updated_at > max)) max = r.updated_at;
      }
      if (max) await this.local.setMeta(`pulled:${table}`, max);
      if (changed) this.onChange({ table });
    }
  }

  /** Apply a row that came from the server (pull or realtime). Returns true if local data changed. */
  async applyRemote(table: TableName, row: AnyRow, notify = true): Promise<boolean> {
    const key = `${table}:${row.id}`;
    if (await this.local.getOutboxItem(key)) {
      // local edits pending: they will be merged against this row on push
      this.again = true;
      return false;
    }
    const local = await this.local.getEntity(table, row.id);
    if (local && local.version > (row.version ?? 0)) return false;
    if (local && local.version === (row.version ?? 0) && local.updatedAt === row.updated_at) return false;
    await this.local.putEntity(table, fromRow(table, row));
    if (notify) this.onChange({ table });
    return true;
  }
}

export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|Failed to fetch|Load failed|NetworkError|timeout|offline/i.test(msg);
}
