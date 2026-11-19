import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock, MapPin, Mic, Plus, Search } from 'lucide-react';
import { store, useStore, useT } from '@/data/store';
import { occurrencesOn } from '@/lib/recurrence';
import { nowInTz, timeToMinutes } from '@/lib/dates';
import { dayMonth, greetingKey, timeRange, weekdayLong } from '@/lib/format';
import { TaskCard } from '@/components/TaskCard';
import { ProgressRing } from '@/components/ProgressRing';
import { useUi } from '@/components/ui';
import { Banners } from '@/components/Banners';
import { SyncDot } from '@/components/SyncDot';
import type { Occurrence } from '@/lib/types';
import { cn } from '@/lib/util';

function useNow(tz: string) {
  const [now, setNow] = useState(() => nowInTz(tz));
  useEffect(() => {
    setNow(nowInTz(tz));
    const id = setInterval(() => setNow(nowInTz(tz)), 30_000);
    return () => clearInterval(id);
  }, [tz]);
  return now;
}

export function Today() {
  const t = useT();
  const ui = useUi();
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const now = useNow(settings.timeZone);
  const today = now.date;

  const occ = useMemo(() => occurrencesOn(tasks, today), [tasks, today]);
  const overdue = useMemo(
    () => tasks.filter((x) => !x.recurrence && !x.completedAt && x.date && x.date < today).sort((a, b) => (a.date! < b.date! ? -1 : 1))
      .map<Occurrence>((task) => ({ task, date: task.date, done: false })),
    [tasks, today],
  );
  const timed = occ.filter((o) => o.task.startTime && !o.done);
  const untimed = occ.filter((o) => !o.task.startTime && !o.done);
  const doneList = occ.filter((o) => o.done);
  const total = occ.length;
  const doneCount = doneList.length;
  const next =
    timed.find((o) => (timeToMinutes(o.task.endTime) ?? timeToMinutes(o.task.startTime)! + 1) > now.minutes) ??
    untimed[0];
  const nextLive = next && next.task.startTime && timeToMinutes(next.task.startTime)! <= now.minutes;

  const open = (o: Occurrence) => ui.openEditor({ occ: o });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-8 pt-safe md:px-8 md:pt-8">
      <header className="flex items-start justify-between pt-3">
        <div>
          <p className="text-[15px] font-medium text-muted">{t(greetingKey(now.minutes))}</p>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight" data-testid="today-weekday">{weekdayLong(settings.lang, today)}</h1>
          <p className="text-[17px] font-medium text-muted">{dayMonth(settings.lang, today)}</p>
        </div>
        <div className="flex items-center gap-1.5 pt-2">
          <SyncDot />
          <button onClick={() => ui.navigate('search')} className="press grid h-10 w-10 place-items-center rounded-full bg-surface shadow-card" aria-label={t('search')}>
            <Search size={19} />
          </button>
        </div>
      </header>

      <Banners />

      {/* summary */}
      <section className="card flex items-center gap-5 p-5" aria-label={t('progress')}>
        <ProgressRing value={total ? doneCount / total : 0}>
          <span className="tnum text-[17px] font-bold">{total ? Math.round((doneCount / total) * 100) : 0}%</span>
        </ProgressRing>
        <div className="grid flex-1 grid-cols-2 gap-3">
          <div>
            <p className="tnum text-[28px] font-bold leading-none" data-testid="planned-count">{total}</p>
            <p className="mt-1 text-[13px] text-muted">{t('planned')}</p>
          </div>
          <div>
            <p className="tnum text-[28px] font-bold leading-none text-success" data-testid="done-count">{doneCount}</p>
            <p className="mt-1 text-[13px] text-muted">{t('done')}</p>
          </div>
        </div>
      </section>

      {/* voice + add */}
      <section className="flex gap-3">
        <button
          onClick={() => ui.openVoice(true)}
          data-testid="voice-cta"
          className="press flex flex-1 items-center gap-3.5 rounded-2xl bg-gradient-to-br from-[#5b6cff] to-[#8a5cff] p-4 text-left text-white shadow-float"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/20"><Mic size={28} /></span>
          <span>
            <span className="block text-[17px] font-semibold leading-tight">{t('dictate')}</span>
            <span className="mt-0.5 block text-[13px] text-white/80">{t('dictateHint')}</span>
          </span>
        </button>
        <button onClick={() => ui.openEditor({ draft: { date: today } })} aria-label={t('addTask')} data-testid="add-task"
          className="press grid w-[76px] place-items-center rounded-2xl bg-surface text-accent shadow-card">
          <Plus size={30} />
        </button>
      </section>

      {/* next */}
      {next && (
        <section>
          <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{t('next')}</h2>
          <button onClick={() => open(next)} className="card press w-full p-4 text-left" data-testid="next-task">
            <div className="flex items-center gap-3">
              <span className={cn('h-10 w-1.5 rounded-full', nextLive && 'animate-pulse')} style={{ background: store.state.categories.find((c) => c.id === next.task.categoryId)?.color ?? 'rgb(var(--accent))' }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[18px] font-semibold">{next.task.title}</p>
                <p className="mt-0.5 flex items-center gap-3 text-[14px] text-muted">
                  {next.task.startTime && <span className="tnum inline-flex items-center gap-1"><Clock size={14} />{timeRange(next.task.startTime, next.task.endTime)}</span>}
                  {next.task.location && <span className="inline-flex min-w-0 items-center gap-1"><MapPin size={14} /><span className="truncate">{next.task.location}</span></span>}
                </p>
              </div>
              <ArrowRight size={18} className="text-muted" />
            </div>
          </button>
        </section>
      )}

      {overdue.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-danger">{t('overdue')}</h2>
          <div className="space-y-2">{overdue.map((o) => <TaskCard key={o.task.id} occ={o} onOpen={open} showDate />)}</div>
        </section>
      )}

      {/* schedule */}
      <section>
        <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{t('schedule')}</h2>
        {total === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-[17px] font-semibold">{t('emptyDay')}</p>
            <p className="mt-1 text-[14px] text-muted">{t('emptyDayHint')}</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="schedule">
            {timed.map((o) => (
              <div key={o.task.id + o.date} className="flex gap-3">
                <div className="tnum w-12 shrink-0 pt-4 text-right text-[14px] font-semibold text-muted">{o.task.startTime}</div>
                <TaskCard occ={o} onOpen={open} className="flex-1" />
              </div>
            ))}
            {untimed.length > 0 && (
              <>
                {timed.length > 0 && <p className="px-1 pt-2 text-[13px] font-medium text-muted">{t('anytime')}</p>}
                {untimed.map((o) => <TaskCard key={o.task.id + o.date} occ={o} onOpen={open} />)}
              </>
            )}
            {doneList.length > 0 && (
              <>
                <p className="px-1 pt-3 text-[13px] font-medium text-muted">{t('completedToday')} · {doneList.length}</p>
                {doneList.map((o) => <TaskCard key={o.task.id + o.date} occ={o} onOpen={open} compact />)}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
