/**
 * The small shared pieces: panel, field row, verdict pill, states.
 *
 * These exist so the same idea looks the same on every screen. A "measured
 * quantity beside its label" appears on Home, on Review and in the Pipeline
 * table; three hand-rolled versions of it is how a tool stops looking like one
 * product.
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { IconAlert, IconPartial, IconPass, IconReject } from '../icons.tsx';
import { Cu } from '../identity/Cu.tsx';

/**
 * A surface.
 *
 * Note what this is not: it is not a card holding an icon, a heading and a line
 * of text, repeated at the same size to make a page. That arrangement is the
 * lazy container, and nesting one inside another is always wrong. `Panel` is a
 * ground for content that has its own structure.
 */
export function Panel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * A label and its value, where the value is a measured quantity.
 *
 * The value is `.num` — mono and tabular — because these are read in columns
 * and scanned for the one that is wrong. `mutedLabel` puts the label above the
 * value in a rail; the default puts them on one line for a dense list.
 */
export function Field({
  label,
  value,
  hint,
  tone = 'default',
  stacked = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'warn' | 'data';
  stacked?: boolean;
}) {
  const valueTone =
    tone === 'warn'
      ? 'text-[var(--reject-ink)]'
      : tone === 'data'
        ? 'text-[var(--tech-600)] dark:text-[var(--tech-300)]'
        : '';

  if (stacked) {
    return (
      <div>
        <dt className="text-[0.75rem] font-medium uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
          {label}
        </dt>
        <dd className={cn('num mt-1 text-[1.0625rem] font-medium', valueTone)}>{value}</dd>
        {hint ? (
          <p className="mt-1 text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">{hint}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[0.8125rem] text-[var(--muted-foreground)]">{label}</dt>
      <dd className={cn('num text-[0.8125rem] font-medium', valueTone)}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Verdict pills. Colour AND shape, always — red/green colour blindness is
   common and this axis decides whether somebody is paid.

   The hue is on the glyph and the tint; the word is ordinary ink. Measured,
   not preferred: `--pass` on `--pass-bg` is 3.06:1, `--reject` 3.43, `--partial`
   3.81, and these render at 11–13px where WCAG 2.2 AA asks 4.5. The three hues
   are fixed by DESIGN.md and no lighter tint rescues them — `--pass` cannot
   reach 4.5 against anything lighter than itself, white included — so the only
   pairing that satisfies the record's own accessibility floor without changing
   a pinned hue is neutral ink, which measures 13.3–16.6:1 in both schemes. The
   shape axis is untouched: the glyph still carries the verdict, in its colour.
   ---------------------------------------------------------------------- */

const VERDICT_STYLE = {
  good: { fg: 'var(--pass)', bg: 'var(--pass-bg)', Glyph: IconPass },
  partial: { fg: 'var(--partial)', bg: 'var(--partial-bg)', Glyph: IconPartial },
  bad: { fg: 'var(--reject)', bg: 'var(--reject-bg)', Glyph: IconReject },
} as const;

export function VerdictPill({
  verdict,
  children,
  size = 'md',
}: {
  verdict: keyof typeof VERDICT_STYLE;
  children: ReactNode;
  size?: 'sm' | 'md';
}) {
  const { fg, bg, Glyph } = VERDICT_STYLE[verdict];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold text-[var(--foreground)]',
        size === 'sm' ? 'px-2 py-0.5 text-[0.75rem]' : 'px-2.5 py-1 text-[0.8125rem]',
      )}
      style={{ backgroundColor: bg }}
    >
      <Glyph size={size === 'sm' ? 13 : 15} style={{ color: fg }} />
      {children}
    </span>
  );
}

/**
 * A flag the engine raised.
 *
 * Severity drives the colour, but the icon is constant: these are always the
 * same kind of thing — something the machine noticed and a human should know
 * before watching.
 */
export function FlagRow({
  code,
  detail,
  blocking,
}: {
  code: string;
  detail: string | null;
  blocking: boolean;
}) {
  return (
    <div className="flex gap-2.5 py-2">
      <IconAlert
        size={16}
        className={cn(
          'mt-0.5 shrink-0',
          blocking ? 'text-[var(--reject)]' : 'text-[var(--sun-600)]',
        )}
      />
      <div className="min-w-0">
        <p className="num text-[0.8125rem] font-medium text-[var(--foreground)]">{code}</p>
        {detail ? (
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An empty state that teaches rather than apologises.
 *
 * Cú carries these — the queue reaching zero is the one moment in the reviewer's
 * day worth marking, and an owl with nothing to watch says it without a
 * congratulation nobody asked for.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[42ch] flex-col items-center py-16 text-center">
      <Cu size={104} />
      <h2 className="mt-5 text-[1.3125rem] font-bold tracking-[-0.02em]">{title}</h2>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * Loading, as a skeleton of the thing that is coming.
 *
 * Not a spinner in the middle of the content: a reviewer waiting for the next
 * episode should see the shape of an episode arriving, so the layout does not
 * jump when it does.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      /**
       * Decoration, and said so. A screen reader that reads six grey boxes as
       * six unlabelled regions is worse than silence; the region that holds
       * them carries `role="status"` and the word, once.
       */
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-[var(--radius-sm)] bg-[var(--muted)]',
        className,
      )}
    />
  );
}

/**
 * The shape of what is coming, plus the one sentence that says it is coming.
 *
 * `role="status"` announces without stealing focus, and `aria-busy` marks the
 * region as not yet settled. Without it the skeletons were invisible to a
 * screen reader and the screen simply went quiet — which reads as finished.
 */
export function Loading({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

/**
 * Something went wrong, said plainly.
 *
 * Copy that reaches somebody who is paid or not paid on this screen says what
 * happened and what to do. No "Oops".
 */
export function Problem({
  title,
  body,
  action,
  onStage = false,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  onStage?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border p-5',
        onStage
          ? 'border-[var(--stage-line)] bg-[var(--stage-panel)]'
          : 'border-[var(--reject)]/35 bg-[var(--reject-bg)]',
      )}
      role="alert"
    >
      <div className="flex gap-3">
        <IconAlert size={20} className="mt-0.5 shrink-0 text-[var(--reject)]" />
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'text-[0.9375rem] font-bold',
              onStage ? 'text-[var(--stage-fg)]' : 'text-[var(--foreground)]',
            )}
          >
            {title}
          </h3>
          <p
            className={cn(
              'mt-1 text-[0.875rem] leading-relaxed',
              onStage ? 'text-[var(--stage-mid)]' : 'text-[var(--muted-foreground)]',
            )}
          >
            {body}
          </p>
          {action ? <div className="mt-3.5">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
