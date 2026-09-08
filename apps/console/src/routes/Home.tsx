/**
 * Home: what needs attention, what to do next, and what the shift has done.
 *
 * **The order is the argument.** Attention needed → next action → shift
 * results → recent work → optional insights. Imagery and motion serve that
 * order and never reorder it: the picture is where the next action is, because
 * that is the only place on this screen a photograph is the subject rather than
 * a decoration, and the reveal on scroll runs down the page in the order above.
 * An operator who reads only the first two hundred pixels has read the two
 * things that can cost somebody money.
 *
 * **The figures are a ledger, not four cards.** Measured quantities in one
 * panel, each sitting with the sentence that says what it is and what it is
 * not. A figure whose note is somewhere else is a figure somebody will
 * misread, and on this screen a misread figure is a person thinking they have
 * been paid.
 *
 * **One ink block, and it has to earn it.** `.feature-block` appears once per
 * screen and only where a figure carries its own sentence and its own action
 * — here the settled value, "Your decisions only. Not the programme's spend."
 * and the arrow to `/settle`. Take away either the sentence or the arrow and
 * the block should go back to being a row in the ledger above it.
 *
 * ## Every figure on this screen is measured or absent
 *
 * Every value used to fall back to a literal on error — `data?.decided ?? 0`
 * under the gauge, `durationShort(data?.payable_seconds ?? '0')` in the ledger
 * — so a 500 photographed as "0 episodes reviewed" and "0:00 payable". A
 * reviewer cannot tell that apart from a shift where they have genuinely done
 * nothing, and on this screen that difference is whether somebody has been
 * paid. A 500 must not render as a zero and the gauge must not draw a
 * fabricated target.
 *
 * ## Trúc, and the line he must not cross
 *
 * He is at the bottom, in *optional insights*, and that placement is the whole
 * of his contract. A greeting is authored and a reaction to a press is
 * personality; **an operational statement is evidence**. So every sentence he
 * says that asserts a fact comes from the same query, with the same scope, the
 * same freshness stamp and the same error state as its ordinary counterpart
 * further up the page — and the counterpart is always there, because he is an
 * additional channel and never the only one. `Shift` supplies current figures
 * and **no historical series**, so there is nothing behind a trend and he does
 * not claim one. When the request failed he says **"Not connected"** and shows
 * a dash, and he never substitutes an example for a figure that did not load.
 *
 * Numerical demonstrations live behind a preview the operator turns on by
 * hand, every value carrying "Example — not live data" in all three locales.
 *
 * He is the existing `PandaStage` — the glTF model, the cursor tracking, the
 * walk, the jump, the breathing — mounted only once his section approaches the
 * viewport, because `React.lazy` alone defers until mount and his section is
 * the last thing on the page. He idles constantly, so he carries a Pause
 * control (WCAG 2.2 Pause, Stop, Hide); reduced motion alone does not satisfy
 * that.
 *
 * ## Motion, and what a still frame has to hold
 *
 * The reveal is one CSS utility living entirely inside a
 * `prefers-reduced-motion: no-preference` block, so under reduced motion there
 * is no hidden start state to recover from: the screen is complete and
 * readable in one frame, and two frames two seconds apart are identical. The
 * gauge sweep is the console's one authored performance and is triggered when
 * the ring reaches the viewport rather than on load — and the arc carries its
 * true offset whether or not the class is ever added, so a gauge that is never
 * scrolled to still reads the right number instead of reading zero.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button, Key } from '../components/ui/button.tsx';
import { Panel, Problem, Skeleton, VerdictPill } from '../components/ui/primitives.tsx';
import { Panda } from '../components/identity/Panda.tsx';
import { mascotStateAt, type MascotState } from '@playerone/design/tokens';
import { IconAlert, IconArrow } from '../components/icons.tsx';
import { cn } from '../lib/cn.ts';
import { durationShort, money, pace, stampLocal } from '../lib/format.ts';
import { api, ApiError, type Shift } from '../lib/api.ts';
import { defaultPeriod } from '../payout/period.ts';

/**
 * Three.js stays out of the chunk this route loads, and out of `/review`'s.
 *
 * The lazy import is only half of it: `React.lazy` defers the fetch until the
 * component mounts, and a component that mounts with the page has deferred
 * nothing. `TrucPanel` mounts this only once its section is within a viewport
 * of the fold.
 */
const PandaStage = lazy(() =>
  import('../components/identity/PandaStage.tsx').then((m) => ({ default: m.PandaStage })),
);

/**
 * The four shift names, from the catalogue rather than from `MASCOT_LABEL`.
 *
 * The label map in `Panda.tsx` carries English and Chinese only, because it is
 * artwork metadata that also ships to React Native. This console is read in
 * Vietnamese too, and these four strings already exist in all three locales.
 */
const SHIFT_KEY: Record<MascotState, string> = {
  earlyBird: 'home.shiftEarly',
  dayShift: 'home.shiftDay',
  goldenHour: 'home.shiftGolden',
  nightOwl: 'home.shiftNight',
};

