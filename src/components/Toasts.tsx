import { store, useStore } from '@/data/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--sab)+92px)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-fg px-4 py-3 text-[14.5px] font-medium text-bg shadow-float animate-pop-in">
          <span>{t.text}</span>
          {t.action && (
            <button className="font-semibold text-accent" onClick={() => { t.action!.run(); store.dismissToast(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}
