import { Archive, BarChart3, ChevronRight, Search, Settings as SettingsIcon, Star } from 'lucide-react';
import { useT } from '@/data/store';
import { useUi, type Route } from '@/components/ui';
import { PageHeader } from './Lists';

export function More() {
  const t = useT();
  const ui = useUi();
  const items: { route: Route; label: string; icon: React.ReactNode; color: string }[] = [
    { route: 'stats', label: t('stats'), icon: <BarChart3 size={19} />, color: '#4f7cff' },
    { route: 'search', label: t('search'), icon: <Search size={19} />, color: '#8e8e93' },
    { route: 'favorites', label: t('favorites'), icon: <Star size={19} />, color: '#f59e0b' },
    { route: 'archive', label: t('archive'), icon: <Archive size={19} />, color: '#10b981' },
    { route: 'settings', label: t('settings'), icon: <SettingsIcon size={19} />, color: '#71717a' },
  ];
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-safe md:px-8 md:pt-8">
      <PageHeader title={t('more')} />
      <div className="card divide-y divide-line/70">
        {items.map((i) => (
          <button key={i.route} onClick={() => ui.navigate(i.route)} className="press flex w-full items-center gap-3.5 px-4 py-3.5 text-left" data-testid={`more-${i.route}`}>
            <span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ background: i.color }}>{i.icon}</span>
            <span className="flex-1 text-[16px]">{i.label}</span>
            <ChevronRight size={18} className="text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