/** `19:42` on the clock of the machine reading it. 24-hour, like every stamp here. */
function clockAt(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Has this element reached the viewport yet — and it only ever answers once.
 *
 * Two jobs, one observer. Sections use it at the fold to add `reveal-in`, and
 * `TrucPanel` uses it a viewport early to decide when the three.js chunk and
 * the glTF are worth fetching. It latches: a section that has been read does
 * not fade out again when it leaves, and a model that has been loaded is not
 * unloaded behind the operator's back.
 *
 * `seen` starts false and the hidden start state exists **only** inside a
 * `prefers-reduced-motion: no-preference` block, so a browser with no
 * `IntersectionObserver` — or an observer that never fires — costs a reveal
 * and never costs the content.
 */
function useOnScreen<T extends HTMLElement>(
  rootMargin = '0px',
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, seen]);

  return [ref, seen];
}

/** A section that rises into place once, on the way down the page. */
function Reveal({
  children,
  className,
  ...rest
}: { children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const [ref, seen] = useOnScreen<HTMLElement>('0px 0px -8% 0px');
  return (
    <section ref={ref} className={cn('reveal', seen && 'reveal-in', className)} {...rest}>
      {children}
    </section>
  );
}

export function HomeScreen() {
  const { t } = useTranslation();

  /**
   * `api.shift()` and not a `fetch` written out here.
   *
   * The hand-rolled version built its `ApiError` from `res.statusText` alone
   * and never read the body, so the `ref` the server puts in a 500 —
   * `{"error":"internal","ref":"req-…"}` — was thrown away before anything
   * could show it. Measured: a mocked 500 rendered the red panel with no
   * reference line under it, which left an operator with nothing to quote and
   * the log line with nothing to be joined to. `call` in `api.ts` has parsed
   * that body since it was written; this route was the one request that went
   * around it.
   */
  const { data, isPending, error, dataUpdatedAt } = useQuery<Shift | null>({
    queryKey: ['shift'],
    queryFn: () => api.shift(),
    /** The shift figures move as the reviewer works; a minute is close enough. */
    refetchInterval: 60_000,
  });

  /**
   * The query is done and there are no figures. Distinct from `isPending`,
   * which is still loading: a skeleton that never resolves and a zero are the
   * two ways this screen used to lie about a failed request.
   */
  const unavailable = !isPending && !data;

  /**
   * When these figures were last measured, on the clock of the machine reading
   * them. Every operational sentence on this screen — Trúc's included — is
   * stamped with it, because a claim about the queue with no time on it is a
   * claim about an unknown moment.
   */
  const asOf = data && dataUpdatedAt > 0 ? clockAt(dataUpdatedAt) : null;

  const state = mascotStateAt();
  const approvalRate =
    data && data.decided > 0 ? Math.round((data.approved / data.decided) * 100) : null;

  return (
    <AppShell
      queueDepth={data?.queue_depth}
      averageSeconds={data?.session_average_seconds}
      operator={data?.reviewer}
    >
      {error ? (
        <div className="mb-5">
          <Problem
            reference={error instanceof ApiError ? error.ref : undefined}
            title={t('ui.a.home.error.title')}
            body={t('ui.a.home.error.body')}
          />
        </div>
      ) : null}

      {/* --- 1. Attention needed. First, and reachable without the panda. --- */}
      <Attention
        needsHuman={data?.needs_human ?? null}
        isPending={isPending}
        unavailable={unavailable}
        asOf={asOf}
      />

      {/* ---------------------------------------------------------------
          2. The next action, and the one place a photograph is the subject.

          A frame of collected footage runs the full width under a measured ink
          scrim, and what stands on it is only what an arriving reviewer has to
          act on: which shift this is, how much work is waiting, and the way in.
          Progress is not here — progress is a result, and results are the next
          section down.

          Nothing in this band moves. It is above the fold, so a reveal here
          would be a page-load sequence rather than a scroll one; and animating
          a surface that type sits on would invalidate the contrast measured on
          it. The image is `landing-poster.jpg`, the same still the sign-in film
          opens on. ponytail: when an episode still is reachable per reviewer,
          this becomes the next episode in their own queue, which is a better
          picture than a stock frame because it is the one they are about to
          judge.
          --------------------------------------------------------------- */}
      <section className="relative isolate mt-5 overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)]">
        <img
          src="/landing-poster.jpg"
          alt=""
          aria-hidden="true"
          /* The largest thing on the screen and above the fold: never lazy. */
          decoding="async"
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
        {/*
          The scrim, flat and measured, the same instrument the sign-in film
          uses: `--stage` at 60% over the worst pixel a frame can hold — pure
          white — composites to `rgb(112,113,115)`, where `--stage-over` reads
          4.94:1. Every ink on this band is that token for that reason.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[color-mix(in_srgb,var(--stage)_60%,transparent)]"
        />

        <div className="flex flex-col gap-6 p-6 text-[var(--stage-over)] sm:p-8 lg:flex-row lg:items-end lg:gap-10 lg:p-12">
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] font-semibold">
              {t('home.greeting')} · {t(SHIFT_KEY[state])}
              {asOf === null ? null : (
                <>
                  {' · '}
                  <span className="num">{t('ui.a.home.asOf', { time: asOf })}</span>
                </>
              )}
            </p>
            <h1 className="mt-3 max-w-[18ch] text-[2.0625rem] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[2.625rem]">
              {t('ui.a.home.next.title')}
            </h1>
            <p className="mt-3 max-w-[46ch] text-[0.9375rem] leading-relaxed">
              {t('ui.a.home.next.body')}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-5 lg:items-end">
            {/*
              The queue, which is what makes the button a decision rather than a
              habit — and it is the programme's own bottleneck. A dash when the
              request failed: there is no measurement, so there is no number.
            */}
            <div className="lg:text-right">
              {isPending ? (
                <Skeleton className="h-[2.625rem] w-24" />
              ) : (
                <p className="num text-[2.625rem] font-extrabold leading-none tracking-[-0.03em]">
                  {unavailable ? '—' : data?.queue_depth}
                </p>
              )}
              <p className="mt-1.5 text-[0.875rem]">
                {unavailable ? t('ui.a.home.unavailable') : t('ui.a.home.queueWaiting')}
              </p>
            </div>

            {/*
              The ink pill needs an edge here, and only here.

              `--action` is near-black on the light shell, and this band is a
              near-black scrim in both schemes: measured on rendered pixels, the
              pill read **1.02:1** against the band around it. Its label was
              fine — light ink on near-black is 15.78:1 — but WCAG 1.4.11 asks
              3:1 of the boundary that identifies a control, and what an
              operator saw was a line of type apparently floating on the
              photograph. The hairline is `--stage-over`, the one white in the
              system and the same token the type on this band uses, which
              measures 5.26:1 against the worst pixel the scrim can produce. In
              the dark scheme the pill inverts to near-white and carries its own
              edge at 15.52:1; the ring costs nothing there.
            */}
            <Button
              asChild
              variant="primary"
              size="lg"
              data-guide="home.start"
              className="ring-1 ring-[var(--stage-over)]"
            >
              <Link to="/review">
                {t('home.start')}
                <Key>R</Key>
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* --- 3. What the shift has done. --- */}
      <Reveal className="mt-8">
        <h2 className="text-[1.0625rem] font-bold tracking-[-0.02em]">
          {t('ui.a.home.results')}
        </h2>

        <div className="mt-3 grid items-start gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <Panel data-guide="home.gauge" className="flex justify-center px-5 py-6">
            {isPending ? (
              <Skeleton className="h-[248px] w-[248px] rounded-full" />
            ) : (
              <Gauge value={data?.decided ?? null} target={data?.target ?? null} />
            )}
          </Panel>

          <Panel data-guide="home.figures" className="px-5 py-1.5">
            <dl className="m-0">
              <Figure
                label={t('home.payable')}
                value={data ? durationShort(data.payable_seconds) : null}
                unavailable={unavailable}
                note={t('ui.a.home.payable.note')}
              />
              <Figure
                label={t('home.approval')}
                value={!data ? null : approvalRate === null ? '—' : `${approvalRate}%`}
                unavailable={unavailable}
                /*
                 * The note carries the programme's own number, because this is
                 * the only figure on the screen a reviewer can read as a grade
                 * and there is nothing on it to grade against. ≥85–90%
                 * qualification is the phase-1 target in PRODUCT.md; without
                 * it, 67% is either a disaster or a Tuesday and the screen does
                 * not say which. It is the *programme's* rate over 40,000
                 * hours, not a quota for one shift, and the sentence says so
                 * rather than turning a target into a score.
                 */
                note={`${t('ui.a.home.approval.note')} ${t('ui.a.home.approval.target')}`}
                /*
                 * The count, and not a verdict pill.
                 *
                 * It read as `good` above 85% and `partial` below it, which
                 * spent two of the three colours that decide whether one person
                 * is paid on an aggregate of everyone. A rate is not a verdict:
                 * there is no episode behind this pill to pass or fail, and a
                 * reviewer who learns that green-here means good has learned
                 * the wrong thing about green-there. The sentence under the
                 * figure carries the judgement instead.
                 */
                trailing={
                  approvalRate === null ? null : (
                    <span className="num rounded-full bg-[var(--muted)] px-2 py-0.5 text-[0.75rem] font-semibold text-[var(--muted-foreground)]">
                      {data?.approved ?? 0}/{data?.decided ?? 0}
                    </span>
                  )
                }
              />
              {/*
                The median, which the payload has carried since it was written
                and this screen never showed.

                A mean over a handful of verdicts is moved several seconds by
                one episode somebody left open while they took a call; the
                median is not, which is the whole reason the server computes it.
                Both are here because they answer different questions and the
                pair is what says whether a shift was steady. `null` when no
                review on this shift was timed — the server leaves untimed rows
                out of it rather than counting them as zero, and so does this.
              */}
              <Figure
                label={t('ui.a.home.median')}
                value={data ? pace(numberOrNull(data.median_seconds_to_verdict)) : null}
                unavailable={unavailable}
                note={t('ui.a.home.median.note')}
              />
              <Figure
                label={t('queue.average')}
                value={data ? pace(data.session_average_seconds) : null}
                unavailable={unavailable}
                note={t('ui.a.home.pace.note')}
              />
            </dl>
          </Panel>
        </div>

        <Settled
          className="mt-5"
          amount={data ? money(data.settled_amount, data.currency) : null}
          unavailable={unavailable}
        />
      </Reveal>

      {/* --- 4. The work itself, row by row. --- */}
      <RecentVerdicts currency={data?.currency ?? 'VND'} />

      {/* --- 5. Optional insights, and the only place a mascot speaks. --- */}
      <TrucPanel
        needsHuman={data?.needs_human ?? null}
        unavailable={unavailable}
        isPending={isPending}
        asOf={asOf}
        state={state}
      />
    </AppShell>
  );
}

