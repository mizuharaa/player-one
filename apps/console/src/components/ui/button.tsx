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
         * The label is **ink, not white**. White on sun-500 measures 2.61:1 —
         * the label on the one thing a screen is asking for was the worst
         * contrast on the screen — and ink (`--stage`, the console's single
         * near-black, the same one the theatre and the top bar use) measures
         * 7.19:1 on the same fill. `--stage` and not `--foreground`, because
         * the fill does not change with the scheme and `--foreground` does:
         * in dark mode a `--foreground` label would turn near-white and put
         * the ratio back where it started.
         *
         * The states move the fill and not the ink, and they move it the way a
         * physical button does — lighter under the pointer, darker under the
         * press. Sun-700 is not used here: ink on it is 3.61:1, under the text
         * floor even for the moment a finger is down.
         */
        primary: cn(
          'bg-[var(--sun-500)] text-[var(--stage)] shadow-[var(--shadow-sun)]',
          'hover:bg-[var(--sun-400)] active:bg-[var(--sun-600)]',
          /*
           * A disabled primary must not read as a *locked* primary. At 45%
           * opacity the sun fill turns a washed apricot that looks like a
           * button somebody has switched off, on a screen where the only
           * reason it is ever disabled is that a request is in flight for a
           * few hundred milliseconds. So while it is working it keeps its
           * colour and loses only its glow and its lift, which is what a
           * control that is busy actually looks like.
           */
          'disabled:opacity-100 disabled:shadow-none disabled:brightness-[0.97]',
        ),
        /**
         * Ink outline: the second thing on the screen worth doing.
         *
         * It was a filled tech-blue button, which made every secondary action
         * look like a link to data — tech is what the machine is telling you,
         * not something you do. Outlined ink says "an action, not the action",
         * and inverting to a filled ink block on hover is the punch this world
         * is built on.
         */
        secondary: cn(
          'border border-[var(--foreground)] bg-transparent text-[var(--foreground)]',
          'hover:bg-[var(--foreground)] hover:text-[var(--background)]',
          'active:bg-[var(--foreground)] active:text-[var(--background)]',
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
          'hover:border-[var(--stage-mid)] hover:bg-[color-mix(in_srgb,var(--stage-panel)_70%,white)]',
        ),
      },
      size: {
        sm: 'h-8 rounded-[var(--radius-sm)] px-3 text-[0.8125rem]',
        md: 'h-10 rounded-[var(--radius-base)] px-4 text-[0.9375rem]',
        lg: 'h-12 rounded-[var(--radius-base)] px-6 text-[1.0625rem]',
        /**
         * The welcome-screen primary: 56px on a pill.
         *
         * A sign-in button is the only control on its screen, so it reads as a
         * destination rather than as one option among several — which is why it
         * gets a height and a radius nothing inside the console uses. `/login`
         * composed these two values inline and left a comment saying it would
         * become a variant when a second screen wanted the same size. The
         * collector's sign-in wants it. This is that condition.
         */
        xl: 'h-14 rounded-[var(--radius-pill)] px-8 text-[1.0625rem]',
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
        'num ml-1 grid h-5 min-w-5 place-items-center rounded-[5px] border px-1 text-[0.6875rem] font-medium',
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
