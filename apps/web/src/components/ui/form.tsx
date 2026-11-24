import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm shadow-xs outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 aria-invalid:border-danger';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium', className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, className)} {...props} />;
}

/** Label, control, hint and error for one form field. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error?.length ? <p className="text-xs text-muted">{hint}</p> : null}
      {error?.length ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger">
          {error.join(' ')}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({ status, message }: { status: 'idle' | 'error' | 'success'; message?: string }) {
  if (!message || status === 'idle') return null;
  return (
    <p
      role={status === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md px-3 py-2 text-sm',
        status === 'error' ? 'bg-danger-surface text-danger' : 'bg-success-surface text-success',
      )}
    >
      {message}
    </p>
  );
}
