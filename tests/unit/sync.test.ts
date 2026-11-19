import { describe, expect, it } from 'vitest';
import { SyncEngine, merge3 } from '@/sync/engine';
import type { Task } from '@/lib/types';
import { taskToRow } from '@/data/mapping';
import { FakeServer, MemoryLocal } from './helpers';

let t0 = 0;
function makeTask(over: Partial<Task> = {}): Task {
  const now = new Date(Date.UTC(2026, 10, 19, 10, 0, t0++)).toISOString();
  return {
    id: 'task-1', title: 'Врач', description: '', date: '2026-11-20', startTime: '09:00', endTime: null,
    categoryId: null, priority: 0, location: '', recurrence: null, subtasks: [], favorite: false,
    completedAt: null, doneDates: [], skipDates: [], postponedCount: 0, deleted: false,
    createdAt: now, updatedAt: now, version: 0, ...over,
  };
}

class Device {
  local = new MemoryLocal();
  engine: SyncEngine;
  constructor(server: FakeServer) { this.engine = new SyncEngine(this.local, server.remote()); }
  async edit(id: string, patch: Partial<Task>) {
    const prev = (await this.local.getEntity('tasks', id)) as Task | undefined;
    const next = { ...(prev ?? makeTask({ id })), ...patch, updatedAt: new Date(Date.UTC(2026, 10, 19, 11, 0, t0++)).toISOString() } as Task;
    await this.local.putEntity('tasks', next);
    await this.engine.recordLocalChange('tasks', id, prev);
  }
  async get(id: string) { return (await this.local.getEntity('tasks', id)) as Task; }
}

describe('sync engine', () => {
  it('iPhone creates a task, iPad receives it, iPad completes it, iPhone sees it', async () => {
    const server = new FakeServer();
    const iphone = new Device(server);
    const ipad = new Device(server);
    await iphone.local.putEntity('tasks', makeTask());
    await iphone.engine.recordLocalChange('tasks', 'task-1', undefined);
    await iphone.engine.sync();
    expect(server.rows.get('tasks:task-1')?.version).toBe(1);
    expect(await iphone.engine.pendingCount()).toBe(0);

    await ipad.engine.sync();
    expect((await ipad.get('task-1')).title).toBe('Врач');

    await ipad.edit('task-1', { completedAt: '2026-11-20T09:30:00Z' });
    await ipad.engine.sync();
    await iphone.engine.sync();
    expect((await iphone.get('task-1')).completedAt).toBe('2026-11-20T09:30:00Z');
    expect((await iphone.get('task-1')).version).toBe(2);
  });

  it('offline changes are queued and sent after reconnect', async () => {
    const server = new FakeServer();
    const phone = new Device(server);
    server.online = false;
    await phone.edit('a', { title: 'Купить хлеб' });
    await phone.edit('b', { title: 'Позвонить' });
    await phone.engine.sync();
    expect(phone.engine.status).toBe('offline');
    expect(await phone.engine.pendingCount()).toBe(2);
    expect((await phone.get('a')).title).toBe('Купить хлеб'); // still usable locally
    server.online = true;
    await phone.engine.sync();
    expect(phone.engine.status).toBe('idle');
    expect(await phone.engine.pendingCount()).toBe(0);
    expect(server.rows.size).toBe(2);
  });

  it('non-overlapping concurrent edits are merged automatically', async () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    await a.edit('task-1', {});
    await a.engine.sync();
    await b.engine.sync();
    await a.edit('task-1', { title: 'Врач (кардиолог)' });
    await b.edit('task-1', { startTime: '10:00' });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    const sa = await a.get('task-1');
    const sb = await b.get('task-1');
    expect([sa.title, sa.startTime]).toEqual(['Врач (кардиолог)', '10:00']);
    expect([sb.title, sb.startTime]).toEqual(['Врач (кардиолог)', '10:00']);
    expect(a.local.conflicts).toHaveLength(0);
    expect(b.local.conflicts).toHaveLength(0);
  });

  it('overlapping edits create a visible conflict instead of silent overwrite', async () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    await a.edit('task-1', {});
    await a.engine.sync();
    await b.engine.sync();
    await a.edit('task-1', { title: 'Версия A' });
    await b.edit('task-1', { title: 'Версия B' });
    await a.engine.sync();
    await b.engine.sync();
    expect(b.local.conflicts).toHaveLength(1);
    expect(b.local.conflicts[0].fields).toEqual(['title']);
    expect((b.local.conflicts[0].local as { title: string }).title).toBe('Версия B');
    expect((await b.get('task-1')).title).toBe('Версия A');
    expect((server.rows.get('tasks:task-1') as { title: string }).title).toBe('Версия A');
  });

  it('completions of a recurring task on two devices are both kept', async () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    await a.edit('r', { recurrence: { freq: 'daily', interval: 1 } });
    await a.engine.sync();
    await b.engine.sync();
    await a.edit('r', { doneDates: ['2026-11-20'] });
    await b.edit('r', { doneDates: ['2026-11-21'] });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.get('r')).doneDates).toEqual(['2026-11-20', '2026-11-21']);
    expect((await b.get('r')).doneDates).toEqual(['2026-11-20', '2026-11-21']);
    expect(b.local.conflicts).toHaveLength(0);
  });

  it('a lost response does not create a false conflict or duplicate', async () => {
    const server = new FakeServer();
    const a = new Device(server);
    await a.edit('x', { title: 'Тест' });
    server.dropNextResponse = true;
    await a.engine.sync();
    expect(a.engine.status).toBe('offline');
    await a.engine.sync();
    expect(a.engine.status).toBe('idle');
    expect(a.local.conflicts).toHaveLength(0);
    expect(server.rows.size).toBe(1);
    expect(await a.engine.pendingCount()).toBe(0);
  });

  it('remote change does not overwrite a pending local edit', async () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    await a.edit('t', { title: 'Исходное' });
    await a.engine.sync();
    await b.engine.sync();
    await b.edit('t', { location: 'Офис' });
    await a.edit('t', { priority: 3 });
    await a.engine.sync();
    // b receives a's row while having pending changes
    await b.engine.applyRemote('tasks', server.rows.get('tasks:t')!);
    expect((await b.get('t')).location).toBe('Офис');
    await b.engine.sync();
    const r = await b.get('t');
    expect([r.location, r.priority]).toEqual(['Офис', 3]);
  });

  it('deletes propagate as soft deletes', async () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    await a.edit('d', {});
    await a.engine.sync();
    await b.engine.sync();
    await b.edit('d', { deleted: true });
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.get('d')).deleted).toBe(true);
  });
});

describe('merge3', () => {
  it('treats identical values as no conflict even without base', () => {
    const row = taskToRow(makeTask());
    expect(merge3('tasks', null, row, { ...row, version: 1 }).conflicts).toEqual([]);
  });
});
