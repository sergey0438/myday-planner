import { useMemo } from 'react';
import { Flame, MoveRight } from 'lucide-react';
import { useStore, useT } from '@/data/store';
import { addDays, nowInTz, rangeDays, startOfMonth, startOfWeek } from '@/lib/dates';
import { occurrencesInRange } from '@/lib/recurrence';
import { weekdayShort } from '@/lib/format';
import { ProgressRing } from '@/components/ProgressRing';
import { PageHeader } from './Lists';

export function Stats() {
  const t = useT();
  const tasks = useStore((s) => s.tasks);
  const categories = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const today = nowInTz(settings.timeZone).date;

  const s = useMemo(() => {
    // completion events: date -> list of category ids
    const doneByDay = new Map<string, (string | null)[]>();
    const push = (d: string, c: string | null) => doneByDay.set(d, [...(doneByDay.get(d) ?? []), c]);
    for (const x of tasks) {
      if (x.recurrence) x.doneDates.forEach((d) => push(d, x.categoryId));
      else if (x.completedAt) push(nowInTz(settings.timeZone, new Date(x.completedAt)).date, x.categoryId);
    }
    const count = (from: string, to: string) => rangeDays(from, to).reduce((n, d) => n + (doneByDay.get(d)?.length ?? 0), 0);
    const from30 = addDays(today, -29);
    const occ = occurrencesInRange(tasks, from30, today);
    let planned = 0, done = 0;
    for (const list of occ.values()) for (const o of list) { planned++; if (o.done) done++; }
    const byCat = new Map<string | null, number>();
    for (const d of rangeDays(from30, today)) for (const c of doneByDay.get(d) ?? []) byCat.set(c, (byCat.get(c) ?? 0) + 1);
    let streak = 0;
    for (let d = (doneByDay.get(today)?.length ? today : addDays(today, -1)); doneByDay.get(d)?.length; d = addDays(d, -1)) streak++;
    const days14 = rangeDays(addDays(today, -13), today).map((d) => ({ d, n: doneByDay.get(d)?.length ?? 0 }));
    const heatStart = startOfWeek(addDays(today, -7 * 11), 1);
    const heat = rangeDays(heatStart, addDays(startOfWeek(today, 1), 6)).map((d) => ({ d, n: doneByDay.get(d)?.length ?? 0 }));
    return {
      today: count(today, today),
      week: count(startOfWeek(today, settings.weekStartsOn), today),
      month: count(startOfMonth(today), today),
      rate: planned ? done / planned : 0,
      planned, done,
      byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
      postponed: tasks.reduce((n, x) => n + x.postponedCount, 0),
      streak, days14, heat,
    };
  }, [tasks, today, settings.timeZone, settings.weekStartsOn]);

  const max14 = Math.max(1, ...s.days14.map((x) => x.n));
  const maxHeat = Math.max(1, ...s.heat.map((x) => x.n));
  const catTotal = s.byCat.reduce((n, [, v]) => n + v, 0) || 1;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-safe md:px-8 md:pt-8" data-testid="stats">
      <PageHeader title={t('stats')} back="more" />
      <div className="grid grid-cols-3 gap-3">
        {[{ k: 'statsToday', v: s.today }, { k: 'statsWeek', v: s.week }, { k: 'statsMonth', v: s.month }].map((x) => (
          <div key={x.k} className="card p-4">
            <p className="tnum text-[30px] font-bold leading-none">{x.v}</p>
            <p className="mt-1.5 text-[12.5px] text-muted">{t(x.k as 'statsToday')}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="card flex items-center gap-4 p-5">
          <ProgressRing value={s.rate} size={92} stroke={10} color="rgb(var(--success))">
            <span className="tnum text-[20px] font-bold">{Math.round(s.rate * 100)}%</span>
          </ProgressRing>
          <div>
            <p className="text-[17px] font-semibold">{t('completionRate')}</p>
            <p className="tnum text-[14px] text-muted">{s.done} / {s.planned} · 30 {settings.lang === 'uk' ? 'днів' : 'дней'}</p>
          </div>
        </div>
        <div className="card grid grid-cols-2 gap-3 p-5">
          <div>
            <Flame className="mb-1 text-orange-500" size={22} />
            <p className="tnum text-[26px] font-bold leading-none">{s.streak}</p>
            <p className="mt-1 text-[12.5px] text-muted">{t('streak')}</p>
          </div>
          <div>
            <MoveRight className="mb-1 text-amber-500" size={22} />
            <p className="tnum text-[26px] font-bold leading-none" data-testid="postponed-total">{s.postponed}</p>
            <p className="mt-1 text-[12.5px] text-muted">{t('postponedCount')}</p>
          </div>
        </div>
      </div>

      <section className="card mt-3 p-5">
        <h2 className="text-[16px] font-semibold">{t('activity')}</h2>
        <p className="text-[13px] text-muted">{t('last14')}</p>
        <div className="mt-4 flex h-36 items-end gap-1.5">
          {s.days14.map(({ d, n }) => (
            <div key={d} className="flex flex-1 flex-col items-center gap-1">
              <span className="tnum text-[10.5px] text-muted">{n || ''}</span>
              <div className="w-full rounded-md bg-accent transition-all" style={{ height: `${(n / max14) * 100}px`, minHeight: 3, opacity: n ? (d === today ? 1 : 0.75) : 0.18 }} />
              <span className={`text-[10px] ${d === today ? 'font-bold text-accent' : 'text-muted'}`}>{weekdayShort(settings.lang, d).slice(0, 2)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-[16px] font-semibold">{t('byCategory')}</h2>
          {s.byCat.length === 0 && <p className="text-[14px] text-muted">—</p>}
          <div className="space-y-2.5">
            {s.byCat.map(([id, n]) => {
              const c = categories.find((x) => x.id === id);
              return (
                <div key={id ?? 'none'}>
                  <div className="mb-1 flex justify-between text-[13.5px]"><span>{c?.name ?? t('noCategory')}</span><span className="tnum text-muted">{n}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-line/70"><div className="h-full rounded-full" style={{ width: `${(n / catTotal) * 100}%`, background: c?.color ?? '#a1a1aa' }} /></div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-[16px] font-semibold">{t('last12w')}</h2>
          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {s.heat.map(({ d, n }) => (
              <div key={d} title={`${d}: ${n}`} className="aspect-square rounded-[3px]"
                style={{ background: d > today ? 'transparent' : n ? `rgb(var(--success) / ${0.25 + 0.75 * (n / maxHeat)})` : 'rgb(var(--line))' }} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
