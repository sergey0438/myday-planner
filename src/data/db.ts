import { openDB, type IDBPDatabase } from 'idb';
import type { Category, Task } from '@/lib/types';
import type { Entity, TableName } from './mapping';
import type { Conflict, LocalAdapter, OutboxItem } from '@/sync/engine';

const DB_NAME = 'myday-planner';
const DB_VERSION = 1;

type DB = IDBPDatabase;
let dbp: Promise<DB> | null = null;

export function getDb(): Promise<DB> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('conflicts')) db.createObjectStore('conflicts', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export class IdbLocal implements LocalAdapter {
  async getEntity(table: TableName, id: string) {
    return (await getDb()).get(table, id) as Promise<Entity | undefined>;
  }
  async putEntity(table: TableName, e: Entity) {
    await (await getDb()).put(table, e);
  }
  async getOutbox() {
    return (await getDb()).getAll('outbox') as Promise<OutboxItem[]>;
  }
  async getOutboxItem(key: string) {
    return (await getDb()).get('outbox', key) as Promise<OutboxItem | undefined>;
  }
  async putOutbox(item: OutboxItem) {
    await (await getDb()).put('outbox', item);
  }
  async deleteOutbox(key: string) {
    await (await getDb()).delete('outbox', key);
  }
  async getMeta<T>(key: string) {
    return (await getDb()).get('meta', key) as Promise<T | undefined>;
  }
  async setMeta(key: string, value: unknown) {
    await (await getDb()).put('meta', value, key);
  }
  async addConflict(c: Conflict) {
    await (await getDb()).put('conflicts', c);
  }
  async getConflicts() {
    return (await getDb()).getAll('conflicts') as Promise<Conflict[]>;
  }
  async deleteConflict(id: string) {
    await (await getDb()).delete('conflicts', id);
  }
  async allTasks() {
    return (await getDb()).getAll('tasks') as Promise<Task[]>;
  }
  async allCategories() {
    return (await getDb()).getAll('categories') as Promise<Category[]>;
  }
  async clearAll() {
    const db = await getDb();
    for (const s of ['tasks', 'categories', 'outbox', 'meta', 'conflicts']) await db.clear(s);
  }
}
