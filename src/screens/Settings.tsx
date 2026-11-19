import { useMemo, useRef, useState } from 'react';
import { Check, Download, LogOut, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { store, useStore, useT } from '@/data/store';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { PageHeader } from './Lists';
import { cloudConfigured } from '@/sync/supabase';
import { saveFile, toCsv } from '@/lib/backup';
import type { Lang, Theme } from '@/lib/types';
import { cn } from '@/lib/util';
import { locales } from '@/i18n';

const PALETTE = ['#4f7cff', '#a855f7', '#f43f5e', '#f59e0b', '#10b981', '#0ea5a4', '#8e8e93', '#ec4899', '#6366f1', '#84cc16', '#f97316', '#06b6d4'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="card divide-y divide-line/70">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <span className="text-[15.5px]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Settings() {
  const t = useT();
  const s = useStore((x) => x.settings);
  const categories = useStore((x) => x.categories);
  const session = useStore((x) => x.session);
  const status = useStore((x) => x.syncStatus);
  const pending = useStore((x) => x.pending);
  const lastSyncedAt = useStore((x) => x.lastSyncedAt);
  const lastError = useStore((x) => x.lastError);
  const realtime = useStore((x) => x.realtime);
  const online = useStore((x) => x.online);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newCat, setNewCat] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[7]);
  const [confirmOut, setConfirmOut] = useState(false);

  const zones = useMemo(() => {
    try {
      const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
      if (list?.length) return list.includes(s.timeZone) ? list : [s.timeZone, ...list];
    } catch { /* ignore */ }
    return ['Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/London', 'Europe/Moscow', 'America/New_York', 'UTC'];
  }, [s.timeZone]);

  const statusText = !online ? t('syncOffline') : status === 'syncing' ? t('syncSyncing') : status === 'error' ? t('syncError') : status === 'disabled' ? t('syncDisabled') : t('syncIdle');
  const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locales[s.lang], { timeZone: s.timeZone, dateStyle: 'short', timeStyle: 'short' }) : '—');
  const ymd = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-safe md:px-8 md:pt-8" data-testid="settings">
      <PageHeader title={t('settings')} back="more" />

      <Section title={t('sync')}>
        <Row label={statusText}>
          <Button size="sm" variant="secondary" onClick={() => void store.syncNow()} disabled={!cloudConfigured || !session} data-testid="sync-now">
            <RefreshCw size={15} className={status === 'syncing' ? 'animate-spin' : ''} /> {t('syncNow')}
          </Button>
        </Row>
        <div className="space-y-1 px-4 py-3 text-[13.5px] text-muted">
          <p>{t('pending')}: <b className="tnum text-fg">{pending}</b></p>
          <p>{t('lastSync')}: <span className="tnum">{stamp(lastSyncedAt)}</span></p>
          {cloudConfigured && session && <p>Realtime: {realtime ? '●' : '○'}</p>}
          {status === 'error' && lastError && <p className="text-danger">{lastError}</p>}
        </div>
        {session && (
          <div className="px-4 py-3.5">
            <p className="text-[13px] text-muted">{t('account')}</p>
            <p className="truncate text-[15.5px]">{session.user.email}</p>
            {!confirmOut ? (
              <Button size="sm" variant="danger" className="mt-2" onClick={() => (pending > 0 ? setConfirmOut(true) : void store.signOut())}>
                <LogOut size={15} /> {t('signOut')}
              </Button>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-[13.5px] text-danger">{t('signOutPending')}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setConfirmOut(false)}>{t('cancel')}</Button>
                  <Button size="sm" variant="danger" onClick={() => void store.signOut(true)}>{t('signOut')}</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title={t('settings')}>
        <Row label={t('language')}>
          <Segmented<Lang> value={s.lang} onChange={(v) => store.setLang(v)} options={[{ value: 'ru', label: 'Русский' }, { value: 'uk', label: 'Українська' }]} />
        </Row>
        <Row label={t('voiceLang')}>
          <Segmented<Lang> value={s.voiceLang} onChange={(v) => store.updateSettings({ voiceLang: v })} options={[{ value: 'ru', label: 'RU' }, { value: 'uk', label: 'UK' }]} />
        </Row>
        <Row label={t('theme')}>
          <Segmented<Theme> value={s.theme} onChange={(v) => store.updateSettings({ theme: v })}
            options={[{ value: 'system', label: t('themeSystem') }, { value: 'light', label: t('themeLight') }, { value: 'dark', label: t('themeDark') }]} />
        </Row>
        <Row label={t('weekStart')}>
          <Segmented<string> value={String(s.weekStartsOn)} onChange={(v) => store.updateSettings({ weekStartsOn: Number(v) as 0 | 1 })}
            options={[{ value: '1', label: t('monday') }, { value: '0', label: t('sunday') }]} />
        </Row>
        <Row label={t('timeZone')}>
          <select className="field max-w-[220px] py-2" value={s.timeZone} onChange={(e) => store.updateSettings({ timeZone: e.target.value })} data-testid="tz-select">
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Row>
      </Section>

      <Section title={t('categories')}>
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
            <label className="relative h-7 w-7 shrink-0 cursor-pointer rounded-full" style={{ background: c.color }}>
              <input type="color" className="absolute inset-0 opacity-0" value={c.color} onChange={(e) => void store.saveCategory({ ...c, color: e.target.value })} aria-label="color" />
            </label>
            <input className="flex-1 bg-transparent py-1.5 text-[15.5px] outline-none" defaultValue={c.name}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) void store.saveCategory({ ...c, name: v }); }} />
            <button className="p-2 text-muted" aria-label={t('delete')} onClick={() => void store.saveCategory({ ...c, deleted: true })}><Trash2 size={17} /></button>
          </div>
        ))}
        <div className="space-y-2.5 px-4 py-3">
          <div className="flex gap-2">
            <input className="field" placeholder={t('categoryName')} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <Button onClick={() => { if (newCat.trim()) { void store.createCategory(newCat.trim(), newColor); setNewCat(''); } }} aria-label={t('addCategory')}><Plus size={18} /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((p) => (
              <button key={p} onClick={() => setNewColor(p)} className="grid h-7 w-7 place-items-center rounded-full" style={{ background: p }} aria-label={p}>
                {newColor === p && <Check size={15} className="text-white" />}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title={t('backup')}>
        <div className="space-y-2 px-4 py-3.5">
          <p className="text-[13.5px] text-muted">{t('backupHint')}</p>
          <Button variant="secondary" className="w-full" data-testid="export-json"
            onClick={() => void saveFile(`myday-backup-${ymd}.json`, JSON.stringify(store.exportData(), null, 2), 'application/json')}>
            <Download size={17} /> {t('exportJson')}
          </Button>
          <Button variant="secondary" className="w-full"
            onClick={() => void saveFile(`myday-tasks-${ymd}.csv`, toCsv(store.state.tasks, store.state.categories), 'text/csv')}>
            <Download size={17} /> {t('exportCsv')}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload size={17} /> {t('importJson')}
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="import-input"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const n = await store.importData(JSON.parse(await f.text()));
                store.toast(`${t('importDone')}: ${n}`);
              } catch {
                store.toast(t('importError'));
              }
            }} />
        </div>
      </Section>

      <Section title={t('about')}>
        <div className="space-y-1 px-4 py-3.5 text-[13.5px] text-muted">
          <p>MyDay Planner · {t('version')} {__APP_VERSION__}</p>
          <p>{t('installHint')}</p>
        </div>
      </Section>
      <div className={cn('h-4')} />
    </div>
  );
}
