import { AlertTriangle, CloudOff } from 'lucide-react';
import { useState } from 'react';
import { useStore, useT } from '@/data/store';
import { cloudConfigured } from '@/sync/supabase';
import { ConflictSheet } from './ConflictSheet';

export function Banners() {
  const t = useT();
  const conflicts = useStore((s) => s.conflicts);
  const online = useStore((s) => s.online);
  const pending = useStore((s) => s.pending);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      {!cloudConfigured && (
        <div className="flex items-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-3 text-[13.5px] text-amber-700 dark:text-amber-300">
          <CloudOff size={17} className="shrink-0" /> {t('localMode')}
        </div>
      )}
      {cloudConfigured && !online && (
        <div className="flex items-center gap-2 rounded-2xl bg-line/60 px-4 py-3 text-[13.5px] text-muted dark:bg-elevated" data-testid="offline-banner">
          <CloudOff size={17} className="shrink-0" /> {t('syncOffline')}{pending > 0 ? ` · ${t('pending')}: ${pending}` : ''}
        </div>
      )}
      {conflicts.length > 0 && (
        <button onClick={() => setOpen(true)} className="press flex w-full items-center gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-left text-[13.5px] font-medium text-danger">
          <AlertTriangle size={17} className="shrink-0" /> {t('conflictsBanner')} ({conflicts.length})
        </button>
      )}
      <ConflictSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
