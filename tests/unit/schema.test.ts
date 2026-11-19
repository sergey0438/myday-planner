// Runs the real migration on an in-process PostgreSQL (PGlite) with a minimal
// stand-in for Supabase's "auth" schema, and checks RLS, versioning and the
// single-account lock.
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
let db: PGlite;

async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);`);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${U1}', 'owner@example.com'), ('${U2}', 'other@example.com');
  `);
  const sql = readFileSync(new URL('../../supabase/migrations/0001_init.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // idempotent
}, 60_000);

describe('database schema', () => {
  it('owner can create and read their tasks; version starts at 1', async () => {
    await as(U1, `insert into public.categories (id, name, color) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Работа', '#3b82f6')`);
    await as(U1, `insert into public.tasks (id, title, date, start_time, category_id) values ('bbbbbbbb-0000-4000-8000-000000000001', 'Врач', '2026-11-20', '09:00', 'aaaaaaaa-0000-4000-8000-000000000001')`);
    const r = await as(U1, 'select title, version, user_id from public.tasks');
    expect(r.rows).toEqual([{ title: 'Врач', version: 1, user_id: U1 }]);
  });

  it('update bumps the version; stale version updates nothing', async () => {
    const ok = await as(U1, `update public.tasks set title = 'Врач 2' where id = 'bbbbbbbb-0000-4000-8000-000000000001' and version = 1 returning version`);
    expect(ok.rows).toEqual([{ version: 2 }]);
    const stale = await as(U1, `update public.tasks set title = 'старое' where id = 'bbbbbbbb-0000-4000-8000-000000000001' and version = 1 returning version`);
    expect(stale.rows).toEqual([]);
  });

  it('another user sees nothing and cannot modify', async () => {
    expect((await as(U2, 'select * from public.tasks')).rows).toEqual([]);
    const upd = await as(U2, `update public.tasks set title = 'взлом' returning id`);
    expect(upd.rows).toEqual([]);
    await expect(as(U2, `insert into public.tasks (id, title, user_id) values ('bbbbbbbb-0000-4000-8000-000000000009', 'x', '${U1}')`)).rejects.toThrow();
  });

  it('a task cannot point to someone else\'s category', async () => {
    await as(U2, `insert into public.categories (id, name, color) values ('aaaaaaaa-0000-4000-8000-000000000002', 'Чужая', '#ff0000')`);
    await expect(as(U1, `insert into public.tasks (id, title, category_id) values ('bbbbbbbb-0000-4000-8000-000000000003', 'x', 'aaaaaaaa-0000-4000-8000-000000000002')`)).rejects.toThrow();
  });

  it('anonymous visitors cannot read anything', async () => {
    await expect(as(null, 'select * from public.tasks')).rejects.toThrow(/permission denied/);
  });

  it('ownership cannot be changed by an update', async () => {
    await as(U1, `update public.tasks set user_id = '${U2}' where id = 'bbbbbbbb-0000-4000-8000-000000000001'`).catch(() => {});
    const r = await db.query(`select user_id from public.tasks where id = 'bbbbbbbb-0000-4000-8000-000000000001'`);
    expect(r.rows).toEqual([{ user_id: U1 }]);
  });

  it('data checks: invalid color, end before start, bad priority', async () => {
    await expect(as(U1, `insert into public.categories (id, name, color) values ('aaaaaaaa-0000-4000-8000-000000000003', 'X', 'red')`)).rejects.toThrow();
    await expect(as(U1, `insert into public.tasks (id, title, start_time, end_time) values ('bbbbbbbb-0000-4000-8000-000000000004', 'x', '10:00', '09:00')`)).rejects.toThrow();
    await expect(as(U1, `insert into public.tasks (id, title, priority) values ('bbbbbbbb-0000-4000-8000-000000000005', 'x', 7)`)).rejects.toThrow();
  });

  it('registration is closed once an account exists', async () => {
    await expect(db.query(`insert into auth.users values ('33333333-3333-4333-8333-333333333333', 'intruder@example.com')`)).rejects.toThrow(/single-user/);
  });

  it('settings are private per user', async () => {
    await as(U1, `insert into public.user_settings (settings) values ('{"lang":"uk"}')`);
    expect((await as(U2, 'select * from public.user_settings')).rows).toEqual([]);
    expect((await as(U1, 'select settings from public.user_settings')).rows).toEqual([{ settings: { lang: 'uk' } }]);
  });
});
