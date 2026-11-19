import { useEffect, useRef, useState } from 'react';
import {
  CalendarClock, CalendarDays, CheckCircle2, ChevronDown, Copy, MapPin, Plus, RotateCcw, Star, Trash2, X,
} from 'lucide-react';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { Segmented } from './ui/Segmented';
import { store, useStore, useT } from '@/data/store';
import type { Priority, Recurrence, Task } from '@/lib/types';
import { addDays, weekdayMon0 } from '@/lib/dates';
import { recurrenceLabel } from '@/lib/format';
import { cn, uuid } from '@/lib/util';
import { isDoneOn } from '@/lib/recurrence';

type RepeatKey = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom';

function repeatKey(r: Recurrence | null): RepeatKey {
  if (!r) return 'none';
  if (r.freq === 'daily' && r.interval === 1) return 'daily';
  if (r.freq === 'weekly' && r.interval === 1 && r.byWeekday?.length === 5 && [0, 1, 2, 3, 4].every((d) => r.byWeekday!.includes(d))) return 'weekdays';
  if (r.freq === 'weekly' && r.interval === 1 && (r.byWeekday?.length ?? 1) === 1) return 'weekly';
  if (r.freq === 'weekly' && r.interval === 2 && (r.byWeekday?.length ?? 1) === 1) return 'biweekly';
  if (r.freq === 'monthly' && r.interval === 1) return 'monthly';
  if (r.freq === 'yearly' && r.interval === 1) return 'yearly';
  return 'custom';
}

function makeRecurrence(k: RepeatKey, date: string | null, prev: Recurrence | null): Recurrence | null {
  const wd = date ? weekdayMon0(date) : 0;
  switch (k) {
    case 'none': return null;
    case 'daily': return { freq: 'daily', interval: 1 };
    case 'weekdays': return { freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] };
    case 'weekly': return { freq: 'weekly', interval: 1, byWeekday: [wd] };
    case 'biweekly': return { freq: 'weekly', interval: 2, byWeekday: [wd] };
    case 'monthly': return { freq: 'monthly', interval: 1 };
    case 'yearly': return { freq: 'yearly', interval: 1 };
    case 'custom': return prev;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** existing task id or a draft for a new one */
  taskId?: string | null;
  draft?: Partial<Task> | null;
  occurrenceDate?: string | null;
}

