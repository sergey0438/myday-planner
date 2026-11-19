import { Cloud, CloudOff, Loader2, AlertCircle } from 'lucide-react';
import { store, useStore, useT } from '@/data/store';
import { useUi } from './ui';

export function SyncDot() {
  const t = useT();
  const ui = useUi();
  const status = useStore((s) => s.syncStatus);
  const online = useStore((s) => s.online);
  const pending = useStore((s) => s.pending);
  const label = !online ? t('syncOffline') : status === 'syncing' ? t('syncSyncing') : status === 'error' ? t('syncError') : status === 'disabled' ? t('syncDisabled') : t('syncIdle');
  const Icon = !online || status === 'offline' ? CloudOff : status === 'syncing' ? Loader2 : status === 'error' ? AlertCircle : Cloud;
  return (
    <button
      onClick={() => { void store.syncNow(); ui.navigate('settings'); }}
      className="press relative grid h-10 w-10 place-items-center rounded-full bg-surface text-muted shadow-card"
      aria-label={label}
      title={label}
      data-testid="sync-status"
      data-status={online ? status : 'offline'}
    >
      <Icon size={19} className={status === 'syncing' ? 'animate-spin' : status === 'error' ? 'text-danger' : ''} />
      {pending > 0 && status !== 'disabled' && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{pending}</span>}
    </button>
  );
}
