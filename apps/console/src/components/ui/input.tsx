/**
 * The text field.
 *
 * shadcn/ui's anatomy, the same as `button.tsx`: a `cva` for the classes, a
 * thin component around a real `<input>`, every value a token. It was a `cva`
 * inside `routes/Login.tsx` with a note saying it belonged here the moment a
 * second screen wanted it; `/login` was rebuilt against `components/ui/` this
 * run, so it is here.
 *
 * 48px, one hairline, a 12px radius, and the sun focus ring the rest of the
 * console uses. That outline is the global `:focus-visible` rule in
 * `globals.css`, so this must NOT suppress it: the border and the ring are
 * different jobs, the border saying "a field" and the ring saying "the
 * keyboard is here".
 *
 * `scroll-mb-40` is what the browser's own scroll-into-view honours, so a
 * field focused near the bottom of a scroller does not sit under its own edge.
 * WCAG 2.2 SC 2.4.11.
 *
 * `invalid` is declared even though nothing sets it yet, because a control
 * shipped with half its states is how a tool starts feeling unfinished, and
 * because the server's refusal has to have somewhere to land when it names a
 * field.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

const input = cva(
  cn(
    'num h-12 w-full scroll-mb-40 rounded-[var(--radius-base)] border bg-[var(--card)] px-4',
    'text-[0.9375rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]',
    'transition-colors duration-150 ease-[var(--ease)]',
    'disabled:cursor-not-allowed disabled:opacity-45',
  ),
  {
    variants: {
      tone: {
        default: cn(
          'border-[var(--field-border)]',
          'hover:border-[var(--foreground)]',
          'focus:border-[var(--foreground)]',
        ),
        invalid: cn('border-[var(--reject)]', 'focus:border-[var(--reject)]'),
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'tone'>,
    VariantProps<typeof input> {}

export function Input({ className, tone, ...props }: InputProps) {
  return <input className={cn(input({ tone }), className)} {...props} />;
}

export { input as inputVariants };