export function TaskEditor({ open, onClose, taskId, draft, occurrenceDate }: Props) {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const categories = useStore((s) => s.categories);
  const existing = useStore((s) => (taskId ? s.tasks.find((x) => x.id === taskId) : undefined));
  const isNew = !existing;
  const [task, setTask] = useState<Task>(() => existing ?? store.newTask(draft ?? {}));
  const [expanded, setExpanded] = useState(!isNew);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [newSub, setNewSub] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTask(existing ?? store.newTask({ date: store.today(), ...(draft ?? {}) }));
    setExpanded(!!existing);
    setConfirmDelete(false);
    setPostponeOpen(false);
    setNewSub('');
    if (!existing) setTimeout(() => titleRef.current?.focus(), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  const set = (patch: Partial<Task>) => setTask((x) => ({ ...x, ...patch }));
  const today = store.today();
  const occDate = occurrenceDate ?? task.date;
  const done = existing ? isDoneOn(existing, occDate) : false;

  const save = async () => {
    const title = task.title.trim();
    if (!title) {
      titleRef.current?.focus();
      return;
    }
    let endTime = task.endTime;
    if (!task.startTime) endTime = null;
    else if (endTime && endTime < task.startTime) endTime = null;
    const subtasks = newSub.trim() ? [...task.subtasks, { id: uuid(), title: newSub.trim(), done: false }] : task.subtasks;
    await store.saveTask({ ...task, title, endTime, subtasks, date: task.recurrence && !task.date ? today : task.date });
    store.toast(t('saved'));
    onClose();
  };

  const addSub = () => {
    const v = newSub.trim();
    if (!v) return;
    set({ subtasks: [...task.subtasks, { id: uuid(), title: v, done: false }] });
    setNewSub('');
  };

  const rk = repeatKey(task.recurrence);

  const footer = (
    <div className="flex gap-2">
      <Button variant="secondary" className="flex-1" onClick={onClose}>{t('cancel')}</Button>
      <Button className="flex-[2]" onClick={save} data-testid="save-task">{t('save')}</Button>
    </div>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? t('newTask') : t('editTask')}
      footer={footer}
      headerRight={
        !isNew ? (
          <button
            className="press grid h-9 w-9 place-items-center rounded-full bg-bg"
            aria-label={task.favorite ? t('unfavorite') : t('favorite')}
            onClick={() => {
              set({ favorite: !task.favorite });
              void store.toggleFavorite(task.id);
            }}
          >
            <Star size={18} className={task.favorite ? 'fill-amber-400 text-amber-400' : 'text-muted'} />
          </button>
        ) : null
      }
    >
      <div className="space-y-4">
        <textarea
          ref={titleRef}
          rows={1}
          value={task.title}
          onChange={(e) => set({ title: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={t('titlePlaceholder')}
          aria-label={t('title')}
          data-testid="task-title"
          className="w-full resize-none bg-transparent text-[22px] font-semibold leading-tight outline-none placeholder:text-muted/60"
        />

        {/* Date chips */}
        <div>
          <span className="label">{t('date')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: t('today'), v: today },
              { label: t('tomorrow'), v: addDays(today, 1) },
              { label: t('noDate'), v: null },
            ].map((o) => (
              <button
                key={o.label}
                onClick={() => set({ date: o.v })}
                className={cn('press rounded-full px-3.5 py-2 text-[14px] font-medium ring-1',
                  task.date === o.v ? 'bg-accent text-accent-fg ring-accent' : 'bg-bg ring-line dark:bg-elevated')}
              >
                {o.label}
              </button>
            ))}
            <label className="relative inline-flex items-center gap-1.5 rounded-full bg-bg px-3.5 py-2 text-[14px] font-medium ring-1 ring-line dark:bg-elevated">
              <CalendarDays size={15} />
              <input
                type="date"
                value={task.date ?? ''}
                data-testid="task-date"
                onChange={(e) => set({ date: e.target.value || null })}
                className="bg-transparent text-[14px] outline-none"
              />
            </label>
          </div>
        </div>

        {/* Time */}
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">{t('start')}</span>
            <input type="time" className="field tnum" value={task.startTime ?? ''} data-testid="task-start"
              onChange={(e) => set({ startTime: e.target.value || null })} />
          </label>
          <label>
            <span className="label">{t('end')}</span>
            <input type="time" className="field tnum" value={task.endTime ?? ''} disabled={!task.startTime} data-testid="task-end"
              onChange={(e) => set({ endTime: e.target.value || null })} />
          </label>
        </div>

        {/* Category */}
        <div>
          <span className="label">{t('category')}</span>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => set({ categoryId: task.categoryId === c.id ? null : c.id })}
                className={cn('press inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[14px] font-medium ring-1 transition',
                  task.categoryId === c.id ? 'text-white ring-transparent' : 'bg-bg ring-line dark:bg-elevated')}
                style={task.categoryId === c.id ? { background: c.color } : undefined}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: task.categoryId === c.id ? '#fff' : c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {!expanded && (
          <button className="press inline-flex items-center gap-1 text-[15px] font-medium text-accent" onClick={() => setExpanded(true)}>
            <ChevronDown size={18} /> {t('moreFields')}
          </button>
        )}

        {expanded && (
          <>
            <div>
              <span className="label">{t('priority')}</span>
              <Segmented<string>
                value={String(task.priority)}
                onChange={(v) => set({ priority: Number(v) as Priority })}
                options={[
                  { value: '0', label: t('priorityNone') },
                  { value: '1', label: t('priorityLow') },
                  { value: '2', label: t('priorityMedium') },
                  { value: '3', label: t('priorityHigh') },
                ]}
              />
            </div>

            <label className="block">
              <span className="label">{t('location')}</span>
              <div className="relative">
                <MapPin size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input className="field pl-9" value={task.location} placeholder={t('locationPlaceholder')}
                  onChange={(e) => set({ location: e.target.value })} />
              </div>
            </label>

            <label className="block">
              <span className="label">{t('repeat')}</span>
              <select
                className="field appearance-none"
                value={rk}
                data-testid="task-repeat"
                onChange={(e) => set({ recurrence: makeRecurrence(e.target.value as RepeatKey, task.date ?? today, task.recurrence), date: task.date ?? today })}
              >
                <option value="none">{t('repeatNone')}</option>
                <option value="daily">{t('repeatDaily')}</option>
                <option value="weekdays">{t('repeatWeekdays')}</option>
                <option value="weekly">{t('repeatWeekly')}</option>
                <option value="biweekly">{t('repeatBiweekly')}</option>
                <option value="monthly">{t('repeatMonthly')}</option>
                <option value="yearly">{t('repeatYearly')}</option>
                {rk === 'custom' && <option value="custom">{recurrenceLabel(lang, task.recurrence)}</option>}
              </select>
            </label>

            <label className="block">
              <span className="label">{t('description')}</span>
              <textarea className="field min-h-[84px]" value={task.description} placeholder={t('descriptionPlaceholder')}
                onChange={(e) => set({ description: e.target.value })} />
            </label>

            <div>
              <span className="label">{t('subtasks')}</span>
              <div className="space-y-1.5">
                {task.subtasks.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2 dark:bg-elevated">
                    <input type="checkbox" checked={s.done} className="h-5 w-5 accent-[rgb(var(--accent))]"
                      onChange={() => set({ subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })} />
                    <input className={cn('flex-1 bg-transparent outline-none', s.done && 'text-muted line-through')} value={s.title}
                      onChange={(e) => set({ subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })} />
                    <button className="p-1 text-muted" aria-label={t('delete')}
                      onClick={() => set({ subtasks: task.subtasks.filter((x) => x.id !== s.id) })}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <input className="field" value={newSub} placeholder={t('addSubtask')} onChange={(e) => setNewSub(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSub())} />
                  <Button variant="secondary" onClick={addSub} aria-label={t('addSubtask')}><Plus size={18} /></Button>
                </div>
              </div>
            </div>
          </>
        )}

        {!isNew && existing && (
          <div className="space-y-2 border-t border-line/70 pt-4">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => { void store.toggleDone(existing, occDate); onClose(); }}>
                {done ? <RotateCcw size={17} /> : <CheckCircle2 size={17} />} {done ? t('reopen') : t('complete')}
              </Button>
              <Button variant="secondary" onClick={() => { void store.duplicateTask(existing.id); onClose(); }}>
                <Copy size={17} /> {t('duplicate')}
              </Button>
            </div>
            {!postponeOpen ? (
              <Button variant="secondary" className="w-full" onClick={() => setPostponeOpen(true)}>
                <CalendarClock size={17} /> {t('postpone')}
              </Button>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button variant="secondary" size="sm" onClick={() => { void store.postpone(existing.id, occDate, 1); onClose(); }}>{t('toTomorrow')}</Button>
                <Button variant="secondary" size="sm" onClick={() => { void store.postpone(existing.id, occDate, 7); onClose(); }}>+7</Button>
                <label className="press relative inline-flex h-9 items-center justify-center rounded-xl bg-bg text-[14px] font-semibold ring-1 ring-line dark:bg-elevated">
                  {t('pickDate')}
                  <input type="date" className="absolute inset-0 opacity-0" onChange={(e) => {
                    if (e.target.value) { void store.moveTask(existing.id, occDate, e.target.value); store.toast(t('postponed')); onClose(); }
                  }} />
                </label>
              </div>
            )}
            {!confirmDelete ? (
              <Button variant="danger" className="w-full" onClick={() => setConfirmDelete(true)} data-testid="delete-task">
                <Trash2 size={17} /> {t('delete')}
              </Button>
            ) : existing.recurrence && occDate ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="danger" onClick={() => { void store.deleteOccurrence(existing.id, occDate); onClose(); }}>{t('deleteOccurrence')}</Button>
                <Button variant="danger" onClick={() => { void store.deleteTask(existing.id); onClose(); }}>{t('deleteSeries')}</Button>
              </div>
            ) : (
              <Button variant="danger" className="w-full bg-danger text-white" data-testid="confirm-delete" onClick={() => { void store.deleteTask(existing.id); onClose(); }}>
                {t('deleteConfirm')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
