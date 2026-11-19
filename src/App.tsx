import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Inbox as InboxIcon, LayoutGrid, Mic, Sun, BarChart3, Settings as SettingsIcon, Star, Archive as ArchiveIcon, Search as SearchIcon, Loader2 } from 'lucide-react';
import { useStore, useT } from "@/data/store";
import { UiContext, type Route, type UiApi } from '@/components/ui';
import { Today } from '@/screens/Today';
import { Calendar } from '@/screens/Calendar';
import { Inbox, Favorites, Archive, Search } from '@/screens/Lists';
import { Stats } from '@/screens/Stats';
import { Settings } from '@/screens/Settings';
import { More } from '@/screens/More';
import { Login } from '@/screens/Login';
import { TaskEditor } from '@/components/TaskEditor';
import { VoiceSheet } from '@/components/VoiceSheet';
import { Toasts } from '@/components/Toasts';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { cloudConfigured } from '@/sync/supabase';
import type { Occurrence, Task } from '@/lib/types';
import { cn } from '@/lib/util';

const ROUTES: Route[] = ['today', 'calendar', 'inbox', 'more', 'stats', 'settings', 'search', 'favorites', 'archive'];
const routeFromHash = (): Route => {
  const h = location.hash.replace('#/', '').replace('#', '') as Route;
  return ROUTES.includes(h) ? h : 'today';
};

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0e0e10' : '#f6f5f2'));
    };
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [theme]);
}

