import { Check, Clock, Flag, ListChecks, MapPin, Repeat, Star } from 'lucide-react';
import type { Occurrence } from '@/lib/types';
import { store, useStore } from '@/data/store';
import { cn, haptic } from '@/lib/util';
import { relativeDay, timeRange } from '@/lib/format';

interface Props {
  occ: Occurrence;
  onOpen: (occ: Occurrence) => void;
  showDate?: boolean;
  compact?: boolean;
  className?: string;
}

export const PRIORITY_COLORS = ['', '#60a5fa', '#f59e0b', '#ef4444'];

export function CheckButton({ done, color, onToggle, label }: { done: boolean; color: string; onToggle: () => void; label: string }) {
  return (
    <button
      aria-label={label}
      aria-pressed={done}
      onClick={(e) => {
        e.stopPropagation();
        haptic(10);
        onToggle();
      }}
      className="press -m-2 grid h-11 w-11 shrink-0 place-items-center"
    >
      <span
        className={cn('grid h-[26px] w-[26px] place-items-center rounded-full border-2 transition-all duration-200')}
        style={{ borderColor: color, background: done ? color : 'transparent' }}
      >
        <Check size={15} strokeWidth={3} className={cn('text-white transition-all duration-200', done ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
      </span>
    </button>
  );
}

export function TaskCard({ occ, onOpen, showDate, compact, className }: Props) {
  const { task, done, date } = occ;
  const cat = useStore((s) => s.categories.find((c) => c.id === task.categoryId));
  const lang = useStore((s) => s.settings.lang);
  const color = cat?.color ?? '#a1a1aa';
  const subDone = task.subtasks.filter((s) => s.done).length;
  const today = store.today();
  const overdue = !done && !!date && date < today;

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="task-card"
      onClick={() => onOpen(occ)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(occ)}
      className={cn('card press flex cursor-pointer items-start gap-3 px-4', compact ? 'py-2.5' : 'py-3.5', className)}
    >
      <div className="pt-0.5">
        <CheckButton
          done={done}
          color={color}
          label={done ? store.t('reopen') : store.t('complete')}
          onToggle={() => void store.toggleDone(task, date)}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={cn('min-w-0 flex-1 text-[16px] font-medium leading-snug transition-colors [overflow-wrap:anywhere]', done && 'text-muted line-through decoration-1')}>
            {task.title || store.t('untitled')}
          </p>
          {task.favorite && <Star size={15} className="mt-0.5 shrink-0 fill-amber-400 text-amber-400" />}
          {task.priority > 0 && <Flag size={15} className="mt-0.5 shrink-0" style={{ color: PRIORITY_COLORS[task.priority], fill: PRIORITY_COLORS[task.priority] }} />}
        </div>
        {(task.startTime || task.location || task.recurrence || task.subtasks.length > 0 || showDate || cat) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            {showDate && (
              <span className={cn(overdue && 'font-medium text-danger')}>{relativeDay(lang, date, today)}</span>
            )}
            {task.startTime && (
              <span className="tnum inline-flex items-center gap-1">
                <Clock size={13} />
                {timeRange(task.startTime, task.endTime)}
              </span>
            )}
            {task.location && (
              <span className="inline-flex min-w-0 max-w-[60%] items-center gap-1">
                <MapPin size={13} className="shrink-0" />
                <span className="truncate">{task.location}</span>
              </span>
            )}
            {task.recurrence && <Repeat size={13} aria-label="repeat" />}
            {task.subtasks.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <ListChecks size={13} />
                {subDone}/{task.subtasks.length}
              </span>
            )}
            {cat && !compact && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
                {cat.name}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
