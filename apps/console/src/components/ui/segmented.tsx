/**
 * The segmented control: one question, every answer visible at once.
 *
 * One pill track with equal segments, not buttons with a gap between them —
 * the track is what says "these are the same question", and a gap says "these
 * are separate decisions". Underneath it is a real set of radios sharing a
 * `name`, so arrow keys move between them, the browser enforces that exactly
 * one is chosen, the value posts with the form, and the whole thing works
 * before any script has run.
 *
 * It was a pair of `cva`s inside `routes/Login.tsx`. Same shape, moved.
 *
 * The caller supplies the `<fieldset>` and its `<legend>`: the legend is the
 * question, and a control cannot know what it is being asked.
 */
import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

const track = cva(
  cn(
    'flex h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border)]',
    'bg-[var(--muted)] p-1',
  ),
);

/**
 * `has-[:focus-visible]` and not a ring on the input: the radio itself is
 * `sr-only`, so its own outline would be drawn around a 1px box somewhere
 * under the label. The segment wears the ring the keyboard earned.
 */
const segment = cva(
  cn(
    'flex h-9 flex-1 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] px-3',
    'text-[0.875rem] font-semibold transition-colors duration-150 ease-[var(--ease)]',
    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]',
  ),
  {
    variants: {
      state: {
        on: 'bg-[var(--foreground)] text-[var(--background)]',
        off: 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
      },
    },
    defaultVariants: { state: 'off' },
  },
);

export function Segmented({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="presentation" className={cn(track(), className)}>
      {children}
    </div>
  );
}

export function SegmentedOption<T extends string>({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: T;
  checked: boolean;
  onSelect: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <label className={segment({ state: checked ? 'on' : 'off' })}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      {children}
    </label>
  );
}

export { track as segmentedTrackVariants, segment as segmentVariants };
