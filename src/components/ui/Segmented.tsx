import { cn } from '@/lib/util';

interface Props<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ value, options, onChange, className }: Props<T>) {
  return (
    <div className={cn('flex rounded-xl bg-line/60 p-1 dark:bg-elevated', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg px-3 py-1.5 text-[14px] font-medium transition',
            o.value === value ? 'bg-surface text-fg shadow-sm dark:bg-line' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
