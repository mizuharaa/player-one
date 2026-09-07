/**
 * The small shared pieces: panel, field row, verdict pill, states.
 *
 * These exist so the same idea looks the same on every screen. A "measured
 * quantity beside its label" appears on Home, on Review and in the Pipeline
 * table; three hand-rolled versions of it is how a tool stops looking like one
 * product.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn.ts';
import { IconAlert, IconPartial, IconPass, IconReject } from '../icons.tsx';
import { Panda } from '../identity/Panda.tsx';

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
        /*
         * Glass, as the world committed 2026-09-07 defines it: `--card` at the
         * card fill over the lavender wash, with a `backdrop-filter` so the
         * ground bends behind it. The page is tinted precisely so this reads
         * as a material — over a white page a translucent card is white, and
         * the effect collapses into a grey rectangle.
         *
         * The border is white rather than `--border`: what catches the light
         * on a piece of glass is its edge, and a grey hairline on a
         * translucent surface reads as a drawn box instead.
         */
        'rounded-[var(--radius-lg)] border border-white/70 shadow-[var(--shadow-sm)]',
        'bg-[color-mix(in_srgb,var(--card)_calc(var(--glass-card)*100%),transparent)]',
        'backdrop-blur-[var(--glass-card-blur)]',
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
  /*
   * `warn` is a discrepancy the machine measured (the device claims 24 s more
   * than the media holds), not a verdict. It used to borrow `--reject`, which
   * put a verdict hue on a row that decides nothing about payment. It is set
   * in weight instead, and the caller's glyph carries the meaning.
   */
  const valueTone =
    tone === 'warn'
      ? 'font-semibold text-[var(--foreground)]'
      : tone === 'data'
        ? 'text-[var(--tech-ink)]'
        : '';

  if (stacked) {
    return (
      <div>
        <dt className="text-[0.75rem] font-medium uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
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
        'inline-flex items-center gap-1.5 rounded-full font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-[0.75rem]' : 'px-2.5 py-1 text-[0.8125rem]',
      )}
      style={{ color: fg, backgroundColor: bg }}
    >
      <Glyph size={size === 'sm' ? 13 : 15} />
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
 * The sentence leads and the code is kept underneath, because the code is what
 * a reviewer reads out to an operator.
 */
export function FlagRow({
  code,
  description,
  detail,
  blocking,
}: {
  code: string;
  description: string;
  detail: string | null;
  blocking: boolean;
}) {
  return (
    <div className="flex gap-2.5 py-2">
      <IconAlert
        size={16}
        className={cn(
          'mt-0.5 shrink-0',
          blocking ? 'text-[var(--reject)]' : 'text-[var(--foreground)]',
        )}
      />
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-medium text-[var(--foreground)]">{description}</p>
        <p className="num mt-0.5 text-[0.75rem] text-[var(--muted-foreground)]">{code}</p>
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
 * Trúc carries these, on a hatched ground. The hatch is the point: an empty
 * table on this console can mean "nothing to do" or it can mean "the query is
 * wrong and somebody is not being paid", and white space reads as the second.
 * A drawn surface says the screen rendered and is empty on purpose. The panda
 * marks the queue reaching zero without a congratulation nobody asked for.
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
    <div className="hatch mx-auto flex max-w-[42ch] flex-col items-center rounded-[var(--radius-lg)] border border-[var(--border)] px-8 py-16 text-center">
      <Panda size={104} />
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
      className={cn(
        'animate-pulse rounded-[var(--radius-sm)] bg-[var(--muted)]',
        className,
      )}
    />
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
  reference,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  onStage?: boolean;
  /**
   * The server's id for this failure, from `ApiError.ref`. Shown small and
   * selectable because its whole job is to be read out or pasted: it is the
   * only thing that joins what the operator saw to the line in the log.
   */
  reference?: string;
}) {
  const { t } = useTranslation();
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
          {reference ? (
            <p
              className={cn(
                'mt-2 font-mono text-[0.75rem] select-all',
                onStage ? 'text-[var(--stage-mid)]' : 'text-[var(--muted-foreground)]',
              )}
            >
              {t('bo.error.reference')} {reference}
            </p>
          ) : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
