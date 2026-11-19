import type { AnyRow, Entity, TableName } from '@/data/mapping';
import type { Conflict, LocalAdapter, OutboxItem, Remote } from '@/sync/engine';

export class MemoryLocal implements LocalAdapter {
  entities = new Map<string, Entity>();
  outbox = new Map<string, OutboxItem>();
  meta = new Map<string, unknown>();
  conflicts: Conflict[] = [];
  async getEntity(t: TableName, id: string) { const e = this.entities.get(`${t}:${id}`); return e ? structuredClone(e) : undefined; }
  async putEntity(t: TableName, e: Entity) { this.entities.set(`${t}:${e.id}`, structuredClone(e)); }
  async getOutbox() { return [...this.outbox.values()].map((x) => structuredClone(x)); }
  async getOutboxItem(k: string) { const x = this.outbox.get(k); return x ? structuredClone(x) : undefined; }
  async putOutbox(i: OutboxItem) { this.outbox.set(i.key, structuredClone(i)); }
  async deleteOutbox(k: string) { this.outbox.delete(k); }
  async getMeta<T>(k: string) { return this.meta.get(k) as T | undefined; }
  async setMeta(k: string, v: unknown) { this.meta.set(k, v); }
  async addConflict(c: Conflict) { this.conflicts.push(c); }
}

/** Simulates Postgres + the version trigger. */
export class FakeServer {
  rows = new Map<string, AnyRow>();
  clock = 0;
  online = true;
  /** when true, the next write succeeds on the server but the response is lost */
  dropNextResponse = false;
  private stamp() { this.clock++; return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString(); }
  remote(): Remote {
    const check = () => { if (!this.online) throw new Error('Failed to fetch'); };
    const lose = () => { if (this.dropNextResponse) { this.dropNextResponse = false; throw new Error('Failed to fetch'); } };
    return {
      fetchSince: async (t, since) => { check(); return [...this.rows.entries()].filter(([k, r]) => k.startsWith(t + ':') && (!since || (r.updated_at ?? '') >= since)).map(([, r]) => structuredClone(r)); },
      fetchOne: async (t, id) => { check(); const r = this.rows.get(`${t}:${id}`); return r ? structuredClone(r) : null; },
      insert: async (t, row) => {
        check();
        if (this.rows.has(`${t}:${row.id}`)) return { duplicate: true };
        const r = { ...structuredClone(row), version: 1, updated_at: this.stamp() } as AnyRow;
        this.rows.set(`${t}:${row.id}`, r);
        lose();
        return { row: structuredClone(r) };
      },
      updateIfVersion: async (t, row, version) => {
        check();
        const cur = this.rows.get(`${t}:${row.id}`);
        if (!cur || cur.version !== version) return null;
        const r = { ...structuredClone(row), version: version + 1, updated_at: this.stamp() } as AnyRow;
        this.rows.set(`${t}:${row.id}`, r);
        lose();
        return structuredClone(r);
      },
    };
  }
}
