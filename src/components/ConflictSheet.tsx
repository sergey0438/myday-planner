import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { store, useStore, useT } from '@/data/store';
import type { TaskRow } from '@/data/mapping';

const FIELD_LABEL: Record<string, string> = {
  title: 'title', description: 'description', date: 'date', start_time: 'start', end_time: 'end', location: 'location',
  priority: 'priority', category_id: 'category', recurrence: 'repeat', subtasks: 'subtasks', completed_at: 'done', deleted: 'delete',
  favorite: 'favorite', name: 'title', color: 'category',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x && 'title' in x ? (x as { title: string }).title : String(x))).join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function ConflictSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const conflicts = useStore((s) => s.conflicts);
  return (
    <Sheet open={open && conflicts.length > 0} onOpenChange={(o) => !o && onClose()} title={t('conflicts')}>
      <div className="space-y-4">
        <p className="text-[14px] text-muted">{t('conflictText')}</p>
        {conflicts.map((c) => {
          const l = c.local as TaskRow & Record<string, unknown>;
          const s = c.server as TaskRow & Record<string, unknown>;
          return (
            <div key={c.id} className="rounded-2xl bg-bg p-4 ring-1 ring-line dark:bg-elevated">
              <p className="mb-3 font-semibold">{(s.title as string) || (s as unknown as { name: string }).name}</p>
              <div className="grid grid-cols-2 gap-3 text-[13.5px]">
                <div>
                  <p className="mb-1 font-medium text-accent">{t('thisDevice')}</p>
                  {c.fields.map((f) => <p key={f}><span className="text-muted">{t((FIELD_LABEL[f] ?? 'title') as Parameters<typeof t>[0])}: </span>{show(l[f])}</p>)}
                </div>
                <div>
                  <p className="mb-1 font-medium text-muted">{t('otherDevice')}</p>
                  {c.fields.map((f) => <p key={f}><span className="text-muted">{t((FIELD_LABEL[f] ?? 'title') as Parameters<typeof t>[0])}: </span>{show(s[f])}</p>)}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                <Button size="sm" onClick={() => void store.resolveConflict(c, 'mine')}>{t('keepMine')}</Button>
                <Button size="sm" variant="secondary" onClick={() => void store.resolveConflict(c, 'theirs')}>{t('keepTheirs')}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