export default function App() {
  const t = useT();
  useTheme();
  const lang = useStore((s) => s.settings.lang);
  const ready = useStore((s) => s.ready);
  const session = useStore((s) => s.session);
  const authChecked = useStore((s) => s.authChecked);
  const inboxCount = useStore((s) => s.tasks.filter((x) => !x.date && !x.completedAt).length);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [editor, setEditor] = useState<{ open: boolean; taskId: string | null; draft: Partial<Task> | null; date: string | null }>({ open: false, taskId: null, draft: null, date: null });
  const [voice, setVoice] = useState<{ open: boolean; auto: boolean }>({ open: false, auto: false });

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    const on = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const navigate = useCallback((r: Route) => {
    if (r === route) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    location.hash = r === 'today' ? '' : `/${r}`;
    if (r === 'today') history.replaceState(null, '', location.pathname);
    setRoute(r);
    window.scrollTo(0, 0);
  }, [route]);

  const api = useMemo<UiApi>(() => ({
    openEditor: (o?: { occ?: Occurrence; draft?: Partial<Task> }) =>
      setEditor({ open: true, taskId: o?.occ?.task.id ?? null, draft: o?.draft ?? null, date: o?.occ?.date ?? null }),
    openVoice: (auto = false) => setVoice({ open: true, auto }),
    navigate,
  }), [navigate]);

  if (!ready || !authChecked) {
    return <div className="grid h-full place-items-center text-muted"><Loader2 className="animate-spin" /></div>;
  }
  if (cloudConfigured && !session) return <Login />;

  const tabs: { r: Route; label: string; icon: typeof Sun; badge?: number }[] = [
    { r: 'today', label: t('today'), icon: Sun },
    { r: 'calendar', label: t('calendar'), icon: CalendarDays },
    { r: 'inbox', label: t('inbox'), icon: InboxIcon, badge: inboxCount },
    { r: 'more', label: t('more'), icon: LayoutGrid },
  ];
  const side: { r: Route; label: string; icon: typeof Sun; badge?: number }[] = [
    ...tabs.slice(0, 3),
    { r: 'favorites', label: t('favorites'), icon: Star },
    { r: 'search', label: t('search'), icon: SearchIcon },
    { r: 'stats', label: t('stats'), icon: BarChart3 },
    { r: 'archive', label: t('archive'), icon: ArchiveIcon },
    { r: 'settings', label: t('settings'), icon: SettingsIcon },
  ];
  const moreRoutes: Route[] = ['more', 'stats', 'settings', 'favorites', 'archive'];
  const activeTab = moreRoutes.includes(route) ? 'more' : route === 'search' ? 'today' : route;

  return (
    <UiContext.Provider value={api}>
      <div className="flex min-h-full">
        {/* iPad / desktop sidebar */}
        <aside className="sticky top-0 hidden h-[100dvh] w-[248px] shrink-0 flex-col border-r border-line/70 bg-surface/60 pl-safe pt-safe backdrop-blur-xl md:flex">
          <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8 rounded-lg" />
            <span className="text-[19px] font-bold tracking-tight">MyDay</span>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {side.map(({ r, label, icon: Icon, badge }) => (
              <button key={r} onClick={() => navigate(r)} data-testid={`side-${r}`}
                className={cn('press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium', route === r ? 'bg-accent/12 text-accent bg-accent/10' : 'text-fg/80 hover:bg-line/50')}>
                <Icon size={19} /> <span className="flex-1 text-left">{label}</span>
                {!!badge && <span className="tnum text-[12px] text-muted">{badge}</span>}
              </button>
            ))}
          </nav>
          <div className="p-4 pb-[max(var(--sab),16px)]">
            <button onClick={() => api.openVoice(true)} className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#5b6cff] to-[#8a5cff] py-3.5 font-semibold text-white shadow-float">
              <Mic size={20} /> {t('dictate')}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-[calc(var(--sab)+84px)] pl-safe pr-safe md:pb-8 md:pl-0">
          <div key={route} className="animate-fade-in">
            {route === 'today' && <Today />}
            {route === 'calendar' && <Calendar />}
            {route === 'inbox' && <Inbox />}
            {route === 'more' && <More />}
            {route === 'stats' && <Stats />}
            {route === 'settings' && <Settings />}
            {route === 'search' && <Search />}
            {route === 'favorites' && <Favorites />}
            {route === 'archive' && <Archive />}
          </div>
        </main>
      </div>

      {/* iPhone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/85 pb-safe backdrop-blur-xl md:hidden" aria-label="navigation">
        <div className="relative mx-auto grid h-[62px] max-w-lg grid-cols-5 items-center">
          {tabs.slice(0, 2).map(({ r, label, icon: Icon }) => (
            <TabButton key={r} active={activeTab === r} label={label} onClick={() => navigate(r)} testId={`tab-${r}`}><Icon size={23} /></TabButton>
          ))}
          <div className="grid place-items-center">
            <button onClick={() => api.openVoice(true)} aria-label={t('dictate')} data-testid="tab-mic"
              className="press -mt-7 grid h-[62px] w-[62px] place-items-center rounded-full bg-gradient-to-br from-[#5b6cff] to-[#8a5cff] text-white shadow-float ring-4 ring-bg">
              <Mic size={28} />
            </button>
          </div>
          {tabs.slice(2).map(({ r, label, icon: Icon, badge }) => (
            <TabButton key={r} active={activeTab === r} label={label} onClick={() => navigate(r)} badge={badge} testId={`tab-${r}`}><Icon size={23} /></TabButton>
          ))}
        </div>
      </nav>

      <TaskEditor open={editor.open} onClose={() => setEditor((e) => ({ ...e, open: false }))} taskId={editor.taskId} draft={editor.draft} occurrenceDate={editor.date} />
      <VoiceSheet open={voice.open} autoStart={voice.auto} onClose={() => setVoice({ open: false, auto: false })} />
      <Toasts />
      <UpdatePrompt />
    </UiContext.Provider>
  );
}

function TabButton({ active, label, onClick, children, badge, testId }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode; badge?: number; testId?: string }) {
  return (
    <button onClick={onClick} data-testid={testId} aria-current={active ? 'page' : undefined}
      className={cn('press relative flex h-full flex-col items-center justify-center gap-0.5', active ? 'text-accent' : 'text-muted')}>
      {children}
      <span className="text-[10.5px] font-medium">{label}</span>
      {!!badge && <span className="absolute right-[22%] top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{badge}</span>}
    </button>
  );
}
