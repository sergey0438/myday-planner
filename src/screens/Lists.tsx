import { useMemo, useState } from 'react';
import { ChevronLeft, Inbox as InboxIcon, Plus, Search as SearchIcon, Star, Archive as ArchiveIcon } from 'lucide-react';
import { store, useStore, useT } from '@/data/store';
import { TaskCard } from '@/components/TaskCard';
import { useUi, type Route } from '@/components/ui';
import type { Occurrence, Task } from '@/lib/types';
import { nextOccurrence, isDoneOn } from '@/lib/recurrence';
import { cn } from '@/lib/util';

export function PageHeader({ title, back, right }: { title: string; back?: Route; right?: React.ReactNode }) {
  const ui = useUi();
  return (
    <header className="flex items-center gap-2 pb-3 pt-3">
      {back && (
        <button onClick={() => ui.navigate(back)} className="press -ml-2 grid h-10 w-10 place-items-center rounded-full text-accent md:hidden" aria-label="back">
          <ChevronLeft size={26} />
        </button>
      )}
      <h1 className="flex-1 text-[30px] font-bold tracking-tight">{title}</h1>
      {right}
    </header>
  );
}

function occFor(task: Task, today: string): Occurrence {
  const d = task.recurrence ? nextOccurrence(task, today) : task.date;
  return { task, date: d, done: isDoneOn(task, d) };
}

function CategoryFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const t = useT();
  const categories = useStore((s) => s.categories);
  return (
    <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
      <button onClick={() => onChange(null)} className={cn('shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium', !value ? 'bg-fg text-bg' : 'bg-surface text-muted')}>{t('allCategories')}</button>
      {categories.map((c) => (
        <button key={c.id} onClick={() => onChange(value === c.id ? null : c.id)}
          className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium', value === c.id ? 'text-white' : 'bg-surface text-muted')}
          style={value === c.id ? { background: c.color } : undefined}>
          <span className="h-2 w-2 rounded-full" style={{ background: value === c.id ? '#fff' : c.color }} />{c.name}
        </button>
      ))}
    </div>
  );
}

function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center p-10 text-center">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-accent/10 text-accent">{icon}</div>
      <p className="text-[17px] font-semibold">{title}</p>
      {hint && <p className="mt-1 text-[14px] text-muted">{hint}</p>}
    </div>
  );
}

export function Inbox() {
  const t = useT();
  const ui = useUi();
  const tasks = useStore((s) => s.tasks);
  const [cat, setCat] = useState<string | null>(null);
  const list = tasks.filter((x) => !x.date && !x.completedAt && (!cat || x.categoryId === cat)).sort((a, b) => b.priority - a.priority || (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-safe md:px-8 md:pt-8">
      <PageHeader title={t('inbox')} right={
        <button onClick={() => ui.openEditor({ draft: { date: null } })} className="press grid h-10 w-10 place-items-center rounded-full bg-accent text-white" aria-label={t('addTask')}><Plus size={22} /></button>
      } />
      <CategoryFilter value={cat} onChange={setCat} />
      <div className="space-y-2">
        {list.length === 0 && <Empty icon={<InboxIcon size={26} />} title={t('emptyInbox')} hint={t('emptyInboxHint')} />}
        {list.map((task) => <TaskCard key={task.id} occ={{ task, date: null, done: false }} onOpen={(o) => ui.openEditor({ occ: o })} />)}
      </div>
    </div>
  );
}

export function Favorites() {
  const t = useT();
  const ui = useUi();
  const tasks = useStore((s) => s.tasks);
  const today = store.today();
  const list = tasks.filter((x) => x.favorite).map((x) => occFor(x, today));
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-safe md:px-8 md:pt-8">
      <PageHeader title={t('favorites')} back="more" />
      <div className="space-y-2">
        {list.length === 0 && <Empty icon={<Star size={26} />} title={t('favorites')} hint={t('noFavorites')} />}
        {list.map((o) => <TaskCard key={o.task.id} occ={o} onOpen={(x) => ui.openEditor({ occ: x })} showDate />)}
      </div>
    </div>
  );
}

export function Archive() {
  const t = useT();
  const ui = useUi();
  const tasks = useStore((s) => s.tasks);
  const [cat, setCat] = useState<string | null>(null);
  const list = useMemo(() => {
    const out: Occurrence[] = [];
    for (const task of tasks) {
      if (cat && task.categoryId !== cat) continue;
      if (!task.recurrence && task.completedAt) out.push({ task, date: task.date, done: true });
      if (task.recurrence) for (const d of task.doneDates) out.push({ task, date: d, done: true });
    }
    return out.sort((a, b) => ((b.date ?? b.task.completedAt ?? '') > (a.date ?? a.task.completedAt ?? '') ? 1 : -1));
  }, [tasks, cat]);
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-safe md:px-8 md:pt-8">
      <PageHeader title={t('archive')} back="more" />
      <CategoryFilter value={cat} onChange={setCat} />
      <div className="space-y-2" data-testid="archive-list">
        {list.length === 0 && <Empty icon={<ArchiveIcon size={26} />} title={t('archive')} hint={t('noArchive')} />}
        {list.slice(0, 300).map((o) => <TaskCard key={o.task.id + o.date} occ={o} onOpen={(x) => ui.openEditor({ occ: x })} showDate compact />)}
      </div>
    </div>
  );
}

export function Search() {
  const t = useT();
  const ui = useUi();
  const tasks = useStore((s) => s.tasks);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const today = store.today();
  const query = q.trim().toLowerCase();
  const list = query || cat
    ? tasks.filter((x) => (!cat || x.categoryId === cat) && (!query || [x.title, x.description, x.location, ...x.subtasks.map((s) => s.title)].join(' ').toLowerCase().includes(query)))
      .slice(0, 100).map((x) => occFor(x, today))
    : [];
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-safe md:px-8 md:pt-8">
      <PageHeader title={t('search')} back="today" />
      <div className="relative mb-3">
        <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input autoFocus className="field bg-surface pl-10 dark:bg-surface" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} data-testid="search-input" type="search" />
      </div>
      <CategoryFilter value={cat} onChange={setCat} />
      <div className="space-y-2">
        {(query || cat) && list.length === 0 && <p className="px-1 text-muted">{t('nothingFound')}</p>}
        {list.map((o) => <TaskCard key={o.task.id} occ={o} onOpen={(x) => ui.openEditor({ occ: x })} showDate />)}
      </div>
    </div>
  );
}
