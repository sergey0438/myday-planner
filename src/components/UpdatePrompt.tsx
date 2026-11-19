import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '@/data/store';

let updateFn: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();
let needRefresh = false;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    updateFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefresh = true;
        listeners.forEach((l) => l());
      },
      onRegisteredSW(_url, reg) {
        // check for a new version every 30 minutes and when the app comes back to the foreground
        if (!reg) return;
        setInterval(() => void reg.update().catch(() => {}), 30 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {});
        });
      },
    });
  });
}

export function UpdatePrompt() {
  const t = useT();
  const [show, setShow] = useState(needRefresh);
  useEffect(() => {
    const l = () => setShow(true);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-[max(var(--sat),10px)]">
      <div className="flex items-center gap-3 rounded-2xl bg-fg px-4 py-3 text-bg shadow-float animate-pop-in">
        <RefreshCw size={17} />
        <span className="text-[14.5px] font-medium">{t('update')}</span>
        <button className="rounded-lg bg-accent px-3 py-1.5 text-[14px] font-semibold text-white" onClick={() => void updateFn?.(true)}>{t('updateNow')}</button>
      </div>
    </div>
  );
}
