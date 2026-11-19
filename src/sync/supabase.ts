import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { AnyRow, TableName } from '@/data/mapping';
import type { InsertResult, Remote } from './engine';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
export const cloudConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'myday-auth' },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

function err(e: { message: string; code?: string } | null) {
  if (e) {
    const x = new Error(e.message);
    (x as Error & { code?: string }).code = e.code;
    throw x;
  }
}

export class SupabaseRemote implements Remote {
  constructor(private sb: SupabaseClient) {}

  async fetchSince(table: TableName, since: string | null): Promise<AnyRow[]> {
    const out: AnyRow[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      let q = this.sb.from(table).select('*').order('updated_at', { ascending: true }).range(from, from + page - 1);
      if (since) q = q.gte('updated_at', since);
      const { data, error } = await q;
      err(error);
      out.push(...((data ?? []) as AnyRow[]));
      if (!data || data.length < page) break;
    }
    return out;
  }

  async fetchOne(table: TableName, id: string): Promise<AnyRow | null> {
    const { data, error } = await this.sb.from(table).select('*').eq('id', id).maybeSingle();
    err(error);
    return (data as AnyRow) ?? null;
  }

  async insert(table: TableName, row: AnyRow): Promise<InsertResult> {
    const { data, error } = await this.sb.from(table).insert(row as never).select('*').single();
    if (error) {
      if (error.code === '23505') return { duplicate: true };
      err(error);
    }
    return { row: data as AnyRow };
  }

  async updateIfVersion(table: TableName, row: AnyRow, version: number): Promise<AnyRow | null> {
    const { id, created_at: _c, ...rest } = row as AnyRow & { created_at: string };
    void _c;
    const { data, error } = await this.sb.from(table).update(rest as never).eq('id', id).eq('version', version).select('*');
    err(error);
    return data && data.length ? (data[0] as AnyRow) : null;
  }

  subscribe(onRow: (table: TableName, row: AnyRow) => void, onStatus: (ok: boolean) => void): () => void {
    const channel: RealtimeChannel = this.sb
      .channel('myday-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (p) => {
        if (p.new && (p.new as AnyRow).id) onRow('tasks', p.new as AnyRow);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, (p) => {
        if (p.new && (p.new as AnyRow).id) onRow('categories', p.new as AnyRow);
      })
      .subscribe((status) => onStatus(status === 'SUBSCRIBED'));
    return () => {
      void this.sb.removeChannel(channel);
    };
  }

  async loadSettings(): Promise<{ settings: Record<string, unknown>; updated_at: string } | null> {
    const { data, error } = await this.sb.from('user_settings').select('settings, updated_at').maybeSingle();
    err(error);
    return data as { settings: Record<string, unknown>; updated_at: string } | null;
  }

  async saveSettings(settings: Record<string, unknown>) {
    const { data: u } = await this.sb.auth.getUser();
    if (!u.user) return;
    const { error } = await this.sb.from('user_settings').upsert({ user_id: u.user.id, settings });
    err(error);
  }
}
