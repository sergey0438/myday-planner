// In-memory imitation of the parts of Supabase (Auth + PostgREST) the app uses.
// Shared between browser contexts, so two "devices" can sync through it.
import type { BrowserContext, Route } from '@playwright/test';

export const MOCK_URL = 'http://127.0.0.1:54329';

type Row = Record<string, unknown> & { id: string; version?: number; updated_at?: string };

export class MockSupabase {
  users: { id: string; email: string; password: string }[] = [];
  tables: Record<string, Map<string, Row>> = { tasks: new Map(), categories: new Map(), user_settings: new Map() };
  clock = Date.UTC(2026, 10, 19, 12, 0, 0);
  log: string[] = [];

  private now() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private session(u: { id: string; email: string }) {
    const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    // fake JWT (header.payload.signature) – supabase-js decodes the payload
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh-' + u.id, user };
  }

  private userFromAuth(route: Route) {
    const h = route.request().headers()['authorization'] ?? '';
    const token = h.replace(/^Bearer\s+/i, '');
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return this.users.find((u) => u.id === payload.sub) ?? null;
    } catch {
      return null;
    }
  }

  async attach(ctx: BrowserContext) {
    await ctx.route(`${MOCK_URL}/**`, (route) => this.handle(route));
  }

  private json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', ...headers },
      body: body === undefined ? '' : JSON.stringify(body),
    });
  }

  async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    this.log.push(`${method} ${url.pathname}${url.search}`);
    if (method === 'OPTIONS') return this.json(route, 200, {});
    const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();

    // ---------------- auth
    if (url.pathname === '/auth/v1/signup') {
      if (this.users.length > 0) return this.json(route, 500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' });
      const u = { id: crypto.randomUUID(), email: body.email, password: body.password };
      this.users.push(u);
      return this.json(route, 200, this.session(u));
    }
    if (url.pathname === '/auth/v1/token') {
      const u = this.users.find((x) => x.email === body.email && x.password === body.password)
        ?? (body.refresh_token ? this.users.find((x) => 'refresh-' + x.id === body.refresh_token) : undefined);
      if (!u) return this.json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return this.json(route, 200, this.session(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const u = this.userFromAuth(route);
      return u ? this.json(route, 200, this.session(u).user) : this.json(route, 401, { msg: 'unauthorized' });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

    // ---------------- rest
    const m = /^\/rest\/v1\/(\w+)$/.exec(url.pathname);
    if (!m) return this.json(route, 404, { message: 'not found' });
    const user = this.userFromAuth(route);
    if (!user) return this.json(route, 401, { message: 'JWT required' });
    const table = this.tables[m[1]];
    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k));
    const match = (r: Row) => r.user_id === user.id && filters.every(([k, v]) => {
      const [op, ...rest] = v.split('.');
      const val = rest.join('.');
      const cur = String(r[k] ?? '');
      if (op === 'eq') return cur === val;
      if (op === 'gte') return cur >= val;
      if (op === 'gt') return cur > val;
      return true;
    });
    const respond = (rows: Row[]) => {
      if (wantsObject) {
        if (rows.length !== 1) return this.json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
        return this.json(route, 200, rows[0]);
      }
      return this.json(route, 200, rows);
    };

    if (method === 'GET') {
      const rows = [...table.values()].filter(match).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100000);
      return respond(rows.slice(offset, offset + limit));
    }
    if (method === 'POST') {
      const items: Row[] = Array.isArray(body) ? body : [body];
      const out: Row[] = [];
      const upsert = (req.headers()['prefer'] ?? '').includes('merge-duplicates');
      for (const it of items) {
        const key = m[1] === 'user_settings' ? user.id : it.id;
        const existing = table.get(key);
        if (existing && !upsert) return this.json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        const row: Row = { ...existing, ...it, id: key, user_id: user.id, version: existing ? (existing.version ?? 0) + 1 : 1, updated_at: this.now() };
        table.set(key, row);
        out.push(row);
      }
      return respond(out);
    }
    if (method === 'PATCH') {
      const rows = [...table.values()].filter(match);
      const out = rows.map((r) => {
        const row: Row = { ...r, ...body, id: r.id, user_id: r.user_id, version: (r.version ?? 0) + 1, updated_at: this.now() };
        table.set(r.id, row);
        return row;
      });
      return respond(out);
    }
    return this.json(route, 405, {});
  }
}
