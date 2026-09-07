/**
 * Home: what the shift has done, and the one action worth taking.
 *
 * The composition refuses the dashboard default — a row of four identical stat
 * cards above a table. There is exactly one hero here, the gauge, because
 * there is exactly one number a reviewer is judged on, and the primary action
 * sits directly under it so the distance between "how am I doing" and "carry
 * on" is one glance and one key.
 *
 * **The figures are a ledger, not four cards.** Three measured quantities in
 * one panel, each sitting with the sentence that says what it is and what it
 * is not. A figure whose note is somewhere else is a figure somebody will
 * misread, and on this screen a misread figure is a person thinking they have
 * been paid.
 *
 * **One ink block, and it has to earn it.** `.feature-block` appears once per
 * screen and only where a figure carries its own sentence and its own action
 * — here the settled value, "Your decisions only. Not the programme's spend."
 * and the arrow to `/settle`. It is not the big-number-small-label template
 * with a dark background: take away either the sentence or the arrow and the
 * block should go back to being a row in the ledger above it.
 *
 * **The strip at the bottom is not a metric.** An unresolved episode is
 * somebody's unpaid recording sitting still, so it gets a sentence and a way
 * in rather than a number in a grid.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button, Key } from '../components/ui/button.tsx';
import { Panel, Problem, Skeleton, VerdictPill } from '../components/ui/primitives.tsx';
import { Panda } from '../components/identity/Panda.tsx';
import { mascotStateAt, type MascotState } from '@playerone/design/tokens';
import { IconAlert, IconArrow } from '../components/icons.tsx';
import { durationShort, money, pace, stampLocal } from '../lib/format.ts';
import { api, ApiError, type Shift } from '../lib/api.ts';
import { defaultPeriod } from '../payout/period.ts';

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

/** `19:42` on the clock of the machine that decided which shift this is. */
function localClock(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
  const { data, isPending, error } = useQuery<Shift | null>({
    queryKey: ['shift'],
    queryFn: () => api.shift(),
    /** The shift figures move as the reviewer works; a minute is close enough. */
    refetchInterval: 60_000,
  });

  /**
   * The query is done and there are no figures.
   *
   * Every value on this screen used to fall back to a literal on error —
   * `data?.decided ?? 0` under the gauge, `durationShort(data?.payable_seconds
   * ?? '0')` in the ledger — so a 500 photographed as "0 episodes reviewed"
   * and "0:00 payable". A reviewer cannot tell that apart from a shift where
   * they have genuinely done nothing, and on this screen that difference is
   * whether somebody has been paid. There is no measurement here, so the
   * screen says so.
   */
  const unavailable = !isPending && !data;

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
        <div className="mb-6">
          <Problem
            reference={error instanceof ApiError ? error.ref : undefined}
            title={t('ui.a.home.error.title')}
            body={t('ui.a.home.error.body')}
          />
        </div>
      ) : null}

      {/* ---------------------------------------------------------------
          The band, and it is the recomposition this screen was missing.

          The world changed on 2026-09-07 and for one round this page only
          changed colour — same two panels, same gauge, same table, repainted
          lavender. Daniel said it looked exactly like the previous version and
          he was right: a palette is not a composition.

          So the shift now opens on the work itself. A frame of collected
          footage runs the full width under a measured ink scrim, and the three
          things a reviewer needs on arrival sit on it: which shift this is and
          what time that is on the machine deciding it, how far through the
          target they are, and the way in. The gauge moved here from its own
          panel — it is still the one hero and there is still exactly one, it
          is simply no longer floating on paper next to the ledger.

          The image is `landing-poster.jpg`, the same still the sign-in film
          opens on. ponytail: when an episode still is reachable per reviewer,
          this becomes the next episode in their own queue, which is a better
          picture than a stock frame because it is the one they are about to
          judge.
          --------------------------------------------------------------- */}
      <section
        data-guide="home.gauge"
        className="relative isolate overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)]"
      >
        <img
          src="/landing-poster.jpg"
          alt=""
          aria-hidden="true"
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

        <div className="flex flex-col gap-6 p-6 text-[var(--stage-over)] lg:flex-row lg:items-center lg:gap-10 lg:p-9">
          <div className="min-w-0 flex-1">
            <h1 className="text-[0.875rem] font-semibold" title={t('ui.a.home.clock')}>
              {t('home.greeting')} · {t(SHIFT_KEY[state])} ·{' '}
              <span className="num">{localClock()}</span>
            </h1>
            <p className="mt-3 text-[2.75rem] font-extrabold leading-[1.02] tracking-[-0.035em]">
              {isPending ? '—' : (data?.decided ?? '—')}
              <span className="text-[1.25rem] font-bold opacity-80">
                {' '}
                / {isPending ? '—' : (data?.target ?? '—')}
              </span>
            </p>
            <p className="mt-1 text-[0.9375rem] opacity-90">{t('ui.a.home.gaugeCaption')}</p>
            {/*
              The arc, drawn small and wordless beside the figure.

              `Gauge` prints the count and a caption inside its own ring, which
              is right when it is the page's hero on paper and wrong here: the
              band already says "3 / 60" in 44px type, and the ring repeating it
              was the same number twice, with its caption in a muted grey that
              measures nothing readable on the ink scrim. `bare` keeps the arc
              and Trúc and drops the type.
            */}

            <Button asChild variant="primary" size="lg" data-guide="home.start" className="mt-6">
              <Link to="/review">
                {t('home.start')}
                <Key>R</Key>
              </Link>
            </Button>
          </div>

          {isPending ? (
            <Skeleton className="h-[212px] w-[212px] shrink-0 rounded-full" />
          ) : (
            <div className="shrink-0 self-center">
              <Gauge value={data?.decided ?? null} target={data?.target ?? null} state={state} bare />
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------
          The ledger and the ink block, side by side now that the gauge has
          gone up into the band. Two columns of equal weight rather than a
          narrow rail beside a wide one: neither of these is subordinate to the
          other, and the old 400px rail existed to hold a gauge that is no
          longer in it.
          --------------------------------------------------------------- */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* column one: the ledger */}
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
              <Figure
                label={t('queue.average')}
                value={data ? pace(data.session_average_seconds) : null}
                unavailable={unavailable}
                note={t('ui.a.home.pace.note')}
              />
            </dl>
          </Panel>
        </div>

        {/* column two: the one ink block, which has its own sentence and its
            own way out and so earns the weight. */}
        <Settled
          amount={data ? money(data.settled_amount, data.currency) : null}
          unavailable={unavailable}
        />
      </div>

      {/* --- The strip that is not a metric. --- */}
      {data && data.needs_human > 0 ? (
        <Link
          to="/episodes"
          data-guide="home.needsHuman"
          className="group mt-6 flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[var(--lavender-300)] bg-[var(--lavender-200)] px-5 py-4 no-underline transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--action)]"
        >
          <IconAlert size={20} className="shrink-0 text-[var(--warn)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] font-bold text-[var(--warn)]">
              <span className="num">{data.needs_human}</span> {t('home.needsHuman')}
            </p>
            <p className="mt-0.5 text-[0.875rem] text-[var(--warn)]">
              {t('home.needsHuman.body')}
            </p>
          </div>
          <IconArrow
            size={18}
            className="shrink-0 text-[var(--warn)] transition-transform duration-150 ease-[var(--ease)] group-hover:translate-x-0.5"
          />
        </Link>
      ) : null}

      <RecentVerdicts currency={data?.currency ?? 'VND'} />
    </AppShell>
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
function Settled({ amount, unavailable }: { amount: string | null; unavailable: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-guide="home.settled" className="feature-block relative px-6 py-6">
      <p className="text-[0.875rem] font-semibold text-[var(--stage-mid)]">{t('home.settled')}</p>
      {unavailable ? (
        <p className="mt-2 pr-14 text-[1.0625rem] text-[var(--stage-mid)]">
          {t('ui.a.home.unavailable')}
        </p>
      ) : amount === null ? (
        <div className="mt-2 h-[2.75rem] w-40 animate-pulse rounded-[var(--radius-sm)] bg-white/10" />
      ) : (
        <p className="figure mt-1.5 pr-14 text-[var(--stage-fg)]">{amount}</p>
      )}
      <p className="mt-3 max-w-[38ch] text-[0.875rem] leading-relaxed text-[var(--stage-mid)]">
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
 */
function RecentVerdicts({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const { data, isPending, error } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.recent(),
  });

  const reviews = data?.reviews ?? [];

  return (
    <section className="mt-6" data-guide="home.recent">
      <h2 className="text-[0.9375rem] font-bold tracking-[-0.01em]">{t('recent.title')}</h2>

      <Panel className="mt-2 overflow-hidden">
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
                      <td className="px-3 py-2.5">
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
    </section>
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
        'px-3 py-2 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] ' +
        (align === 'right' ? 'text-right ' : 'text-left ') +
        (className ?? '')
      }
    >
      {children}
    </th>
  );
}

/**
 * The gauge: a 240° arc with Trúc standing in the middle of it.
 *
 * An arc rather than a bar because it holds the target and the current value in
 * one shape at a size worth looking at, and because a bar that reaches its end
 * has nowhere left to go — a reviewer past target should see that, not see a
 * full bar. The sweep is one of the console's two authored motions: 900ms,
 * once, on load.
 *
 * **Bamboo, and never mistakable for a verdict.** The fill is `bamboo-600`,
 * which is the stroke step (3.01:1 on the muted track, the exact pair the
 * contrast test pins). Bamboo is barred from verdicts and from money, and this
 * ring carries three things that keep it on the right side of that line: a gap
 * at the bottom, the count printed as text, and a caption naming the unit. Past
 * target the stroke moves to `--pass`, which is the one moment the two
 * vocabularies meet on purpose — and the caption still says what it counts.
 *
 * The panda is positioned over the arc rather than inside a `foreignObject`:
 * `PandaStage` mounts a WebGL canvas, and a canvas inside an SVG is a rendering
 * path nothing else in this console depends on.
 */
function Gauge({
  value,
  target,
  state,
  bare = false,
}: {
  /**
   * `null` on both when the shift query failed. The ring then draws its track
   * and nothing else, the count is a dash and the caption drops the target —
   * rather than an empty arc reading "0 of 60", which is a measurement.
   */
  value: number | null;
  target: number | null;
  state: MascotState;
  /**
   * Draw the arc and Trúc, and none of the type.
   *
   * The ring prints its own count and caption, which is right where it is the
   * hero on paper. In the band it is beside a 44px figure saying the same
   * thing, and its caption is a muted grey with nothing readable to sit on
   * over an ink scrim. This drops both; the band's own type says it once.
   */
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const R = 104;
  const CX = 150;
  const CY = 128;
  /**
   * The stroke, fattened from 15 to 22.
   *
   * At 15 the ring read as a hairline diagram beside a 240px card of white,
   * and the bamboo — the one colour on this screen that means "how far along"
   * — was the thinnest mark on it. 22 is a fourteenth of the diameter, which
   * is the weight the ring-card comp draws, and it is what lets the fill be
   * seen from a metre away at a counter. `bamboo-600` on `--muted` is pinned
   * at 3.01:1 by the contrast test and nothing here changes that pair.
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
      className="relative m-0 mt-3 w-[300px] max-w-full"
      role="img"
      aria-label={known ? t('ui.a.home.gauge', { value, target }) : t('ui.a.home.unavailable')}
    >
      <svg viewBox="0 0 300 196" width="300" className="block max-w-full">
        <path
          d={track}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        <path
          className="gauge-fill"
          d={track}
          fill="none"
          /*
           * Bamboo whether or not the target is behind you. Turning the ring
           * pass-green at 60 episodes made a shift's progress wear the colour
           * that means a collector was paid; the deeper step marks the
           * milestone without borrowing that meaning.
           */
          stroke={over ? 'var(--lime-700)' : 'var(--lime-500)'}
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
        Trúc, standing in the ring at the size the comp draws him — and drawn
        flat, not in three.js.

        `PandaStage` was here at `size={120}`, which is 61px of character in a
        186px ring: a toy in a hoop. Enlarging it was easy; facing him forward
        was not. The stage's camera is fixed at 34° on the z axis and the only
        rotation in it is a yaw the model takes from the pointer, clamped and
        zero at rest — so `truc.glb`, which is authored facing the camera's
        right, renders in profile whatever size it is passed. Measured, not
        assumed: with the pointer parked on the exact centre of the canvas and
        the scene settled for two seconds, the render is still a side view
        (`.impeccable/a/panda-centre.png`). Nothing in this route's scope can
        turn him; the fix is one `rotation.y` on the loaded scene inside
        `PandaStage`, which the identity track owns.

        So the ring gets the flat `Panda`, which is drawn front-facing from the
        same turnaround sheet, in the same six fills, and is what the ring-card
        comp shows. At 182px he stands with his shadow on the arc's lower ends
        and about 10px of air over his ears. He is also the same artwork the
        collector app ships, so the mascot at the centre of both products'
        first screen is now literally the same drawing.
      */}
      <div className="pointer-events-none absolute left-[150px] top-[100px] -translate-x-1/2 -translate-y-1/2">
        <Panda size={168} state={state} />
      </div>

      {/*
        The count, under the ring's opening rather than inside the arc.

        It is HTML and not an SVG `<text>` now: the numeral was competing with
        the character for the middle of the ring, and moving it below the gap is
        what let Trúc have the ring. Plain text also means it inherits the
        font stack and the locale's own digits instead of being a drawing of a
        number.
      */}
{bare ? null : (
        <>
      <p className="num relative m-0 text-center text-[2.75rem] font-extrabold leading-none tracking-[-0.03em]">
        {value ?? '—'}
      </p>

      <figcaption className="mt-2 text-center text-[0.875rem] text-[var(--muted-foreground)]">
        {t('home.reviewed')}
        {target === null ? null : (
          <>
            {' · '}
            {t('home.target')}{' '}
            <span className="num font-semibold text-[var(--foreground)]">{target}</span>
          </>
        )}
      </figcaption>
        </>
      )}
    </figure>
  );
}

/**
 * One measured quantity, sitting with the sentence that says what it is not.
 *
 * Deliberately not a card: the label reads at body size in sentence case, the
 * value is mono because it is measured, and the note is a full sentence
 * underneath. A big number with a small tracked label above it and an accent
 * under it is the template this refuses — it makes four unrelated figures look
 * like one comparable set, and two of these four are not money at all.
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
