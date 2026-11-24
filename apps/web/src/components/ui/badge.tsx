import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  default: 'bg-surface-sunken text-muted',
  primary: 'bg-info-surface text-accent',
  success: 'bg-success-surface text-success',
  warning: 'bg-warning-surface text-text',
} as const;

export function Badge({
  className,
  variant = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
