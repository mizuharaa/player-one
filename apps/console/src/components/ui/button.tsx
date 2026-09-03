/**
 * The console's one button.
 *
 * shadcn/ui's anatomy — `cva` variants, a `Slot` escape hatch, the same prop
 * names — so anyone fluent in that ecosystem can read it, but every value comes
 * from the design tokens rather than from shadcn's default neutral palette.
 *
 * The variant list is short on purpose. `primary` is sun-filled and is the only
 * element on any screen allowed to carry `--shadow-sun`; if two of them appear
 * in one viewport, one of them is wrong. `verdict` is separate from everything
 * else because those three buttons are the money path and must not inherit a
 * hover or a disabled treatment that was tuned for a toolbar.
 *
 * Every variant declares hover, active, focus-visible and disabled. Shipping a
 * button with half its states is the most common way a tool starts feeling
 * unfinished, and `:active` in particular is what makes a keyboard-driven
 * screen feel like it responded.
 */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

const button = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease)]',
    'disabled:pointer-events-none disabled:opacity-45',
    'active:translate-y-px',
    '[&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        /**
         * The one glow on the page. Sun means action.
         *
         * The ink is `--on-sun`, and it is dark. White on `sun-500` measures
         * 2.61:1 — a WCAG failure at any size, on the one control every screen
         * points at. `--on-sun` is 7.19:1 on the same fill. The ramps hold
         * their hue in both themes so their ink cannot follow the neutrals,
         * and a colour written as a Tailwind keyword here is a colour the
         * collector app cannot read.
         */
        primary: cn(
          'bg-[var(--sun-500)] text-[var(--on-sun)] shadow-[var(--shadow-sun)]',
          'hover:bg-[var(--sun-600)] active:bg-[var(--sun-700)]',
        ),
        /** Tech blue: leads to data rather than doing something. */
        secondary: cn(
          'bg-[var(--tech-500)] text-[var(--on-tech)]',
          'hover:bg-[var(--tech-600)] active:bg-[var(--tech-700)]',
        ),
        outline: cn(
          'border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)]',
          'hover:bg-[var(--muted)] hover:border-[var(--faint-foreground)]',
        ),
        ghost: cn(
          'text-[var(--muted-foreground)]',
          'hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
        ),
        /** On the stage, where the ground is near-black in both themes. */
        stage: cn(
          'border border-[var(--stage-line)] bg-[var(--stage-panel)] text-[var(--stage-fg)]',
          'hover:border-[var(--stage-mid)] hover:bg-[color-mix(in_srgb,var(--stage-panel)_70%,var(--stage-fg))]',
        ),
      },
      size: {
        sm: 'h-8 rounded-[var(--radius-sm)] px-3 text-[0.8125rem]',
        md: 'h-10 rounded-[var(--radius-base)] px-4 text-[0.9375rem]',
        lg: 'h-12 rounded-[var(--radius-base)] px-6 text-[1.0625rem]',
        /** Square, for a toolbar glyph. Still 32px+, still keyboard-reachable. */
        icon: 'h-9 w-9 rounded-[var(--radius-sm)]',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(button({ variant, size }), className)} {...props} />;
}

/**
 * The keyboard hint that rides inside a button.
 *
 * A complete review must be possible with no pointer at all, so the shortcut is
 * part of the control rather than hidden in a help sheet — a reviewer learns it
 * by seeing it on the button they were already clicking.
 */
export function Key({ children, onStage }: { children: React.ReactNode; onStage?: boolean }) {
  return (
    <kbd
      className={cn(
        'num ml-1 grid h-5 min-w-5 shrink-0 place-items-center rounded-[var(--radius-xs)] border px-1 text-[0.6875rem] font-medium',
        onStage
          ? 'border-[var(--stage-line)] bg-[var(--stage)] text-[var(--stage-mid)]'
          : 'border-[var(--border-strong)] bg-[var(--muted)] text-[var(--muted-foreground)]',
      )}
    >
      {children}
    </kbd>
  );
}

export { button as buttonVariants };
