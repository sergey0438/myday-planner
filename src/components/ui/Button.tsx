import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/util';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'press inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' && 'h-9 px-3 text-[14px]',
        size === 'md' && 'h-11 px-4 text-[15px]',
        size === 'lg' && 'h-[52px] px-5 text-[16px]',
        variant === 'primary' && 'bg-accent text-accent-fg shadow-sm',
        variant === 'secondary' && 'bg-bg text-fg ring-1 ring-line dark:bg-elevated',
        variant === 'ghost' && 'text-accent hover:bg-accent/10',
        variant === 'danger' && 'bg-danger/10 text-danger',
        className,
      )}
      {...rest}
    />
  );
});
