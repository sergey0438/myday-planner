import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  DndContext, DragOverlay, pointerWithin, rectIntersection, type CollisionDetection, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { store, useStore, useT } from '@/data/store';
import { occurrencesInRange, occurrencesOn } from '@/lib/recurrence';
import {
  addDays, addMonths, endOfMonth, minutesToTime, nowInTz, rangeDays, startOfMonth, startOfWeek, timeToMinutes,
} from '@/lib/dates';
import { dayMonth, monthYear, weekdayShort } from '@/lib/format';
import { Segmented } from '@/components/ui/Segmented';
import { TaskCard } from '@/components/TaskCard';
import { useUi } from '@/components/ui';
import type { Occurrence } from '@/lib/types';
import { cn, haptic } from '@/lib/util';

type View = 'day' | 'week' | 'month';

// Drop where the finger/pointer is, not where the (wider) drag preview overlaps.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

function weekTitle(lang: 'ru' | 'uk', start: string) {
  const end = addDays(start, 6);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))}–${dayMonth(lang, end)}`;
  return `${dayMonth(lang, start)} – ${dayMonth(lang, end)}`;
}
const HOUR_H = 60;

// The click that ends a drag must not open the task.
let lastDragEnd = 0;

function Draggable({ id, occ, children }: { id: string; occ: Occurrence; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { occ } });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      onClickCapture={(e) => { if (Date.now() - lastDragEnd < 400) { e.stopPropagation(); e.preventDefault(); } }} className={cn('touch-manipulation', isDragging && 'opacity-30')} style={{ WebkitUserSelect: 'none' }}>
      {children}
    </div>
  );
}

function Droppable({ id, data, className, children, testId }: { id: string; data: Record<string, unknown>; className?: string; children?: ReactNode; testId?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div ref={setNodeRef} data-testid={testId} className={cn(className, isOver && 'bg-accent/10 ring-2 ring-accent/50')}>
      {children}
    </div>
  );
}

export function Calendar() {
  const t = useT();
  const ui = useUi();
  const tasks = useStore((s) => s.tasks);
  const categories = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const today = nowInTz(settings.timeZone).date;
  const [view, setView] = useState<View>(() => (localStorage.getItem('myday-cal-view') as View) || 'week');
  const [cursor, setCursor] = useState(today);
  const [dragging, setDragging] = useState<Occurrence | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => { try { localStorage.setItem('myday-cal-view', view); } catch { /* ignore */ } }, [view]);

  const visible = useMemo(() => (filter ? tasks.filter((x) => x.categoryId === filter) : tasks), [tasks, filter]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
  );

  const step = (dir: number) => {
    if (view === 'day') setCursor(addDays(cursor, dir));
    else if (view === 'week') setCursor(addDays(cursor, 7 * dir));
    else setCursor(addMonths(cursor, dir));
  };

  const onDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current as { occ: Occurrence }).occ);
    haptic(12);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    lastDragEnd = Date.now();
    const occ = (e.active.data.current as { occ: Occurrence } | undefined)?.occ;
    const target = e.over?.data.current as { date: string; hour?: number } | undefined;
    if (!occ || !target) return;
    const newTime = target.hour !== undefined ? minutesToTime(target.hour * 60) : undefined;
    if (target.date === occ.date && (newTime === undefined || newTime === occ.task.startTime)) return;
    void store.moveTask(occ.task.id, occ.date, target.date, newTime);
    haptic(8);
  };

  const open = (o: Occurrence) => ui.openEditor({ occ: o });
  const title = view === 'month' ? monthYear(settings.lang, cursor) : view === 'week'
    ? weekTitle(settings.lang, startOfWeek(cursor, settings.weekStartsOn))
    : `${weekdayShort(settings.lang, cursor)}, ${dayMonth(settings.lang, cursor)}`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-4 pb-8 pt-safe md:px-8 md:pt-8">
      <header className="sticky top-0 z-10 -mx-4 bg-bg/90 px-4 pb-3 pt-3 backdrop-blur-xl md:-mx-8 md:px-8">
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate text-[23px] font-bold tracking-tight md:text-[28px]" data-testid="calendar-title">{title}</h1>
          <div className="flex shrink-0 items-center gap-1">
            <button className="press grid h-10 w-10 place-items-center rounded-full bg-surface shadow-card" onClick={() => step(-1)} aria-label="prev"><ChevronLeft size={20} /></button>
            <button className="press h-10 rounded-full bg-surface px-3.5 text-[14px] font-semibold text-accent shadow-card" onClick={() => setCursor(today)} data-testid="cal-today">{t('goToday')}</button>
            <button className="press grid h-10 w-10 place-items-center rounded-full bg-surface shadow-card" onClick={() => step(1)} aria-label="next"><ChevronRight size={20} /></button>
          </div>
        </div>
        <Segmented<View> className="mt-3" value={view} onChange={setView}
          options={[{ value: 'day', label: t('day') }, { value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} />
        <div className="no-scrollbar -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4">
          <button onClick={() => setFilter(null)} className={cn('shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium', !filter ? 'bg-fg text-bg' : 'bg-surface text-muted')}>{t('allCategories')}</button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => setFilter(filter === c.id ? null : c.id)}
              className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium', filter === c.id ? 'text-white' : 'bg-surface text-muted')}
              style={filter === c.id ? { background: c.color } : undefined}>
              <span className="h-2 w-2 rounded-full" style={{ background: filter === c.id ? '#fff' : c.color }} />{c.name}
            </button>
          ))}
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        {view === 'day' && <DayView date={cursor} today={today} tasks={visible} onOpen={open} onPick={setCursor} weekStartsOn={settings.weekStartsOn} />}
        {view === 'week' && <WeekView date={cursor} today={today} tasks={visible} onOpen={open} weekStartsOn={settings.weekStartsOn}
          onPickDay={(d) => { setCursor(d); setView('day'); }} />}
        {view === 'month' && <MonthView date={cursor} today={today} tasks={visible} onOpen={open} weekStartsOn={settings.weekStartsOn} onPick={setCursor} />}
        <DragOverlay>{dragging ? <div className="w-64 max-w-[80vw] rotate-2 opacity-95"><TaskCard occ={dragging} onOpen={() => {}} compact /></div> : null}</DragOverlay>
      </DndContext>

      <p className="mt-4 text-center text-[12.5px] text-muted">{t('dragHint')}</p>

      <button onClick={() => ui.openEditor({ draft: { date: cursor } })} aria-label={t('addTask')}
        className="press fixed bottom-[calc(var(--sab)+96px)] right-5 z-20 grid h-14 w-14 place-items-center rounded-full bg-accent text-white shadow-float md:bottom-8 md:right-8">
        <Plus size={28} />
      </button>
    </div>
  );
}

interface ViewProps { date: string; today: string; tasks: ReturnType<typeof store.state.tasks.slice>; onOpen: (o: Occurrence) => void; weekStartsOn: 0 | 1 }

function WeekStrip({ date, today, onPick, weekStartsOn, tasks }: { date: string; today: string; onPick: (d: string) => void; weekStartsOn: 0 | 1; tasks: ViewProps['tasks'] }) {
  const lang = useStore((s) => s.settings.lang);
  const days = rangeDays(startOfWeek(date, weekStartsOn), addDays(startOfWeek(date, weekStartsOn), 6));
  const map = occurrencesInRange(tasks, days[0], days[6]);
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d) => (
        <Droppable key={d} id={`strip-${d}`} data={{ date: d }} className="rounded-2xl">
          <button onClick={() => onPick(d)} className={cn('press flex w-full flex-col items-center rounded-2xl py-2', d === date ? 'bg-accent text-white' : d === today ? 'bg-accent/10 text-accent' : '')}>
            <span className={cn('text-[11px] font-medium', d === date ? 'text-white/80' : 'text-muted')}>{weekdayShort(lang, d)}</span>
            <span className="tnum text-[18px] font-semibold">{Number(d.slice(8))}</span>
            <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', (map.get(d)?.length ?? 0) > 0 ? (d === date ? 'bg-white' : 'bg-accent') : 'bg-transparent')} />
          </button>
        </Droppable>
      ))}
    </div>
  );
}

function DayView({ date, today, tasks, onOpen, onPick, weekStartsOn }: ViewProps & { onPick: (d: string) => void }) {
  const t = useT();
  const tz = useStore((s) => s.settings.timeZone);
  const occ = occurrencesOn(tasks, date);
  const untimed = occ.filter((o) => !o.task.startTime);
  const timed = occ.filter((o) => o.task.startTime);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowMin = nowInTz(tz).minutes;

  useEffect(() => {
    const first = timed[0] ? timeToMinutes(timed[0].task.startTime)! : date === today ? nowMin : 8 * 60;
    scrollRef.current?.scrollTo({ top: Math.max(0, (first / 60 - 1) * HOUR_H), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // lane layout for overlapping events
  const lanes: { occ: Occurrence; top: number; height: number; lane: number; lanes: number }[] = [];
  const sorted = [...timed].sort((a, b) => (a.task.startTime! < b.task.startTime! ? -1 : 1));
  let group: typeof lanes = [];
  let groupEnd = -1;
  const flush = () => { const n = Math.max(...group.map((g) => g.lane)) + 1; group.forEach((g) => (g.lanes = n)); group = []; };
  for (const o of sorted) {
    const s = timeToMinutes(o.task.startTime)!;
    const e = Math.max(s + 30, timeToMinutes(o.task.endTime) ?? s + 45);
    if (s >= groupEnd && group.length) flush();
    const used = new Set(group.filter((g) => g.top + g.height > (s / 60) * HOUR_H).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    const item = { occ: o, top: (s / 60) * HOUR_H, height: ((e - s) / 60) * HOUR_H, lane, lanes: 1 };
    group.push(item); lanes.push(item);
    groupEnd = Math.max(groupEnd, e);
  }
  if (group.length) flush();

  return (
    <div className="space-y-3">
      <WeekStrip date={date} today={today} onPick={onPick} weekStartsOn={weekStartsOn} tasks={tasks} />
      {untimed.length > 0 && (
        <Droppable id={`day-untimed-${date}`} data={{ date }} className="space-y-2 rounded-2xl">
          <p className="px-1 text-[13px] font-medium text-muted">{t('anytime')}</p>
          {untimed.map((o) => <Draggable key={o.task.id} id={`d-${o.task.id}-${o.date}`} occ={o}><TaskCard occ={o} onOpen={onOpen} compact /></Draggable>)}
        </Droppable>
      )}
      <div ref={scrollRef} className="card relative h-[62dvh] overflow-y-auto md:h-[68vh]" data-testid="day-grid">
        <div className="relative" style={{ height: 24 * HOUR_H }}>
          {Array.from({ length: 24 }, (_, h) => (
            <Droppable key={h} id={`slot-${date}-${h}`} data={{ date, hour: h }} className="flex border-t border-line/60">
              <div style={{ height: HOUR_H - 1 }} className="flex w-full">
                <span className="tnum w-14 shrink-0 -translate-y-2 pr-2 text-right text-[11.5px] text-muted">{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</span>
              </div>
            </Droppable>
          ))}
          {date === today && (
            <div className="pointer-events-none absolute left-12 right-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR_H }}>
              <span className="h-2.5 w-2.5 -translate-x-1 rounded-full bg-danger" />
              <span className="h-[2px] flex-1 bg-danger" />
            </div>
          )}
          {lanes.map(({ occ: o, top, height, lane, lanes: n }) => {
            const cat = store.state.categories.find((c) => c.id === o.task.categoryId);
            const color = cat?.color ?? '#4f6cff';
            return (
              <div key={o.task.id + o.date} className="absolute z-[5]" style={{ top: top + 1, height: height - 2, left: `calc(3.5rem + (100% - 3.75rem) * ${lane / n})`, width: `calc((100% - 3.75rem) / ${n} - 4px)` }}>
                <Draggable id={`g-${o.task.id}-${o.date}`} occ={o}>
                  <button onClick={() => onOpen(o)} className="press flex w-full flex-col overflow-hidden rounded-xl px-2.5 py-1.5 text-left"
                    style={{ height: height - 2, background: `${color}22`, borderLeft: `3px solid ${color}` }}>
                    <span className={cn('truncate text-[13.5px] font-semibold', o.done && 'line-through opacity-60')}>{o.task.title}</span>
                    {height > 36 && <span className="tnum text-[12px] text-muted">{o.task.startTime}{o.task.endTime ? `–${o.task.endTime}` : ''}{o.task.location ? ` · ${o.task.location}` : ''}</span>}
                  </button>
                </Draggable>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekView({ date, today, tasks, onOpen, weekStartsOn, onPickDay }: ViewProps & { onPickDay: (d: string) => void }) {
  const lang = useStore((s) => s.settings.lang);
  const start = startOfWeek(date, weekStartsOn);
  const days = rangeDays(start, addDays(start, 6));
  const map = occurrencesInRange(tasks, days[0], days[6]);
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-7 md:gap-2" data-testid="week-view">
      {days.map((d) => {
        const list = map.get(d) ?? [];
        return (
          <Droppable key={d} id={`week-${d}`} data={{ date: d }} testId={`week-day-${d}`}
            className={cn('rounded-2xl p-2 transition md:min-h-[300px]', d === today ? 'bg-accent/[.07] ring-1 ring-accent/30' : 'bg-surface/60 dark:bg-surface/40')}>
            <button onClick={() => onPickDay(d)} className="mb-1.5 flex w-full items-baseline gap-2 px-1.5 text-left">
              <span className={cn('tnum text-[20px] font-bold', d === today && 'text-accent')}>{Number(d.slice(8))}</span>
              <span className={cn('text-[13px] font-medium', d === today ? 'text-accent' : 'text-muted')}>{weekdayShort(lang, d)}</span>
              <span className="ml-auto text-[12px] text-muted">{list.length || ''}</span>
            </button>
            <div className="space-y-1.5">
              {list.map((o) => (
                <Draggable key={o.task.id + d} id={`w-${o.task.id}-${d}`} occ={o}>
                  <TaskCard occ={o} onOpen={onOpen} compact className="px-3" />
                </Draggable>
              ))}
            </div>
          </Droppable>
        );
      })}
    </div>
  );
}

function MonthView({ date, today, tasks, onOpen, weekStartsOn, onPick }: ViewProps & { onPick: (d: string) => void }) {
  const lang = useStore((s) => s.settings.lang);
  const categories = useStore((s) => s.categories);
  const first = startOfWeek(startOfMonth(date), weekStartsOn);
  const last = addDays(startOfWeek(endOfMonth(date), weekStartsOn), 6);
  const days = rangeDays(first, last);
  const map = occurrencesInRange(tasks, first, last);
  const month = date.slice(0, 7);
  const selected = map.get(date) ?? occurrencesOn(tasks, date);
  return (
    <div className="space-y-4">
      <div className="card p-2" data-testid="month-view">
        <div className="grid grid-cols-7 pb-1">
          {days.slice(0, 7).map((d) => <span key={d} className="py-1 text-center text-[11.5px] font-medium text-muted">{weekdayShort(lang, d)}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((d) => {
            const list = map.get(d) ?? [];
            const load = list.length;
            return (
              <Droppable key={d} id={`month-${d}`} data={{ date: d }} className="rounded-xl">
                <button onClick={() => onPick(d)} data-testid={`month-cell-${d}`}
                  className={cn('press flex aspect-square w-full flex-col items-center rounded-xl pt-1.5 md:aspect-[1.25]',
                    d === date ? 'bg-accent text-white' : d === today ? 'bg-accent/10' : '', d.slice(0, 7) !== month && d !== date && 'opacity-35')}>
                  <span className={cn('tnum text-[15px] font-semibold', d === today && d !== date && 'text-accent')}>{Number(d.slice(8))}</span>
                  <span className="mt-1 flex max-w-full flex-wrap justify-center gap-[3px] px-1">
                    {list.slice(0, 4).map((o) => (
                      <span key={o.task.id} className="h-[6px] w-[6px] rounded-full"
                        style={{ background: d === date ? '#fff' : categories.find((c) => c.id === o.task.categoryId)?.color ?? 'rgb(var(--accent))', opacity: o.done ? 0.4 : 1 }} />
                    ))}
                  </span>
                  {load > 4 && <span className="text-[9.5px] leading-none opacity-70">+{load - 4}</span>}
                </button>
              </Droppable>
            );
          })}
        </div>
      </div>
      <div>
        <h2 className="mb-2 px-1 text-[15px] font-semibold">{dayMonth(lang, date)}, {weekdayShort(lang, date)}</h2>
        <div className="space-y-2">
          {selected.length === 0 && <p className="px-1 text-[14px] text-muted">—</p>}
          {selected.map((o) => (
            <Draggable key={o.task.id + date} id={`m-${o.task.id}-${date}`} occ={o}>
              <TaskCard occ={o} onOpen={onOpen} />
            </Draggable>
          ))}
        </div>
      </div>
    </div>
  );
}
