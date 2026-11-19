import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/util';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerRight?: ReactNode;
}

/** Bottom sheet on phones, centered dialog on tablets/desktop. */
export function Sheet({ open, onOpenChange, title, children, footer, className, headerRight }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed z-50 flex flex-col bg-surface text-fg outline-none',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl animate-sheet-in',
            'md:inset-auto md:left-1/2 md:top-1/2 md:w-[560px] md:max-h-[86vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:animate-pop-in md:shadow-float',
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line md:hidden" />
          <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-3">
            <Dialog.Title className="text-[19px] font-semibold tracking-tight">{title}</Dialog.Title>
            <div className="flex items-center gap-1">
              {headerRight}
              <Dialog.Close className="press grid h-9 w-9 place-items-center rounded-full bg-bg text-muted" aria-label="Закрыть">
                <X size={18} />
              </Dialog.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
          {footer && <div className="border-t border-line/70 px-5 pt-3 pb-[max(var(--sab),14px)]">{footer}</div>}
          {!footer && <div className="pb-[var(--sab)]" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