/**
 * `median_seconds_to_verdict` arrives as a decimal string, or as nothing.
 *
 * `pace` takes a number and prints a dash for anything that is not one, so the
 * parse is the whole of the conversion — and a string the server could not
 * measure comes back `null` rather than as `NaN` dressed up as `0.0s`.
 */
function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * What needs a human, first on the page and reachable without the mascot.
 *
 * Three states and they are three different sentences. A count is a link into
 * `/episodes`, drawn in the attention hue and carrying its glyph. Zero is a
 * measurement too and says so quietly, with the time it was measured at. A
 * failed request says neither — "nothing needs attention" is a claim, and
 * a screen with no figures is not entitled to make it.
 */
function Attention({
  needsHuman,
  isPending,
  unavailable,
  asOf,
}: {
  needsHuman: number | null;
  isPending: boolean;
  unavailable: boolean;
  asOf: string | null;
}) {
  const { t } = useTranslation();

  if (isPending) return <Skeleton className="h-14 w-full rounded-[var(--radius-lg)]" />;

  if (unavailable || needsHuman === null) {
    return (
      <Panel className="flex items-center gap-3 px-5 py-4">
        <span className="num text-[1.0625rem] text-[var(--muted-foreground)]" aria-hidden="true">
          —
        </span>
        <p className="text-[0.875rem] text-[var(--muted-foreground)]">
          {t('ui.a.home.attention.unknown')}
        </p>
      </Panel>
    );
  }

  if (needsHuman === 0) {
    return (
      <Panel className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
        <p className="text-[0.875rem] font-semibold">{t('ui.a.home.attention.none')}</p>
        {asOf === null ? null : (
          <p className="num text-[0.8125rem] text-[var(--muted-foreground)]">
            {t('ui.a.home.asOf', { time: asOf })}
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Link
      to="/episodes"
      data-guide="home.needsHuman"
      className="group flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[var(--warn)]/40 bg-[var(--warn-bg)] px-5 py-4 no-underline transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--warn)]"
    >
      <IconAlert size={20} className="shrink-0 text-[var(--warn)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-bold text-[var(--warn)]">
          <span className="num">{needsHuman}</span> {t('home.needsHuman')}
        </p>
        <p className="mt-0.5 text-[0.875rem] text-[var(--warn)]">
          {t('home.needsHuman.body')}
          {asOf === null ? null : <span className="num"> {t('ui.a.home.asOf', { time: asOf })}</span>}
        </p>
      </div>
      <IconArrow
        size={18}
        className="shrink-0 text-[var(--warn)] transition-transform duration-150 ease-[var(--ease)] group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/**
 * The settled value: the one ink block this screen is allowed.
 *
 * `.feature-block` is `--stage` — the console's single near-black, the same one
 * the top bar and the review theatre use — and the figure inside it is mono at
 * the display step. The sentence under it is not decoration: DESIGN.md pins it
 * because a personal figure read as the programme's budget is wrong by orders
 * of magnitude. The arrow is a real link to the screen that owns the money, so
 * the block is a door and not a poster.
 */
function Settled({
  amount,
  unavailable,
  className,
}: {
  amount: string | null;
  unavailable: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div data-guide="home.settled" className={cn('feature-block relative px-6 py-6', className)}>
      <p className="text-[0.875rem] font-semibold text-[var(--stage-mid)]">{t('home.settled')}</p>
      {unavailable ? (
        <p className="mt-2 pr-14 text-[1.0625rem] text-[var(--stage-mid)]">
          {t('ui.a.home.unavailable')}
        </p>
      ) : amount === null ? (
        <div className="mt-2 h-[2.625rem] w-40 animate-pulse rounded-[var(--radius-sm)] bg-[var(--stage-panel)]" />
      ) : (
        /*
         * Printed, never counted up. Money is the one figure on this console
         * that must never pass through a value it was not measured at: an
         * animation from 0 to the total renders a sequence of amounts nobody
         * was ever paid, and a screenshot taken mid-tween is a wrong number
         * with a timestamp on it.
         */
        <p className="figure mt-1.5 pr-14 text-[var(--stage-fg)]">{amount}</p>
      )}
      <p className="mt-3 max-w-[52ch] text-[0.875rem] leading-relaxed text-[var(--stage-mid)]">
        {t('ui.a.home.settled.note')}
      </p>

      <Link
        to="/settle"
        search={{ period: defaultPeriod() }}
        aria-label={t('ui.a.home.settled.open')}
        title={t('ui.a.home.settled.open')}
        className={
          'absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full border ' +
          'border-[var(--stage-line)] bg-[var(--stage-panel)] text-[var(--stage-fg)] no-underline ' +
          'transition-[background-color,border-color,transform] duration-150 ease-[var(--ease)] ' +
          'hover:border-[var(--action)] hover:bg-[var(--action)] hover:text-[var(--action-ink)] ' +
          'active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]'
        }
      >
        <IconArrow size={19} />
      </Link>
    </div>
  );
}

/**
 * The last twenty verdicts this reviewer committed.
 *
 * Home without this is a page of aggregates, and an aggregate is exactly the
 * thing a reviewer cannot check. The individual rows are what let somebody
 * notice that the partial they marked at 11:04 paid less than they expected,
 * which is the first step of every payment dispute — so the row carries the
 * measured duration beside the effective one, and the amount beside both.
 *
 * **No still beside a row, and that is deliberate.** A picture next to an
 * episode id is a claim about what is in that recording, and this console has
 * no per-episode frame to make it with. A stock frame there would be the one
 * kind of decoration this screen cannot afford.
 */
function RecentVerdicts({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.recent(),
  });

  const reviews = data?.reviews ?? [];

  return (
    <Reveal className="mt-8" data-guide="home.recent">
      <h2 className="text-[1.0625rem] font-bold tracking-[-0.02em]">{t('recent.title')}</h2>

      <Panel className="mt-3 overflow-hidden">
        {isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : error ? (
          /*
           * A failed query is not an empty table.
           *
           * This branch did not exist: `data` was undefined on a 500, `reviews`
           * fell back to `[]`, and the screen printed "No verdicts yet this
           * session" — which is a claim about the reviewer's work, made out of
           * a database error. Same panel, same reference line as the figures
           * above, so the operator has one id to read out for both.
           */
          <div className="p-4">
            <Problem
              reference={error instanceof ApiError ? error.ref : undefined}
              title={t('ui.a.home.recent.error')}
              body={t('ui.a.home.error.body')}
            />
          </div>
        ) : reviews.length === 0 ? (
          <div className="hatch flex items-center justify-center px-5 py-10">
            <p className="text-[0.9375rem] text-[var(--muted-foreground)]">{t('recent.empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              {/*
                The header row this table went without.

                Four unlabelled columns of numbers is a table a reviewer has to
                decode from the values — and two of these columns are durations
                in the same format, so "which one is the measured one" was
                genuinely unanswerable from the screen. `2:12 → 2:12` is only
                obvious on a full pass. The arrow is inside the heading for the
                same reason it is inside the cell: the pair is one reading, not
                two columns that happen to be adjacent.
              */}
              <thead>
                <tr className="border-b border-[var(--border-strong)]">
                  <Th className="pl-5">{t('ui.a.home.recent.time')}</Th>
                  <Th>{t('ui.a.home.recent.episode')}</Th>
                  <Th>{t('ui.a.home.recent.verdict')}</Th>
                  <Th className="w-full">{t('ui.a.home.recent.duration')}</Th>
                  <Th align="right">{t('ui.a.home.recent.amount')}</Th>
                  <Th align="right" className="pr-5">
                    {t('ui.a.home.recent.pace')}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => {
                  const verdict =
                    r.reviewState === 'pass'
                      ? 'good'
                      : r.reviewState === 'partial_pass'
                        ? 'partial'
                        : 'bad';
                  return (
                    <tr
                      key={r.reviewId}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                    >
                      <td className="num py-2.5 pl-5 pr-3 text-[0.8125rem] whitespace-nowrap text-[var(--muted-foreground)]">
                        {stampLocal(r.reviewedAt)}
                      </td>
                      {/*
                        The episode this verdict was about.

                        A dispute starts with somebody naming one episode, and
                        until this column existed the screen could show that a
                        partial paid ₫1,582 without saying *which* recording
                        that was. The id is a uuid, so the cell prints the head
                        of it — enough to match against a row on `/episodes` or
                        a line on a bill — and carries the whole thing in
                        `title` for copying. It is text and not a link: this
                        console has no route for one episode, and a link that
                        goes to a list is a link that lied.
                      */}
                      <td
                        className="num px-3 py-2.5 text-[0.8125rem] text-[var(--muted-foreground)]"
                        title={r.episodeId}
                      >
                        {r.episodeId.slice(0, 8)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <VerdictPill verdict={verdict} size="sm">
                          {t(`verdict.${verdict}`)}
                        </VerdictPill>
                      </td>
                      <td className="num px-3 py-2.5 text-[0.8125rem] whitespace-nowrap text-[var(--muted-foreground)]">
                        {durationShort(r.measured)}
                        {' → '}
                        <span className="font-semibold text-[var(--foreground)]">
                          {durationShort(r.effective)}
                        </span>
                      </td>
                      <td className="num px-3 py-2.5 text-right text-[0.8125rem] font-semibold">
                        {money(r.amount, currency)}
                      </td>
                      <td className="num py-2.5 pl-3 pr-5 text-right text-[0.8125rem] text-[var(--muted-foreground)]">
                        {r.seconds === null ? '—' : pace(Number(r.seconds))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Reveal>
  );
}

/**
 * Trúc: an additional channel, last on the page, and held to the same standard
 * as every figure above him.
 *
 * The greeting is authored and costs nothing. The one operational sentence he
 * says is the attention count — the same field, the same query, the same
 * freshness stamp and the same failure behaviour as the strip at the top of
 * this screen, which is still there and is still the channel that matters. On
 * a failed request he says "Not connected" and shows a dash; he never fills the
 * hole with an example.
 *
 * **The preview is entered by hand and never by the screen.** `Shift` carries
 * current figures and no history, so a trend has nothing behind it. The tiles
 * below the toggle demonstrate the shape of a panel that does not exist yet,
 * every one of them labelled "Example — not live data", and none of them ever
 * stands where a live figure failed to load.
 *
 * **He idles, so he can be stopped.** Breathing and blinking run for as long as
 * the tab is visible, which is exactly the moving content WCAG 2.2's Pause,
 * Stop, Hide is about; reduced motion is a different user and a different
 * setting. The button is real, it is beside him, and it is keyboard-reachable.
 */
function TrucPanel({
  needsHuman,
  unavailable,
  isPending,
  asOf,
  state,
}: {
  needsHuman: number | null;
  unavailable: boolean;
  isPending: boolean;
  asOf: string | null;
  state: MascotState;
}) {
  const { t } = useTranslation();
  /** A viewport of warning, so the chunk and the glTF land before he is read. */
  const [ref, near] = useOnScreen<HTMLElement>('100% 0px');
  const [paused, setPaused] = useState(false);
  const [preview, setPreview] = useState(false);

  /** The one thing he asserts, and the source it comes from. */
  const status = isPending
    ? null
    : unavailable || needsHuman === null
      ? { text: t('ui.a.home.truc.offline'), figure: '—', muted: true }
      : needsHuman === 0
        ? { text: t('ui.a.home.attention.none'), figure: null, muted: false }
        : { text: t('home.needsHuman'), figure: String(needsHuman), muted: false };

  return (
    <section ref={ref} className={cn('reveal mt-8', near && 'reveal-in')}>
      <h2 className="text-[1.0625rem] font-bold tracking-[-0.02em]">{t('ui.a.home.insights')}</h2>
      <p className="mt-1 max-w-[68ch] text-[0.875rem] text-[var(--muted-foreground)]">
        {t('ui.a.home.truc.lede')}
      </p>

      <Panel className="mt-3 p-5 sm:p-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="flex shrink-0 flex-col items-center gap-2">
            {/*
              The flat panda holds his place at the same size until the chunk
              arrives, so nothing on the page moves when it does — and if there
              is no WebGL, or the driver refuses the renderer, the stage falls
              back to this same drawing on its own.
            */}
            {near ? (
              <Suspense fallback={<Panda size={196} state={state} />}>
                <PandaStage size={196} paused={paused} label={t('login.trucTitle')} />
              </Suspense>
            ) : (
              <Panda size={196} state={state} />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={paused}
              onClick={() => setPaused((on) => !on)}
            >
              {paused ? t('ui.a.home.truc.resume') : t('ui.a.home.truc.pause')}
            </Button>
          </div>

          <div className="min-w-0 flex-1">
            {/*
              One key, one sentence, punctuation and all.

              It was assembled here — greeting, space, shift name, a full stop
              written in the `.tsx` — and Chinese renders that as `你好。 白班.`:
              a Latin period after a CJK clause that already ends in one, plus a
              Latin word space CJK does not use. A sentence is not two strings
              and a separator; the separator is part of the language.
            */}
            <p className="text-[1.0625rem] font-bold tracking-[-0.01em]">
              {t('ui.a.home.truc.greet', { shift: t(SHIFT_KEY[state]) })}
            </p>

            {status === null ? (
              <Skeleton className="mt-3 h-6 w-2/3" />
            ) : (
              <p
                className={cn(
                  'mt-3 text-[0.9375rem]',
                  status.muted && 'text-[var(--muted-foreground)]',
                )}
              >
                {status.figure === null ? null : (
                  <span className="num font-semibold">{status.figure} </span>
                )}
                {status.text}
              </p>
            )}

            {/*
              Where he got it, and when. The same two facts every operational
              sentence on this screen carries — without them a mascot saying
              "nothing needs attention" is a mascot's opinion.
            */}
            <p className="mt-1.5 text-[0.8125rem] text-[var(--muted-foreground)]">
              {t('ui.a.home.truc.source')}
              {asOf === null ? null : <span className="num"> {t('ui.a.home.asOf', { time: asOf })}</span>}
            </p>

            <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-expanded={preview}
                onClick={() => setPreview((on) => !on)}
              >
                {preview ? t('ui.a.home.preview.hide') : t('ui.a.home.preview.show')}
              </Button>
              <p className="min-w-0 flex-1 text-[0.8125rem] text-[var(--muted-foreground)]">
                {t('ui.a.home.preview.why')}
              </p>
            </div>
          </div>
        </div>

        {preview ? (
          <div className="mt-6 border-t border-[var(--border)] pt-6">
            <p className="max-w-[68ch] text-[0.875rem] text-[var(--muted-foreground)]">
              {t('ui.a.home.preview.note')}
            </p>
            <ul className="mt-4 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3">
              <ExampleTile
                image="/tiles/hf-garden.jpg"
                label={t('ui.a.home.preview.trend')}
                value={t('ui.a.home.preview.trendValue')}
              />
              <ExampleTile
                image="/tiles/film-kitchen.jpg"
                label={t('ui.a.home.preview.week')}
                value="4:12:30"
              />
              <ExampleTile
                image="/tiles/film-books.jpg"
                label={t('ui.a.home.preview.streak')}
                value="12"
              />
            </ul>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}

/**
 * One demonstration, and it says so beside the value rather than once at the
 * top of the group.
 *
 * The badge is next to every figure on purpose: a heading two hundred pixels
 * away is not what somebody photographs, and a screenshot of a tile with no
 * label on it is indistinguishable from a measurement. The picture sits above
 * the type rather than behind it, so nothing here is text on a photograph and
 * nothing here needs a scrim.
 */
function ExampleTile({ image, label, value }: { image: string; label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <li className="overflow-hidden rounded-[var(--radius-base)] border border-[var(--border)] bg-[var(--card)]">
      <img
        src={image}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="block h-28 w-full object-cover"
      />
      <div className="p-4">
        <p className="text-[0.8125rem] text-[var(--muted-foreground)]">{label}</p>
        <p className="num mt-1 text-[1.3125rem] font-medium tracking-[-0.02em]">{value}</p>
        <p className="mt-2 inline-block rounded-[var(--radius-sm)] bg-[var(--muted)] px-2 py-0.5 text-[0.75rem] font-semibold text-[var(--muted-foreground)]">
          {t('ui.a.home.preview.badge')}
        </p>
      </div>
    </li>
  );
}

/**
 * A column heading, in the register `/episodes` already uses for its tables —
 * 12px, semibold, tracked and upper case. Uppercase is not this world's habit
 * anywhere else; it is here because a header row has to read as a different
 * kind of thing from the twenty rows of data under it without a second rule or
 * a fill, and because the console's other table already made that choice.
 */
function Th({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={
        /*
          `whitespace-nowrap`, because these headings are translated. "Pace"
          is one short word in English and 用时 in Chinese, and the narrow
          columns at 1280 broke both that heading and the verdict pill under
          it into stacked characters — a column head reading vertically is a
          column head somebody has to decode.
        */
        'whitespace-nowrap px-3 py-2 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] ' +
        (align === 'right' ? 'text-right ' : 'text-left ') +
        (className ?? '')
      }
    >
      {children}
    </th>
  );
}

/**
 * The gauge: a 240° arc, and nothing standing inside it.
 *
 * An arc rather than a bar because it holds the target and the current value in
 * one shape at a size worth looking at, and because a bar that reaches its end
 * has nowhere left to go — a reviewer past target should see that, not see a
 * full bar.
 *
 * **Trúc is not in it any more.** He stood in the middle of the ring, at a size
 * where a character with a fixed camera and a pointer-driven yaw reads as a
 * figure trapped in a hoop rather than as a mascot. The product owner called it
 * uncanny and it was. The ring is a measurement and it is now only that; he has
 * his own panel at the foot of the page, where he is a character rather than a
 * decoration inside an instrument.
 *
 * **The stroke steps, corrected.** The arc drew in `lime-500`, which is the
 * ramp's *fill* step and is asserted by `contrast.test.ts` to fall **under**
 * 3:1 on every light ground — measured 1.08:1 against the `--muted` track it is
 * drawn on, so the one graphic on this screen that carries a quantity was the
 * one that could not be told from its own background. It is `lime-600` now,
 * which is the ramp's stroke step: 3.44:1 on the light muted fill and 3.42:1 on
 * the dark one. Past target it becomes `--lime-ink`, the per-scheme step, which
 * measures 4.59:1 light and 12.53:1 dark — where the old `lime-700` read 2.57:1
 * on the dark track. Lime is progress and emphasis in this world and is barred
 * from verdicts and from money; a ring that carries a count of episodes is
 * exactly what it is for.
 *
 * The sweep is the console's one authored performance: 900ms, once, when the
 * ring reaches the viewport. The arc is drawn at its true offset whether or not
 * that ever happens, so a gauge nobody scrolls to reads the right number rather
 * than reading zero.
 */
function Gauge({
  value,
  target,
}: {
  /**
   * `null` on both when the shift query failed. The ring then draws its track
   * and nothing else, the count is a dash and the caption drops the target —
   * rather than an empty arc reading "0 of 60", which is a measurement.
   */
  value: number | null;
  target: number | null;
}) {
  const { t } = useTranslation();
  const [ref, seen] = useOnScreen<HTMLElement>('0px');
  const R = 104;
  const CX = 150;
  const CY = 128;
  /**
   * The stroke, fattened from 15 to 22.
   *
   * At 15 the ring read as a hairline diagram beside a 240px card of white, and
   * the accent — the one colour on this screen that means "how far along" — was
   * the thinnest mark on it. 22 is a fourteenth of the diameter, which is the
   * weight the ring-card comp draws, and it is what lets the fill be seen from
   * a metre away at a counter.
   */
  const STROKE = 22;
  const SWEEP = 240;
  /**
   * Degrees clockwise from twelve o'clock: 240° is the lower left, and sweeping
   * 240° clockwise from there ends at the lower right. That leaves the opening
   * at the bottom, under the value — which is the only arrangement where the
   * number reads as the thing the arc is measuring rather than as a caption
   * that happens to sit nearby.
   */
  const START = 240;

  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
  };

  const a = polar(START);
  const b = polar(START + SWEEP);
  /** large-arc-flag 1 because the sweep exceeds 180°; sweep-flag 1 for clockwise. */
  const track = `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 1 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;

  const arcLength = (SWEEP / 360) * 2 * Math.PI * R;
  const known = value !== null && target !== null;
  const ratio = known && target > 0 ? Math.min(value / target, 1) : 0;
  const over = known && target > 0 && value > target;

  return (
    <figure
      ref={ref}
      className="relative m-0 w-[300px] max-w-full"
      role="img"
      aria-label={known ? t('ui.a.home.gauge', { value, target }) : t('ui.a.home.unavailable')}
    >
      <div className="relative">
        <svg viewBox="0 0 300 196" width="300" className="block max-w-full">
          <path
            d={track}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
          <path
            className={seen ? 'gauge-fill' : undefined}
            d={track}
            fill="none"
            stroke={over ? 'var(--lime-ink)' : 'var(--lime-600)'}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={arcLength}
            style={
              {
                '--sweep-from': `${arcLength}`,
                '--sweep-to': `${arcLength * (1 - ratio)}`,
                strokeDashoffset: arcLength * (1 - ratio),
              } as React.CSSProperties
            }
          />
        </svg>

        {/*
          The count, on the ring's own centre, and it is HTML rather than an
          SVG `<text>`: plain text inherits the font stack and the locale's own
          digits instead of being a drawing of a number.

          The offset is a percentage of the drawn box and not a pixel figure —
          the centre of the arc is y=128 of a 196-unit viewBox, which is 65.3%
          — so the number stays on the centre when the svg is scaled down
          inside a narrow panel instead of drifting off it.
        */}
        <p className="num absolute inset-x-0 top-[65.3%] m-0 -translate-y-1/2 text-center text-[2.625rem] font-extrabold leading-none tracking-[-0.03em]">
          {value ?? '—'}
        </p>
      </div>

      <figcaption className="mt-2 text-center text-[0.875rem] text-[var(--muted-foreground)]">
        {t('ui.a.home.gaugeCaption')}
        {target === null ? null : (
          <>
            {' · '}
            {t('home.target')}{' '}
            <span className="num font-semibold text-[var(--foreground)]">{target}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * One measured quantity, sitting with the sentence that says what it is not.
 *
 * Deliberately not a card: the label reads at body size in sentence case, the
 * value is mono because it is measured, and the note is a full sentence
 * underneath. A big number with a small tracked label above it and an accent
 * under it is the template this refuses — it makes unrelated figures look like
 * one comparable set, and two of these are not money at all.
 */
function Figure({
  label,
  value,
  note,
  trailing,
  unavailable = false,
}: {
  label: string;
  value: string | null;
  note: string;
  trailing?: React.ReactNode;
  /**
   * The query finished and produced nothing. Distinct from `value === null`,
   * which is still loading: a skeleton that never resolves and a zero are the
   * two ways this screen used to lie about a failed request.
   */
  unavailable?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-[var(--border)] py-4 last:border-0">
      {/*
        The note lives inside the `<dt>` rather than in a sibling paragraph:
        a `<dl>` group may hold only terms and descriptions, and the sentence
        belongs to the term — it says what this figure is, not what its value
        is. Flow content inside a `<dt>` is allowed and this keeps the markup
        a real description list instead of three divs pretending to be one.
      */}
      <dt className="text-[0.9375rem] font-semibold">
        {label}
        <span className="mt-1 block max-w-[52ch] text-[0.8125rem] font-normal leading-snug text-[var(--muted-foreground)]">
          {note}
        </span>
      </dt>
      {unavailable ? (
        <dd className="m-0 text-[0.9375rem] text-[var(--muted-foreground)]">
          {t('ui.a.home.unavailable')}
        </dd>
      ) : value === null ? (
        <dd className="m-0">
          <Skeleton className="h-7 w-24" />
        </dd>
      ) : (
        <dd className="m-0 flex items-center gap-2">
          {trailing}
          <span className="num text-[1.625rem] font-medium tracking-[-0.02em]">{value}</span>
        </dd>
      )}
    </div>
  );
}
